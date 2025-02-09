// api/notification/notification.routes.js
import express from 'express';
import { requireAuth } from '../../middlewares/requireAuth.middleware.js';
import { log } from '../../middlewares/logger.middleware.js';
import { notificationService } from '../../services/notification.service.js';

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

        await notificationService.saveSubscription(subscription, userId);
        res.status(201).json({ message: 'Subscription added successfully' });
    } catch (err) {
        console.error('Error in subscribe:', err);
        res.status(500).json({ error: 'Failed to subscribe to notifications' });
    }
});

// שליחת נוטיפיקציה (לטסטים)
router.post('/send', log, requireAuth, async (req, res) => {
    try {
        const { userId, payload } = req.body;
        await notificationService.sendNotification(userId, payload);
        res.json({ message: 'Notification sent successfully' });
    } catch (err) {
        console.error('Error sending notification:', err);
        res.status(500).json({ error: 'Failed to send notification' });
    }
});

export const notificationRoutes = router;