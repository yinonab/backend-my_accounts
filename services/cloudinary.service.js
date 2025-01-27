import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import multer from 'multer';

// הגדרת Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

// יצירת אחסון באמצעות Cloudinary
const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'my-uploads', // שם התיקייה ב-Cloudinary
        allowed_formats: ['jpg', 'jpeg', 'png', 'gif'], // סוגי קבצים מותרים
    },
});

// יצירת instance של multer
export const upload = multer({ storage });
