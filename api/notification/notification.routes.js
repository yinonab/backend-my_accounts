// api/notification/notification.routes.js
import express from 'express';
import { requireAuth } from '../../middlewares/requireAuth.middleware.js';
import { log } from '../../middlewares/logger.middleware.js';
import { notificationService } from '../../services/notification.service.js';
import { config } from '../../config/index.js';


const router = express.Router();

// נרשם לנוטיפיקציות
router.post('/', log, requireAuth, async (req, res) => {
    try {
        const { subscription } = req.body;
        const userId = req.loggedinUser._id;

        // בדיקת תקינות subscription
        if (!subscription) {
            return res.status(400).json({ error: 'Subscription is required' });
        }

        // לוג בטוח יותר
        console.log('Received request to save subscription:', {
            userId,
            subscriptionDetails: subscription ?
                JSON.stringify(Object.keys(subscription)) :
                'No subscription provided'
        });
        console.log('🔔 Received request to save subscription');
        console.log('👤 Extracted userId from token:', userId);
        console.log('📩 Subscription Keys:', subscription ? Object.keys(subscription) : 'No subscription provided');


        await notificationService.saveSubscription(subscription, userId);
        res.status(201).json({ message: 'Subscription added successfully' });
    } catch (err) {
        console.error('Error in subscribe:', err);
        res.status(500).json({ error: 'Failed to subscribe to notifications' });
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
        const userId = req.loggedinUser._id; // ✅ ה-ID מגיע ישירות מהטוקן
        const { payload } = req.body; // ✅ מקבל רק את ה-payload מהלקוח
        console.log("📩 Notification send request received:", { userId, payload });
        console.log('Extracted userId from token:', req.loggedinUser._id);
        console.log('🚀 Preparing to send notification');
        console.log('👤 User ID from Token:', userId);
        console.log('📨 Payload Received:', payload);


        await notificationService.sendNotification(userId, payload);
        res.status(200).json({ message: 'Notification sent successfully' });
    } catch (err) {
        console.error('❌ Error sending notification:', err);

        // ✅ שיפור התגובה ללקוח בהתאם לשגיאה
        if (err.statusCode === 410 || err.statusCode === 404) {
            return res.status(410).json({ error: 'Subscription no longer valid. Please re-subscribe.' });
        } else if (err.statusCode === 429) {
            return res.status(429).json({ error: 'Too many requests. Please try again later.' });
        } else {
            return res.status(500).json({ error: 'Failed to send notification' });
        }
    }
});

export const notificationRoutes = router;