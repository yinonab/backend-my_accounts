const express = require("express");
const router = express.Router();
const geolocationService = require("../../services/geolocation.service");

router.post("/update-location", async (req, res) => {
    const { userId, lat, lng, token } = req.body;

    if (!userId || !lat || !lng || !token) {
        return res.status(400).json({ error: "Missing required parameters" });
    }

    await geolocationService.updateUserLocation(userId, lat, lng, token);
    res.status(200).json({ message: "Location updated successfully" });
});
export const geolocationRoutes = router;
//module.exports = router;
