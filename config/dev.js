import dotenv from 'dotenv';
dotenv.config();
export default {
  // dbURL: 'mongodb://127.0.0.1:27017',
  // dbName : 'tester_db'
  dbURL: process.env.MONGO_URL || 'mongodb+srv://yinon:Wishime1%21%3F@cluster0.htzpw.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0',
  dbName: process.env.DB_NAME || 'my_accounts',
  notifications: {
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY,
    vapidPrivateKey: process.env.VAPID_PRIVATE_KEY,
    vapidContact: process.env.VAPID_CONTACT || 'mailto:luzifere@gmail.com'
  }
};