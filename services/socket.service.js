import { logger } from './logger.service.js'
import { Server } from 'socket.io'

var gIo = null
const userSocketsMap = new Map(); // 🗺️ New Map to track userId -> socketId


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
        // 🟢 ניטור חיבורי Keep-Alive
        // socket.on('ping', () => {
        //     logger.info(`📡 Received ping from client [id: ${socket.id}]`);
        //     socket.emit('pong'); // מחזיר Pong כדי לשמור על החיבור
        // });
        socket.on('ping', () => {
            logger.info(`📡 Received ping from client [id: ${socket.id}]`);

            // if (!socket.userId) {
            //     logger.warn(`⚠️ User is not authenticated, attempting to restore session...`);
            //     socket.emit('set-user-socket', {
            //         userId: socket.userId,
            //         username: socket.username
            //     });
            // }

            socket.emit('pong'); // מחזיר pong כדי לשמור על החיבור
        });

        socket.on('user-ready', () => {
            logger.info(`✅ [SERVER] User is ready! userId=${socket.userId}, socketId=${socket.id}`);
        
            if (!socket.userId) {
                logger.warn(`⚠️ [SERVER] Cannot emit TEST_NOTIFICATION - userId is missing`);
                return;
            }
            userSocketsMap.set(socket.userId.toString(), socket.id); // 🆕 גם כאן לשמור את המיפוי

            // emitTestNotification({
            //     userId: socket.userId,
            //     data: {
            //         title: "📢 Welcome!",
            //         body: "You are successfully connected and ready for notifications! 🚀"
            //     }
            // });
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
                userSocketsMap.delete(socket.userId.toString()); // 🆕 הסר מהמפה
            }
            // if (socket.userId) {
            //     // שלח פינג ללקוח במקרה של ניתוק, כדי לוודא שהחיבור פעיל
            //     const targetSocket = _getUserSocket(socket.userId);
        
            //     if (targetSocket) {
            //         targetSocket.emit('ping'); // שליחת פינג
            //         logger.info(`✅ שלח פינג ללקוח ${socket.userId} אחרי ניתוק`);
            //     } else {
            //         logger.warn(`⚠️ לא מצאנו חיבור פעיל למחשב הלקוח ${socket.userId}`);
            //     }
            //     // נסה לחבר מחדש עד 5 פעמים
            //     const maxRetryAttempts = 5; // מספר ניסיונות חיבור מחדש
            //     let retryCount = 0; // סופר הניסיונות
            //     const reconnectInterval = setInterval(() => {
            //         if (retryCount < maxRetryAttempts) {
            //             retryCount++;
            //             logger.info(`🔄 מנסה לחבר מחדש את המשתמש ${socket.userId} בפעם ${retryCount}...`);
        
            //             const targetSocket = _getUserSocket(socket.userId);
            //             if (!targetSocket) { // רק אם אין כבר חיבור פעיל
            //                 gIo.to(socket.id).emit('set-user-socket', {
            //                     userId: socket.userId,
            //                     username: socket.username
            //                 });
            //                 logger.info(`✅ שלח בקשה לחיבור מחדש עבור ${socket.userId}`);
            //             } else {
            //                 logger.info(`🔵 למשתמש ${socket.userId} כבר יש חיבור פעיל, לא מחבר מחדש.`);
            //             }
            //         } else {
            //             clearInterval(reconnectInterval); // סיום הניסיונות אחרי 5 פעמים
            //             logger.warn(`⚠️ לא הצלחנו לחבר מחדש את ${socket.userId} אחרי ${maxRetryAttempts} ניסיונות.`);
            //         }
            //     }, 250 * retryCount); // חיכוי בין ניסיונות, הזמן גדל עם כל ניסיון (למשל: 1 שניה, 2 שניות, 3 שניות וכו')
            // }
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

            // if (socket.userId) {
            //     logger.info(`✅ User ${socket.userId} is re-authenticating`);
            //     socket.emit('set-user-socket', { userId: socket.userId, username: socket.username });
            // } else {
            //     logger.warn(`⚠️ No userId found, attempting to restore session...`);

            //     // מנסה לשחזר את החיבור דרך Event יזום ללקוח
            //     socket.emit('request-user-data');
            // }
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
        //Auth
        // socket.on('set-user-socket', (userData) => {
        //     const { userId, username } = userData;
        //     if (!userId) {
        //         logger.warn(`⚠️ Invalid userId received for socket authentication.`);
        //         return;
        //     }
        //     logger.info(`✅ Setting socket.userId = ${userId} and socket.username = ${username} for socket [id: ${socket.id}]`);
        //     socket.userId = userId;
        //     socket.username = username;
        //     userSocketsMap.set(userId.toString(), socket.id); // 🆕 שמור במפה

        // });

        socket.on('set-user-socket', async (userData) => {
            const { userId, username } = userData;
            if (!userId) {
                logger.warn(`⚠️ Invalid userId received for socket authentication.`);
                return;
            }
        
            // קודם כל נבדוק אם כבר יש סוקט למשתמש הזה
            const existingSocket = _getUserSocket(userId);
        
            if (existingSocket && existingSocket.id !== socket.id) {
                logger.warn(`⚠️ Another socket exists for user ${userId}. Disconnecting old socket...`);
        
                try {
                    existingSocket.disconnect();
                    setTimeout(() => {
                        if (existingSocket.connected) {
                            logger.warn(`⚠️ Old socket for user ${userId} still connected after disconnect, force closing...`);
                            existingSocket.disconnect(true);
                        }
                    }, 500);                    
                    
                    // סוגר את החיבור הישן
                } catch (err) {
                    logger.error(`❌ Error disconnecting existing socket for user ${userId}:`, err);
                }
            }
        
            // עכשיו מקשרים את הסוקט החדש
            socket.userId = userId;
            socket.username = username;
        
            logger.info(`✅ Setting socket.userId = ${userId} and socket.username = ${username} for socket [id: ${socket.id}]`);
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

        // socket.on('connect', () => {
        //     if (socket.userId) {
        //         logger.info(`🔄 Re-authenticating socket with userId: ${socket.userId}`);
        //     } else {
        //         logger.warn(`⚠️ New socket connection without authentication. User must log in.`);
        //     }
        // });


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

// async function emitTestNotification({ userId, data }) {
//     userId = userId.toString();
//     const socket = await _getUserSocket(userId);

//     if (socket) {
//         logger.info(`📣 Emitting TEST_NOTIFICATION to user: ${userId}, socketId: ${socket.id}`);
//         socket.emit('test-notification', data);
//     } else {
//         logger.warn(`⚠️ No socket found for user: ${userId}`);
//     }
// }

// async function emitTestNotification({ userId, data, attempt = 1 }) {
//     if (!userId) {
//         logger.error(`❌ emitTestNotification called without userId!`);
//         return;
//     }
//     userId = userId.toString();
//     const socket = await _getUserSocket(userId);

//     if (socket && socket.userId) {
//         logger.info(`📣 Emitting TEST_NOTIFICATION to user: ${userId}, socketId: ${socket.id}`);
//         socket.emit('test-notification', data);
//     } else {
//         if (attempt <= 5) {
//             logger.warn(`⚠️ No socket found for user: ${userId}. Retrying attempt ${attempt}...`);
//             setTimeout(() => {
//                 emitTestNotification({ userId, data, attempt: attempt + 1 });
//             }, attempt * 500); // מחכה קצת יותר בכל ניסיון
//         } else {
//             logger.error(`❌ Failed to find socket for user: ${userId} after ${attempt - 1} attempts.`);
//         }
//     }
// }


async function emitTestNotification({ userId, data, attempt = 1 }) {
    if (!userId) {
        logger.error(`❌ emitTestNotification called without userId!`);
        return;
    }

    userId = userId.toString();
    const socketId = userSocketsMap.get(userId);


    logger.info(`🔍 emitTestNotification: Trying to emit to userId=${userId}`);
    logger.info(`🗺️ Current keys in userSocketsMap: ${[...userSocketsMap.keys()]}`);


    if (!socketId) {
        logger.warn(`⚠️ No socketId found for user: ${userId}. Attempt ${attempt}`);
        if (attempt <= 5) {
            setTimeout(() => {
                emitTestNotification({ userId, data, attempt: attempt + 1 });
            }, attempt * 500);
        }
        return;
    }

    const socket = gIo.sockets.sockets.get(socketId);

    if (socket && socket.connected) {
        logger.info(`📣 Emitting TEST_NOTIFICATION to user: ${userId}, socketId: ${socket.id}`);
        socket.emit('test-notification', data);
    } else {
        logger.warn(`⚠️ Socket not connected for user: ${userId}. Attempt ${attempt}`);
        if (attempt <= 5) {
            setTimeout(() => {
                emitTestNotification({ userId, data, attempt: attempt + 1 });
            }, attempt * 500);
        }
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
// function _getUserSocket(userId) {
//     return [...gIo.sockets.sockets.values()].find(socket => socket.userId === userId);
// }

function _getUserSocket(userId) {
    return [...gIo.sockets.sockets.values()]
        .find(socket => socket.userId && socket.userId.toString() === userId.toString());
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
