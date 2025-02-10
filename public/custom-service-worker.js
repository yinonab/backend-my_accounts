self.addEventListener("push", function (event) {
    console.log("🔔 Push event received!", event);

    if (event.data) {
        const notificationData = event.data.json();
        console.log("📩 Push Notification Data:", notificationData);

        event.waitUntil(
            self.registration.showNotification(notificationData.title, {
                body: notificationData.body,
                icon: notificationData.icon || "https://res.cloudinary.com/dzqnyehxn/image/upload/v1739170705/notification-badge_p0oafv.png",
                badge: notificationData.badge || "https://res.cloudinary.com/dzqnyehxn/image/upload/v1739170705/notification-badge_p0oafv.png",
                vibrate: notificationData.vibrate || [200, 100, 200],
                tag: notificationData.tag || "push-msg",
                requireInteraction: notificationData.requireInteraction || false,
                data: notificationData.data || {}
            })
        );
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
