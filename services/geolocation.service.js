import { notificationService } from "../services/notification.service.js";

// הגדרת אזור בטוח
const SAFE_ZONE = {
    lat: 40.7128, // קו רוחב של ניו יורק
    lng: -74.0060, // קו אורך של ניו יורק
    radius: 0.001 // רדיוס של 1 מטר (אם ברצונך להשתמש במטרים)
};

// פונקציה לחישוב המרחק בין שתי נקודות
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // רדיוס כדור הארץ בקילומטרים
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        0.5 - Math.cos(dLat) / 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        (1 - Math.cos(dLon)) / 2;

    return R * 2 * Math.asin(Math.sqrt(a)); // המרחק בקילומטרים
}

// פונקציה אחת שמבצעת את בדיקת המיקום ושליחת ההתראה אם המשתמש יצא מהאזור
async function updateUserLocation(userId, lat, lng, token) {
    const distance = getDistance(lat, lng, SAFE_ZONE.lat, SAFE_ZONE.lng);
    console.log(`🔍 User ${userId} נמצא ${distance.toFixed(3)} ק"מ מהאזור המוגדר.`);

    if (distance > SAFE_ZONE.radius) {
        console.log(`🚨 User ${userId} יצא מהאזור! שולח התראה...`);

        try {
            // השארתי את הלוג המפורט שלך
            console.log('Sending notification with the following data: ', {
                title: "התראה גיאוגרפית!",
                body: "יצאת מהאזור המוגדר!",
                type: "geo-alert",
                token: token,
                data: {
                    eventType: "geo-alert",
                    click_action: "FLUTTER_NOTIFICATION_CLICK"
                },
                androidChannel: "high_importance_channel",
                priority: "high"
            });

            const response = await notificationService.sendNotification(userId, {
                title: "התראה גיאוגרפית!",
                body: "יצאת מהאזור המוגדר!",
                type: "geo-alert",
                token: token,
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
            // חשוב: לא זורקים שגיאה החוצה, רק מדפיסים וממשיכים
        }
    } else {
        console.log(`✅ User ${userId} נמצא בתוך האזור הבטוח, אין צורך לשלוח התראה.`);
    }

    return { success: true }; // תמיד מחזיר הצלחה
}
export default {
    updateUserLocation,
};

