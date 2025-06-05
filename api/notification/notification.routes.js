// api/notification/notification.routes.js
import express from 'express';
import { requireAuth } from '../../middlewares/requireAuth.middleware.js';
import { log } from '../../middlewares/logger.middleware.js';
import { notificationService } from '../../services/notification.service.js';
import { config } from '../../config/index.js';
import { dbService } from '../../services/db.service.js';
import { socketService } from '../../services/socket.service.js';
import { NotificationToken } from '../../models/notification-token.model.js';

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

        // Ensure correct arguments order and structure for saveSubscription
        const subscription = { token }; // Create a subscription object with the token
        await notificationService.saveSubscription(userId, subscription);
        res.status(201).json({ message: "FCM Token saved successfully" });
    } catch (err) {
        console.error("❌ Error saving FCM Token:", err);
        res.status(500).json({ error: "Failed to save FCM Token" });
    }
});

// Add route to check if token exists (GET /check-token)
router.post('/check-token', requireAuth, async (req, res) => {
    try {
        const userId = req.loggedinUser._id;
        console.log("🔍 Checking token existence for user:", userId);

        // Assuming notificationService has a method like checkTokenExistence
        const exists = await notificationService.checkTokenExistence(userId);

        res.status(200).json({ exists });
    } catch (err) {
        console.error("❌ Error checking token existence:", err);
        res.status(500).json({ error: "Failed to check token existence" });
    }
});

// Add route to save subscription/token (POST /save-subscription) - similar to POST /
router.post('/save-subscription', log, requireAuth, async (req, res) => {
    try {
        const { token } = req.body;
        const userId = req.loggedinUser._id;

        if (!token) {
            return res.status(400).json({ error: "FCM Token is required" });
        }

        console.log("🔍 Checking if token exists for user:", userId);
        
        // בדיקה אם הטוקן כבר קיים
        const existingToken = await NotificationToken.findOne({ userId });
        if (existingToken) {
            console.log("✅ Token already exists for user:", userId);
            return res.status(200).json({ message: "Token already exists" });
        }

        console.log("🔔 Saving new FCM Token for user:", userId);
        const subscription = { token };
        await notificationService.saveSubscription(userId, subscription);
        
        console.log("✅ FCM Token saved successfully for user:", userId);
        res.status(201).json({ message: "FCM Token saved successfully" });
    } catch (err) {
        console.error("❌ Error saving FCM Token:", err);
        res.status(500).json({ error: "Failed to save FCM Token" });
    }
});

// Add route to validate token (POST /validate-token)
router.post('/validate-token', requireAuth, async (req, res) => {
    try {
        const { token } = req.body;
        console.log("🔍 Validating token:", token);

        if (!token) {
             return res.status(400).json({ error: "FCM Token is required" });
        }

        // Assuming notificationService has a method like validateToken
        const isValid = await notificationService.validateToken(token);

        res.status(200).json({ isValid });
    } catch (err) {
        console.error("❌ Error validating token:", err);
        res.status(500).json({ error: "Failed to validate token" });
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
        console.log("🔍 Checking token for user:", userId);

        // קריאה מקולקציית tokens באמצעות המודל
        const userToken = await NotificationToken.findOne({ userId });

        if (!userToken) {
            console.warn(`⚠️ No token found for user: ${userId}`);
            return res.status(404).json({ error: 'No token found' });
        }

        console.log("✅ Found token:", userToken);
        // החזרת אובייקט ה-token כפי שהקליינט מצפה לקבל
        res.status(200).json({ token: userToken.token });
    } catch (err) {
        console.error('❌ Error retrieving token:', err);
        res.status(500).json({ error: 'Failed to retrieve token' });
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
        await notificationService.sendNotification(userId, { title, body, token, type, icon });

        // Check if user has active socket connection before emitting
        const userSockets = socketService.getUserSockets(userId);
        if (userSockets && userSockets.length > 0) {
            socketService.emitTestNotification({
                userId,
                data: {
                    title: title || "📢 Notification",
                    body: body || "New notification arrived",
                    messageId: `msg_${Date.now()}`,
                    timestamp: Date.now()
                }
            });
        } else {
            console.log("ℹ️ User has no active socket connection, skipping socket notification");
        }

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