// services/geofence.job.js
import { checkGeofenceViolations } from './geofence.service.js';
import { logger } from './logger.service.js';

let intervalId;

export function startGeofenceMonitoring() {
  // הרצה ראשונית
  checkGeofenceViolations();
  
  // הגדרת אינטרוול
  intervalId = setInterval(() => {
    checkGeofenceViolations();
  }, CHECK_INTERVAL);
  
  logger.info('ניטור גיאופנס הופעל');
}

export function stopGeofenceMonitoring() {
  if (intervalId) {
    clearInterval(intervalId);
    logger.info('ניטור גיאופנס הופסק');
  }
}