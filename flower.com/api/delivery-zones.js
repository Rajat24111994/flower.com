const { FieldValue } = require("firebase-admin/firestore");
const { getAdminAuth, getAdminFirestore, sendError, verifyRequest } = require("../lib/firebase-admin");

const ZONES_DOCUMENT = "deliveryZones";

function validZone(zone) {
    if (!zone || typeof zone !== "object" || Array.isArray(zone)) return null;
    const id = String(zone.id || "").trim();
    const province = String(zone.province || "").trim();
    const district = String(zone.district || "").trim();
    const fee = zone.fee;
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)
        || !province || province.length > 120
        || !district || district.length > 120
        || !Number.isSafeInteger(fee) || fee < 0 || fee > 1000000000
        || typeof zone.enabled !== "boolean") return null;
    return { id, province, district, fee, enabled: zone.enabled };
}

function hasDuplicateAreas(zones) {
    const seen = new Set();
    for (const zone of zones) {
        const key = `${zone.province.toLocaleLowerCase("vi")}\u0000${zone.district.toLocaleLowerCase("vi")}`;
        if (seen.has(key)) return true;
        seen.add(key);
    }
    return false;
}

module.exports = async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    const db = (() => {
        try {
            return getAdminFirestore();
        } catch (error) {
            console.error("Delivery-zone API configuration error:", error.code || error.message);
            return null;
        }
    })();
    if (!db) return sendError(res, 503, "admin-api-not-configured", "API quản trị dữ liệu giao hàng chưa được cấu hình.");

    if (req.method === "GET") {
        const manage = req.query?.manage === "1";
        if (manage) {
            let adminAuth;
            try {
                adminAuth = getAdminAuth();
            } catch (error) {
                console.error("Delivery-zone authentication configuration error:", error.code || error.message);
                return sendError(res, 503, "admin-api-not-configured", "API quản trị dữ liệu giao hàng chưa được cấu hình.");
            }
            const claims = await verifyRequest(req, res, adminAuth);
            if (!claims) return;
            if (claims.admin !== true) return sendError(res, 403, "permission-denied", "Bạn cần quyền quản trị để quản lý khu vực giao hàng.");
        }

        try {
            const snapshot = await db.collection("metadata").doc(ZONES_DOCUMENT).get();
            const zones = (Array.isArray(snapshot.data()?.zones) ? snapshot.data().zones : [])
                .map(validZone)
                .filter(Boolean);
            const visibleZones = manage ? zones : zones.filter((zone) => zone.enabled);
            return res.status(200).json({
                configured: zones.some((zone) => zone.enabled),
                zones: visibleZones
            });
        } catch (error) {
            console.error("Delivery-zone read failed:", error.code || error.message);
            return sendError(res, 503, "delivery-zone-service-unavailable", "Chưa thể tải khu vực giao hàng.");
        }
    }

    if (req.method !== "POST") {
        res.setHeader("Allow", "GET, POST");
        return sendError(res, 405, "method-not-allowed", "API khu vực giao hàng chỉ chấp nhận GET hoặc POST.");
    }

    let adminAuth;
    try {
        adminAuth = getAdminAuth();
    } catch (error) {
        console.error("Delivery-zone authentication configuration error:", error.code || error.message);
        return sendError(res, 503, "admin-api-not-configured", "API quản trị dữ liệu giao hàng chưa được cấu hình.");
    }
    const claims = await verifyRequest(req, res, adminAuth);
    if (!claims) return;
    if (claims.admin !== true) return sendError(res, 403, "permission-denied", "Bạn cần quyền quản trị để thay đổi khu vực giao hàng.");

    const action = req.body?.action;
    if (action !== "upsert" && action !== "delete") {
        return sendError(res, 400, "invalid-delivery-zone", "Thao tác khu vực giao hàng không hợp lệ.");
    }
    const zone = action === "upsert" ? validZone(req.body?.zone) : null;
    const zoneId = action === "delete" ? String(req.body?.id || "").trim() : zone?.id;
    if (!zoneId || !/^[A-Za-z0-9_-]{1,80}$/.test(zoneId) || (action === "upsert" && !zone)) {
        return sendError(res, 400, "invalid-delivery-zone", "Vui lòng nhập tên tỉnh/thành, quận/huyện và phí giao hợp lệ.");
    }

    try {
        const reference = db.collection("metadata").doc(ZONES_DOCUMENT);
        const zones = await db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(reference);
            const current = (Array.isArray(snapshot.data()?.zones) ? snapshot.data().zones : [])
                .map(validZone)
                .filter(Boolean);
            const next = action === "upsert"
                ? [...current.filter((item) => item.id !== zone.id), zone]
                : current.filter((item) => item.id !== zoneId);
            if (hasDuplicateAreas(next)) {
                const error = new Error("Khu vực tỉnh/thành và quận/huyện này đã được khai báo.");
                error.code = "duplicate-delivery-zone";
                throw error;
            }
            transaction.set(reference, { zones: next, updatedAt: FieldValue.serverTimestamp() });
            return next;
        });
        return res.status(200).json({
            configured: zones.some((item) => item.enabled),
            zones
        });
    } catch (error) {
        if (error.code === "duplicate-delivery-zone") {
            return sendError(res, 409, error.code, error.message);
        }
        console.error("Delivery-zone update failed:", error.code || error.message);
        return sendError(res, 503, "delivery-zone-service-unavailable", "Chưa thể lưu khu vực giao hàng. Vui lòng thử lại.");
    }
};

module.exports.internals = { validZone, hasDuplicateAreas };
