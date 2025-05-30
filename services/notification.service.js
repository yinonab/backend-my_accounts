// services/notification.service.js
import admin from "firebase-admin";

import webpush from 'web-push';
import { config } from '../config/index.js';
import { dbService } from './db.service.js';
import { logger } from './logger.service.js';
import dotenv from 'dotenv';
import crypto from 'crypto';
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
        const tokenInfo = {
            token,
            userId,
            createdAt: Date.now(),
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
        await this._saveTokenToDatabase(tokenInfo);
        
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

    async _saveTokenToDatabase(tokenInfo) {
        try {
            const collection = await dbService.getCollection('tokens');
            await collection.updateOne(
                { token: tokenInfo.token },
                { $set: tokenInfo },
                { upsert: true }
            );
        } catch (error) {
            logger.error('Failed to save token to database:', error);
        }
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

// הוספת מנגנון ניטור משופר
class NotificationMonitoringSystem {
    constructor() {
        this.metrics = {
            notifications: {
                total: 0,
                sent: 0,
                failed: 0,
                delivered: 0,
                pending: 0
            },
            tokens: {
                total: 0,
                active: 0,
                invalid: 0,
                expired: 0
            },
            performance: {
                avgDeliveryTime: 0,
                maxDeliveryTime: 0,
                minDeliveryTime: Infinity,
                avgRetryCount: 0
            },
            errors: {
                invalidToken: 0,
                networkError: 0,
                serverError: 0,
                other: 0
            }
        };
        this.history = [];
        this.maxHistorySize = 1000;
    }

    trackNotification(notificationId, userId) {
        this.metrics.notifications.total++;
        this.metrics.notifications.pending++;
        this._updateHistory('notification_created', { notificationId, userId });
    }

    trackNotificationSent(notificationId, token) {
        this.metrics.notifications.sent++;
        this.metrics.notifications.pending--;
        this._updateHistory('notification_sent', { notificationId, token });
    }

    trackNotificationDelivered(notificationId, deliveryTime) {
        this.metrics.notifications.delivered++;
        this._updatePerformanceMetrics(deliveryTime);
        this._updateHistory('notification_delivered', { notificationId, deliveryTime });
    }

    trackNotificationFailed(notificationId, error, retryCount) {
        this.metrics.notifications.failed++;
        this._trackError(error);
        this._updateRetryMetrics(retryCount);
        this._updateHistory('notification_failed', { notificationId, error, retryCount });
    }

    trackToken(token, status) {
        this.metrics.tokens.total++;
        if (status === 'active') {
            this.metrics.tokens.active++;
        } else if (status === 'invalid') {
            this.metrics.tokens.invalid++;
        } else if (status === 'expired') {
            this.metrics.tokens.expired++;
        }
        this._updateHistory('token_status', { token, status });
    }

    _trackError(error) {
        if (error.code === 'messaging/invalid-registration-token') {
            this.metrics.errors.invalidToken++;
        } else if (error.code === 'messaging/server-unavailable') {
            this.metrics.errors.serverError++;
        } else if (error.code === 'messaging/network-error') {
            this.metrics.errors.networkError++;
        } else {
            this.metrics.errors.other++;
        }
    }

    _updatePerformanceMetrics(deliveryTime) {
        const { performance } = this.metrics;
        performance.avgDeliveryTime = (performance.avgDeliveryTime * (this.metrics.notifications.delivered - 1) + deliveryTime) / this.metrics.notifications.delivered;
        performance.maxDeliveryTime = Math.max(performance.maxDeliveryTime, deliveryTime);
        performance.minDeliveryTime = Math.min(performance.minDeliveryTime, deliveryTime);
    }

    _updateRetryMetrics(retryCount) {
        const { performance } = this.metrics;
        performance.avgRetryCount = (performance.avgRetryCount * (this.metrics.notifications.failed - 1) + retryCount) / this.metrics.notifications.failed;
    }

    _updateHistory(event, data) {
        const entry = {
            timestamp: Date.now(),
            event,
            data
        };
        this.history.push(entry);
        if (this.history.length > this.maxHistorySize) {
            this.history.shift();
        }
    }

    getMetrics() {
        return {
            ...this.metrics,
            history: this.history.slice(-100) // מחזיר 100 האירועים האחרונים
        };
    }

    getHealthStatus() {
        const metrics = this.getMetrics();
        const deliveryRate = metrics.notifications.delivered / (metrics.notifications.sent || 1);
        const errorRate = (metrics.errors.invalidToken + metrics.errors.networkError + metrics.errors.serverError + metrics.errors.other) / (metrics.notifications.sent || 1);
        const tokenHealthRate = metrics.tokens.active / (metrics.tokens.total || 1);

        return {
            status: this._calculateHealthStatus(deliveryRate, errorRate, tokenHealthRate),
            details: {
                deliveryRate,
                errorRate,
                tokenHealthRate,
                activeTokens: metrics.tokens.active,
                totalTokens: metrics.tokens.total
            }
        };
    }

    _calculateHealthStatus(deliveryRate, errorRate, tokenHealthRate) {
        if (deliveryRate < 0.5 || errorRate > 0.3 || tokenHealthRate < 0.3) return 'critical';
        if (deliveryRate < 0.8 || errorRate > 0.1 || tokenHealthRate < 0.6) return 'degraded';
        return 'healthy';
    }
}

const notificationMonitoringSystem = new NotificationMonitoringSystem();

// הוספת מנגנון טיפול בשגיאות משופר
class NotificationErrorHandler {
    constructor() {
        this.errorTypes = {
            INVALID_TOKEN: 'invalid_token',
            NETWORK: 'network',
            SERVER: 'server',
            RATE_LIMIT: 'rate_limit',
            UNKNOWN: 'unknown'
        };
        
        this.recoveryStrategies = new Map();
        this.errorCounts = new Map();
        this.maxRetries = new Map();
        
        // הגדרת אסטרטגיות התאוששות
        this._setupRecoveryStrategies();
    }

    _setupRecoveryStrategies() {
        // אסטרטגיה לטיפול בטוקנים לא תקינים
        this.recoveryStrategies.set(this.errorTypes.INVALID_TOKEN, async (token, error) => {
            logger.warn(`🔑 Invalid token detected: ${token}`);
            await this._handleInvalidToken(token, error);
        });

        // אסטרטגיה לטיפול בשגיאות רשת
        this.recoveryStrategies.set(this.errorTypes.NETWORK, async (token, error) => {
            const retryCount = this.errorCounts.get(token) || 0;
            if (retryCount < this.maxRetries.get(token) || 3) {
                logger.info(`🔄 Retrying notification (${retryCount + 1}/3) for token ${token}`);
                await this._handleNetworkError(token, error);
            } else {
                logger.error(`❌ Max retry attempts reached for token ${token}`);
                this._handleFatalError(token, error);
            }
        });

        // אסטרטגיה לטיפול בשגיאות שרת
        this.recoveryStrategies.set(this.errorTypes.SERVER, async (token, error) => {
            logger.error(`🔧 Server error for token ${token}`);
            await this._handleServerError(token, error);
        });

        // אסטרטגיה לטיפול בהגבלת קצב
        this.recoveryStrategies.set(this.errorTypes.RATE_LIMIT, async (token, error) => {
            logger.warn(`🚫 Rate limit exceeded for token ${token}`);
            await this._handleRateLimit(token, error);
        });
    }

    async handleError(token, error) {
        const errorType = this._classifyError(error);
        logger.error(`❌ Error occurred for token ${token}:`, {
            type: errorType,
            message: error.message,
            stack: error.stack
        });

        // עדכון מונה השגיאות
        this.errorCounts.set(token, (this.errorCounts.get(token) || 0) + 1);

        // קבלת אסטרטגיית התאוששות
        const recoveryStrategy = this.recoveryStrategies.get(errorType) || 
                               this.recoveryStrategies.get(this.errorTypes.UNKNOWN);

        try {
            await recoveryStrategy(token, error);
        } catch (recoveryError) {
            logger.error(`❌ Recovery failed for token ${token}:`, recoveryError);
            this._handleFatalError(token, recoveryError);
        }
    }

    _classifyError(error) {
        if (error.code === 'messaging/invalid-registration-token' ||
            error.code === 'messaging/registration-token-not-registered') {
            return this.errorTypes.INVALID_TOKEN;
        }
        if (error.code === 'messaging/network-error' ||
            error.code === 'messaging/server-unavailable') {
            return this.errorTypes.NETWORK;
        }
        if (error.code === 'messaging/internal-error' ||
            error.code === 'messaging/server-error') {
            return this.errorTypes.SERVER;
        }
        if (error.code === 'messaging/quota-exceeded' ||
            error.code === 'messaging/rate-limit-exceeded') {
            return this.errorTypes.RATE_LIMIT;
        }
        return this.errorTypes.UNKNOWN;
    }

    async _handleInvalidToken(token, error) {
        try {
            await removeToken(token);
            logger.info(`✅ Removed invalid token: ${token}`);
        } catch (removeError) {
            logger.error(`❌ Failed to remove invalid token ${token}:`, removeError);
            this._handleFatalError(token, removeError);
        }
    }

    async _handleNetworkError(token, error) {
        const retryCount = this.errorCounts.get(token) || 0;
        const delay = Math.min(1000 * Math.pow(2, retryCount), 30000); // אקספוננציאלי עם מקסימום של 30 שניות

        logger.info(`⏳ Waiting ${delay}ms before retry attempt ${retryCount + 1}`);
        await new Promise(resolve => setTimeout(resolve, delay));

        try {
            // כאן אפשר להוסיף לוגיקה לשליחה חוזרת
            this.errorCounts.delete(token);
        } catch (retryError) {
            logger.error(`❌ Retry failed for token ${token}:`, retryError);
            throw retryError;
        }
    }

    async _handleServerError(token, error) {
        const retryAfter = error.retryAfter || 60; // ברירת מחדל: 60 שניות
        logger.info(`⏳ Server error recovery: waiting ${retryAfter} seconds`);
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        await this._handleNetworkError(token, error);
    }

    async _handleRateLimit(token, error) {
        const retryAfter = error.retryAfter || 60; // ברירת מחדל: 60 שניות
        logger.info(`⏳ Rate limit recovery: waiting ${retryAfter} seconds`);
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        await this._handleNetworkError(token, error);
    }

    _handleFatalError(token, error) {
        logger.error(`💀 Fatal error for token ${token}:`, error);
        this.errorCounts.delete(token);
        this.maxRetries.delete(token);
    }

    resetErrorCount(token) {
        this.errorCounts.delete(token);
    }

    setMaxRetries(token, maxRetries) {
        this.maxRetries.set(token, maxRetries);
    }
}

const notificationErrorHandler = new NotificationErrorHandler();

// הוספת מערכת ניסיונות חוזרים מתקדמת
class AdvancedRetrySystem {
    constructor() {
        this.retryStrategies = new Map();
        this.retryHistory = new Map();
        this.maxRetries = 3;
        this.baseDelay = 1000; // 1 שנייה
    }

    async retry(operation, context) {
        const strategy = this._getRetryStrategy(context);
        let attempts = 0;
        let lastError = null;

        while (attempts < this.maxRetries) {
            try {
                const result = await operation();
                this._recordSuccess(context, attempts);
                return result;
            } catch (error) {
                lastError = error;
                attempts++;
                
                if (!this._shouldRetry(error, context, attempts)) {
                    break;
                }

                const delay = this._calculateDelay(attempts, strategy);
                await this._wait(delay);
                
                this._recordRetry(context, error, attempts);
            }
        }

        this._recordFailure(context, lastError, attempts);
        throw lastError;
    }

    _getRetryStrategy(context) {
        if (this.retryStrategies.has(context.type)) {
            return this.retryStrategies.get(context.type);
        }

        return {
            exponential: true,
            jitter: true,
            maxDelay: 30000 // 30 שניות
        };
    }

    _shouldRetry(error, context, attempts) {
        if (attempts >= this.maxRetries) {
            return false;
        }

        const strategy = this._getRetryStrategy(context);
        if (strategy.retryableErrors && !strategy.retryableErrors.includes(error.code)) {
            return false;
        }

        return true;
    }

    _calculateDelay(attempt, strategy) {
        let delay = strategy.exponential
            ? this.baseDelay * Math.pow(2, attempt - 1)
            : this.baseDelay;

        if (strategy.jitter) {
            delay = delay * (0.5 + Math.random());
        }

        return Math.min(delay, strategy.maxDelay);
    }

    _wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    _recordSuccess(context, attempts) {
        const history = this._getHistory(context);
        history.successes++;
        history.lastSuccess = Date.now();
        history.attempts = attempts;
    }

    _recordRetry(context, error, attempts) {
        const history = this._getHistory(context);
        history.retries++;
        history.lastError = error;
        history.lastRetry = Date.now();
        history.attempts = attempts;
    }

    _recordFailure(context, error, attempts) {
        const history = this._getHistory(context);
        history.failures++;
        history.lastError = error;
        history.lastFailure = Date.now();
        history.attempts = attempts;
    }

    _getHistory(context) {
        const key = this._getContextKey(context);
        if (!this.retryHistory.has(key)) {
            this.retryHistory.set(key, {
                successes: 0,
                failures: 0,
                retries: 0,
                attempts: 0,
                lastSuccess: null,
                lastFailure: null,
                lastRetry: null,
                lastError: null
            });
        }
        return this.retryHistory.get(key);
    }

    _getContextKey(context) {
        return `${context.type}-${context.id}`;
    }

    setRetryStrategy(type, strategy) {
        this.retryStrategies.set(type, strategy);
    }

    getRetryHistory(context) {
        return this.retryHistory.get(this._getContextKey(context));
    }
}

// הוספת מערכת ניטור בריאות מתקדמת
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

        // שליחת התראה למערכת הניטור
        advancedAnalyticsSystem.trackError(
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

// יצירת מופעים של המערכות החדשות
const retrySystem = new AdvancedRetrySystem();
const healthMonitoringSystem = new AdvancedHealthMonitoringSystem();

// הגדרת אסטרטגיות ניסיונות חוזרים
retrySystem.setRetryStrategy('notification', {
    exponential: true,
    jitter: true,
    maxDelay: 30000,
    retryableErrors: ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND']
});

// הגדרת בדיקות בריאות
healthMonitoringSystem.addHealthCheck('notification_service', async () => {
    const stats = await notificationManager.getStats();
    return {
        healthy: stats.successRate > 0.9,
        value: stats.successRate,
        details: stats
    };
});

healthMonitoringSystem.addHealthCheck('token_health', async () => {
    const stats = advancedTokenManager.getTokenStats();
    return {
        healthy: stats.healthy > 0.8,
        value: stats.healthy,
        details: stats
    };
});

// הגדרת התראות
healthMonitoringSystem.setAlert('notification_service', {
    threshold: 0.9,
    severity: 'high'
});

healthMonitoringSystem.setAlert('token_health', {
    threshold: 0.8,
    severity: 'medium'
});

// הפעלת ניטור בריאות
healthMonitoringSystem.startMonitoring();

// עדכון פונקציית שליחת ההתראות
async function sendNotification(params) {
    try {
        const { userId, title, body, type, data } = params;
        
        // Get user's tokens
        const tokens = await NotificationToken.find({ userId }).select('token');
        if (!tokens.length) {
            throw new Error('No tokens found for user');
        }

        // Filter out unhealthy tokens
        const healthyTokens = tokens.filter(token => {
            const health = tokenHealthMonitor.getTokenHealth(token.token);
            return health.status === 'healthy' || health.status === 'unknown';
        });

        if (!healthyTokens.length) {
            throw new Error('No healthy tokens available');
        }

        // Send notification to each healthy token
        const results = await Promise.allSettled(
            healthyTokens.map(async ({ token }) => {
                try {
                    const message = {
                        notification: {
                            title,
                            body
                        },
                        data: {
                            type,
                            ...data
                        },
                        token
                    };

                    const response = await admin.messaging().send(message);
                    tokenHealthMonitor.recordSuccess(token);
                    return response;
                } catch (error) {
                    tokenHealthMonitor.recordFailure(token);
                    throw error;
                }
            })
        );

        // Log results
        const successful = results.filter(r => r.status === 'fulfilled').length;
        const failed = results.filter(r => r.status === 'rejected').length;
        
        console.log(`Notification sent to ${successful} devices, failed for ${failed} devices`);

        return {
            success: true,
            results: {
                successful,
                failed,
                total: results.length
            }
        };
    } catch (error) {
        console.error('Error sending notification:', error);
        throw error;
    }
}

// הוספת תחזוקת טוקנים אוטומטית
setInterval(async () => {
    try {
        await advancedTokenManager.performMaintenance();
        const stats = advancedTokenManager.getTokenStats();
        logger.info('🔧 Token maintenance completed:', stats);
    } catch (error) {
        logger.error('❌ Token maintenance failed:', error);
    }
}, 60 * 60 * 1000); // כל שעה

// הוספת ניטור סטטיסטיקות טוקנים
setInterval(() => {
    const stats = tokenManager.getTokenStats();
    logger.info('📊 Token Statistics:', stats);
}, 60 * 60 * 1000); // כל שעה

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
        const user = await User.findById(userId);
        if (!user) {
            console.log('⚠️ User not found:', userId);
            return [];
        }

        // קבלת טוקנים פעילים בלבד
        const activeTokens = user.fcmTokens.filter(token => token.isActive);
        console.log(`📱 Found ${activeTokens.length} active tokens for user:`, userId);
        
        return activeTokens.map(token => token.token);
    } catch (error) {
        console.error('❌ Error getting user tokens:', error);
        return [];
    }
}

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

// הוספת מערכת דיווחים וממשק ניהול
class ReportingSystem {
    constructor() {
        this.reports = new Map();
        this.dashboards = new Map();
        this.exportFormats = ['csv', 'json', 'pdf'];
    }

    async generateReport(type, params) {
        const report = await this._generateReportData(type, params);
        this.reports.set(report.id, report);
        return report;
    }

    async _generateReportData(type, params) {
        const reportId = `${type}-${Date.now()}`;
        let data;

        switch (type) {
            case 'notification_stats':
                data = await this._generateNotificationStats(params);
                break;
            case 'token_health':
                data = await this._generateTokenHealthReport(params);
                break;
            case 'error_analysis':
                data = await this._generateErrorAnalysis(params);
                break;
            default:
                throw new Error('Unknown report type');
        }

        return {
            id: reportId,
            type,
            timestamp: Date.now(),
            data
        };
    }

    async _generateNotificationStats(params) {
        const stats = {
            total: 0,
            byType: {},
            byUser: {},
            byTime: {
                hourly: {},
                daily: {},
                weekly: {}
            },
            successRate: 0,
            averageDeliveryTime: 0
        };

        // איסוף נתונים מהמערכות השונות
        const notifications = await dbService.getCollection('notifications').find().toArray();
        
        notifications.forEach(notification => {
            stats.total++;
            
            // סטטיסטיקות לפי סוג
            stats.byType[notification.type] = (stats.byType[notification.type] || 0) + 1;
            
            // סטטיסטיקות לפי משתמש
            stats.byUser[notification.userId] = (stats.byUser[notification.userId] || 0) + 1;
            
            // סטטיסטיקות לפי זמן
            const date = new Date(notification.timestamp);
            const hour = date.getHours();
            const day = date.toISOString().split('T')[0];
            const week = this._getWeekNumber(date);
            
            stats.byTime.hourly[hour] = (stats.byTime.hourly[hour] || 0) + 1;
            stats.byTime.daily[day] = (stats.byTime.daily[day] || 0) + 1;
            stats.byTime.weekly[week] = (stats.byTime.weekly[week] || 0) + 1;
        });

        return stats;
    }

    async _generateTokenHealthReport(params) {
        const tokens = await dbService.getCollection('tokens').find().toArray();
        const healthStats = {
            total: tokens.length,
            byStatus: {},
            byPlatform: {},
            byHealth: {
                healthy: 0,
                warning: 0,
                critical: 0
            }
        };

        tokens.forEach(token => {
            const health = advancedTokenManager.getTokenHealth(token.token);
            
            healthStats.byStatus[token.status] = (healthStats.byStatus[token.status] || 0) + 1;
            healthStats.byPlatform[token.platform] = (healthStats.byPlatform[token.platform] || 0) + 1;
            healthStats.byHealth[health]++;
        });

        return healthStats;
    }

    async _generateErrorAnalysis(params) {
        const errors = await dbService.getCollection('notification_errors').find().toArray();
        const analysis = {
            total: errors.length,
            byType: {},
            byToken: {},
            byUser: {},
            trends: {
                hourly: {},
                daily: {},
                weekly: {}
            }
        };

        errors.forEach(error => {
            analysis.byType[error.type] = (analysis.byType[error.type] || 0) + 1;
            analysis.byToken[error.token] = (analysis.byToken[error.token] || 0) + 1;
            analysis.byUser[error.userId] = (analysis.byUser[error.userId] || 0) + 1;

            const date = new Date(error.timestamp);
            const hour = date.getHours();
            const day = date.toISOString().split('T')[0];
            const week = this._getWeekNumber(date);

            analysis.trends.hourly[hour] = (analysis.trends.hourly[hour] || 0) + 1;
            analysis.trends.daily[day] = (analysis.trends.daily[day] || 0) + 1;
            analysis.trends.weekly[week] = (analysis.trends.weekly[week] || 0) + 1;
        });

        return analysis;
    }

    _getWeekNumber(date) {
        const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const dayNum = d.getUTCDay() || 7;
        d.setUTCDate(d.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    }

    async exportReport(reportId, format) {
        const report = this.reports.get(reportId);
        if (!report) {
            throw new Error('Report not found');
        }

        if (!this.exportFormats.includes(format)) {
            throw new Error('Unsupported export format');
        }

        switch (format) {
            case 'csv':
                return this._exportToCSV(report);
            case 'json':
                return this._exportToJSON(report);
            case 'pdf':
                return this._exportToPDF(report);
            default:
                throw new Error('Export format not implemented');
        }
    }

    async _exportToCSV(report) {
        // מימוש ייצוא ל-CSV
        return 'CSV data';
    }

    async _exportToJSON(report) {
        return JSON.stringify(report.data, null, 2);
    }

    async _exportToPDF(report) {
        // מימוש ייצוא ל-PDF
        return 'PDF data';
    }
}

// הוספת מערכת בדיקות אוטומטיות
class AutomatedTestingSystem {
    constructor() {
        this.tests = new Map();
        this.results = new Map();
        this.suites = new Map();
    }

    async runTests(suiteName) {
        const suite = this.suites.get(suiteName);
        if (!suite) {
            throw new Error('Test suite not found');
        }

        const results = {
            suite: suiteName,
            startTime: Date.now(),
            tests: [],
            summary: {
                total: 0,
                passed: 0,
                failed: 0,
                skipped: 0
            }
        };

        for (const test of suite.tests) {
            const testResult = await this._runTest(test);
            results.tests.push(testResult);
            
            results.summary.total++;
            if (testResult.status === 'passed') {
                results.summary.passed++;
            } else if (testResult.status === 'failed') {
                results.summary.failed++;
            } else {
                results.summary.skipped++;
            }
        }

        results.endTime = Date.now();
        results.duration = results.endTime - results.startTime;
        
        this.results.set(`${suiteName}-${Date.now()}`, results);
        return results;
    }

    async _runTest(test) {
        const result = {
            name: test.name,
            startTime: Date.now(),
            status: 'pending',
            error: null
        };

        try {
            await test.fn();
            result.status = 'passed';
        } catch (error) {
            result.status = 'failed';
            result.error = error;
        }

        result.endTime = Date.now();
        result.duration = result.endTime - result.startTime;
        
        return result;
    }

    addTestSuite(name, tests) {
        this.suites.set(name, {
            name,
            tests: tests.map(test => ({
                name: test.name,
                fn: test.fn
            }))
        });
    }
}

// יצירת מופעים של המערכות החדשות
const reportingSystem = new ReportingSystem();
const testingSystem = new AutomatedTestingSystem();

// הוספת סדרות בדיקות
testingSystem.addTestSuite('notification', [
    {
        name: 'send notification',
        fn: async () => {
            const result = await sendNotification('test-user', 'Test', 'Test message');
            if (!result) throw new Error('Notification send failed');
        }
    },
    {
        name: 'token validation',
        fn: async () => {
            const token = 'test-token';
            const isValid = await securitySystem.validateToken(token, 'test-user');
            if (!isValid) throw new Error('Token validation failed');
        }
    }
]);

// הפעלת בדיקות אוטומטיות כל שעה
setInterval(async () => {
    try {
        const results = await testingSystem.runTests('notification');
        logger.info('Test results:', results);
    } catch (error) {
        logger.error('Test execution failed:', error);
    }
}, 3600000);

async function saveSubscription(userId, subscription) {
    try {
        const tokenInfo = {
            token: subscription.endpoint,
            userId: userId,
            platform: subscription.platform || 'web',
            createdAt: new Date(),
            lastUsed: new Date(),
            status: 'active',
            metadata: {
                keys: subscription.keys,
                expirationTime: subscription.expirationTime
            }
        };

        await NotificationToken.findOneAndUpdate(
            { token: subscription.endpoint },
            tokenInfo,
            { upsert: true, new: true }
        );

        return true;
    } catch (error) {
        console.error('Error saving subscription:', error);
        return false;
    }
}

export const notificationService = {
    saveSubscription,
    sendNotification,
    removeSubscription,
    createIndexes
};

class TokenHealthMonitor {
    constructor() {
        this.healthChecks = new Map();
        this.healthThresholds = {
            maxFailures: 3,
            failureWindow: 5 * 60 * 1000, // 5 minutes
            minSuccessRate: 0.8
        };
    }

    async monitorToken(token) {
        const check = {
            failures: 0,
            successes: 0,
            lastFailure: null,
            lastSuccess: null,
            status: 'healthy'
        };
        this.healthChecks.set(token, check);
        return check;
    }

    recordFailure(token) {
        const check = this.healthChecks.get(token);
        if (!check) return;

        check.failures++;
        check.lastFailure = Date.now();

        // Check if token should be marked as unhealthy
        if (check.failures >= this.healthThresholds.maxFailures) {
            check.status = 'unhealthy';
            this.handleUnhealthyToken(token);
        }
    }

    recordSuccess(token) {
        const check = this.healthChecks.get(token);
        if (!check) return;

        check.successes++;
        check.lastSuccess = Date.now();

        // Reset failure count if success rate is good
        const totalAttempts = check.failures + check.successes;
        if (totalAttempts >= 10 && (check.successes / totalAttempts) >= this.healthThresholds.minSuccessRate) {
            check.failures = 0;
            check.status = 'healthy';
        }
    }

    async handleUnhealthyToken(token) {
        try {
            // Remove token from database
            await NotificationToken.deleteOne({ token });
            
            // Notify user about token issue
            await this.notifyTokenIssue(token);
            
            // Remove from health checks
            this.healthChecks.delete(token);
        } catch (error) {
            console.error('Error handling unhealthy token:', error);
        }
    }

    async notifyTokenIssue(token) {
        try {
            const user = await NotificationToken.findOne({ token }).select('userId');
            if (!user) return;

            await this.sendNotification({
                userId: user.userId,
                title: 'בעיה בהתראות',
                body: 'נדרש לרענן את ההתראות. לחץ כאן לרענון.',
                type: 'token_issue',
                data: {
                    action: 'renew_token',
                    token
                }
            });
        } catch (error) {
            console.error('Error notifying about token issue:', error);
        }
    }

    getTokenHealth(token) {
        return this.healthChecks.get(token) || { status: 'unknown' };
    }
}

// Create instance
const tokenHealthMonitor = new TokenHealthMonitor();