import { logger } from './logger.service.js'
import { Server } from 'socket.io'

let gIo = null
const userSocketsMap = new Map()

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
    }

    getConnectionStats() {
        return {
            total: this.connections.size,
            active: Array.from(this.connections.values()).filter(conn => conn.isActive).length
        }
    }

    addConnection(socketId, details) {
        this.connections.set(socketId, {
            ...details,
            isActive: true,
            lastHeartbeat: Date.now()
        })
    }

    removeConnection(socketId) {
        this.connections.delete(socketId)
    }

    updateHeartbeat(socketId) {
        const connection = this.connections.get(socketId)
        if (connection) {
            connection.lastHeartbeat = Date.now()
            connection.isActive = true
        }
    }

    handleDisconnect(socketId) {
        this.removeConnection(socketId)
        this.reconnectAttempts.delete(socketId)
        this.lastPingTime.delete(socketId)
    }
}

// פונקציית התחלת השרת
export function setupSocketAPI(http) {
    if (gIo) {
        logger.info('Socket API already initialized')
        return
    }

    gIo = new Server(http, {
        cors: {
            origin: '*',
            methods: ['GET', 'POST'],
            credentials: true,
            transports: ['websocket', 'polling']
        },
        allowEIO3: true,
        pingInterval: HEARTBEAT_INTERVAL,
        pingTimeout: CONNECTION_CHECK_INTERVAL
    })

    const connectionManager = new ConnectionManager()

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
                    const socket = gIo.sockets.sockets.get(socketId)
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
    gIo.on('connection', socket => {
        logger.info(`New connected socket [id: ${socket.id}]`)
        
        // הוספת החיבור למנהל החיבורים
        connectionManager.addConnection(socket.id, {
            userAgent: socket.handshake.headers['user-agent'],
            transport: socket.conn.transport.name,
            ip: socket.handshake.address
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

        socket.on('disconnect', () => {
            try {
                connectionManager.handleDisconnect(socket.id)
                logger.info(`👋 Socket disconnected [id: ${socket.id}]`)
            } catch (error) {
                logger.error(`❌ Error handling disconnection: ${error.message}`)
            }
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
            logger.info(`User ready [userId=${socket.userId}, socketId=${socket.id}]`)
            if (!socket.userId) return
            emitTestNotification({
                userId: socket.userId,
                data: {
                    title: "📢 Welcome!",
                    body: "Ready for notifications! 🚀"
                }
            })
        })

        // ... שאר ה-event handlers הקיימים ...
    })
}

// פונקציות עזר
function _getUserSockets(userId) {
    const socketSet = userSocketsMap.get(userId) || new Set()
    return Array.from(socketSet)
        .map(socketId => gIo.sockets.sockets.get(socketId))
        .filter(socket => socket && socket.connected)
}

async function emitTestNotification({ userId, data, attempt = 1 }) {
    if (!userId) {
        logger.error(`❌ emitTestNotification called without userId!`)
        return
    }

    const socketSet = userSocketsMap.get(userId) || new Set()
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
        const socket = gIo.sockets.sockets.get(socketId)
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
    const socketSet = userSocketsMap.get(userId)
    if (!socketSet) return

    socketSet.delete(socketId)
    logger.info(`🧹 Removed dead socket [id: ${socketId}] for userId=${userId}`)

    if (socketSet.size === 0) {
        userSocketsMap.delete(userId)
        logger.info(`❌ No active sockets left for userId=${userId}, removing from map.`)
    }
}

// ייצוא הפונקציות הנדרשות
export const socketService = {
    setupSocketAPI,
    emitTestNotification
}
