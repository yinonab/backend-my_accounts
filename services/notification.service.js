// services/notification.service.js
import admin from "firebase-admin";

import webpush from 'web-push';
import { config } from '../config/index.js';
import { dbService } from './db.service.js';
import { logger } from './logger.service.js';
import dotenv from 'dotenv';
dotenv.config(); // וודא שזה נטען
if (!admin.apps.length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);  // טען את המפתח מתוך משתנה הסביבה

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),  // השתמש במפתח מתוך המשתנה
    });
}

console.log("🔥 Firebase Admin SDK Initialized");
console.log('🔍 Loading Notification Service', new Date().toISOString());
console.log('🔑 Environment Variables:', {
    vapidPublicKey: config.notifications.vapidPublicKey ? 'VALID' : 'MISSING',
    vapidPrivateKey: config.notifications.vapidPrivateKey ? 'VALID' : 'MISSING',
    vapidContact: config.notifications.vapidContact
});
const vapidPublicKey = config.notifications.vapidPublicKey;
console.log('🔑 Server VAPID Public Key:', vapidPublicKey);


console.log('Config loaded:', {
    vapidPublicKey: config.notifications.vapidPublicKey,
    vapidPrivateKey: config.notifications.vapidPrivateKey?.substring(0, 5) + '...', // לא להדפיס את כל המפתח הפרטי
    vapidContact: config.notifications.vapidContact
});
console.log('Loaded VAPID Public Key:', config.notifications.vapidPublicKey);

const COLLECTION_NAME = 'notifications';
try {
    console.log('🌐 Attempting to set VAPID Details');
    webpush.setVapidDetails(
        config.notifications.vapidContact,
        config.notifications.vapidPublicKey,
        config.notifications.vapidPrivateKey
    );
    console.log('✅ VAPID Details set successfully');
} catch (vapidError) {
    console.error('❌ Failed to set VAPID Details:', vapidError);
}


console.log('VAPID Public Key:', config.notifications.vapidPublicKey);
console.log('VAPID Private Key:', config.notifications.vapidPrivateKey);
console.log('VAPID Contact:', config.notifications.vapidContact);
// הגדרת המפתחות של VAPID
webpush.setVapidDetails(
    config.notifications.vapidContact,
    config.notifications.vapidPublicKey,
    config.notifications.vapidPrivateKey
);
createIndexes();
async function createIndexes() {
    console.log('📦 Attempting to create notification indexes');
    try {
        const collection = await dbService.getCollection(COLLECTION_NAME);
        // console.log('🔍 Creating index on userId');
        await collection.createIndex({ userId: 1 });
        //  console.log('🔍 Creating index on userId and createdAt');
        await collection.createIndex({ userId: 1, createdAt: -1 });
        //    console.log('✅ Notification indexes created successfully');
        //  logger.info('Notification indexes created');
    } catch (err) {
        logger.error('Failed to create indexes', err);
        //  console.error('❌ Failed to create indexes:', err);
    }
}

async function saveSubscription(token, userId) {
    // console.log(`📥 Attempting to save subscription for user: ${userId}`, {
    //     subscriptionDetails: {
    //         endpoint: token.endpoint ? 'PRESENT' : 'MISSING',
    //         keys: subscription.keys ? Object.keys(subscription.keys) : 'NO KEYS'
    //     }
    // });
    try {
        console.log('Attempting to save subscription:', {
            userId,
            // subscription: JSON.stringify(subscription).substring(0, 100) + '...'
        });
        const collection = await dbService.getCollection(COLLECTION_NAME);

        // בדיקה אם כבר קיים subscription לאותו משתמש
        const existingSubscription = await collection.findOne({ userId });
        if (existingSubscription && existingSubscription.token === token) {
            console.log(`✅ Token for user: ${userId} is already up to date.`);
            return;
        }

        if (existingSubscription) {
            console.log(`🔄 Updating existing subscription for user: ${userId}`);
            // עדכון subscription קיים
            const updateResult = await collection.updateOne(
                { userId },
                { $set: { token, updatedAt: new Date() } }
            );
            console.log('✅ Subscription update result:', updateResult);

            console.log(`Updated subscription for user: ${userId}, Matched: ${updateResult.matchedCount}, Modified: ${updateResult.modifiedCount}`);
            logger.info(`Updated subscription for user: ${userId}`);
        } else {
            console.log(`➕ Creating new subscription for user: ${userId}`);
            // יצירת subscription חדש
            const insertResult = await collection.insertOne({ userId, token, createdAt: new Date() });
            console.log('✅ Subscription insert result:', insertResult);

            logger.info(`Created new subscription for user: ${userId}`);
        }
    } catch (err) {
        console.error('❌ Failed to save subscription:', err);
        logger.error('Failed to save subscription', err);
        throw err;
    }
}

async function sendNotification(userId, payload) {
    const defaultIcon = "https://res.cloudinary.com/dzqnyehxn/image/upload/v1739858070/belll_fes617.png";
    const messageId = payload.id || `msg_${Date.now()}`;
    const isSilent = payload.type === "keep-alive";
    const isHighPriority = payload.priority === "high" || !isSilent;

    // הדפסות אבחון ראשוניות
    console.log('🚀 Initiating notification process:', {
        messageId,
        userId,
        isSilent,
        isHighPriority,
        payloadSummary: {
            title: payload.title,
            body: payload.body?.substring(0, 50) + (payload.body?.length > 50 ? '...' : ''),
            type: payload.type || 'regular'
        }
    });

    try {
        const collection = await dbService.getCollection(COLLECTION_NAME);
        const userSubscription = await collection.findOne({ userId });

        // בדיקות טוקן מפורטות
        if (!userSubscription?.token) {
            const errorMsg = `❌ [FCM-ERROR] No valid token for user ${userId}`;
            console.error(errorMsg, {
                errorType: 'MISSING_TOKEN',
                severity: 'HIGH',
                solution: 'Verify user registration flow',
                userId,
                dbRecordExists: !!userSubscription
            });
            return { success: false, error: errorMsg };
        }

        // בניית הודעת FCM מותאמת לרקע
        const message = {
            token: userSubscription.token,
            data: {
                ...payload.data,
                title: String(payload.title || ''),
                body: String(payload.body || ''),
                icon: String(payload.icon || defaultIcon),
                badge: payload.badge || defaultIcon,
                sound: payload.sound || 'default',
                type: payload.type || 'regular',
                silent: String(!!payload.silent),
                wakeUpApp: String(!!payload.wakeUpApp),
                requireInteraction: String(!!payload.requireInteraction),
                click_action: "FLUTTER_NOTIFICATION_CLICK",
                timestamp: Date.now().toString(),
                messageId
            },
            android: {
                priority: isHighPriority ? "high" : "normal",
                ttl: isHighPriority ? 3600 : 600, // 1 hour vs 10 minutes
                notification: isSilent ? undefined : {
                    title: String(payload.title),
                    body: String(payload.body),
                    sound: payload.sound || 'default',
                    channel_id: payload.androidChannel || 'high_importance_channel',
                    icon: 'notification_icon',
                    color: '#FF0000',
                    tag: payload.tag || messageId,
                    priority: isHighPriority ? 'PRIORITY_HIGH' : 'PRIORITY_DEFAULT'
                }
            },
            apns: {
                headers: {
                    'apns-priority': isHighPriority ? '10' : '5',
                    'apns-push-type': isSilent ? 'background' : 'alert'
                },
                payload: {
                    aps: {
                        sound: payload.sound || 'default',
                        badge: payload.badgeCount || 1,
                        'content-available': isSilent ? 1 : 0,
                        mutableContent: 1
                    }
                }
            },
            fcmOptions: {
                analyticsLabel: payload.type || 'general'
            }
        };

        console.log('📨 Constructed FCM message:', {
            messageId,
            fcmMessage: {
                tokenShort: userSubscription.token.substring(0, 6) + '...',
                androidPriority: message.android.priority,
                isSilent,
                containsNotification: !!message.android.notification
            }
        });

        // שליחה עם timeout
        const TIMEOUT = 15000; // 15 seconds
        const sendPromise = admin.messaging().send(message);
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('FCM_TIMEOUT')), TIMEOUT);
        });

        const response = await Promise.race([sendPromise, timeoutPromise]);

        console.log('✅ [FCM-SUCCESS] Notification processed:', {
            messageId,
            userId,
            fcmResponse: {
                messageId: response.messageId,
                name: response.name,
                deliveryTime: new Date().toISOString()
            },
            deviceState: 'ACTIVE'
        });

        return {
            success: true,
            messageId: response.messageId,
            fcmResponse: response
        };

    } catch (error) {
        // טיפול בשגיאות מפורט
        let errorType = 'UNKNOWN_ERROR';
        let severity = 'HIGH';
        let solution = 'Check server logs';
        let deviceState = 'UNKNOWN';

        switch (error.code || error.message) {
            case 'messaging/invalid-registration-token':
            case 'messaging/registration-token-not-registered':
                errorType = 'INVALID_TOKEN';
                solution = 'Remove token and prompt user to re-register';
                await removeSubscription(userId);
                break;

            case 'messaging/quota-exceeded':
                errorType = 'QUOTA_EXCEEDED';
                severity = 'CRITICAL';
                solution = 'Request quota increase in Firebase Console';
                break;

            case 'FCM_TIMEOUT':
                errorType = 'DELIVERY_TIMEOUT';
                deviceState = 'DOZE_MODE_OR_OFFLINE';
                solution = 'Device may be in Doze mode or offline. Consider using high-priority data messages';
                break;

            case 'messaging/device-message-rate-exceeded':
                errorType = 'RATE_LIMITED';
                deviceState = 'THROTTLED';
                solution = 'Reduce notification frequency to this device';
                break;

            default:
                errorType = error.code || 'UNSPECIFIED_ERROR';
        }

        console.error(`❌ [FCM-FAILURE] ${errorType}`, {
            messageId,
            userId,
            errorDetails: {
                code: error.code,
                message: error.message,
                stack: error.stack?.split('\n')[0]
            },
            diagnosticInfo: {
                errorType,
                severity,
                deviceState,
                solution,
                timestamp: new Date().toISOString()
            }
        });

        return {
            success: false,
            errorType,
            message: error.message,
            deviceState,
            solution
        };
    }
}

// async function removeSubscription(userId) {
//     console.log(`🗑️ Attempting to remove subscription for user: ${userId}`);
//     try {
//         const collection = await dbService.getCollection(COLLECTION_NAME);
//         const deleteResult = await collection.deleteOne({ userId });
//         console.log('✅ Subscription removal result:', {
//             userId,
//             deletedCount: deleteResult.deletedCount
//         });

//         logger.info(`Removed subscription for user: ${userId}`);
//     } catch (err) {
//         console.error('❌ Failed to remove subscription:', err);
//         logger.error('Failed to remove subscription', err);
//         throw err;
//     }
// }
async function removeSubscription(userId) {
    console.log(`🗑️ Removing subscription for user: ${userId}`);

    try {
        const collection = await dbService.getCollection(COLLECTION_NAME);
        const deleteResult = await collection.updateOne({ userId }, { $unset: { token: "" } });

        console.log('✅ Subscription removal result:', {
            userId,
            modifiedCount: deleteResult.modifiedCount
        });

        logger.info(`Removed invalid FCM token for user: ${userId}`);
    } catch (err) {
        console.error('❌ Failed to remove subscription:', err);
        throw err;
    }
}




export const notificationService = {
    saveSubscription,
    sendNotification,
    removeSubscription,
    createIndexes
};