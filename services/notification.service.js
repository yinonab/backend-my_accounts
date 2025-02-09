// services/notification.service.js
import webpush from 'web-push';
import { config } from '../config/index.js';
import { dbService } from './db.service.js';
import { logger } from './logger.service.js';
import dotenv from 'dotenv';
dotenv.config(); // וודא שזה נטען

console.log('Loaded VAPID Public Key:', config.notifications.vapidPublicKey);

const COLLECTION_NAME = 'notifications';


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
    try {
        const collection = await dbService.getCollection(COLLECTION_NAME);
        await collection.createIndex({ userId: 1 });
        await collection.createIndex({ userId: 1, createdAt: -1 });
        logger.info('Notification indexes created');
    } catch (err) {
        logger.error('Failed to create indexes', err);
    }
}

async function saveSubscription(subscription, userId) {
    try {
        const collection = await dbService.getCollection(COLLECTION_NAME);

        // בדיקה אם כבר קיים subscription לאותו משתמש
        const existingSubscription = await collection.findOne({ userId });

        if (existingSubscription) {
            // עדכון subscription קיים
            await collection.updateOne(
                { userId },
                {
                    $set: {
                        subscription,
                        updatedAt: new Date()
                    }
                }
            );
            logger.info(`Updated subscription for user: ${userId}`);
        } else {
            // יצירת subscription חדש
            await collection.insertOne({
                userId,
                subscription,
                createdAt: new Date(),
                updatedAt: new Date()
            });
            logger.info(`Created new subscription for user: ${userId}`);
        }
    } catch (err) {
        logger.error('Failed to save subscription', err);
        throw err;
    }
}

async function sendNotification(userId, payload) {
    console.log('Is message relevant?');
    try {
        const collection = await dbService.getCollection(COLLECTION_NAME);
        const userSubscription = await collection.findOne({ userId });

        if (!userSubscription) {
            logger.warn(`No subscription found for user: ${userId}`);
            return;
        }

        try {
            await webpush.sendNotification(
                userSubscription.subscription,
                JSON.stringify(payload)
            );
            logger.info(`Notification sent to user: ${userId}`);
        } catch (err) {
            // אם יש שגיאה בשליחה, ייתכן שה-subscription לא תקף יותר
            if (err.statusCode === 410 || err.statusCode === 404) {
                await collection.deleteOne({ userId });
                logger.warn(`Deleted invalid subscription for user: ${userId}`);
            }
            throw err;
        }
    } catch (err) {
        logger.error('Failed to send notification', err);
        throw err;
    }
}

async function removeSubscription(userId) {
    try {
        const collection = await dbService.getCollection(COLLECTION_NAME);
        await collection.deleteOne({ userId });
        logger.info(`Removed subscription for user: ${userId}`);
    } catch (err) {
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