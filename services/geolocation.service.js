const admin = require("firebase-admin");

// הגדרת אזור בטוח
const SAFE_ZONE = {
    lat: 32.0853, // קו רוחב (Latitude)
    lng: 34.7818, // קו אורך (Longitude)
    radius: 0.5 // טווח המיקום המותר (בקילומטרים)
};

// פונקציה לחישוב המרחק בין שתי נקודות
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // רדיוס כדור הארץ בק"מ
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        0.5 - Math.cos(dLat) / 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        (1 - Math.cos(dLon)) / 2;

    return R * 2 * Math.asin(Math.sqrt(a));
}

// בדיקה אם המשתמש יצא מהאזור המוגדר
async function checkUserLocation(userId, userLat, userLng, userToken) {
    const distance = getDistance(userLat, userLng, SAFE_ZONE.lat, SAFE_ZONE.lng);
    console.log(`🔍 User ${userId} נמצא ${distance.toFixed(3)} ק"מ מהאזור המוגדר.`);

    if (distance > SAFE_ZONE.radius) {
        console.log(`🚨 User ${userId} יצא מהאזור! שולח התראה...`);
        
        const message = {
            notification: {
                title: "התראה גיאוגרפית!",
                body: "יצאת מהאזור המוגדר!"
            },
            data: {
                eventType: "geo-alert",
                click_action: "FLUTTER_NOTIFICATION_CLICK"
            },
            android: {
                priority: "high"
            },
            token: userToken
        };

        try {
            const response = await admin.messaging().send(message);
            console.log("✅ התראה נשלחה בהצלחה:", response);
        } catch (error) {
            console.error("❌ שגיאה בשליחת התראה:", error);
        }
    }
}

// פונקציה שמקבלת את מיקום המשתמש, מבצעת בדיקה ושולחת התראה אם צריך
exports.updateUserLocation = async (userId, lat, lng, token) => {
    await checkUserLocation(userId, parseFloat(lat), parseFloat(lng), token);
};
