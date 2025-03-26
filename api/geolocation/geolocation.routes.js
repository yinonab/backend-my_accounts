import express from "express";
import geolocationService from "../../services/geolocation.service";

const router = express.Router();

router.post("/update-location", async (req, res) => {
    const { userId, lat, lng, token } = req.body;

    if (!userId || !lat || !lng || !token) {
        return res.status(400).json({ error: "Missing required parameters" });
    }

    await geolocationService.updateUserLocation(userId, lat, lng, token);
    res.status(200).json({ message: "Location updated successfully" });
});

export default router;
