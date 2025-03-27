//const admin = require("firebase-admin");
import { notificationService } from "../services/notification.service.js";

//import admin from "firebase-admin";

// הגדרת אזור בטוח
const SAFE_ZONE = {
    lat: 40.7128,
    lng: -74.0060,
    radius: 0.001
};

// פונקציה לחישוב המרחק בין שתי נקודות
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
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

        try {
            const response = await notificationService.sendNotification(userId, {       
                title: "התראה גיאוגרפית!",
                body: "יצאת מהאזור המוגדר!",
                type: "geo-alert",
                token: userToken,  
                data: {
                    eventType: "geo-alert",
                    click_action: "FLUTTER_NOTIFICATION_CLICK"
                },
                androidChannel: "high_importance_channel",
                priority: "high"
            });

            console.log("✅ התראה נשלחה בהצלחה:", response);
        } catch (error) {
            console.error("❌ שגיאה בשליחת התראה:", error);
        }
    }
}

// פונקציה שמקבלת את מיקום המשתמש, מבצעת בדיקה ושולחת התראה אם צריך
export async function updateUserLocation(userId, lat, lng, token) {
    await checkUserLocation(userId, parseFloat(lat), parseFloat(lng), token);
}
// ייצוא הפונקציה כערך ברירת מחדל
export default {
    async updateUserLocation(userId, lat, lng, token) {
        console.log(`Updating location for user ${userId} at ${lat}, ${lng} with token ${token}`);
        return { success: true };
    }
};
