// api/notification/notification.routes.js
import express from 'express';
import { requireAuth } from '../../middlewares/requireAuth.middleware.js';
import { log } from '../../middlewares/logger.middleware.js';
import { notificationService } from '../../services/notification.service.js';
import { config } from '../../config/index.js';
import { dbService } from '../../services/db.service.js';


const COLLECTION_NAME = 'notifications';
const router = express.Router();

// נרשם לנוטיפיקציות
router.post('/', log, requireAuth, async (req, res) => {
    try {
        const { token } = req.body;
        const userId = req.loggedinUser._id;

        if (!token) {
            return res.status(400).json({ error: "FCM Token is required" });
        }

        console.log("🔔 Saving FCM Token for user:", userId);
        console.log("🔔 Saving FCM Token for user:", token);

        // לוג בטוח יותר
        // console.log('Received request to save subscription:', {
        //     userId,
        //     subscriptionDetails: subscription ?
        //         JSON.stringify(Object.keys(subscription)) :
        //         'No subscription provided'
        // });
        // console.log('🔔 Received request to save subscription');
        // console.log('👤 Extracted userId from token:', userId);
        // console.log('📩 Subscription Keys:', subscription ? Object.keys(subscription) : 'No subscription provided');


        await notificationService.saveSubscription(token, userId);
        res.status(201).json({ message: "FCM Token saved successfully" });
    } catch (err) {
        console.error("❌ Error saving FCM Token:", err);
        res.status(500).json({ error: "Failed to save FCM Token" });
    }
});
router.get('/vapid-public-key', async (req, res) => {
    try {
        res.json({ vapidPublicKey: config.notifications.vapidPublicKey });
    } catch (err) {
        console.error('Failed to get VAPID public key:', err);
        res.status(500).json({ error: 'Failed to retrieve VAPID public key' });
    }
});
router.get('/get-subscription', requireAuth, async (req, res) => {
    try {
        const userId = req.loggedinUser._id;
        console.log("🔍 Checking subscription for user:", userId);

        const collection = await dbService.getCollection(COLLECTION_NAME);
        const userSubscription = await collection.findOne({ userId });

        if (!userSubscription) {
            console.warn(`⚠️ No subscription found for user: ${userId}`);
            return res.status(404).json({ error: 'No subscription found' });
        }

        console.log("✅ Found subscription:", userSubscription);
        res.status(200).json({ subscription: userSubscription.subscription });
    } catch (err) {
        console.error('❌ Error retrieving subscription:', err);
        res.status(500).json({ error: 'Failed to retrieve subscription' });
    }
});



// שליחת נוטיפיקציה (לטסטים)
// router.post('/send', log, requireAuth, async (req, res) => {
//     try {
//         const { userId, payload } = req.body;
//         await notificationService.sendNotification(userId, payload);
//         res.json({ message: 'Notification sent successfully' });
//     } catch (err) {
//         console.error('Error sending notification:', err);
//         res.status(500).json({ error: 'Failed to send notification' });
//     }
// });
router.post('/send', log, requireAuth, async (req, res) => {
    try {
        console.log("📩 Full request body received:", JSON.stringify(req.body, null, 2));

        const userId = req.loggedinUser._id;
        const { title, body, token, type, icon } = req.body;
        //  console.log("📩 Notification send request received:", { userId, payload });
        console.log('Extracted userId from token:', req.loggedinUser._id);
        console.log('🚀 Preparing to send notification');
        console.log('👤 User ID from Token:', userId);
        console.log('📨 Payload Received:', title);
        console.log('📨 Payload Received:', body);
        console.log('📨 Payload Received:', token);
        console.log('📨 Payload Received:', type);

        if (!title || !body) {
            return res.status(400).json({ error: "Title and body are required" });
        }
        console.log("🚀 Sending notification to user:", userId);
        const payload = {
            title,
            body,
            token,
            type,
            icon,
            data: {
                senderId,
                targetUserId: targetUserId || senderId,
                ...customData, // כל נתונים נוספים שנשלחו
                timestamp: new Date().toISOString()
            }
        };

      
        console.log("🚀 Sending notification with payload:", payload);
        await notificationService.sendNotification(userId, payload);

      //  await notificationService.sendNotification(userId, { title, body, token, type, icon });

        res.status(200).json({ message: "Notification sent successfully" });
    } catch (err) {
        console.error("❌ Error sending notification:", err);
        res.status(500).json({ error: "Failed to send notification" });
    }
});


//         await notificationService.sendNotification(userId, payload);
//         res.status(200).json({ message: 'Notification sent successfully' });
//     } catch (err) {
//         console.error('❌ Error sending notification:', err);

//         // ✅ שיפור התגובה ללקוח בהתאם לשגיאה
//         if (err.statusCode === 410 || err.statusCode === 404) {
//             return res.status(410).json({ error: 'Subscription no longer valid. Please re-subscribe.' });
//         } else if (err.statusCode === 429) {
//             return res.status(429).json({ error: 'Too many requests. Please try again later.' });
//         } else {
//             return res.status(500).json({ error: 'Failed to send notification' });
//         }
//     }
// });

export const notificationRoutes = router;