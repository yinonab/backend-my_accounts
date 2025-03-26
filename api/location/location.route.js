// routes/location.route.js
import express from 'express';
import { saveUserLocation } from '../services/geofence.service.js';

const router = express.Router();

// עדכון מיקום משתמש
router.post('/update', async (req, res) => {
  try {
    const { userId, lat, lng } = req.body;
    await saveUserLocation(userId, lat, lng);
    res.status(200).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// הגדרת מיקום בית
router.post('/set-home', async (req, res) => {
  try {
    const { userId, lat, lng } = req.body;
    await dbService.getCollection('users').updateOne(
      { _id: userId },
      { $set: { homeLocation: { lat, lng } } },
      { upsert: true }
    );
    res.status(200).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


export default router;