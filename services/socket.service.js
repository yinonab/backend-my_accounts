import { logger } from './logger.service.js'
import { Server } from 'socket.io'
import jwt from 'jsonwebtoken'
import config from '../config/dev.js'
import { userService } from '../api/user/user.service.js'

let io = null
let connectedUsers = new Map()

// הגדרת קבועים
const HEARTBEAT_INTERVAL = 10000 // 10 שניות
const KEEP_ALIVE_INTERVAL = 240000 // 4 דקות
const CONNECTION_CHECK_INTERVAL = 30000 // 30 שניות
const MAX_RECONNECT_ATTEMPTS = 5
const RECONNECT_DELAY = 5000 // 5 שניות

// מחלקת ניהול חיבורים
class ConnectionManager {
    constructor() {
        this.connections = new Map()
        this.reconnectAttempts = new Map()
        this.lastPingTime = new Map()
        this.connectionTimeouts = new Map()
    }

    getConnectionStats() {
        return {
            total: this.connections.size,
            active: Array.from(this.connections.values()).filter(conn => conn.isActive).length,
            reconnecting: Array.from(this.reconnectAttempts.values()).filter(attempts => attempts > 0).length
        }
    }

    addConnection(socketId, details) {
        this.connections.set(socketId, {
            ...details,
            isActive: true,
            lastHeartbeat: Date.now(),
            connectedAt: Date.now()
        })
        
        // הגדרת timeout לניקוי אוטומטי
        const timeout = setTimeout(() => {
            this.handleDeadConnection(socketId)
        }, CONNECTION_CHECK_INTERVAL * 2)
        
        this.connectionTimeouts.set(socketId, timeout)
    }

    removeConnection(socketId) {
        const timeout = this.connectionTimeouts.get(socketId)
        if (timeout) {
            clearTimeout(timeout)
            this.connectionTimeouts.delete(socketId)
        }
        
        this.connections.delete(socketId)
        this.reconnectAttempts.delete(socketId)
        this.lastPingTime.delete(socketId)
    }

    updateHeartbeat(socketId) {
        const connection = this.connections.get(socketId)
        if (connection) {
            connection.lastHeartbeat = Date.now()
            connection.isActive = true
            
            // איפוס ניסיונות החיבור מחדש
            this.reconnectAttempts.set(socketId, 0)
            
            // עדכון ה-timeout
            const timeout = this.connectionTimeouts.get(socketId)
            if (timeout) {
                clearTimeout(timeout)
            }
            
            const newTimeout = setTimeout(() => {
                this.handleDeadConnection(socketId)
            }, CONNECTION_CHECK_INTERVAL * 2)
            
            this.connectionTimeouts.set(socketId, newTimeout)
        }
    }

    handleDisconnect(socketId) {
        const attempts = (this.reconnectAttempts.get(socketId) || 0) + 1
        this.reconnectAttempts.set(socketId, attempts)
        
        if (attempts >= MAX_RECONNECT_ATTEMPTS) {
            this.removeConnection(socketId)
            logger.info(`❌ Max reconnection attempts reached for socket [id: ${socketId}]`)
        } else {
            logger.info(`⚠️ Socket disconnected [id: ${socketId}]. Attempt ${attempts}/${MAX_RECONNECT_ATTEMPTS}`)
        }
    }

    handleDeadConnection(socketId) {
        const connection = this.connections.get(socketId)
        if (connection && Date.now() - connection.lastHeartbeat > CONNECTION_CHECK_INTERVAL * 2) {
            logger.warn(`💀 Dead connection detected [id: ${socketId}]`)
            this.removeConnection(socketId)
            
            // ניסיון לשלוח התראה למשתמש
            const userId = connection.userId
            if (userId) {
                emitTestNotification({
                    userId,
                    data: {
                        title: "⚠️ Connection Lost",
                        body: "Your connection was lost. Please check your internet connection."
                    }
                })
            }
        }
    }
}

// פונקציית התחלת השרת
export function setupSocketAPI(http) {
    if (io) {
        logger.info('Socket API already initialized')
        return
    }

    io = new Server(http, {
        cors: {
            origin: '*',
            methods: ['GET', 'POST'],
            credentials: true,
            allowedHeaders: ['Content-Type', 'Authorization', 'loginToken']
        },
        allowEIO3: true,
        pingInterval: HEARTBEAT_INTERVAL,
        pingTimeout: CONNECTION_CHECK_INTERVAL,
        connectTimeout: 45000
    })

    const connectionManager = new ConnectionManager()

    io.use(async (socket, next) => {
        try {
            const token = socket.handshake.auth.token
            if (!token) {
                return next(new Error('Authentication error'))
            }

            const decoded = jwt.verify(token, process.env.JWT_SECRET)
            const user = await userService.getById(decoded._id)
            
            if (!user) {
                return next(new Error('User not found'))
            }

            socket.user = user
            next()
        } catch (err) {
            logger.error('Socket authentication error:', err)
            next(new Error('Authentication error'))
        }
    })

    // הגדרת ניקוי תקופתי
    setInterval(() => {
        try {
            const now = Date.now()
            const deadTimeout = CONNECTION_CHECK_INTERVAL

            for (const [socketId, connection] of connectionManager.connections.entries()) {
                if (now - connection.lastHeartbeat > deadTimeout) {
                    connectionManager.removeConnection(socketId)
                    logger.info(`🧹 Removed dead socket [id: ${socketId}]`)
                }
            }

            const stats = connectionManager.getConnectionStats()
            logger.info(`🧹 Running global cleanup for dead sockets...`)
            logger.info(`✅ Cleanup complete. Active users: ${stats.active}`)
        } catch (error) {
            logger.error(`❌ Error during socket cleanup: ${error.message}`)
        }
    }, CONNECTION_CHECK_INTERVAL)

    // הגדרת שליחת keep-alive
    setInterval(() => {
        try {
            for (const [socketId, connection] of connectionManager.connections.entries()) {
                if (connection.isActive) {
                    const socket = io.sockets.sockets.get(socketId)
                    if (socket) {
                        socket.emit('keep-alive')
                    }
                }
            }
        } catch (error) {
            logger.error(`❌ Error sending keep-alive: ${error.message}`)
        }
    }, KEEP_ALIVE_INTERVAL)

    // טיפול בחיבורים חדשים
    io.on('connection', socket => {
        logger.info(`User connected: ${socket.user._id}`)
        
        // Add socket to the set for the user
        if (!connectedUsers.has(socket.user._id)) {
            connectedUsers.set(socket.user._id, new Set())
        }
        connectedUsers.get(socket.user._id).add(socket)
        logger.info(`Total sockets for user ${socket.user._id}: ${connectedUsers.get(socket.user._id).size}`)

        // הוספת החיבור למנהל החיבורים
        connectionManager.addConnection(socket.id, {
            userAgent: socket.handshake.headers['user-agent'],
            transport: socket.conn.transport.name,
            ip: socket.handshake.address,
            userId: socket.user._id
        })

        // הגדרת event handlers
        socket.on('heartbeat', () => {
            try {
                connectionManager.updateHeartbeat(socket.id)
                socket.emit('heartbeat_ack')
                logger.info(`❤️‍🔥 Heartbeat received from [id: ${socket.id}]`)
            } catch (error) {
                logger.error(`❌ Error processing heartbeat: ${error.message}`)
            }
        })

        socket.on('disconnect', (reason) => {
            try {
                logger.info(`👋 Socket disconnected [id: ${socket.id}]. Reason: ${reason}`)
                connectionManager.handleDisconnect(socket.id)
                
                // Remove socket from the set for the user
                const userSockets = connectedUsers.get(socket.user._id)
                if (userSockets) {
                    userSockets.delete(socket)
                    if (userSockets.size === 0) {
                        connectedUsers.delete(socket.user._id)
                        logger.info(`❌ No active sockets left for userId=${socket.user._id}, removing from map.`)
                    } else {
                        logger.info(`Remaining sockets for user ${socket.user._id}: ${userSockets.size}`)
                    }
                }
            } catch (error) {
                logger.error(`❌ Error handling disconnection: ${error.message}`)
            }
        })

        socket.on('error', (error) => {
            logger.error(`❌ Socket error [id: ${socket.id}]: ${error.message}`)
            connectionManager.handleDisconnect(socket.id)
            connectedUsers.delete(socket.user._id)
        })

        // טיפול בהודעות צ'אט
        socket.on('chat-send-msg', (msg) => {
            logger.info(`💬 Received chat message: ${msg.text} from user ${socket.user._id}`)
            // שידור ההודעה לכל הלקוחות בחדר הרלוונטי
            io.to(socket.myTopic || 'general').emit('chat-add-msg', msg)
            logger.info(`✅ Broadcasted chat-add-msg to room: ${socket.myTopic || 'general'}`)
        })

        // טיפול בהודעות פרטיות
        socket.on('chat-send-private-msg', ({ toUserId, text, imageUrl, videoUrl, sender, senderName, tempId }) => {
            logger.info(`✉️ Received private message for ${toUserId} from ${socket.user._id}`)

            // Get all sockets for the target user
            const targetSockets = connectedUsers.get(toUserId)

            if (targetSockets && targetSockets.size > 0) {
                // יצירת אובייקט הודעה מלא יותר
                const privateMessage = {
                    _id: tempId, // שימוש ב-tempId זמנית, יש להחליף ב-ID מהדאטהבייס אם נשמור הודעות
                    sender: sender,
                    senderName: senderName,
                    text: text,
                    imageUrl: imageUrl,
                    videoUrl: videoUrl,
                    toUserId: toUserId,
                    createdAt: Date.now()
                }

                // Emit to all sockets of the target user
                targetSockets.forEach(targetSocket => {
                    if (targetSocket.connected) {
                        targetSocket.emit('chat-add-private-msg', privateMessage)
                        logger.info(`✅ Sent private message to socket [id: ${targetSocket.id}] for user ${toUserId}`)
                    } else {
                         logger.warn(`⚠️ Target socket [id: ${targetSocket.id}] for user ${toUserId} is not connected, skipping.`)
                         // Optional: Clean up disconnected sockets here if not handled elsewhere
                    }
                })

            } else {
                logger.warn(`⚠️ User ${toUserId} has no active sockets, cannot send private message via socket.`)
                // כאן אפשר להוסיף לוגיקה לשמירת ההודעה במסד נתונים ושליחתה כשהמשתמש מתחבר
            }
        })

        // טיפול באינדיקטור הקלדה
        socket.on('typing', ({ toUserId, messageType }) => {
            if (!socket.user?._id || !toUserId || !messageType) return;
            logger.info(`✍️ User ${socket.user._id} is typing (${messageType}) for user ${toUserId}`);
            const targetSockets = connectedUsers.get(toUserId);
            if (targetSockets) {
                targetSockets.forEach(targetSocket => {
                     if (targetSocket.connected) {
                         targetSocket.emit('user-typing', { fromUserId: socket.user._id, messageType });
                     }
                });
            }
        });

        // טיפול באינדיקטור הפסקת הקלדה
        socket.on('stop-typing', ({ toUserId }) => {
            if (!socket.user?._id || !toUserId) return;
            logger.info(`✋ User ${socket.user._id} stopped typing for user ${toUserId}`);
             const targetSockets = connectedUsers.get(toUserId);
            if (targetSockets) {
                targetSockets.forEach(targetSocket => {
                     if (targetSocket.connected) {
                         targetSocket.emit('user-stop-typing', { fromUserId: socket.user._id });
                     }
                });
            }
        });

        // טיפול בהצטרפות לחדר
        socket.on('chat-set-topic', topic => {
            if (!socket.user?._id) return;
            if (socket.myTopic === topic) return
            if (socket.myTopic) {
                socket.leave(socket.myTopic)
                logger.info(`Socket is leaving topic ${socket.myTopic} [id: ${socket.id}]`)
            }
            socket.join(topic)
            socket.myTopic = topic
            logger.info(`Socket joined topic ${topic} [id: ${socket.id}] for user ${socket.user._id}`)
        })

        // טיפול במעקב אחר משתמש
        socket.on('user-watch', userId => {
             if (!socket.user?._id || !userId) return;
            logger.info(`👀 User ${socket.user._id} watching user ${userId} [socket id: ${socket.id}]`)
            socket.join('watching:' + userId)
        })

        // שאר ה-event handlers הקיימים
        socket.on('ping', () => {
            logger.info(`📡 Received ping from client [id: ${socket.id}]`)
            socket.emit('pong')
        })

        socket.on('pong', () => {
            logger.info(`🏓 Pong received from client [id: ${socket.id}]`)
        })

        socket.on('user-ready', () => {
            logger.info(`User ready [userId=${socket.user._id}, socketId=${socket.id}]`)
            if (!socket.user._id) return
            emitTestNotification({
                userId: socket.user._id,
                data: {
                    title: "📢 Welcome!",
                    body: "Ready for notifications! 🚀"
                }
            })
        })

        socket.on('reconnect_attempt', (attemptNumber) => {
            logger.info(`Reconnection attempt ${attemptNumber} for user ${socket.user._id}`)
        })

        socket.on('reconnect', (attemptNumber) => {
            logger.info(`Reconnected after ${attemptNumber} attempts for user ${socket.user._id}`)
        })

        socket.on('reconnect_error', (error) => {
            logger.error(`Reconnection error for user ${socket.user._id}:`, error)
        })

        socket.on('reconnect_failed', () => {
            logger.error(`Failed to reconnect for user ${socket.user._id}`)
        })
    })

    return io
}

// פונקציות עזר
function _getUserSockets(userId) {
    const socketSet = connectedUsers.get(userId) || new Set()
    return Array.from(socketSet)
        .map(socketId => io.sockets.sockets.get(socketId))
        .filter(socket => socket && socket.connected)
}

async function emitTestNotification({ userId, data, attempt = 1 }) {
    if (!userId) {
        logger.error(`❌ emitTestNotification called without userId!`)
        return
    }

    const socketSet = connectedUsers.get(userId) || new Set()
    const socketIds = Array.from(socketSet)

    logger.info(`🔍 emitTestNotification: Attempt ${attempt} for userId=${userId}`)
    logger.info(`🗺️ Current sockets for userId=${userId}: [${socketIds.join(', ')}]`)

    if (!socketIds.length) {
        if (attempt <= 5) {
            logger.warn(`⚠️ No sockets for userId=${userId}. Retrying attempt ${attempt}`)
            setTimeout(() => emitTestNotification({ userId, data, attempt: attempt + 1 }), attempt * 500)
        } else {
            logger.error(`❌ Max retries reached for userId=${userId}. Giving up.`)
        }
        return
    }

    for (const socketId of socketIds) {
        const socket = io.sockets.sockets.get(socketId)
        if (socket && socket.connected) {
            socket.emit('test-notification', data)
            logger.info(`✅ Sent test-notification to socketId=${socket.id}`)
        } else {
            logger.warn(`⚠️ Skipped socketId=${socketId} (not found or disconnected)`)
            cleanupDeadSocket(socketId, userId)
        }
    }
}

function cleanupDeadSocket(socketId, userId) {
    const socketSet = connectedUsers.get(userId)
    if (!socketSet) return

    socketSet.delete(socketId)
    logger.info(`🧹 Removed dead socket [id: ${socketId}] for userId=${userId}`)

    if (socketSet.size === 0) {
        connectedUsers.delete(userId)
        logger.info(`❌ No active sockets left for userId=${userId}, removing from map.`)
    }
}

function getIO() {
    if (!io) {
        throw new Error('Socket.io not initialized')
    }
    return io
}

function emitToUser(userId, eventName, data) {
    try {
        const socket = connectedUsers.get(userId)
        if (socket) {
            socket.emit(eventName, data)
            logger.info(`Emitted ${eventName} to user ${userId}`)
        } else {
            logger.warn(`No socket found for user ${userId}`)
        }
    } catch (error) {
        logger.error(`Error emitting to user ${userId}:`, error)
    }
}

function emitToAll(eventName, data) {
    try {
        io.emit(eventName, data)
        logger.info(`Emitted ${eventName} to all users`)
    } catch (error) {
        logger.error('Error emitting to all users:', error)
    }
}

// ייצוא הפונקציות הנדרשות
export const socketService = {
    setupSocketAPI,
    emitTestNotification(data) {
        const { userId } = data;
        const userSockets = _getUserSockets(userId);
        
        if (!userSockets || userSockets.length === 0) {
            logger.warn(`⚠️ No active sockets found for user ${userId}`);
            return;
        }

        logger.info(`📡 Emitting test notification to ${userSockets.length} sockets for user ${userId}`);
        userSockets.forEach(socket => {
            socket.emit('test-notification', data);
        });
    },
    getIO,
    emitToUser,
    emitToAll,
    getUserSockets(userId) {
        const socketSet = connectedUsers.get(userId);
        if (!socketSet) {
            return [];
        }
        return Array.from(socketSet).filter(socket => socket.connected);
    },
    cleanupDeadSocket(socketId, userId) {
        const userSockets = connectedUsers.get(userId);
        if (!userSockets) return;

        let targetSocket = null;
        for (const socket of userSockets) {
            if (socket.id === socketId) {
                targetSocket = socket;
                break;
            }
        }

        if (targetSocket) {
             userSockets.delete(targetSocket);
             logger.info(`🧹 Manually removed dead socket [id: ${socketId}] for userId=${userId}`);
             if (userSockets.size === 0) {
                connectedUsers.delete(userId);
                logger.info(`❌ No active sockets left for userId=${userId}, removing from map.`);
            }
        } else {
             logger.warn(`⚠️ Attempted to manually remove socket [id: ${socketId}] for userId=${userId} but socket not found in map set.`);
        }
    }
}
