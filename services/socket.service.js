import { logger } from './logger.service.js'
import { Server } from 'socket.io'

var gIo = null
const userSocketsMap = new Map(); // 🗺️ New Map to track userId -> socketId

// הוספת מנגנון טיפול בשגיאות משופר
class ErrorHandler {
    constructor() {
        this.errorTypes = {
            CONNECTION: 'connection',
            TIMEOUT: 'timeout',
            AUTHENTICATION: 'authentication',
            RATE_LIMIT: 'rate_limit',
            SERVER: 'server',
            UNKNOWN: 'unknown'
        };
        
        this.recoveryStrategies = new Map();
        this.errorCounts = new Map();
        this.maxRetries = new Map();
        
        // הגדרת אסטרטגיות התאוששות
        this._setupRecoveryStrategies();
    }

    _setupRecoveryStrategies() {
        // אסטרטגיה לחיבור מחדש
        this.recoveryStrategies.set(this.errorTypes.CONNECTION, async (socket, error) => {
            const retryCount = this.errorCounts.get(socket.id) || 0;
            if (retryCount < this.maxRetries.get(socket.id) || 3) {
                logger.info(`🔄 Attempting reconnection (${retryCount + 1}/3) for socket ${socket.id}`);
                await this._handleReconnection(socket, error);
            } else {
                logger.error(`❌ Max reconnection attempts reached for socket ${socket.id}`);
                this._handleFatalError(socket, error);
            }
        });

        // אסטרטגיה לטיפול בפסק זמן
        this.recoveryStrategies.set(this.errorTypes.TIMEOUT, async (socket, error) => {
            logger.warn(`⏰ Timeout detected for socket ${socket.id}`);
            await this._handleTimeout(socket, error);
        });

        // אסטרטגיה לטיפול בשגיאות אימות
        this.recoveryStrategies.set(this.errorTypes.AUTHENTICATION, async (socket, error) => {
            logger.error(`🔒 Authentication error for socket ${socket.id}`);
            await this._handleAuthenticationError(socket, error);
        });

        // אסטרטגיה לטיפול בהגבלת קצב
        this.recoveryStrategies.set(this.errorTypes.RATE_LIMIT, async (socket, error) => {
            logger.warn(`🚫 Rate limit exceeded for socket ${socket.id}`);
            await this._handleRateLimit(socket, error);
        });
    }

    async handleError(socket, error) {
        const errorType = this._classifyError(error);
        logger.error(`❌ Error occurred for socket ${socket.id}:`, {
            type: errorType,
            message: error.message,
            stack: error.stack
        });

        // עדכון מונה השגיאות
        this.errorCounts.set(socket.id, (this.errorCounts.get(socket.id) || 0) + 1);

        // קבלת אסטרטגיית התאוששות
        const recoveryStrategy = this.recoveryStrategies.get(errorType) || 
                               this.recoveryStrategies.get(this.errorTypes.UNKNOWN);

        try {
            await recoveryStrategy(socket, error);
        } catch (recoveryError) {
            logger.error(`❌ Recovery failed for socket ${socket.id}:`, recoveryError);
            this._handleFatalError(socket, recoveryError);
        }
    }

    _classifyError(error) {
        if (error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET') {
            return this.errorTypes.CONNECTION;
        }
        if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
            return this.errorTypes.TIMEOUT;
        }
        if (error.code === 'EAUTH' || error.message.includes('authentication')) {
            return this.errorTypes.AUTHENTICATION;
        }
        if (error.code === 'RATE_LIMIT' || error.message.includes('rate limit')) {
            return this.errorTypes.RATE_LIMIT;
        }
        if (error.code === 'ESERVER' || error.message.includes('server error')) {
            return this.errorTypes.SERVER;
        }
        return this.errorTypes.UNKNOWN;
    }

    async _handleReconnection(socket, error) {
        const retryCount = this.errorCounts.get(socket.id) || 0;
        const delay = Math.min(1000 * Math.pow(2, retryCount), 30000); // אקספוננציאלי עם מקסימום של 30 שניות

        logger.info(`⏳ Waiting ${delay}ms before reconnection attempt ${retryCount + 1}`);
        await new Promise(resolve => setTimeout(resolve, delay));

        try {
            await socket.connect();
            logger.info(`✅ Reconnection successful for socket ${socket.id}`);
            this.errorCounts.delete(socket.id);
        } catch (reconnectError) {
            logger.error(`❌ Reconnection failed for socket ${socket.id}:`, reconnectError);
            throw reconnectError;
        }
    }

    async _handleTimeout(socket, error) {
        // ניסיון לשלוח ping כדי לבדוק את החיבור
        try {
            await socket.emit('ping');
            const pongReceived = await new Promise((resolve) => {
                const timeout = setTimeout(() => resolve(false), 5000);
                socket.once('pong', () => {
                    clearTimeout(timeout);
                    resolve(true);
                });
            });

            if (!pongReceived) {
                throw new Error('Pong not received');
            }
        } catch (timeoutError) {
            logger.error(`❌ Connection check failed for socket ${socket.id}`);
            await this._handleReconnection(socket, timeoutError);
        }
    }

    async _handleAuthenticationError(socket, error) {
        // ניסיון להתחבר מחדש עם פרטי אימות חדשים
        try {
            await socket.disconnect();
            // כאן אפשר להוסיף לוגיקה לקבלת פרטי אימות חדשים
            await socket.connect();
        } catch (authError) {
            logger.error(`❌ Authentication recovery failed for socket ${socket.id}`);
            this._handleFatalError(socket, authError);
        }
    }

    async _handleRateLimit(socket, error) {
        const retryAfter = error.retryAfter || 60; // ברירת מחדל: 60 שניות
        logger.info(`⏳ Rate limit recovery: waiting ${retryAfter} seconds`);
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        await this._handleReconnection(socket, error);
    }

    _handleFatalError(socket, error) {
        logger.error(`💀 Fatal error for socket ${socket.id}:`, error);
        socket.disconnect(true);
        this.errorCounts.delete(socket.id);
        this.maxRetries.delete(socket.id);
    }

    resetErrorCount(socketId) {
        this.errorCounts.delete(socketId);
    }

    setMaxRetries(socketId, maxRetries) {
        this.maxRetries.set(socketId, maxRetries);
    }
}

const errorHandler = new ErrorHandler();

/**
 * 🧠 Socket Service Architecture
 *
 * ✅ Supports multiple sockets per user (e.g., mobile, browser, tablet).
 * ✅ Manages socket authentication and tracks all active sockets in `userSocketsMap`.
 * ✅ On disconnection: removes the socket and cleans dead sockets; if none remain, removes user from map.
 * ✅ Emits and broadcasts messages to all relevant sockets for each user.
 * ✅ Ensures system remains robust, consistent, and scalable with real-time updates across platforms.
 *
 * Author: [Your Name]
 * Date: [Today's Date]
 */
/**
 * 🧠 שירות Socket - תמיכה במשתמשים עם מספר חיבורים
 *
 * ✅ מאפשר ריבוי חיבורים (סוקטים) לכל משתמש (דפדפן, מובייל, טאבלט וכו').
 * ✅ מנוהל מיפוי של כל הסוקטים הפעילים במבנה userSocketsMap.
 * ✅ בעת ניתוק: הסוקט מוסר מהמיפוי, ואם אין סוקטים פעילים - היוזר נמחק מהמפה.
 * ✅ שליחה ושידור הודעות לכל הסוקטים הפעילים של כל משתמש.
 * ✅ שומר על יציבות, גמישות וסקיילביליות במערכת עדכונים בזמן אמת.
 *
 * מחבר: [שמך]
 * תאריך: [תאריך היום]
 */


export function setupSocketAPI(http) {
    gIo = new Server(http, {
        cors: {
            origin: '*',
            methods: ['GET', 'POST'],
            credentials: true,
            transports: ['websocket', 'polling']
        },
        allowEIO3: true,
        pingInterval: 15000,
        pingTimeout: 300000
    });
    setInterval(cleanupAllDeadSockets, 30 * 1000);
    setInterval(sendKeepAliveNotifications, 4 * 60 * 1000);

    gIo.on('connection', socket => {
        logger.info(`New connected socket [id: ${socket.id}]`)
        logger.info(`✅ New connected socket [id: ${socket.id}]`)
        logger.info(`🖥️ Connection details`, {
            userAgent: socket.handshake.headers['user-agent'],
            transport: socket.conn.transport.name,
            ip: socket.handshake.address
        });
    
        socket.on('ping', () => {
            logger.info(`📡 Received ping from client [id: ${socket.id}]`);
            socket.emit('pong'); // מחזיר pong כדי לשמור על החיבור
        });

        socket.on('user-ready', () => {
            logger.info(`User ready [userId=${socket.userId}, socketId=${socket.id}]`);
            if (!socket.userId) return;
            emitTestNotification({
                userId: socket.userId,
                data: {
                    title: "📢 Welcome!",
                    body: "Ready for notifications! 🚀"
                }
            });
        });
        


        socket.on('pong', () => {
            logger.info(`🏓 Pong received from client [id: ${socket.id}]`);
        });

        socket.conn.on('heartbeat', () => {
            logger.info(`❤️‍🔥 Heartbeat received from [id: ${socket.id}]`);
        });
        
        
        socket.on('disconnect', (reason) => {
            logger.warn(`Socket disconnected [id: ${socket.id}], reason: ${reason}`);
            if (socket.userId) {
                const socketSet = userSocketsMap.get(socket.userId);
                if (socketSet) {
                    socketSet.delete(socket.id); // 🧠 שינוי: מחיקה מתוך Set
                    if (socketSet.size > 0) {
                        userSocketsMap.set(socket.userId, socketSet);
                    } else {
                        userSocketsMap.delete(socket.userId);
                        logger.info(`🧹 All sockets closed for user ${socket.userId}, removed from map.`);
                    }
                }
            }
        });
        
        socket.on('connect', () => {
            logger.info(`🔄 Socket connected again [id: ${socket.id}]`);

        });
        socket.on('typing', (data) => {
            const { toUserId, messageType } = data;
            if (!socket.userId || !toUserId || !messageType) return;
        
            const targetSockets = _getUserSockets(toUserId);
            targetSockets.forEach(targetSocket => {
                targetSocket.emit('user-typing', {
                    fromUserId: socket.userId,
                    messageType
                });
            });
        });
        

        socket.on('stop-typing', (data) => {
            const { toUserId } = data;
            if (!socket.userId || !toUserId) return;
        
            const targetSockets = _getUserSockets(toUserId);
            targetSockets.forEach(targetSocket => {
                targetSocket.emit('user-stop-typing', { fromUserId: socket.userId });
            });
        });
        

        socket.on('chat-set-topic', topic => {
            if (socket.myTopic === topic) return
            if (socket.myTopic) {
                socket.leave(socket.myTopic)
                logger.info(`Socket is leaving topic ${socket.myTopic} [id: ${socket.id}]`)
            }
            socket.join(topic)
            socket.myTopic = topic
        })
        socket.on('chat-send-msg', msg => {
            if (!socket.userId) {
                logger.warn(`⚠️ Unauthorized message attempt from socket [id: ${socket.id}] - User not logged in.`);
                return;
            }

            // יצירת אובייקט הודעה
            const message = {
                sender: socket.userId,
                senderName: socket.username || 'Unknown User', // אם אין שם משתמש
                text: msg.text || '', // אם אין טקסט, נשלח מחרוזת ריקה
                imageUrl: msg.imageUrl || undefined, // אם אין תמונה, נשאיר `undefined`
                videoUrl: msg.videoUrl || undefined,
            };

            logger.info(`📢 קיבלנו הודעה חדשה מהמשתמש: 
                🆔 UserID: ${socket.userId}
                🏷️ Room: ${socket.myTopic || 'No Room'}
                📝 Text: "${msg.text || 'No text'}"
                🖼️ Image: ${msg.imageUrl ? msg.imageUrl : 'No Image'}
                🎥 Video: ${msg.videoUrl ? msg.videoUrl : 'No Video'}`);


            gIo.to(socket.myTopic).emit('chat-add-msg', message);
        });

        // ✅ האזנה להודעות פרטיות
        socket.on('chat-send-private-msg', async (data) => {
            logger.info(`📩 chat-send-private-msg received:`, data);
            const { toUserId, text, imageUrl, videoUrl, tempId } = data;

            if (!socket.userId || !socket.username) {
                logger.warn(`❌ Unauthorized private message attempt from socket [id: ${socket.id}] - Missing user authentication.`);
                return;
            }

            if (!toUserId || (text === undefined && imageUrl === undefined && videoUrl === undefined)) {
                logger.warn(`⚠️ Missing recipient or message content`);
                return;
            }

            const privateMessage = {
                sender: socket.userId,
                senderName: socket.username,
                text: text || '',
                imageUrl: imageUrl || undefined,
                videoUrl: videoUrl || undefined,
                toUserId: toUserId,
                tempId: tempId
            };

            const targetSockets = _getUserSockets(toUserId);
            
            // שליחת ההודעה לכל הסוקטים של המשתמש
            if (targetSockets.length) {
                targetSockets.forEach(targetSocket => {
                    targetSocket.emit('chat-add-private-msg', privateMessage);
                });
                
                // שליחת נוטיפיקציה רק פעם אחת, לא משנה כמה סוקטים יש
                try {
                    await notificationService.sendNotification(toUserId, {
                        title: `📩 הודעה חדשה מ- ${socket.username}`,
                        body: text || 'תמונה חדשה',
                        type: 'chat-message',
                        data: {
                            messageType: 'private',
                            senderId: socket.userId,
                            senderName: socket.username
                        }
                    });
                } catch (err) {
                    logger.error('Failed to send notification:', err);
                    // המשך בזרימת הקוד גם אם הנוטיפיקציה נכשלה
                }

                logger.info(`✅ Private message delivered to ${toUserId} on ${targetSockets.length} socket(s)`);
            } else {
                logger.warn(`⚠️ No active sockets found for recipient ${toUserId}`);
            }
        });






        socket.on('user-watch', userId => {
            logger.info(`user-watch from socket [id: ${socket.id}], on user ${userId}`)
            socket.join('watching:' + userId)
        })
   

       // 🆕 שינוי: עכשיו תומך בריבוי סוקטים לכל יוזר
       socket.on('set-user-socket', (userData) => {
        const { userId, username } = userData;
        if (!userId) return;
        socket.userId = userId;
        socket.username = username;

        if (!userSocketsMap.has(userId)) {
            userSocketsMap.set(userId, new Set());
        }
        const socketSet = userSocketsMap.get(userId);
        if (!socketSet.has(socket.id)) {
            socketSet.add(socket.id);
            logger.info(`✅ Added socket ${socket.id} to user ${userId}`);
        } else {
            logger.info(`ℹ️ Socket ${socket.id} already mapped for user ${userId}, skipping.`);
        }
    });
    

        


        // האזנה לאירוע Keep Alive מהלקוח
        socket.on('ping', () => {
            logger.info(`📡 Received ping from client [id: ${socket.id}]`);
            socket.emit('pong'); // החזרת pong כדי לשמור על החיבור
        });

        // זיהוי חיבורי Socket שהתנתקו
        socket.conn.on('heartbeat', () => {
            logger.info(`❤️‍🔥 Heartbeat received from [id: ${socket.id}]`);
        });

        socket.on('unset-user-socket', () => {
            logger.info(`Removing socket.userId for socket [id: ${socket.id}]`)
            delete socket.userId
        })

    })
}
function cleanupDuplicateSocketRefs(userId) {
    const socketSet = userSocketsMap.get(userId) || new Set();
    const aliveSocketIds = new Set();
    for (const socketId of socketSet) {
        const socket = gIo.sockets.sockets.get(socketId);
        if (socket && socket.connected) {
            aliveSocketIds.add(socketId);
        }
    }
    if (aliveSocketIds.size > 0) {
        userSocketsMap.set(userId, aliveSocketIds);
    } else {
        userSocketsMap.delete(userId);
    }
    logger.info(`🧼 Cleaned socket refs for userId=${userId}, remaining: [${Array.from(aliveSocketIds).join(', ')}]`);
}


function emitTo({ type, data, label }) {
    if (label) gIo.to('watching:' + label.toString()).emit(type, data)
    else gIo.emit(type, data)
}

async function emitToUser({ type, data, userId }) {
    const socketSet = userSocketsMap.get(userId) || new Set();
    for (const socketId of socketSet) {
        const socket = gIo.sockets.sockets.get(socketId);
        if (socket && socket.connected) {
            socket.emit(type, data);
            logger.info(`✅ Emitted ${type} to socket ${socket.id}`);
        }
    }
}
async function emitTestNotification({ userId, data, attempt = 1 }) {
    // אם לא הועבר userId, נרשום שגיאה
    if (!userId) {
        logger.error(`❌ emitTestNotification called without userId!`);
        return;
    }
    
    // לוקחים את כל הסוקטים של המשתמש מתוך המפה, אם אין, ניצור מערך ריק
    const socketSet = userSocketsMap.get(userId) || new Set();
    const socketIds = Array.from(socketSet); // ממירים את ה-Set למערך כדי לעבוד איתו

    // רושמים את הניסיון הנוכחי של השיגור
    logger.info(`🔍 emitTestNotification: Attempt ${attempt} for userId=${userId}`);
    logger.info(`🗺️ Current sockets for userId=${userId}: [${socketIds.join(', ')}]`);

    // אם אין סוקטים שנמצאים במפה עבור המשתמש, ננסה שוב עד 5 פעמים
    if (!socketIds.length) {
        if (attempt <= 5) {
            logger.warn(`⚠️ No sockets for userId=${userId}. Retrying attempt ${attempt}`);
            // אם אין סוקטים, נמתין ונסו שוב
            setTimeout(() => emitTestNotification({ userId, data, attempt: attempt + 1 }), attempt * 500);
        } else {
            // אם הגענו למקסימום של 5 ניסיונות, נרשום שגיאה
            logger.error(`❌ Max retries reached for userId=${userId}. Giving up.`);
        }
        return; // אם לא הצלחנו למצוא סוקטים, יוצאים מהפונקציה
    }

    // עבור כל סוקט במערך, ננסה לשלוח את ההודעה
    for (const socketId of socketIds) {
        const socket = gIo.sockets.sockets.get(socketId); // מוצאים את הסוקט מתוך המפה

        if (socket && socket.connected) { // אם הסוקט מחובר
            // שולחים את ההודעה לסוקט הזה
            socket.emit('test-notification', data);
            logger.info(`✅ Sent test-notification to socketId=${socket.id}`);
        } else {
            // אם הסוקט לא נמצא או לא מחובר, נרשום שהסוקט מנותק
            logger.warn(`⚠️ Skipped socketId=${socketId} (not found or disconnected)`);
            // אם הסוקט לא נמצא או מנותק, ננקה אותו מהמפה
            cleanupDeadSocket(socketId, userId);
        }
    }
}

// פונקציה לניקוי סוקט מנותק מהמפה
function cleanupDeadSocket(socketId, userId) {
    const socketSet = userSocketsMap.get(userId); // מוצאים את כל הסוקטים של המשתמש

    if (!socketSet) return; // אם אין סוקטים, יוצאים

    const socket = gIo.sockets.sockets.get(socketId);
    const socketName = socket ? socket.handshake ? socket.handshake.headers['user-agent'] : 'Unknown Socket' : 'Socket Not Found';


    // מוחקים את הסוקט מהמפה
    socketSet.delete(socketId);
    logger.info(`🧹 Removed dead socket [id: ${socketId}, Name: ${socketName}] for userId=${userId}`);

    // אם לא נשארו סוקטים פעילים עבור המשתמש, נמחק את המשתמש מהמפה
    if (socketSet.size === 0) {
        userSocketsMap.delete(userId);
        logger.info(`❌ No active sockets left for userId=${userId}, removing from map.`);
    }
}


function cleanupAllDeadSockets() {
    logger.info("🧹 Running global cleanup for dead sockets...");

    for (const [userId, socketSet] of userSocketsMap.entries()) {
        const aliveSocketIds = new Set();
        for (const socketId of socketSet) {
            const socket = gIo.sockets.sockets.get(socketId);
            const socketName = socket ? socket.handshake ? socket.handshake.headers['user-agent'] : 'Unknown Socket' : 'Socket Not Found';

            if (socket && socket.connected) {
                aliveSocketIds.add(socketId);
            } else {
                socketSet.delete(socketId);  // מחיקה של הסוקט מהמפה של המשתמש
                logger.info(`🧹 Removed dead socket [id: ${socketId}, Name: ${socketName}] for userId=${userId}`);
            }
        }

        if (aliveSocketIds.size > 0) {
            userSocketsMap.set(userId, aliveSocketIds);
        } else {
            userSocketsMap.delete(userId);
            logger.info(`❌ Removed user ${userId} from map – no active sockets`);
        }
    }

    logger.info(`✅ Cleanup complete. Active users: ${userSocketsMap.size}`);
}

async function broadcast({ type, data, room = null, userId }) {
    userId = userId.toString();
    logger.info(`📡 Broadcasting event: ${type}`);

    if (room) {
        // אם מוגדר room → שולחים לחדר
        logger.info(`🏠 Broadcasting to room: ${room}`);
        gIo.to(room).emit(type, data);
        return;
    }

    const socketSet = userSocketsMap.get(userId) || new Set();
    const socketsIds = Array.from(socketSet);
        if (socketsIds.length) {
        logger.info(`📤 Broadcasting to all sockets of user: ${userId}, excluding them`);
        socketsIds.forEach(socketId => {
            const socket = gIo.sockets.sockets.get(socketId);
            if (socket && socket.connected) {
                socket.broadcast.emit(type, data);
                logger.info(`✅ Broadcasted to everyone excluding socketId=${socket.id}`);
            } else {
                logger.warn(`⚠️ Skipped disconnected socketId=${socketId}`);
            }
        });
    } else {
        logger.info(`🌍 Broadcasting to ALL users (no exclusion)`);
        gIo.emit(type, data);
    }
}



// If possible, send to all sockets BUT not the current socket 
// Optionally, broadcast to a room / to all
// async function broadcast({ type, data, room = null, userId }) {
//     userId = userId.toString()

//     logger.info(`Broadcasting event: ${type}`)
//     const excludedSocket = await _getUserSocket(userId)
//     if (room && excludedSocket) {
//         logger.info(`Broadcast to room ${room} excluding user: ${userId}`)
//         excludedSocket.broadcast.to(room).emit(type, data)
//     } else if (excludedSocket) {
//         logger.info(`Broadcast to all excluding user: ${userId}`)
//         excludedSocket.broadcast.emit(type, data)
//     } else if (room) {
//         logger.info(`Emit to room: ${room}`)
//         gIo.to(room).emit(type, data)
//     } else {
//         logger.info(`Emit to all`)
//         gIo.emit(type, data)
//     }
// }
// function _cleanDeadSockets(userId) {
//     const sockets = [...gIo.sockets.sockets.values()]
//         .filter(socket => socket.userId && socket.userId.toString() === userId.toString());

//     sockets.forEach(socket => {
//         if (!socket.connected) {
//             logger.info(`🧹 Cleaning dead socket [id: ${socket.id}] for userId=${userId}`);
//             socket.disconnect(true); // סוגר לגמרי
//         }
//     });
// }

function _cleanDeadSockets(userId) {
    const socketSet = userSocketsMap.get(userId) || new Set();
    const aliveSocketIds = new Set();
    for (const socketId of socketSet) {
        const socket = gIo.sockets.sockets.get(socketId);
        if (socket && socket.connected) {
            aliveSocketIds.add(socketId);
        } else {
            logger.info(`🧹 Removing dead socket [id: ${socketId}] for userId=${userId}`);
        }
    }
    if (aliveSocketIds.size > 0) {
        userSocketsMap.set(userId, aliveSocketIds);
        logger.info(`🛠️ Updated alive sockets for userId=${userId}: [${Array.from(aliveSocketIds).join(', ')}]`);
    } else {
        userSocketsMap.delete(userId);
        logger.info(`🧹 All sockets dead for userId=${userId}, removed from map.`);
    }
}



function _getUserSocket(userId) {
    return [...gIo.sockets.sockets.values()]
        .find(socket => socket.userId && socket.userId.toString() === userId.toString());
}

function _getUserSockets(userId) {
    const socketSet = userSocketsMap.get(userId) || new Set();
    const sockets = Array.from(socketSet)
        .map(socketId => gIo.sockets.sockets.get(socketId))
        .filter(socket => socket && socket.connected);
    return sockets;
}


async function _getAllSockets() {
    // return all Socket instances
    const sockets = await gIo.fetchSockets()
    return sockets
}

async function _printSockets() {
    const sockets = await _getAllSockets()
    console.log(`Sockets: (count: ${sockets.length}):`)
    sockets.forEach(_printSocket)
}
function _printSocket(socket) {
    console.log(`Socket - socketId: ${socket.id} userId: ${socket.userId}`)
}

export const socketService = {
    // set up the sockets service and define the API
    setupSocketAPI,
    // emit to everyone / everyone in a specific room (label)
    emitTo,
    // emit to a specific user (if currently active in system)
    emitToUser,
    // Send to all sockets BUT not the current socket - if found
    // (otherwise broadcast to a room / to all)
    broadcast,
    cleanupDuplicateSocketRefs,
    emitTestNotification,
}

// הגדרת קבועים חדשים
const HEARTBEAT_INTERVAL = 10000; // 10 שניות
const KEEP_ALIVE_INTERVAL = 240000; // 4 דקות
const CONNECTION_CHECK_INTERVAL = 30000; // 30 שניות
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 5000; // 5 שניות

// הוספת מנגנון Heartbeat משופר
function startHeartbeat(socket) {
    let missedPings = 0;
    const maxMissedPings = 3;

    const heartbeatInterval = setInterval(() => {
        if (socket.connected) {
            socket.emit('ping');
            logger.info(`📡 Heartbeat ping sent to socket: ${socket.id}`);
            
            // בדיקת תגובה ל-ping
            const pingTimeout = setTimeout(() => {
                missedPings++;
                logger.warn(`⚠️ Socket ${socket.id} missed ${missedPings} pings`);
                
                if (missedPings >= maxMissedPings) {
                    logger.error(`❌ Socket ${socket.id} missed too many pings, disconnecting`);
                    clearInterval(heartbeatInterval);
                    socket.disconnect(true);
                    handleReconnection(socket);
                }
            }, 5000); // 5 שניות להמתין לתגובה

            socket.once('pong', () => {
                clearTimeout(pingTimeout);
                missedPings = 0;
            });
        } else {
            logger.warn(`⚠️ Socket ${socket.id} disconnected during heartbeat`);
            clearInterval(heartbeatInterval);
            handleReconnection(socket);
        }
    }, HEARTBEAT_INTERVAL);

    return heartbeatInterval;
}

// הוספת מנגנון Keep-Alive משופר
async function sendKeepAliveNotifications() {
    try {
        const sockets = await _getAllSockets();
        const now = Date.now();
        
        for (const socket of sockets) {
            if (socket.userId) {
                const lastPing = connectionManager.lastPingTime.get(socket.id) || 0;
                const timeSinceLastPing = now - lastPing;
                
                if (timeSinceLastPing > KEEP_ALIVE_INTERVAL) {
                    logger.info(`🔄 Sending keep-alive to socket ${socket.id}`);
                    
                    try {
                        await emitTestNotification({
                            userId: socket.userId,
                            data: {
                                title: "🔄 Keep-Alive",
                                body: "Keeping connection alive",
                                type: "keep-alive",
                                silent: true,
                                priority: "high",
                                ttl: 3600,
                                android: {
                                    priority: "high",
                                    notification: {
                                        channelId: "keep_alive_channel",
                                        priority: "max",
                                        sound: "default",
                                        defaultSound: true,
                                        defaultVibrateTimings: true,
                                        defaultLightSettings: true
                                    }
                                }
                            }
                        });
                        
                        // עדכון זמן ה-ping האחרון
                        connectionManager.updatePing(socket.id);
                    } catch (error) {
                        logger.error(`❌ Failed to send keep-alive to socket ${socket.id}:`, error);
                        handleReconnection(socket);
                    }
                }
            }
        }
    } catch (err) {
        logger.error('Failed to send keep-alive notifications:', err);
    }
}

// הוספת מנגנון ניהול חיבורים משופר
class ConnectionManager {
    constructor() {
        this.connectionStats = new Map();
        this.reconnectAttempts = new Map();
        this.lastPingTime = new Map();
        this.deviceConnections = new Map();
        this.connectionPool = new Map();
    }

    trackConnection(socket) {
        const stats = {
            connectedAt: Date.now(),
            lastPing: Date.now(),
            reconnectCount: 0,
            deviceInfo: socket.handshake.headers['user-agent'],
            ip: socket.handshake.address,
            userId: socket.userId,
            deviceId: this._getDeviceId(socket)
        };
        this.connectionStats.set(socket.id, stats);
        this.lastPingTime.set(socket.id, Date.now());
        
        // מעקב אחר חיבורים לפי מכשיר
        if (stats.deviceId) {
            if (!this.deviceConnections.has(stats.deviceId)) {
                this.deviceConnections.set(stats.deviceId, new Set());
            }
            this.deviceConnections.get(stats.deviceId).add(socket.id);
        }

        // מעקב אחר חיבורים לפי משתמש
        if (stats.userId) {
            if (!this.connectionPool.has(stats.userId)) {
                this.connectionPool.set(stats.userId, new Set());
            }
            this.connectionPool.get(stats.userId).add(socket.id);
        }
    }

    _getDeviceId(socket) {
        const userAgent = socket.handshake.headers['user-agent'];
        const ip = socket.handshake.address;
        return `${userAgent}-${ip}`;
    }

    updatePing(socketId) {
        this.lastPingTime.set(socketId, Date.now());
        const stats = this.connectionStats.get(socketId);
        if (stats) {
            stats.lastPing = Date.now();
        }
    }

    handleDisconnect(socketId) {
        const stats = this.connectionStats.get(socketId);
        if (stats) {
            stats.reconnectCount++;
            logger.info(`📊 Connection stats for ${socketId}:`, {
                duration: Date.now() - stats.connectedAt,
                reconnectCount: stats.reconnectCount,
                deviceInfo: stats.deviceInfo,
                userId: stats.userId
            });

            // ניקוי חיבורים לפי מכשיר
            if (stats.deviceId) {
                const deviceConnections = this.deviceConnections.get(stats.deviceId);
                if (deviceConnections) {
                    deviceConnections.delete(socketId);
                    if (deviceConnections.size === 0) {
                        this.deviceConnections.delete(stats.deviceId);
                    }
                }
            }

            // ניקוי חיבורים לפי משתמש
            if (stats.userId) {
                const userConnections = this.connectionPool.get(stats.userId);
                if (userConnections) {
                    userConnections.delete(socketId);
                    if (userConnections.size === 0) {
                        this.connectionPool.delete(stats.userId);
                    }
                }
            }
        }
        this.connectionStats.delete(socketId);
        this.lastPingTime.delete(socketId);
    }

    checkConnections() {
        const now = Date.now();
        for (const [socketId, lastPing] of this.lastPingTime) {
            if (now - lastPing > 30000) { // 30 שניות
                logger.warn(`⚠️ Socket ${socketId} hasn't pinged in 30 seconds`);
                const socket = gIo.sockets.sockets.get(socketId);
                if (socket) {
                    socket.emit('ping');
                }
            }
        }
    }

    getDeviceConnections(deviceId) {
        return this.deviceConnections.get(deviceId) || new Set();
    }

    getUserConnections(userId) {
        return this.connectionPool.get(userId) || new Set();
    }

    getConnectionStats() {
        return {
            totalConnections: this.connectionStats.size,
            totalDevices: this.deviceConnections.size,
            totalUsers: this.connectionPool.size,
            connectionsByDevice: Object.fromEntries(
                Array.from(this.deviceConnections.entries()).map(([deviceId, connections]) => [
                    deviceId,
                    connections.size
                ])
            ),
            connectionsByUser: Object.fromEntries(
                Array.from(this.connectionPool.entries()).map(([userId, connections]) => [
                    userId,
                    connections.size
                ])
            )
        };
    }
}

// הוספת מנגנון ניטור משופר
class MonitoringSystem {
    constructor() {
        this.metrics = {
            connections: {
                total: 0,
                active: 0,
                failed: 0,
                reconnected: 0
            },
            pings: {
                sent: 0,
                received: 0,
                missed: 0
            },
            errors: {
                connection: 0,
                timeout: 0,
                other: 0
            },
            performance: {
                avgResponseTime: 0,
                maxResponseTime: 0,
                minResponseTime: Infinity
            }
        };
        this.history = [];
        this.maxHistorySize = 1000;
    }

    trackConnection(socket) {
        this.metrics.connections.total++;
        this.metrics.connections.active++;
        this._updateHistory('connection', { socketId: socket.id, type: 'connect' });
    }

    trackDisconnection(socket, reason) {
        this.metrics.connections.active--;
        if (reason === 'transport error') {
            this.metrics.connections.failed++;
        }
        this._updateHistory('disconnection', { socketId: socket.id, reason });
    }

    trackReconnection(socket) {
        this.metrics.connections.reconnected++;
        this._updateHistory('reconnection', { socketId: socket.id });
    }

    trackPing(socket) {
        this.metrics.pings.sent++;
        this._updateHistory('ping', { socketId: socket.id, type: 'sent' });
    }

    trackPong(socket, responseTime) {
        this.metrics.pings.received++;
        this._updatePerformanceMetrics(responseTime);
        this._updateHistory('pong', { socketId: socket.id, responseTime });
    }

    trackMissedPing(socket) {
        this.metrics.pings.missed++;
        this._updateHistory('missed_ping', { socketId: socket.id });
    }

    trackError(socket, error) {
        if (error.type === 'connection') {
            this.metrics.errors.connection++;
        } else if (error.type === 'timeout') {
            this.metrics.errors.timeout++;
        } else {
            this.metrics.errors.other++;
        }
        this._updateHistory('error', { socketId: socket.id, error });
    }

    _updatePerformanceMetrics(responseTime) {
        const { performance } = this.metrics;
        performance.avgResponseTime = (performance.avgResponseTime * (this.metrics.pings.received - 1) + responseTime) / this.metrics.pings.received;
        performance.maxResponseTime = Math.max(performance.maxResponseTime, responseTime);
        performance.minResponseTime = Math.min(performance.minResponseTime, responseTime);
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
        const { connections, pings, errors } = this.metrics;
        const pingSuccessRate = pings.received / (pings.sent || 1);
        const errorRate = (errors.connection + errors.timeout + errors.other) / (connections.total || 1);

        return {
            status: this._calculateHealthStatus(pingSuccessRate, errorRate),
            details: {
                pingSuccessRate,
                errorRate,
                activeConnections: connections.active,
                totalConnections: connections.total
            }
        };
    }

    _calculateHealthStatus(pingSuccessRate, errorRate) {
        if (pingSuccessRate < 0.5 || errorRate > 0.3) return 'critical';
        if (pingSuccessRate < 0.8 || errorRate > 0.1) return 'degraded';
        return 'healthy';
    }
}

const monitoringSystem = new MonitoringSystem();

// עדכון פונקציית החיבור הראשית
function connectSocket(socket) {
    logger.info('🔌 New socket connection attempt:', socket.id);
    
    // התחלת מעקב אחר החיבור
    connectionManager.trackConnection(socket);
    monitoringSystem.trackConnection(socket);
    
    // התחלת מנגנון Heartbeat
    const heartbeatInterval = startHeartbeat(socket);
    socket.heartbeatInterval = heartbeatInterval;
    
    // הוספת מאזינים לאירועים
    socket.on('ping', () => {
        const startTime = Date.now();
        connectionManager.updatePing(socket.id);
        monitoringSystem.trackPing(socket);
        socket.emit('pong');
    });

    socket.on('pong', () => {
        const responseTime = Date.now() - startTime;
        logger.info(`🏓 Pong received from socket ${socket.id}`);
        connectionManager.updatePing(socket.id);
        monitoringSystem.trackPong(socket, responseTime);
    });

    socket.on('disconnect', (reason) => {
        logger.info('❌ Socket disconnected:', socket.id);
        connectionManager.handleDisconnect(socket.id);
        monitoringSystem.trackDisconnection(socket, reason);
        clearInterval(socket.heartbeatInterval);
    });

    socket.on('error', (error) => {
        logger.error('❌ Socket error:', error);
        monitoringSystem.trackError(socket, error);
        handleReconnection(socket);
    });

    // התחלת ניטור חיבורים
    startConnectionMonitoring();
}

// הוספת מנגנון ניטור החיבורים
function startConnectionMonitoring() {
    setInterval(() => {
        connectionManager.checkConnections();
        
        const activeSockets = Array.from(userSocketsMap.values()).flat();
        logger.info(`📊 Active connections: ${activeSockets.length}`);
        
        activeSockets.forEach(socket => {
            if (!socket.connected) {
                logger.warn(`⚠️ Found disconnected socket: ${socket.id}`);
                handleReconnection(socket);
            }
        });
    }, CONNECTION_CHECK_INTERVAL);
}

// עדכון מנגנון החיבור מחדש
function handleReconnection(socket) {
    const reconnectAttempts = connectionManager.reconnectAttempts.get(socket.id) || 0;
    
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        logger.error('❌ Max reconnection attempts reached for socket:', socket.id);
        return;
    }

    connectionManager.reconnectAttempts.set(socket.id, reconnectAttempts + 1);
    logger.info(`🔄 Attempting to reconnect (${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})...`);

    socket.connect();
    
    socket.once('connect', () => {
        logger.info('✅ Reconnection successful for socket:', socket.id);
        connectionManager.reconnectAttempts.delete(socket.id);
        startHeartbeat(socket);
    });

    socket.once('connect_error', (error) => {
        logger.error('❌ Reconnection failed:', error.message);
        setTimeout(() => handleReconnection(socket), RECONNECT_DELAY * (reconnectAttempts + 1));
    });
}

// הוספת פונקציה לניטור סטטיסטיקות
function startStatsMonitoring() {
    setInterval(() => {
        const stats = connectionManager.getConnectionStats();
        const metrics = monitoringSystem.getMetrics();
        const health = monitoringSystem.getHealthStatus();
        
        logger.info('📊 System Statistics:', {
            connections: stats,
            metrics,
            health
        });

        // שליחת התראה אם המערכת במצב קריטי
        if (health.status === 'critical') {
            logger.error('🚨 System health is critical:', health.details);
            // כאן אפשר להוסיף שליחת התראה למנהלי המערכת
        }
    }, 60000); // כל דקה
}

// התחלת ניטור סטטיסטיקות
startStatsMonitoring();
