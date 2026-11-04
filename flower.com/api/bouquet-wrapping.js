const { FieldValue } = require("firebase-admin/firestore");
const { getAdminAuth, getAdminFirestore, sendError, verifyRequest } = require("../lib/firebase-admin");
const { normalizeTiers } = require("../js/catalog/bouquet-wrapping.js");

const WRAPPING_DOCUMENT = "bouquetWrapping";

function readTiers(data) {
    return normalizeTiers(data?.tiers) || [];
}

module.exports = async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    let db;
    try {
        db = getAdminFirestore();
    } catch (error) {
        console.error("Bouquet wrapping API configuration error:", error.code || error.message);
        return sendError(res, 503, "admin-api-not-configured", "API cấu hình phí bó hoa chưa được thiết lập.");
    }

    if (req.method === "GET") {
        const manage = req.query?.manage === "1";
        if (manage) {
            let adminAuth;
            try {
                adminAuth = getAdminAuth();
            } catch (error) {
                console.error("Bouquet wrapping authentication configuration error:", error.code || error.message);
                return sendError(res, 503, "admin-api-not-configured", "API quản trị phí bó hoa chưa được thiết lập.");
            }
            const claims = await verifyRequest(req, res, adminAuth);
            if (!claims) return;
            if (claims.admin !== true) return sendError(res, 403, "permission-denied", "Bạn cần quyền quản trị để xem cấu hình phí bó hoa.");
        }
        try {
            const snapshot = await db.collection("metadata").doc(WRAPPING_DOCUMENT).get();
            const tiers = readTiers(snapshot.data());
            return res.status(200).json({ configured: tiers.length > 0, tiers });
        } catch (error) {
            console.error("Bouquet wrapping read failed:", error.code || error.message);
            return sendError(res, 503, "bouquet-wrapping-unavailable", "Chưa thể tải cấu hình phí bó hoa.");
        }
    }

    if (req.method !== "POST") {
        res.setHeader("Allow", "GET, POST");
        return sendError(res, 405, "method-not-allowed", "API phí bó hoa chỉ chấp nhận GET hoặc POST.");
    }

    let adminAuth;
    try {
        adminAuth = getAdminAuth();
    } catch (error) {
        console.error("Bouquet wrapping authentication configuration error:", error.code || error.message);
        return sendError(res, 503, "admin-api-not-configured", "API quản trị phí bó hoa chưa được thiết lập.");
    }
    const claims = await verifyRequest(req, res, adminAuth);
    if (!claims) return;
    if (claims.admin !== true) return sendError(res, 403, "permission-denied", "Bạn cần quyền quản trị để thay đổi phí bó hoa.");
    const tiers = normalizeTiers(req.body?.tiers);
    if (!tiers) {
        return sendError(res, 400, "invalid-bouquet-wrapping", "Bậc phí phải tăng dần theo số cành, mức cuối phải áp dụng đến 50 cành; phí là số nguyên VND không âm.");
    }

    try {
        await db.collection("metadata").doc(WRAPPING_DOCUMENT).set({
            tiers,
            updatedAt: FieldValue.serverTimestamp()
        });
        return res.status(200).json({ configured: true, tiers });
    } catch (error) {
        console.error("Bouquet wrapping update failed:", error.code || error.message);
        return sendError(res, 503, "bouquet-wrapping-unavailable", "Chưa thể lưu cấu hình phí bó hoa. Vui lòng thử lại.");
    }
};

module.exports.internals = { readTiers, WRAPPING_DOCUMENT };
