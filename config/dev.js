import dotenv from 'dotenv';
dotenv.config();

const config = {
  dbURL: process.env.MONGO_URL || 'mongodb+srv://yinon:Wishime1%21%3F@cluster0.htzpw.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0&connectTimeoutMS=60000&socketTimeoutMS=60000&serverSelectionTimeoutMS=60000&maxPoolSize=100&minPoolSize=20&maxIdleTimeMS=60000&waitQueueTimeoutMS=60000&heartbeatFrequencyMS=5000&retryReads=true&retryWrites=true&w=majority&readPreference=primaryPreferred',
  dbName: process.env.DB_NAME || 'my_accounts',
  baseURL: process.env.BASE_URL || 'http://localhost:3030/api',
  notifications: {
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY,
    vapidPrivateKey: process.env.VAPID_PRIVATE_KEY,
    vapidContact: process.env.VAPID_CONTACT || 'mailto:luzifere@gmail.com'
  }
};

export default config;
