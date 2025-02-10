self.addEventListener("push", function (event) {
    console.log("🔔 Push event received!", event);

    if (event.data) {
        let notificationData;

        try {
            const rawData = event.data.json();
            notificationData = rawData.payload || rawData; // 🔹 בדיקה האם הנתונים עטופים ב-payload
            console.log("📩 Parsed Push Notification Data:", notificationData);
        } catch (error) {
            console.error("❌ Error parsing push notification data:", error);
            return;
        }

        const title = notificationData.title || "New Notification";
        const options = {
            body: notificationData.body || "You have a new message",
            icon: notificationData.icon || "https://res.cloudinary.com/dzqnyehxn/image/upload/v1739170705/notification-badge_p0oafv.png",
            badge: notificationData.badge || "https://res.cloudinary.com/dzqnyehxn/image/upload/v1739170705/notification-badge_p0oafv.png",
            vibrate: notificationData.vibrate || [200, 100, 200],
            tag: notificationData.tag || "push-msg",
            requireInteraction: notificationData.requireInteraction || false,
            data: notificationData.data || {}
        };

        event.waitUntil(self.registration.showNotification(title, options));
    } else {
        console.warn("⚠️ Push event received but no data!");
    }
});

self.addEventListener("notificationclick", function (event) {
    console.log("📩 Notification Clicked:", event.notification);
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: "window", includeUncontrolled: true }).then(windowClients => {
            if (windowClients.length > 0) {
                windowClients[0].focus();
            } else {
                clients.openWindow("/");
            }
        })
    );
});
