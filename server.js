import http from 'http';
import path from 'path';
import cors from 'cors';
import express from 'express';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

import { authRoutes } from './api/auth/auth.routes.js';
import { userRoutes } from './api/user/user.routes.js';
import { reviewRoutes } from './api/review/review.routes.js';
import { contactRoutes } from './api/contact/contact.routes.js';
import { setupSocketAPI } from './services/socket.service.js';
import { setupAsyncLocalStorage } from './middlewares/setupAls.middleware.js';
import { logger } from './services/logger.service.js';

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
if (isProduction) {
    app.use(cors({
        origin: process.env.FRONTEND_URL || 'https://backend-my-accounts.onrender.com', // Update with your production frontend URL
        credentials: true, // Allow cookies to be sent
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
        ],
        credentials: true, // Allow cookies to be sent
    }));
    console.log('CORS configured for development');
}

// Static file serving for production
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
server.listen(port, () => {
    logger.info(`Server is running on port: ${port}`);
});
