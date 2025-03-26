// services/geofence.service.js
import { dbService } from './db.service.js';
import { logger } from './logger.service.js';

const CHECK_INTERVAL = 30 * 1000; // כל 30 שניות
const GEO_RADIUS = 0.2; // חצי מטר

// פונקציה לחישוב מרחק
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // רדיוס כדור הארץ במטרים
  const φ1 = lat1 * Math.PI/180;
  const φ2 = lat2 * Math.PI/180;
  const Δφ = (lat2-lat1) * Math.PI/180;
  const Δλ = (lon2-lon1) * Math.PI/180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  
  return R * c; // מרחק במטרים
}

// שמירת מיקום משתמש
export async function saveUserLocation(userId, lat, lng) {
  try {
    await dbService.getCollection('user_locations').insertOne({
      userId,
      location: {
        type: 'Point',
        coordinates: [lng, lat]
      },
      timestamp: new Date()
    });
    logger.info(`מיקום נשמר למשתמש ${userId}`);
  } catch (err) {
    logger.error(`שגיאה בשמירת מיקום: ${err.message}`);
  }
}

// בדיקת הפרת גיאופנס
export async function checkGeofenceViolations() {
  try {
    const users = await dbService.getCollection('user').find().toArray();
    
    for (const user of users) {
      if (!user.homeLocation) continue;
      
      const lastLocation = await dbService.getCollection('user_locations')
        .findOne({ userId: user._id }, { sort: { timestamp: -1 } });
      
      if (!lastLocation) continue;
      
      const distance = calculateDistance(
        user.homeLocation.lat,
        user.homeLocation.lng,
        lastLocation.location.coordinates[1],
        lastLocation.location.coordinates[0]
      );
      
      if (distance > GEO_RADIUS) {
        logger.info(`התראה: משתמש ${user._id} יצא מהאזור המותר`);
        // כאן נפעיל את ההתראה בפועל
      }
    }
  } catch (err) {
    logger.error(`שגיאה בבדיקת גיאופנס: ${err.message}`);
  }
}