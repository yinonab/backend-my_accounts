import { logger } from './logger.service.js'
import { Server } from 'socket.io'

var gIo = null

export function setupSocketAPI(http) {
    gIo = new Server(http, {
        cors: {
            origin: '*',
            methods: ['GET', 'POST'],
            credentials: true,
            transports: ['websocket', 'polling']
        },
        allowEIO3: true,
        pingTimeout: 60000
    });
    gIo.on('connection', socket => {
        logger.info(`New connected socket [id: ${socket.id}]`)
        logger.info(`New connected socket [id: ${socket.id}]`, {
            userAgent: socket.handshake.headers['user-agent'],
            transport: socket.conn.transport.name,
            ip: socket.handshake.address
        });
        socket.on('disconnect', socket => {
            logger.info(`Socket disconnected [id: ${socket.id}]`)
        })
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
                logger.warn(`Unauthorized message attempt from socket [id: ${socket.id}]`);
                return;
            }

            // Add username to the message object
            const message = {
                sender: socket.userId,
                senderName: socket.username, // Add username
                text: msg.text
            };

            logger.info(`New chat msg from user [id: ${socket.userId}, name: ${socket.username}], emitting to topic ${socket.myTopic}`);
            gIo.to(socket.myTopic).emit('chat-add-msg', message);
        });

        // ✅ האזנה להודעות פרטיות
        socket.on('chat-send-private-msg', async (data) => {
            const { toUserId, text } = data;

            if (!socket.userId || !socket.username) {
                logger.warn(`❌ Unauthorized private message attempt from socket [id: ${socket.id}]`);
                return;
            }

            if (!toUserId || !text) {
                logger.warn(`⚠️ Missing recipient or message text: { toUserId: ${toUserId}, text: ${text} }`);
                return;
            }

            // יצירת אובייקט ההודעה עם שם השולח
            const privateMessage = {
                sender: socket.userId,
                senderName: socket.username, // הוספת שם המשתמש
                text: text
            };

            logger.info(`📩 Private message received: { from: ${socket.userId}, to: ${toUserId}, text: ${text} }`);

            const targetSocket = _getUserSocket(toUserId);
            if (targetSocket) {
                targetSocket.emit('chat-add-private-msg', privateMessage);
                logger.info(`✅ Private message successfully sent to ${toUserId}`);
            } else {
                logger.warn(`⚠️ No active socket found for recipient ${toUserId}`);
            }
        });



        socket.on('user-watch', userId => {
            logger.info(`user-watch from socket [id: ${socket.id}], on user ${userId}`)
            socket.join('watching:' + userId)
        })
        //Auth
        socket.on('set-user-socket', (userData) => {
            const { userId, username } = userData;
            if (!userId) {
                logger.warn(`⚠️ Invalid userId received for socket authentication.`);
                return;
            }
            logger.info(`✅ Setting socket.userId = ${userId} and socket.username = ${username} for socket [id: ${socket.id}]`);
            socket.userId = userId;
            socket.username = username;
        });
        socket.on('connect', () => {
            if (socket.userId) {
                logger.info(`🔄 Re-authenticating socket with userId: ${socket.userId}`);
            } else {
                logger.warn(`⚠️ New socket connection without authentication. User must log in.`);
            }
        });


        socket.on('unset-user-socket', () => {
            logger.info(`Removing socket.userId for socket [id: ${socket.id}]`)
            delete socket.userId
        })

    })
}


function emitTo({ type, data, label }) {
    if (label) gIo.to('watching:' + label.toString()).emit(type, data)
    else gIo.emit(type, data)
}

async function emitToUser({ type, data, userId }) {
    userId = userId.toString()
    const socket = await _getUserSocket(userId)

    if (socket) {
        logger.info(`Emiting event: ${type} to user: ${userId} socket [id: ${socket.id}]`)
        socket.emit(type, data)
    } else {
        logger.info(`No active socket for user: ${userId}`)
        // _printSockets()
    }
}

// If possible, send to all sockets BUT not the current socket 
// Optionally, broadcast to a room / to all
async function broadcast({ type, data, room = null, userId }) {
    userId = userId.toString()

    logger.info(`Broadcasting event: ${type}`)
    const excludedSocket = await _getUserSocket(userId)
    if (room && excludedSocket) {
        logger.info(`Broadcast to room ${room} excluding user: ${userId}`)
        excludedSocket.broadcast.to(room).emit(type, data)
    } else if (excludedSocket) {
        logger.info(`Broadcast to all excluding user: ${userId}`)
        excludedSocket.broadcast.emit(type, data)
    } else if (room) {
        logger.info(`Emit to room: ${room}`)
        gIo.to(room).emit(type, data)
    } else {
        logger.info(`Emit to all`)
        gIo.emit(type, data)
    }
}

// async function _getUserSocket(userId) {
//     const sockets = await _getAllSockets()
//     const socket = sockets.find(s => s.userId === userId)
//     return socket
// }
function _getUserSocket(userId) {
    return [...gIo.sockets.sockets.values()].find(socket => socket.userId === userId);
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
}
