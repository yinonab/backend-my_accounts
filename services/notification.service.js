// services/notification.service.js
import webpush from 'web-push';
import { config } from '../config/index.js';
import { dbService } from './db.service.js';
import { logger } from './logger.service.js';
import dotenv from 'dotenv';
dotenv.config(); // וודא שזה נטען
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
        console.log('🔍 Creating index on userId');
        await collection.createIndex({ userId: 1 });
        console.log('🔍 Creating index on userId and createdAt');
        await collection.createIndex({ userId: 1, createdAt: -1 });
        console.log('✅ Notification indexes created successfully');
        logger.info('Notification indexes created');
    } catch (err) {
        logger.error('Failed to create indexes', err);
        console.error('❌ Failed to create indexes:', err);
    }
}

async function saveSubscription(subscription, userId) {
    console.log(`📥 Attempting to save subscription for user: ${userId}`, {
        subscriptionDetails: {
            endpoint: subscription.endpoint ? 'PRESENT' : 'MISSING',
            keys: subscription.keys ? Object.keys(subscription.keys) : 'NO KEYS'
        }
    });
    try {
        console.log('Attempting to save subscription:', {
            userId,
            subscription: JSON.stringify(subscription).substring(0, 100) + '...'
        });
        const collection = await dbService.getCollection(COLLECTION_NAME);

        // בדיקה אם כבר קיים subscription לאותו משתמש
        const existingSubscription = await collection.findOne({ userId });

        if (existingSubscription) {
            console.log(`🔄 Updating existing subscription for user: ${userId}`);
            // עדכון subscription קיים
            const updateResult = await collection.updateOne(
                { userId },
                {
                    $set: {
                        subscription,
                        updatedAt: new Date()
                    }
                }
            );
            console.log('✅ Subscription update result:', updateResult);

            console.log(`Updated subscription for user: ${userId}, Matched: ${updateResult.matchedCount}, Modified: ${updateResult.modifiedCount}`);
            logger.info(`Updated subscription for user: ${userId}`);
        } else {
            console.log(`➕ Creating new subscription for user: ${userId}`);
            // יצירת subscription חדש
            const insertResult = await collection.insertOne({
                userId,
                subscription,
                createdAt: new Date(),
                updatedAt: new Date()
            });
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
    console.log(`📤 Attempting to send notification to user: ${userId}`, {
        payloadDetails: {
            title: payload.title,
            body: payload.body,
            icon: payload.icon ? 'PRESENT' : 'MISSING'
        }
    });
    console.log('Attempting to send notification:', {
        userId,
        payload
    });
    try {
        const collection = await dbService.getCollection(COLLECTION_NAME);
        const userSubscription = await collection.findOne({ userId });

        if (!userSubscription) {
            console.warn(`⚠️ No subscription found for user: ${userId}`);
            logger.warn(`No subscription found for user: ${userId}`);
            return;
        }
        console.log('🚀 Preparing to send web push notification');
        console.log('🚀 Sending web push notification to:', userSubscription.subscription.endpoint);
        console.log('📨 Payload being sent:', JSON.stringify(payload, null, 2));

        try {
            const pushResult = await webpush.sendNotification(
                userSubscription.subscription,
                JSON.stringify(payload)
            );
            console.log('✅ Notification sent successfully:', pushResult);
            console.log('✅ Notification sent successfully', {
                userId,
                result: pushResult ? 'SUCCESS' : 'UNKNOWN_RESULT'
            });
        } catch (pushError) {
            console.error('❌ Push notification error:', {
                userId,
                errorCode: pushError.statusCode,
                errorMessage: pushError.message
            });

            // טיפול במנויים לא תקפים
            if (pushError.statusCode === 410 || pushError.statusCode === 404) {
                console.warn(`🗑️ Deleting invalid subscription for user: ${userId}`);
                await collection.deleteOne({ userId });
            } else if (pushError.statusCode === 429) {
                console.warn('⚠️ Push Quota Exceeded! Try again later.');
            } else if (pushError.statusCode >= 500) {
                console.error('🚨 Server error while sending push notification.');
            }

            throw pushError;
        }
    } catch (err) {
        console.error('❌ Notification sending failed:', err);
        throw err;
    }
}

async function removeSubscription(userId) {
    console.log(`🗑️ Attempting to remove subscription for user: ${userId}`);
    try {
        const collection = await dbService.getCollection(COLLECTION_NAME);
        const deleteResult = await collection.deleteOne({ userId });
        console.log('✅ Subscription removal result:', {
            userId,
            deletedCount: deleteResult.deletedCount
        });

        logger.info(`Removed subscription for user: ${userId}`);
    } catch (err) {
        console.error('❌ Failed to remove subscription:', err);
        logger.error('Failed to remove subscription', err);
        throw err;
    }
}



export const notificationService = {
    saveSubscription,
    sendNotification,
    removeSubscription,
    createIndexes
};