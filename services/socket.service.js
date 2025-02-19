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
        pingInterval: 25000,
        pingTimeout: 180000
    });
    gIo.on('connection', socket => {
        logger.info(`New connected socket [id: ${socket.id}]`)
        logger.info(`✅ New connected socket [id: ${socket.id}]`)
        logger.info(`🖥️ Connection details`, {
            userAgent: socket.handshake.headers['user-agent'],
            transport: socket.conn.transport.name,
            ip: socket.handshake.address
        });
        // 🟢 ניטור חיבורי Keep-Alive
        // socket.on('ping', () => {
        //     logger.info(`📡 Received ping from client [id: ${socket.id}]`);
        //     socket.emit('pong'); // מחזיר Pong כדי לשמור על החיבור
        // });
        socket.on('ping', () => {
            logger.info(`📡 Received ping from client [id: ${socket.id}]`);

            if (!socket.userId) {
                logger.warn(`⚠️ User is not authenticated, attempting to restore session...`);
                socket.emit('set-user-socket', {
                    userId: socket.userId,
                    username: socket.username
                });
            }

            socket.emit('pong'); // מחזיר pong כדי לשמור על החיבור
        });


        socket.on('pong', () => {
            logger.info(`🏓 Pong received from client [id: ${socket.id}]`);
        });

        socket.conn.on('heartbeat', () => {
            logger.info(`❤️‍🔥 Heartbeat received from [id: ${socket.id}]`);
        });
        socket.on('disconnect', (reason) => {
            logger.warn(`❌ Socket disconnected [id: ${socket.id}], reason: ${reason}`);

            if (socket.userId) {
                logger.info(`🔄 מנסה לחבר מחדש את המשתמש ${socket.userId} בעוד 5 שניות...`);

                setTimeout(() => {
                    const targetSocket = _getUserSocket(socket.userId);
                    if (!targetSocket) { // רק אם אין כבר חיבור פעיל
                        gIo.to(socket.id).emit('set-user-socket', {
                            userId: socket.userId,
                            username: socket.username
                        });
                        logger.info(`✅ שלח בקשה לחיבור מחדש עבור ${socket.userId}`);
                    } else {
                        logger.info(`🔵 למשתמש ${socket.userId} כבר יש חיבור פעיל, לא מחבר מחדש.`);
                    }
                }, 5000); // מחכה 5 שניות לפני ניסיון החיבור מחדש
            }
        });

        // socket.on('disconnect', socket => {
        //     logger.info(`Socket disconnected [id: ${socket.id}]`)
        // })

        // 🟢 חיבור מחדש של משתמשים במקרה של ניתוק
        // socket.on('connect', () => {
        //     if (socket.userId) {
        //         logger.info(`🔄 Re-authenticating socket with userId: ${socket.userId}`);
        //         socket.emit('set-user-socket', { userId: socket.userId, username: socket.username });
        //     } else {
        //         logger.warn(`⚠️ New socket connection without authentication. User must log in.`);
        //     }
        // });
        socket.on('connect', () => {
            logger.info(`🔄 Socket connected again [id: ${socket.id}]`);

            if (socket.userId) {
                logger.info(`✅ User ${socket.userId} is re-authenticating`);
                socket.emit('set-user-socket', { userId: socket.userId, username: socket.username });
            } else {
                logger.warn(`⚠️ No userId found, attempting to restore session...`);

                // מנסה לשחזר את החיבור דרך Event יזום ללקוח
                socket.emit('request-user-data');
            }
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
                imageUrl: msg.imageUrl || undefined // אם אין תמונה, נשאיר `undefined`
            };

            logger.info(`📢 Group message received: 
            📤 From: ${socket.userId} (${socket.username || 'Unknown'}) 
            🏷️ Room: ${socket.myTopic || 'No Room'} 
            📝 Text: "${msg.text || 'No text'}" 
            🖼️ Image: ${msg.imageUrl ? 'Yes' : 'No'}`);

            gIo.to(socket.myTopic).emit('chat-add-msg', message);
        });

        // ✅ האזנה להודעות פרטיות
        socket.on('chat-send-private-msg', async (data) => {
            const { toUserId, text, imageUrl } = data;

            if (!socket.userId || !socket.username) {
                logger.warn(`❌ Unauthorized private message attempt from socket [id: ${socket.id}] - Missing user authentication.`);
                return;
            }

            if (!toUserId || (!text && !imageUrl)) {
                logger.warn(`⚠️ Missing recipient or message content: 
                🏷️ To User ID: ${toUserId} 
                📝 Text: "${text || 'No text'}" 
                🖼️ Image: ${imageUrl ? 'Yes' : 'No'}`);
                return;
            }

            // יצירת אובייקט הודעה פרטית
            const privateMessage = {
                sender: socket.userId,
                senderName: socket.username,
                text: text || '', // אם אין טקסט, נשלח מחרוזת ריקה
                imageUrl: imageUrl || undefined // אם אין תמונה, נשאיר `undefined`
            };

            logger.info(`📩 Private message received: 
            📤 From: ${socket.userId} (${socket.username}) 
            📬 To: ${toUserId} 
            📝 Text: "${text || 'No text'}" 
            🖼️ Image: ${imageUrl ? 'Yes' : 'No'}`);

            const targetSocket = _getUserSocket(toUserId);
            if (targetSocket) {
                targetSocket.emit('chat-add-private-msg', privateMessage);
                logger.info(`✅ Private message successfully sent to ${toUserId} (${socket.username})`);
            } else {
                logger.warn(`⚠️ No active socket found for recipient ${toUserId}. Message could not be delivered.`);
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
        // האזנה לאירוע Keep Alive מהלקוח
        socket.on('ping', () => {
            logger.info(`📡 Received ping from client [id: ${socket.id}]`);
            socket.emit('pong'); // החזרת pong כדי לשמור על החיבור
        });

        // זיהוי חיבורי Socket שהתנתקו
        socket.conn.on('heartbeat', () => {
            logger.info(`❤️‍🔥 Heartbeat received from [id: ${socket.id}]`);
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
