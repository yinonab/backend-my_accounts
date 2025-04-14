import { logger } from './logger.service.js'
import { Server } from 'socket.io'

var gIo = null
const userSocketsMap = new Map(); // 🗺️ New Map to track userId -> socketId


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
        pingInterval: 25000,
        pingTimeout: 600000
    });
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
                const sockets = userSocketsMap.get(socket.userId) || [];
                const updatedSockets = sockets.filter(id => id !== socket.id);
                if (updatedSockets.length > 0) {
                    userSocketsMap.set(socket.userId, updatedSockets);
                } else {
                    userSocketsMap.delete(socket.userId);
                    logger.info(`🧹 All sockets closed for user ${socket.userId}, removed from map.`);
                }
            }
        });
        
        socket.on('connect', () => {
            logger.info(`🔄 Socket connected again [id: ${socket.id}]`);

        });
        socket.on('typing', (data) => {
            const { toUserId, messageType } = data;
            if (!socket.userId || !toUserId || !messageType) return;

            const targetSocket = _getUserSocket(toUserId);
            if (targetSocket) {
                targetSocket.emit('user-typing', {
                    fromUserId: socket.userId,
                    messageType
                });
            }
        });

        socket.on('stop-typing', (data) => {
            const { toUserId } = data;
            if (!socket.userId || !toUserId) return;

            const targetSocket = _getUserSocket(toUserId);
            if (targetSocket) {
                targetSocket.emit('user-stop-typing', { fromUserId: socket.userId });
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
            const { toUserId, text, imageUrl, videoUrl, tempId } = data;  // ✅ עכשיו גם videoUrl

            if (!socket.userId || !socket.username) {
                logger.warn(`❌ Unauthorized private message attempt from socket [id: ${socket.id}] - Missing user authentication.`);
                return;
            }

            if (!toUserId || (text === undefined && imageUrl === undefined && videoUrl === undefined)) {
                logger.warn(`⚠️ Missing recipient or message content: 
                🏷️ To User ID: ${toUserId} 
                📝 Text: "${text || 'No text'}" 
                🖼️ Image: ${imageUrl ? 'Yes' : 'No'}"
                🎥 Video: ${videoUrl ? 'Yes' : 'No'}"`);
                return;
            }


            const privateMessage = {
                sender: socket.userId,
                senderName: socket.username,
                text: text || '',
                imageUrl: imageUrl || undefined,
                videoUrl: videoUrl || undefined,  // ✅ הוספת וידאו
                toUserId: toUserId,
                tempId: tempId // העברת ה-tempId ללקוח
            };

            logger.info(`📩 Private message received:
            📤 From: ${socket.userId} (${socket.username})
            📬 To: ${toUserId}
            templetid;${tempId}
            📝 Text: "${text || 'No text'}"
            🖼️ Image: ${imageUrl ? 'Yes' : 'No'}"
            🎥 Video: ${videoUrl ? 'Yes' : 'No'}"`);

            const targetSocket = _getUserSocket(toUserId);

            if (targetSocket) {
                logger.info(`🚀 Sending private message to: ${toUserId} socketId: ${targetSocket.id}`);
                logger.info(`🚀 Sending private message to: ${privateMessage} socketId: ${privateMessage}`);
                targetSocket.emit('chat-add-private-msg', privateMessage);
                logger.info(`✅ Private message successfully sent to ${toUserId} - ${JSON.stringify(privateMessage)}`);
            } else {
                logger.warn(`⚠️ No active socket found for recipient ${toUserId}. Message could not be delivered.`);
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
        userSocketsMap.set(userId, []);
    }
    userSocketsMap.get(userId).push(socket.id);

    logger.info(`✅ Added socket ${socket.id} to user ${userId}`);
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


function emitTo({ type, data, label }) {
    if (label) gIo.to('watching:' + label.toString()).emit(type, data)
    else gIo.emit(type, data)
}

async function emitToUser({ type, data, userId }) {
    const socketsIds = userSocketsMap.get(userId) || [];
    socketsIds.forEach(socketId => {
        const socket = gIo.sockets.sockets.get(socketId);
        if (socket && socket.connected) {
            socket.emit(type, data);
            logger.info(`✅ Emitted ${type} to socket ${socket.id}`);
        }
    });
}

async function emitTestNotification({ userId, data, attempt = 1 }) {
    if (!userId) {
        logger.error(`❌ emitTestNotification called without userId!`);
        return;
    }

    const socketsIds = userSocketsMap.get(userId) || [];

    logger.info(`🔍 emitTestNotification: Attempt ${attempt} for userId=${userId}`);
    logger.info(`🗺️ Current sockets for userId=${userId}: [${socketsIds.join(', ')}]`);

    if (!socketsIds.length) {
        if (attempt <= 5) {
            logger.warn(`⚠️ No sockets for userId=${userId}. Retrying attempt ${attempt}`);
            setTimeout(() => emitTestNotification({ userId, data, attempt: attempt + 1 }), attempt * 500);
        } else {
            logger.error(`❌ Max retries reached for userId=${userId}. Giving up.`);
        }
        return;
    }

    socketsIds.forEach(socketId => {
        const socket = gIo.sockets.sockets.get(socketId);
        if (socket && socket.connected) {
            socket.emit('test-notification', data);
            logger.info(`✅ Sent test-notification to socketId=${socket.id}`);
        } else {
            logger.warn(`⚠️ Skipped socketId=${socketId} (not found or disconnected)`);
        }
    });
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

    const socketsIds = userSocketsMap.get(userId) || [];
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
    const socketsIds = userSocketsMap.get(userId) || [];
    const aliveSockets = [];

    socketsIds.forEach(socketId => {
        const socket = gIo.sockets.sockets.get(socketId);
        if (socket && socket.connected) {
            aliveSockets.push(socketId);
        } else {
            logger.info(`🧹 Removing dead socket [id: ${socketId}] for userId=${userId}`);
        }
    });

    if (aliveSockets.length) {
        userSocketsMap.set(userId, aliveSockets);
        logger.info(`🛠️ Updated alive sockets for userId=${userId}: [${aliveSockets.join(', ')}]`);
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
    const socketsIds = userSocketsMap.get(userId) || [];
    const sockets = socketsIds
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
    emitTestNotification,
}
