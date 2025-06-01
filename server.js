import http from 'http';
import path from 'path';
import cors from 'cors';
import express from 'express';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import config from './config/dev.js'; // שינוי הייבוא
import admin from 'firebase-admin';
import mongoose from 'mongoose';

dotenv.config();

console.log('Loaded environment variables:');
console.log('VAPID_PUBLIC_KEY:', process.env.VAPID_PUBLIC_KEY);
console.log('VAPID_PRIVATE_KEY:', process.env.VAPID_PRIVATE_KEY);
console.log('VAPID_CONTACT:', process.env.VAPID_CONTACT);

import { authRoutes } from './api/auth/auth.routes.js';
import { userRoutes } from './api/user/user.routes.js';
import { reviewRoutes } from './api/review/review.routes.js';
import { contactRoutes } from './api/contact/contact.routes.js';
import { notificationRoutes } from './api/notification/notification.routes.js';
import geolocationRoutes from './api/geolocation/geolocation.routes.js';

import { setupSocketAPI } from './services/socket.service.js';
import { setupAsyncLocalStorage } from './middlewares/setupAls.middleware.js';
import { logger } from './services/logger.service.js';
import { upload } from './services/cloudinary.service.js';

// Initialize Firebase Admin if not already initialized
if (!admin.apps.length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
    });
}

// הגדרת ערוצי התראות
const configureNotificationChannels = async () => {
    try {
        // הגדרת ערוצי התראות עבור אנדרואיד
        const androidConfig = {
            notification: {
                android: {
                    notification: {
                        channelId: 'high_importance_channel',
                        priority: 'high',
                        defaultSound: true,
                        defaultVibrateTimings: true,
                        defaultLightSettings: true
                    }
                }
            }
        };

        // הגדרת ערוצי התראות עבור iOS
        const apnsConfig = {
            payload: {
                aps: {
                    sound: 'default',
                    badge: 1,
                    contentAvailable: true
                }
            },
            headers: {
                'apns-priority': '10'
            }
        };

        // הגדרת ערוצי התראות עבור Web
        const webConfig = {
            notification: {
                requireInteraction: true,
                vibrate: [100, 50, 100]
            },
            headers: {
                Urgency: 'high'
            }
        };

        // שמירת ההגדרות בקובץ הקונפיגורציה
        const notificationConfig = {
            android: androidConfig,
            apns: apnsConfig,
            web: webConfig
        };

        console.log('✅ Notification channels configured successfully');
        return notificationConfig;
    } catch (error) {
        console.error('❌ Failed to configure notification channels:', error);
        // החזרת הגדרות ברירת מחדל במקרה של שגיאה
        return {
            android: {
                notification: {
                    android: {
                        notification: {
                            channelId: 'default_channel',
                            priority: 'default'
                        }
                    }
                }
            }
        };
    }
};

// Call the configuration function
const notificationConfig = configureNotificationChannels();

const app = express();
const server = http.createServer(app);

// Environment variables
const isProduction = process.env.NODE_ENV === 'production';
const port = process.env.PORT || 3030;

// Log environment
console.log(`Running in ${process.env.NODE_ENV || 'development'} mode`);

// Middleware
app.use(cookieParser());
app.use(express.json());

// CORS Setup
// if (isProduction) {
//     app.use(cors({
//         origin: process.env.FRONTEND_URL || 'https://backend-my-accounts.onrender.com', // Update with your production frontend URL
//         credentials: true, // Allow cookies to be sent
//     }));
//     console.log(`CORS configured for production: ${process.env.FRONTEND_URL}`);
// } else {
//     app.use(cors({
//         origin: [
//             'http://127.0.0.1:3000',
//             'http://localhost:3000',
//             'http://127.0.0.1:5173',
//             'http://localhost:5173',
//             'http://localhost:4200',
//         ],
//         credentials: true, // Allow cookies to be sent
//     }));
//     console.log('CORS configured for development');
// }

// // Static file serving for production
// if (isProduction) {
//     // Serve static files from the "public" directory
//     app.use(express.static(path.resolve('public')));

//     // Fallback route for unmatched requests
//     app.use((req, res, next) => {
//         if (req.path.startsWith('/api') || req.path.includes('.')) {
//             // Skip fallback for API and static asset requests
//             return next();
//         }
//         // Serve the Angular app for other routes
//         res.sendFile(path.resolve('public', 'index.html'));
//     });
// }
// CORS Setup
if (isProduction) {
    app.use(cors({
        origin: [
            process.env.FRONTEND_URL,
            'https://backend-my-accounts.onrender.com',
            'http://localhost:3030'  // Include this if you need local development
        ],
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization']
    }));
    console.log(`CORS configured for production: ${process.env.FRONTEND_URL}`);
} else {
    app.use(cors({
        origin: [
            'http://127.0.0.1:3000',
            'http://localhost:3000',
            'http://127.0.0.1:5173',
            'http://localhost:5173',
            'http://localhost:4200',
            'http://localhost:3030',
            'http://192.168.1.63:4200',  // הוספת כתובת ה-IP של המחשב שלך
            'http://10.0.2.2:4200',      // סימולטור אנדרואיד
            'http://10.100.102.9:4200',
            'http://192.168.1.88:4200'  // IP חדש שלך
        ],
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization']
    }));
    console.log('CORS configured for development');
}

if (isProduction) {
    // Serve static files from the "public" directory
    app.use(express.static(path.resolve('public')));

    // Fallback route for unmatched requests
    app.use((req, res, next) => {
        if (req.path.startsWith('/api') || req.path.includes('.')) {
            // Skip fallback for API and static asset requests
            return next();
        }
        // Serve the Angular app for other routes
        res.sendFile(path.resolve('public', 'index.html'));
    });
}


// Middleware for async local storage
app.all('*', setupAsyncLocalStorage);

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/review', reviewRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/notification', notificationRoutes);
app.use("/api/geolocation", geolocationRoutes);



// Debugging request logs
app.use((req, res, next) => {
    console.log(`Request received: ${req.method} ${req.path}`);
    next();
});

// Socket setup
setupSocketAPI(server);

// Fallback route for unmatched routes in development
if (!isProduction) {
    app.use((req, res, next) => {
        if (req.path.includes('.')) {
            // Skip fallback for static files (e.g., .js, .css)
            return next();
        }
        if (req.path.startsWith('/api')) {
            // Skip fallback for API requests
            return next();
        }
        res.sendFile(path.resolve('public', 'index.html'));
    });
}


// Start the server
// server.listen(port, () => {
//     logger.info(`Server is running on port: ${port}`);
// });

// API להעלאת תמונה
app.post('/api/upload', upload.single('image'), (req, res) => {
    try {
        const file = req.file;
        if (!file) {
            return res.status(400).json({ error: 'No file uploaded.' });
        }
        res.status(200).json({
            message: 'Image uploaded successfully!',
            imageUrl: file.path || file.secure_url, // ה-URL הציבורי של התמונה
        });
    } catch (error) {
        console.error('Error uploading image:', error);
        res.status(500).json({ error: 'Image upload failed', details: error.message });
    }
});

async function startServer() {
    try {
        // Connect to MongoDB using Mongoose
        await mongoose.connect(config.dbURL, {
            serverSelectionTimeoutMS: 60000,
            socketTimeoutMS: 60000,
            connectTimeoutMS: 60000,
            maxPoolSize: 100,
            minPoolSize: 20,
            maxIdleTimeMS: 30000,
            retryWrites: true,
            retryReads: true
        });
        logger.info('✅ MongoDB connection established successfully');

        // Start the server AFTER successful database connection
        server.listen(port, () => {
            logger.info(`Server is running on port: ${port}`);
        });
    } catch (err) {
        logger.error('❌ Failed to connect to MongoDB or start server:', err);
        process.exit(1); // Exit with failure code
    }
}

// Call the async function to start the server
startServer();




