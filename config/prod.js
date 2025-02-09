import dotenv from 'dotenv';
dotenv.config();

export default {
  dbURL: process.env.MONGO_URL,
  dbName: process.env.DB_NAME,
  baseURL: process.env.BASE_URL || 'https://backend-my-accounts.onrender.com/api', // ✅ הוספת baseURL
  notifications: {
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY,
    vapidPrivateKey: process.env.VAPID_PRIVATE_KEY,
    vapidContact: process.env.VAPID_CONTACT
  }
};
