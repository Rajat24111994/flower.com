const { getAdminAuth, getAdminFirestore, sendError, verifyAdminRequest } = require("../../lib/firebase-admin");

module.exports = async function handler(req, res) {
    res.setHeader("Cache-Control", "private, no-store");
    if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        return sendError(res, 405, "method-not-allowed", "API nhật ký quản trị chỉ chấp nhận GET.");
    }

    let auth;
    let db;
    try {
        auth = getAdminAuth();
        db = getAdminFirestore();
    } catch (error) {
        console.error("Admin audit API configuration error:", error.code || error.message);
        return sendError(res, 503, "admin-api-not-configured", "API nhật ký quản trị chưa được cấu hình.");
    }

    const actor = await verifyAdminRequest(req, res, auth, db);
    if (!actor) return;

    try {
        const snapshot = await db.collection("adminAudit").orderBy("createdAt", "desc").limit(100).get();
        const entries = snapshot.docs.map((document) => {
            const data = document.data();
            return {
                id: document.id,
                actorUid: String(data.actorUid || ""),
                actorEmail: String(data.actorEmail || ""),
                action: String(data.action || ""),
                resourceType: String(data.resourceType || ""),
                resourceId: String(data.resourceId || ""),
                details: data.details && typeof data.details === "object" ? data.details : {},
                createdAt: data.createdAt?.toDate?.().toISOString() || ""
            };
        });
        return res.status(200).json({ entries });
    } catch (error) {
        console.error("Admin audit read failed:", error.code || error.message);
        return sendError(res, 503, "admin-audit-unavailable", "Chưa thể tải nhật ký thao tác quản trị.");
    }
};
