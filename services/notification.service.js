// services/notification.service.js
import admin from "firebase-admin";

import webpush from 'web-push';
import { config } from '../config/index.js';
import { dbService } from './db.service.js';
import { logger } from './logger.service.js';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { NotificationToken } from '../models/notification-token.model.js'
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
async function ensureIndexes() {
    console.log('📦 Attempting to create notification indexes');
    try {
        const notificationsCollection = await dbService.getCollection('notifications');
        await notificationsCollection.createIndex({ userId: 1 });
        await notificationsCollection.createIndex({ userId: 1, createdAt: -1 });
        console.log('🔍 Creating index on token for notifications collection');
        await notificationsCollection.createIndex({ token: 1 }); // הוספת אינדקס על שדה הטוקן
        
        const tokensCollection = await dbService.getCollection('tokens');
        console.log('🔍 Creating index on token for tokens collection');
        await tokensCollection.createIndex({ token: 1 }, { unique: true }); // אינדקס יחידאי על שדה הטוקן
        console.log('✅ Indexes created successfully for both collections');
    } catch (err) {
        logger.error('Failed to create indexes', err);
    }
}

ensureIndexes();

// הוספת מערכת ניהול מחזור חיים של טוקנים
class TokenLifecycleManager {
    constructor() {
        this.tokenExpiryTimes = new Map();
        this.renewalThreshold = 4 * 60 * 1000; // 4 דקות לפני פקיעת תוקף
        this.checkInterval = 60 * 1000; // בדיקה כל דקה
        this.maxTokenAge = 5 * 60 * 1000; // 5 דקות
        this.platforms = new Map(); // מעקב אחר פלטפורמות
    }

    async start() {
        this._scheduleChecks();
    }

    _scheduleChecks() {
        setInterval(() => this._checkTokens(), this.checkInterval);
    }

    async _checkTokens() {
        const now = Date.now();
        for (const [token, expiryTime] of this.tokenExpiryTimes) {
            if (now >= expiryTime - this.renewalThreshold) {
                await this._renewToken(token);
            }
        }
    }

    async _renewToken(token) {
        try {
            logger.info(`🔄 Renewing token: ${token}`);
            
            const tokenInfo = await this._getTokenInfo(token);
            if (!tokenInfo) {
                logger.warn(`❌ Token info not found: ${token}`);
                return;
            }

            // בדיקה אם הפלטפורמה תומכת בחידוש אוטומטי
            if (!this._isAutoRenewalSupported(tokenInfo.platform)) {
                logger.info(`ℹ️ Auto renewal not supported for platform: ${tokenInfo.platform}`);
                await this._notifyClientForRenewal(tokenInfo);
                return;
            }

            // בדיקת תקינות הטוקן
            const isValid = await this._validateToken(token);
            if (!isValid) {
                logger.warn(`❌ Token validation failed during renewal: ${token}`);
                await this._handleInvalidToken(token);
                return;
            }

            // חידוש הטוקן
            const newToken = await this._generateNewToken(token);
            await this._updateToken(token, newToken);
            
            logger.info(`✅ Token renewed successfully: ${token}`);
        } catch (error) {
            logger.error(`❌ Token renewal failed: ${token}`, error);
            await this._handleRenewalFailure(token, error);
        }
    }

    _isAutoRenewalSupported(platform) {
        // אנדרואיד תומך בחידוש אוטומטי
        if (platform === 'android') return true;
        
        // iOS דורש חידוש ידני
        if (platform === 'ios') return false;
        
        // ווב תלוי בדפדפן
        if (platform === 'web') {
            return 'serviceWorker' in navigator && 'PushManager' in window;
        }
        
        return false;
    }

    async _notifyClientForRenewal(tokenInfo) {
        try {
            await sendNotification(tokenInfo.userId, {
                title: '🔄 עדכון התראות נדרש',
                body: 'נא לחדש את הרשאת ההתראות כדי להמשיך לקבל עדכונים',
                type: 'token_renewal',
                data: {
                    action: 'renew_token',
                    platform: tokenInfo.platform
                }
            });
        } catch (error) {
            logger.error('Failed to send renewal notification:', error);
        }
    }

    async _validateToken(token) {
        try {
            // בדיקה ספציפית לפלטפורמה
            const tokenInfo = await this._getTokenInfo(token);
            if (!tokenInfo) return false;

            if (tokenInfo.platform === 'android') {
                // בדיקה ספציפית לאנדרואיד
                await admin.messaging().send({
                    token,
                    data: { type: 'validation' }
                });
                return true;
            } else if (tokenInfo.platform === 'web') {
                // בדיקה ספציפית לווב
                return await this._validateWebToken(token);
            }
            
            return false;
        } catch (error) {
            return false;
        }
    }

    async _validateWebToken(token) {
        try {
            const subscription = await webpush.getSubscription(token);
            return !!subscription;
        } catch (error) {
            return false;
        }
    }

    async _generateNewToken(oldToken) {
        const tokenInfo = await this._getTokenInfo(oldToken);
        if (!tokenInfo) {
            throw new Error('Token info not found');
        }

        let newToken;
        if (tokenInfo.platform === 'android') {
            // יצירת טוקן חדש לאנדרואיד
            newToken = await admin.messaging().getToken();
        } else if (tokenInfo.platform === 'web') {
            // יצירת טוקן חדש לווב
            const subscription = await webpush.generateVAPIDKeys();
            newToken = subscription.endpoint;
        } else {
            throw new Error('Unsupported platform');
        }

        return {
            token: newToken,
            userId: tokenInfo.userId,
            platform: tokenInfo.platform,
            metadata: tokenInfo.metadata
        };
    }

    async _updateToken(oldToken, newToken) {
        // עדכון הטוקן במסד הנתונים
        const collection = await dbService.getCollection('tokens');
        await collection.updateOne(
            { token: oldToken },
            { 
                $set: { 
                    token: newToken.token,
                    updatedAt: new Date(),
                    platform: newToken.platform
                }
            }
        );

        // עדכון הטוקן במערכות האחרות
        await advancedTokenManager.updateToken(oldToken, newToken.token);
        this.tokenExpiryTimes.set(newToken.token, Date.now() + this.maxTokenAge);
        this.tokenExpiryTimes.delete(oldToken);
        this.platforms.set(newToken.token, newToken.platform);
    }

    async addToken(token, userId, metadata = {}) {
        const platform = metadata.platform || 'unknown';
        const expiryTime = Date.now() + this.maxTokenAge;
        
        this.tokenExpiryTimes.set(token, expiryTime);
        this.platforms.set(token, platform);
        
        // שמירת הטוקן במסד הנתונים
        const collection = await dbService.getCollection('tokens');
        await collection.insertOne({
            token,
            userId,
            platform,
            metadata,
            createdAt: new Date(),
            expiresAt: new Date(expiryTime)
        });
    }

    async _handleInvalidToken(token) {
        await advancedTokenManager.removeToken(token);
        this.tokenExpiryTimes.delete(token);
    }

    async _handleRenewalFailure(token, error) {
        // ניסיון חוזר לאחר זמן קצר
        setTimeout(async () => {
            try {
                await this._renewToken(token);
            } catch (retryError) {
                logger.error(`❌ Token renewal retry failed: ${token}`, retryError);
                await this._handleInvalidToken(token);
            }
        }, 30000); // ניסיון חוזר אחרי 30 שניות
    }

    async _getTokenInfo(token) {
        const collection = await dbService.getCollection('tokens');
        return await collection.findOne({ token });
    }

    async removeToken(token) {
        this.tokenExpiryTimes.delete(token);
        const collection = await dbService.getCollection('tokens');
        await collection.deleteOne({ token });
    }

    getTokenExpiryTime(token) {
        return this.tokenExpiryTimes.get(token);
    }
}

// יצירת מופע של מערכת ניהול מחזור החיים
const tokenLifecycleManager = new TokenLifecycleManager();

// הוספת מערכת סנכרון קרוס-פלטפורמות
class CrossPlatformSyncManager {
    constructor() {
        this.syncIntervals = new Map();
        this.syncStatus = new Map();
        this.platformHandlers = new Map();
        this.setupPlatformHandlers();
    }

    setupPlatformHandlers() {
        // מטפל באנדרואיד
        this.platformHandlers.set('android', {
            validateToken: async (token) => {
                try {
                    await admin.messaging().send({
                        token,
                        data: { type: 'validation' }
                    });
                    return true;
                } catch (error) {
                    return false;
                }
            },
            renewToken: async (oldToken) => {
                const newToken = await admin.messaging().getToken();
                return newToken;
            },
            syncInterval: 4 * 60 * 1000 // 4 דקות
        });

        // מטפל בווב
        this.platformHandlers.set('web', {
            validateToken: async (token) => {
                try {
                    const subscription = await webpush.getSubscription(token);
                    return !!subscription;
                } catch (error) {
                    return false;
                }
            },
            renewToken: async (oldToken) => {
                const subscription = await webpush.generateVAPIDKeys();
                return subscription.endpoint;
            },
            syncInterval: 4 * 60 * 1000 // 4 דקות
        });
    }

    async startSync(token, platform) {
        const handler = this.platformHandlers.get(platform);
        if (!handler) {
            logger.error(`Unsupported platform: ${platform}`);
            return;
        }

        // עצירת סנכרון קיים אם יש
        this.stopSync(token);

        // התחלת סנכרון חדש
        const interval = setInterval(async () => {
            await this._performSync(token, platform);
        }, handler.syncInterval);

        this.syncIntervals.set(token, interval);
        this.syncStatus.set(token, {
            platform,
            lastSync: Date.now(),
            status: 'active'
        });

        // ביצוע סנכרון ראשוני
        await this._performSync(token, platform);
    }

    stopSync(token) {
        const interval = this.syncIntervals.get(token);
        if (interval) {
            clearInterval(interval);
            this.syncIntervals.delete(token);
            this.syncStatus.delete(token);
        }
    }

    async _performSync(token, platform) {
        try {
            const handler = this.platformHandlers.get(platform);
            const isValid = await handler.validateToken(token);

            if (!isValid) {
                logger.warn(`Token validation failed for ${platform}: ${token}`);
                await this._handleInvalidToken(token, platform);
                return;
            }

            // עדכון סטטוס הסנכרון
            this.syncStatus.set(token, {
                platform,
                lastSync: Date.now(),
                status: 'active'
            });

            // שליחת התראה לשמירה על חיבור פעיל
            await this._sendKeepAliveNotification(token, platform);

        } catch (error) {
            logger.error(`Sync failed for ${platform}: ${token}`, error);
            this.syncStatus.set(token, {
                platform,
                lastSync: Date.now(),
                status: 'error',
                error: error.message
            });
        }
    }

    async _handleInvalidToken(token, platform) {
        try {
            const handler = this.platformHandlers.get(platform);
            const newToken = await handler.renewToken(token);
            
            if (newToken) {
                await this._updateToken(token, newToken, platform);
            } else {
                await this._notifyTokenRenewalRequired(token, platform);
            }
        } catch (error) {
            logger.error(`Token renewal failed for ${platform}: ${token}`, error);
            await this._notifyTokenRenewalRequired(token, platform);
        }
    }

    async _updateToken(oldToken, newToken, platform) {
        // עדכון הטוקן במסד הנתונים
        const collection = await dbService.getCollection('tokens');
        await collection.updateOne(
            { token: oldToken },
            { 
                $set: { 
                    token: newToken,
                    updatedAt: new Date(),
                    platform
                }
            }
        );

        // עדכון הטוקן במערכות האחרות
        await advancedTokenManager.updateToken(oldToken, newToken);
        
        // עדכון הסנכרון
        this.stopSync(oldToken);
        await this.startSync(newToken, platform);
    }

    async _notifyTokenRenewalRequired(token, platform) {
        const tokenInfo = await this._getTokenInfo(token);
        if (!tokenInfo) return;

        await sendNotification(tokenInfo.userId, {
            title: '🔄 עדכון התראות נדרש',
            body: 'נא לחדש את הרשאת ההתראות כדי להמשיך לקבל עדכונים',
            type: 'token_renewal',
            data: {
                action: 'renew_token',
                platform
            }
        });
    }

    async _sendKeepAliveNotification(token, platform) {
        const tokenInfo = await this._getTokenInfo(token);
        if (!tokenInfo) return;

        await sendNotification(tokenInfo.userId, {
            title: '📡 בדיקת חיבור',
            body: 'מבצע סנכרון התראות...',
            type: 'keep_alive',
            data: {
                action: 'sync',
                platform,
                timestamp: Date.now()
            },
            silent: true
        });
    }

    async _getTokenInfo(token) {
        const collection = await dbService.getCollection('tokens');
        return await collection.findOne({ token });
    }

    getSyncStatus(token) {
        return this.syncStatus.get(token);
    }

    getAllSyncStatus() {
        return Array.from(this.syncStatus.entries());
    }
}

// יצירת מופע של מערכת הסנכרון
const syncManager = new CrossPlatformSyncManager();

// הוספת מנגנון ניהול התראות משופר
class NotificationManager {
    constructor() {
        this.deliveryStats = new Map();
        this.failedNotifications = new Map();
        this.notificationQueue = new Map();
        this.tokenStats = new Map();
    }

    getStats() {
        const stats = {
            total: this.deliveryStats.size,
            successful: 0,
            failed: 0,
            pending: 0,
            successRate: 0
        };

        for (const [_, stat] of this.deliveryStats) {
            if (stat.status === 'delivered') stats.successful++;
            else if (stat.status === 'failed') stats.failed++;
            else if (stat.status === 'pending') stats.pending++;
        }

        stats.successRate = stats.total > 0 ? stats.successful / stats.total : 0;
        return stats;
    }

    trackNotification(userId, notificationId) {
        const stats = {
            sentAt: Date.now(),
            attempts: 0,
            status: 'pending',
            lastAttempt: null,
            error: null,
            tokens: new Set()
        };
        this.deliveryStats.set(notificationId, stats);
    }

    updateDeliveryStatus(notificationId, status, error = null, token = null) {
        const stats = this.deliveryStats.get(notificationId);
        if (stats) {
            stats.status = status;
            stats.lastAttempt = Date.now();
            stats.attempts++;
            if (token) {
                stats.tokens.add(token);
            }
            if (error) {
                stats.error = error;
                this.failedNotifications.set(notificationId, {
                    ...stats,
                    retryAfter: Date.now() + RETRY_DELAY
                });
            }
        }
    }

    trackToken(token) {
        if (!this.tokenStats.has(token)) {
            this.tokenStats.set(token, {
                firstSeen: Date.now(),
                lastUsed: Date.now(),
                successCount: 0,
                failureCount: 0,
                lastError: null
            });
        }
        const stats = this.tokenStats.get(token);
        stats.lastUsed = Date.now();
        return stats;
    }

    updateTokenStats(token, success, error = null) {
        const stats = this.tokenStats.get(token);
        if (stats) {
            if (success) {
                stats.successCount++;
            } else {
                stats.failureCount++;
                stats.lastError = error;
            }
        }
    }

    async retryFailedNotifications() {
        const now = Date.now();
        for (const [notificationId, data] of this.failedNotifications) {
            if (now >= data.retryAfter && data.attempts < MAX_RETRY_ATTEMPTS) {
                try {
                    await this.retryNotification(notificationId);
                } catch (error) {
                    logger.error(`Failed to retry notification ${notificationId}:`, error);
                }
            }
        }
    }

    async retryNotification(notificationId) {
        const notification = this.notificationQueue.get(notificationId);
        if (notification) {
            const { userId, title, body, data } = notification;
            const userTokens = await getUserTokens(userId);
            
            for (const token of userTokens) {
                try {
                    await sendToToken(token, title, body, data);
                    this.updateTokenStats(token, true);
                    this.updateDeliveryStatus(notificationId, 'delivered', null, token);
                } catch (error) {
                    this.updateTokenStats(token, false, error);
                    this.updateDeliveryStatus(notificationId, 'failed', error, token);
                    throw error;
                }
            }
            
            this.failedNotifications.delete(notificationId);
        }
    }

    getTokenHealth(token) {
        const stats = this.tokenStats.get(token);
        if (!stats) return 'unknown';
        
        const totalAttempts = stats.successCount + stats.failureCount;
        if (totalAttempts === 0) return 'new';
        
        const successRate = stats.successCount / totalAttempts;
        if (successRate > 0.8) return 'healthy';
        if (successRate > 0.5) return 'degraded';
        return 'unhealthy';
    }
}

const notificationManager = new NotificationManager();

// הוספת מנגנון ניהול טוקנים מתקדם
class AdvancedTokenManager {
    constructor() {
        this.tokens = new Map();
        this.tokenGroups = new Map();
        this.maintenanceSchedule = new Map();
        this.tokenStats = new Map();
        this.tokenMetadata = new Map();
    }

    async addToken(token, userId, metadata = {}) {
        // Use the centralized function to save/update in DB
        await saveOrUpdateToken(token, userId, metadata);

        // Update in-memory cache
        const tokenInfo = {
            token,
            userId,
            createdAt: Date.now(), // This will be overwritten by DB value on load
            lastUsed: Date.now(),
            status: 'active',
            metadata: {
                platform: metadata.platform || 'unknown',
                appVersion: metadata.appVersion || 'unknown',
                deviceInfo: metadata.deviceInfo || {},
                ...metadata
            },
            stats: {
                totalNotifications: 0,
                successfulDeliveries: 0,
                failedDeliveries: 0,
                lastError: null,
                errorHistory: []
            }
        };
        this.tokens.set(token, tokenInfo);
        this._updateTokenGroups(token, tokenInfo);
        this._scheduleMaintenance(token);
        // No need to call _saveTokenToDatabase here as it's done in saveOrUpdateToken

        return tokenInfo;
    }

    _updateTokenGroups(token, tokenInfo) {
        // קבוצות לפי משתמש
        if (!this.tokenGroups.has(tokenInfo.userId)) {
            this.tokenGroups.set(tokenInfo.userId, new Set());
        }
        this.tokenGroups.get(tokenInfo.userId).add(token);

        // קבוצות לפי פלטפורמה
        const platform = tokenInfo.metadata.platform;
        if (!this.tokenGroups.has(`platform:${platform}`)) {
            this.tokenGroups.set(`platform:${platform}`, new Set());
        }
        this.tokenGroups.get(`platform:${platform}`).add(token);
    }

    _scheduleMaintenance(token) {
        const maintenanceInterval = 24 * 60 * 60 * 1000; // 24 שעות
        const nextMaintenance = Date.now() + maintenanceInterval;
        this.maintenanceSchedule.set(token, nextMaintenance);
    }

    async updateTokenStatus(token, status, error = null) {
        const tokenInfo = this.tokens.get(token);
        if (!tokenInfo) return;

        tokenInfo.status = status;
        tokenInfo.lastUsed = Date.now();
        
        if (error) {
            tokenInfo.stats.failedDeliveries++;
            tokenInfo.stats.lastError = error;
            tokenInfo.stats.errorHistory.push({
                timestamp: Date.now(),
                error: error.message || error
            });
            
            // שמירת רק 10 השגיאות האחרונות
            if (tokenInfo.stats.errorHistory.length > 10) {
                tokenInfo.stats.errorHistory.shift();
            }
        } else {
            tokenInfo.stats.successfulDeliveries++;
        }
        
        tokenInfo.stats.totalNotifications++;
        
        await this._saveTokenToDatabase(tokenInfo);
        this._checkTokenHealth(token);
    }

    _checkTokenHealth(token) {
        const tokenInfo = this.tokens.get(token);
        if (!tokenInfo) return;

        const { stats } = tokenInfo;
        const totalAttempts = stats.successfulDeliveries + stats.failedDeliveries;
        
        if (totalAttempts === 0) return;

        const successRate = stats.successfulDeliveries / totalAttempts;
        const recentErrors = stats.errorHistory.filter(
            error => Date.now() - error.timestamp < 24 * 60 * 60 * 1000
        ).length;

        if (successRate < 0.5 || recentErrors > 5) {
            this._markTokenAsUnhealthy(token);
        }
    }

    _markTokenAsUnhealthy(token) {
        const tokenInfo = this.tokens.get(token);
        if (!tokenInfo) return;

        tokenInfo.status = 'unhealthy';
        logger.warn(`Token marked as unhealthy: ${token}`);
        
        // שליחת התראה למשתמש
        this._notifyUserAboutUnhealthyToken(tokenInfo.userId, token);
    }

    async _notifyUserAboutUnhealthyToken(userId, token) {
        try {
            await sendNotification(userId, {
                title: '⚠️ בעיה בהתראות',
                body: 'נא לעדכן את האפליקציה כדי להמשיך לקבל התראות',
                type: 'token_health',
                data: {
                    token,
                    action: 'update_app'
                }
            });
        } catch (error) {
            logger.error('Failed to send token health notification:', error);
        }
    }

    async removeToken(token) {
        const tokenInfo = this.tokens.get(token);
        if (!tokenInfo) return;

        // הסרת הטוקן מכל הקבוצות
        this._removeTokenFromGroups(token, tokenInfo);
        
        // הסרת הטוקן מהמאגר
        this.tokens.delete(token);
        this.maintenanceSchedule.delete(token);
        
        // הסרת הטוקן מהמסד נתונים
        try {
            const collection = await dbService.getCollection('tokens');
            await collection.deleteOne({ token });
        } catch (error) {
            logger.error('Failed to remove token from database:', error);
        }
    }

    _removeTokenFromGroups(token, tokenInfo) {
        // הסרה מקבוצת המשתמש
        const userGroup = this.tokenGroups.get(tokenInfo.userId);
        if (userGroup) {
            userGroup.delete(token);
            if (userGroup.size === 0) {
                this.tokenGroups.delete(tokenInfo.userId);
            }
        }

        // הסרה מקבוצת הפלטפורמה
        const platformGroup = this.tokenGroups.get(`platform:${tokenInfo.metadata.platform}`);
        if (platformGroup) {
            platformGroup.delete(token);
            if (platformGroup.size === 0) {
                this.tokenGroups.delete(`platform:${tokenInfo.metadata.platform}`);
            }
        }
    }

    async performMaintenance() {
        const now = Date.now();
        for (const [token, nextMaintenance] of this.maintenanceSchedule) {
            if (now >= nextMaintenance) {
                await this._maintainToken(token);
                this._scheduleMaintenance(token);
            }
        }
    }

    async _maintainToken(token) {
        const tokenInfo = this.tokens.get(token);
        if (!tokenInfo) return;

        // בדיקת תקינות הטוקן
        try {
            await this._validateToken(token);
            tokenInfo.status = 'active';
        } catch (error) {
            logger.warn(`Token validation failed: ${token}`, error);
            tokenInfo.status = 'invalid';
            await this.removeToken(token);
        }

        // ניקוי היסטוריית שגיאות ישנה
        const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);
        tokenInfo.stats.errorHistory = tokenInfo.stats.errorHistory.filter(
            error => error.timestamp > thirtyDaysAgo
        );

        await this._saveTokenToDatabase(tokenInfo);
    }

    async _validateToken(token) {
        try {
            await admin.messaging().send({
                token,
                data: { type: 'validation' }
            });
            return true;
        } catch (error) {
            if (error.code === 'messaging/invalid-registration-token' ||
                error.code === 'messaging/registration-token-not-registered') {
                throw error;
            }
            return true;
        }
    }

    getTokenStats() {
        const stats = {
            total: this.tokens.size,
            byStatus: {
                active: 0,
                unhealthy: 0,
                invalid: 0
            },
            byPlatform: new Map(),
            byUser: new Map()
        };

        for (const [token, info] of this.tokens) {
            // סטטיסטיקות לפי סטטוס
            stats.byStatus[info.status] = (stats.byStatus[info.status] || 0) + 1;

            // סטטיסטיקות לפי פלטפורמה
            const platform = info.metadata.platform;
            const platformCount = stats.byPlatform.get(platform) || 0;
            stats.byPlatform.set(platform, platformCount + 1);

            // סטטיסטיקות לפי משתמש
            const userCount = stats.byUser.get(info.userId) || 0;
            stats.byUser.set(info.userId, userCount + 1);
        }

        return {
            ...stats,
            byPlatform: Object.fromEntries(stats.byPlatform),
            byUser: Object.fromEntries(stats.byUser)
        };
    }

    getTokenHealth(token) {
        const tokenInfo = this.tokens.get(token);
        if (!tokenInfo) return 'unknown';

        const { stats } = tokenInfo;
        const totalAttempts = stats.successfulDeliveries + stats.failedDeliveries;
        
        if (totalAttempts === 0) return 'new';
        
        const successRate = stats.successfulDeliveries / totalAttempts;
        if (successRate > 0.8) return 'healthy';
        if (successRate > 0.5) return 'degraded';
        return 'unhealthy';
    }
}

const advancedTokenManager = new AdvancedTokenManager();

// הוספת מערכת אנליטיקה בסיסית
class AnalyticsSystem {
    constructor() {
        this.events = new Map();
        this.errors = new Map();
    }

    trackError(error, context, type) {
        const errorId = Date.now().toString();
        this.errors.set(errorId, {
            error: error.message,
            stack: error.stack,
            context,
            type,
            timestamp: new Date()
        });
        logger.error(`Error tracked: ${error.message}`, { context, type });
    }

    trackEvent(name, data) {
        const eventId = Date.now().toString();
        this.events.set(eventId, {
            name,
            data,
            timestamp: new Date()
        });
    }

    getErrors() {
        return Array.from(this.errors.values());
    }

    getEvents() {
        return Array.from(this.events.values());
    }
}

// יצירת מופע של מערכת האנליטיקה
const analyticsSystem = new AnalyticsSystem();

class AdvancedHealthMonitoringSystem {
    constructor() {
        this.healthChecks = new Map();
        this.healthStatus = new Map();
        this.alerts = new Map();
        this.checkInterval = 60000; // דקה
    }

    async startMonitoring() {
        this._scheduleHealthChecks();
        this._monitorSystemResources();
    }

    _scheduleHealthChecks() {
        setInterval(async () => {
            await this._runHealthChecks();
        }, this.checkInterval);
    }

    async _runHealthChecks() {
        for (const [name, check] of this.healthChecks) {
            try {
                const result = await check.fn();
                this._updateHealthStatus(name, result);
            } catch (error) {
                this._handleHealthCheckFailure(name, error);
            }
        }
    }

    _updateHealthStatus(name, result) {
        const status = {
            name,
            status: result.healthy ? 'healthy' : 'unhealthy',
            timestamp: Date.now(),
            details: result
        };

        this.healthStatus.set(name, status);
        this._checkAlerts(name, status);
    }

    _handleHealthCheckFailure(name, error) {
        const status = {
            name,
            status: 'error',
            timestamp: Date.now(),
            error: error.message
        };

        this.healthStatus.set(name, status);
        this._checkAlerts(name, status);
    }

    _checkAlerts(name, status) {
        const alert = this.alerts.get(name);
        if (alert && this._shouldTriggerAlert(status, alert)) {
            this._triggerAlert(name, status, alert);
        }
    }

    _shouldTriggerAlert(status, alert) {
        if (status.status === 'error') return true;
        if (status.status === 'unhealthy' && alert.threshold) {
            return this._isBelowThreshold(status, alert.threshold);
        }
        return false;
    }

    _isBelowThreshold(status, threshold) {
        return status.details && status.details.value < threshold;
    }

    _triggerAlert(name, status, alert) {
        logger.error('Health check alert:', {
            name,
            status,
            alert
        });

        analyticsSystem.trackError(
            new Error(`Health check failed: ${name}`),
            null,
            'system'
        );
    }

    _monitorSystemResources() {
        setInterval(() => {
            const resources = this._getSystemResources();
            this._updateResourceHealth(resources);
        }, 5000); // כל 5 שניות
    }

    _getSystemResources() {
        const usage = process.memoryUsage();
        return {
            memory: {
                heapUsed: usage.heapUsed,
                heapTotal: usage.heapTotal,
                rss: usage.rss
            },
            cpu: process.cpuUsage()
        };
    }

    _updateResourceHealth(resources) {
        const memoryHealth = this._checkMemoryHealth(resources.memory);
        const cpuHealth = this._checkCpuHealth(resources.cpu);

        this._updateHealthStatus('memory', memoryHealth);
        this._updateHealthStatus('cpu', cpuHealth);
    }

    _checkMemoryHealth(memory) {
        const heapUsage = memory.heapUsed / memory.heapTotal;
        return {
            healthy: heapUsage < 0.8,
            value: heapUsage,
            details: memory
        };
    }

    _checkCpuHealth(cpu) {
        const cpuUsage = (cpu.user + cpu.system) / 1000000;
        return {
            healthy: cpuUsage < 80,
            value: cpuUsage,
            details: cpu
        };
    }

    addHealthCheck(name, check, alert = null) {
        this.healthChecks.set(name, {
            fn: check,
            alert
        });
    }

    setAlert(name, alert) {
        this.alerts.set(name, alert);
    }

    getHealthStatus(name) {
        return this.healthStatus.get(name);
    }

    getAllHealthStatus() {
        return Array.from(this.healthStatus.values());
    }
}

// יצירת מופע של מערכת ניטור הבריאות
const healthMonitoringSystem = new AdvancedHealthMonitoringSystem();

// הגדרת בדיקות בריאות
healthMonitoringSystem.addHealthCheck('notification_service', async () => {
    const stats = notificationManager.getStats();
    return {
        healthy: stats.successRate > 0.9,
        value: stats.successRate,
        details: stats
    };
});

// הפעלת ניטור בריאות
healthMonitoringSystem.startMonitoring();

// פונקציה משופרת לשליחה לטוקן ספציפי
async function sendToToken(token, title, body, data, retryCount = 0) {
    try {
        const message = {
            token,
            notification: {
                title,
                body,
                sound: 'default',
                badge: '1',
                clickAction: 'FLUTTER_NOTIFICATION_CLICK'
            },
            data: {
                ...data,
                click_action: 'FLUTTER_NOTIFICATION_CLICK',
                sound: 'default',
                status: 'done',
                screen: data.screen || 'home'
            },
            android: {
                priority: 'high',
                notification: {
                    channelId: 'high_importance_channel',
                    priority: 'max',
                    sound: 'default',
                    defaultSound: true,
                    defaultVibrateTimings: true,
                    defaultLightSettings: true
                }
            },
            apns: {
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
            },
            webpush: {
                headers: {
                    Urgency: 'high'
                },
                notification: {
                    requireInteraction: true,
                    vibrate: [100, 50, 100]
                }
            }
        };

        const response = await admin.messaging().send(message);
        console.log('✅ Successfully sent message:', response);
        return response;

    } catch (error) {
        console.error('❌ Error sending to token:', error);

        if (retryCount < MAX_RETRY_ATTEMPTS) {
            console.log(`🔄 Retrying (${retryCount + 1}/${MAX_RETRY_ATTEMPTS})...`);
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
            return sendToToken(token, title, body, data, retryCount + 1);
        }

        throw error;
    }
}

// פונקציה לטיפול בטוקנים שנכשלו
async function handleFailedToken(token, error) {
    if (error.code === 'messaging/invalid-registration-token' ||
        error.code === 'messaging/registration-token-not-registered') {
        console.log('🗑️ Removing invalid token:', token);
        await removeToken(token);
    }
}

// פונקציה לקבלת כל הטוקנים של משתמש
async function getUserTokens(userId) {
    try {
        // וידוא חיבור למסד הנתונים
        const isConnected = await ensureDatabaseConnection();
        if (!isConnected) {
            throw new Error('Database connection failed');
        }

        // קבלת כל הטוקנים הפעילים של המשתמש
        const tokens = await NotificationToken.find({
            userId,
            status: 'active',
            lastUsed: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } // טוקנים ששימשו ב-30 ימים האחרונים
        });

        return tokens.map(token => token.token);
    } catch (error) {
        logger.error('❌ Error getting user tokens:', error);
        throw error;
    }
}

async function removeSubscription(userId) {
    try {
        // וידוא חיבור למסד הנתונים
        const isConnected = await ensureDatabaseConnection();
        if (!isConnected) {
            throw new Error('Database connection failed');
        }

        // מחיקת כל הטוקנים של המשתמש
        await NotificationToken.deleteMany({ userId });
        logger.info('✅ User subscriptions removed successfully');
        
        return { success: true };
    } catch (error) {
        logger.error('❌ Error removing subscriptions:', error);
        throw error;
    }
}

// הוספת פונקציית חיבור למסד הנתונים
async function ensureDatabaseConnection() {
    try {
        const collection = await dbService.getCollection(COLLECTION_NAME);
        await collection.findOne({}); // בדיקת חיבור
        logger.info('✅ Database connection verified');
        return true;
    } catch (error) {
        logger.error('❌ Database connection error:', error);
        logger.info('🔄 Attempting to reconnect to database...');
        
        // ניסיון חוזר לחיבור
        try {
            await dbService.closeConnection();
            await new Promise(resolve => setTimeout(resolve, 2000)); // המתנה של 2 שניות
            const collection = await dbService.getCollection(COLLECTION_NAME);
            await collection.findOne({});
            logger.info('✅ Database reconnected successfully');
            return true;
        } catch (retryError) {
            logger.error('❌ Database reconnection failed:', retryError);
            return false;
        }
    }
}

// Centralized function to save or update a token
async function saveOrUpdateToken(token, userId, metadata = {}) {
    try {
        const collection = await dbService.getCollection('tokens');
        const result = await collection.updateOne(
            { token: token },
            { 
                $set: { 
                    userId,
                    platform: metadata.platform || 'unknown',
                    lastUsed: new Date(),
                    status: 'active', // Assume active on save/update
                    metadata: metadata // Store full metadata
                },
                $setOnInsert: { 
                    createdAt: new Date() 
                } // Set createdAt only on insert
            },
            { upsert: true } // Create document if it doesn't exist
        );
        console.log('✅ Token saved/updated successfully:', result);
        return result;
    } catch (error) {
        logger.error('❌ Failed to save or update token:', error);
        throw error; // Re-throw to indicate failure
    }
}

// Modify saveSubscription to use the new centralized function
async function saveSubscription(userId, subscription) {
    try {
        if (!subscription || !subscription.token) {
            throw new Error("Subscription object or token is missing");
        }
        const token = subscription.token;
        const platform = subscription.endpoint?.includes('webpush') ? 'web' : 'unknown'; // Infer platform if possible
        
        // Use the centralized function to save/update the token
        await saveOrUpdateToken(token, userId, { ...subscription, platform });

        // Optional: If you still need to save something to the 'notifications' collection
        // based on the original structure, you can add that logic here.
        // For now, we focus on fixing the token duplication.
        
    } catch (error) {
        logger.error('❌ Error in saveSubscription:', error);
        throw error; // Re-throw to indicate failure
    }
}

// הוספת פונקציית ניקוי טוקנים ישנים
async function cleanupOldTokens() {
    try {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        await NotificationToken.deleteMany({
            lastUsed: { $lt: thirtyDaysAgo },
            status: { $ne: 'active' }
        });
        logger.info('🧹 Cleaned up old notification tokens');
    } catch (error) {
        logger.error('❌ Error cleaning up old tokens:', error);
    }
}

// הפעלת ניקוי תקופתי
setInterval(cleanupOldTokens, 24 * 60 * 60 * 1000); // פעם ביום

// פונקציה לשליחת התראות
async function sendNotification(params) {
    try {
        const { userId, title, body, type, data } = params;
        
        // Get user's tokens
        const tokens = await NotificationToken.find({ 
            userId, 
            status: 'active',
            lastUsed: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } // רק טוקנים פעילים ב-30 יום האחרונים
        }).select('token platform metadata');

        if (!tokens.length) {
            logger.warn(`⚠️ No active tokens found for user ${userId}`);
            return {
                success: false,
                error: 'No active tokens found'
            };
        }

        // Send notification to each token
        const results = await Promise.allSettled(
            tokens.map(async ({ token, platform, metadata }) => {
                try {
                    const message = {
                        notification: {
                            title,
                            body
                        },
                        data: {
                            type,
                            ...data,
                            platform,
                            timestamp: Date.now()
                        },
                        token,
                        android: {
                            priority: 'high',
                            notification: {
                                channelId: 'high_importance_channel',
                                priority: 'max',
                                sound: 'default',
                                defaultSound: true,
                                defaultVibrateTimings: true,
                                defaultLightSettings: true
                            }
                        },
                        apns: {
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
                        },
                        webpush: {
                            headers: {
                                Urgency: 'high'
                            },
                            notification: {
                                requireInteraction: true,
                                vibrate: [100, 50, 100]
                            }
                        }
                    };

                    const response = await admin.messaging().send(message);
                    
                    // עדכון סטטיסטיקות הטוקן
                    await advancedTokenManager.updateTokenStatus(token, 'active');
                    
                    return {
                        token,
                        platform,
                        success: true,
                        response
                    };
                } catch (error) {
                    logger.error(`❌ Error sending to token ${token}:`, error);
                    
                    // טיפול בשגיאות ספציפיות
                    if (error.code === 'messaging/invalid-registration-token' ||
                        error.code === 'messaging/registration-token-not-registered') {
                        await NotificationToken.updateOne(
                            { token },
                            { $set: { status: 'invalid' } }
                        );
                        await advancedTokenManager.updateTokenStatus(token, 'invalid', error);
                    } else {
                        await advancedTokenManager.updateTokenStatus(token, 'error', error);
                    }
                    
                    throw error;
                }
            })
        );

        // ניתוח התוצאות
        const successful = results.filter(r => r.status === 'fulfilled').length;
        const failed = results.filter(r => r.status === 'rejected').length;
        
        logger.info(`📊 Notification results for user ${userId}: ${successful} successful, ${failed} failed`);

        return {
            success: true,
            results: {
                successful,
                failed,
                total: results.length,
                details: results.map(r => r.status === 'fulfilled' ? r.value : r.reason)
            }
        };
    } catch (error) {
        logger.error(`❌ Error sending notification:`, error);
        throw error;
    }
}

export const notificationService = {
    saveSubscription,
    sendNotification,
    removeSubscription,
    ensureIndexes
};