// Import Firebase scripts
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

// Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyD6YVTQRO_GtEp_LAZOIzRODS3jNHu-YgE",
    authDomain: "my-accounts-76d6e.firebaseapp.com",
    projectId: "my-accounts-76d6e",
    storageBucket: "my-accounts-76d6e.firebasestorage.app",
    messagingSenderId: "988437566016",
    appId: "1:988437566016:web:72f59ea673d54185fbc5a5",
    measurementId: "G-X1FLCYTWDM"
};

// 🟢 פונקציות לשמירת ושחזור Token ב-IndexedDB
// 🟢 פונקציות לשמירת ושחזור Token ב-IndexedDB
async function saveTokenToDB(token) {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open("AppDB", 1);
        request.onupgradeneeded = function (event) {
            const db = event.target.result;
            if (!db.objectStoreNames.contains("auth")) {
                db.createObjectStore("auth", { keyPath: "id" });
            }
        };
        request.onsuccess = function (event) {
            const db = event.target.result;
            const transaction = db.transaction("auth", "readwrite");
            const store = transaction.objectStore("auth");
            const putRequest = store.put({ id: "loginToken", token });

            putRequest.onsuccess = function () {
                console.log("✅ Token נשמר בהצלחה ב-IndexedDB");
                resolve();
            };
            putRequest.onerror = function () {
                console.error("❌ שגיאה בשמירת ה-Token ב-IndexedDB");
                reject();
            };
        };
    });
}

function getTokenFromDB() {
    return new Promise((resolve) => {
        const request = indexedDB.open("AppDB", 1);
        request.onsuccess = function (event) {
            const db = event.target.result;
            const transaction = db.transaction("auth", "readonly");
            const store = transaction.objectStore("auth");
            const getRequest = store.get("loginToken");

            getRequest.onsuccess = function () {
                resolve(getRequest.result ? getRequest.result.token : null);
            };
        };
    });
}



// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

self.addEventListener("activate", (event) => {
    event.waitUntil(
        getTokenFromDB().then((token) => {
            if (token) {
                console.log("🔄 משחזר `loginToken` מה-IndexedDB...");
                self.clients.matchAll().then((clients) => {
                    clients.forEach((client) =>
                        client.postMessage({ type: "RESTORE_LOGIN_TOKEN", token })
                    );
                });
            }
        })
    );
});

// Event listener for background notifications
// messaging.onBackgroundMessage((payload) => {
//     console.log('📩 [Firebase Messaging SW] Received background message:', payload);
//     const notificationTitle = payload.notification.title;
//     const notificationOptions = {
//         body: payload.notification.body,
//         icon: payload.notification.icon || "https://res.cloudinary.com/dzqnyehxn/image/upload/v1739170705/notification-badge_p0oafv.png",
//     };

//     self.registration.showNotification(notificationTitle, notificationOptions);
// });


messaging.onBackgroundMessage(async (payload) => {
    console.log('📩 [Firebase Messaging SW] Received background message:', payload);

    const notificationTitle = payload.notification?.title || payload.data?.title || "New Notification";
    const notificationOptions = {
        body: payload.notification?.body || payload.data?.body || "You have a new message",
        icon: payload.notification?.icon || payload.data?.icon || "https://res.cloudinary.com/dzqnyehxn/image/upload/v1739170705/notification-badge_p0oafv.png",
        data: payload.data
    };
    self.registration.showNotification(notificationTitle, notificationOptions);

    if (payload.data?.loginToken) {
        console.log("🔄 נוטיפיקציה עם Token חדש, שומר ב-IndexedDB...");
        await saveTokenToDB(payload.data.loginToken);
        self.clients.matchAll().then((clients) => {
            clients.forEach((client) =>
                client.postMessage({ type: "RESTORE_LOGIN_TOKEN", token: payload.data.loginToken })
            );
        });
    }

    if (payload.data?.wakeUpApp) {
        console.log("📲 מעיר את האפליקציה...");
        self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
            clients.forEach(client => client.postMessage({ type: "WAKE_UP" }));
        });
    }
});

self.addEventListener("message", (event) => {
    if (event.data && event.data.type === "SAVE_LOGIN_TOKEN") {
        console.log("💾 שומר Token ב-IndexedDB...");
        saveTokenToDB(event.data.token);
    }
    if (event.data?.type === "WAKE_UP") {
        console.log("📲 קיבלנו בקשת Wake-Up, מחזירים הודעה ל-Client");
        self.clients.matchAll().then((clients) => {
            clients.forEach((client) => client.postMessage({ type: "WAKE_UP" }));
        });
    }
});
