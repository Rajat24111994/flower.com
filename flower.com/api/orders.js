const { getAdminFirestore, sendError } = require("../lib/firebase-admin");
const { InventoryReservationError, reserveInventory } = require("../lib/order-inventory");

module.exports = async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return sendError(res, 405, "method-not-allowed", "Use POST for this endpoint.");
    }

    let db;
    try {
        db = getAdminFirestore();
    } catch (error) {
        console.error("Firebase Admin API configuration error:", error.message);
        return sendError(res, 503, "admin-api-not-configured", "The inventory API is not configured.");
    }

    try {
        const result = await reserveInventory(db, req.body && req.body.orderId, req.body && req.body.items);
        return res.status(200).json(result);
    } catch (error) {
        if (error instanceof InventoryReservationError) {
            const status = error.code === "invalid-argument" ? 400 : 409;
            return sendError(res, status, error.code, error.message);
        }
        console.error("Order inventory reservation failed:", error.code || error.message);
        return sendError(res, 500, "inventory-reservation-failed", "Could not confirm the order. Please try again.");
    }
};
