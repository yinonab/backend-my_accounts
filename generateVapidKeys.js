// generateVapidKeys.js
import webpush from 'web-push';

const vapidKeys = webpush.generateVAPIDKeys();
console.log('VAPID Keys:', vapidKeys);