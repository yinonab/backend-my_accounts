import express from "express";
import geolocationService from "../../services/geolocation.service.js";

const router = express.Router();

router.post("/update-location", async (req, res) => {
    const { userId, lat, lng, token } = req.body;

    console.log("🔍 Received request to update location with the following data:");
    console.log(`userId: ${userId}, lat: ${lat}, lng: ${lng}, token: ${token}`);


    if (!userId || !lat || !lng || !token) {
        console.error("❌ Missing required parameters");
        return res.status(400).json({ error: "Missing required parameters" });
    }

    try {
        console.log("✅ Parameters are valid, updating user location...");
        await geolocationService.updateUserLocation(userId, lat, lng, token);
        console.log("✅ Location updated successfully for user:", userId);

        res.status(200).json({ message: "Location updated successfully" });
    } catch (error) {
        console.error("❌ Error while updating location:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

export default router;
