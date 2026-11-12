// Controller của module yêu cầu thiết kế: nhận request /api/design-requests.
//   POST action=create         khách gửi yêu cầu (tính giá ước tính từ giá cành hiện tại)
//   GET  id&token              khách xem yêu cầu bằng mã truy cập
//   POST action=respond        khách chấp nhận/từ chối báo giá
//   GET  manage=1, POST action=admin-update   admin xem danh sách và gửi báo giá
const { createHash, randomBytes } = require("node:crypto");
const { FieldValue } = require("firebase-admin/firestore");
const { getAdminAuth, getAdminFirestore, sendError, verifyAdminRequest } = require("../shared/firebase-admin");
const bouquetWrapping = require("../../js/catalog/bouquet-wrapping.js");
// Dùng chung quy tắc lịch giao, số điện thoại, khu vực và giá cành với module đơn hàng.
const orderRules = { ...require("../orders/validation"), ...require("../orders/pricing") };
const {
    STATUSES, COLORS, TEXT_LIMITS, DESIGN_CHOICES, cleanText, canonicalColor, validImage, parseDesign, normalizeStems, safeDate, publicRequest, validAccessToken, addHistory
} = require("./validation");

async function optionalUser(req, res) {
    const match = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
    if (!match) return null;
    let auth;
    try {
        auth = getAdminAuth();
    } catch (error) {
        console.error("Design request authentication configuration error:", error.code || error.message);
        sendError(res, 503, "admin-api-not-configured", "API xác thực chưa được thiết lập.");
        return false;
    }
    try {
        return await auth.verifyIdToken(match[1], true);
    } catch {
        sendError(res, 401, "unauthenticated", "Phiên đăng nhập không hợp lệ hoặc đã hết hạn.");
        return false;
    }
}

module.exports = async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    let db;
    try {
        db = getAdminFirestore();
    } catch (error) {
        console.error("Design request API configuration error:", error.code || error.message);
        return sendError(res, 503, "admin-api-not-configured", "API yêu cầu thiết kế chưa được thiết lập.");
    }

    if (req.method === "GET") {
        if (req.query?.manage === "1") {
            let auth;
            try {
                auth = getAdminAuth();
            } catch (error) {
                console.error("Design request authentication configuration error:", error.code || error.message);
                return sendError(res, 503, "admin-api-not-configured", "API quản trị yêu cầu thiết kế chưa được thiết lập.");
            }
            const claims = await verifyAdminRequest(req, res, auth, db);
            if (!claims) return;
            try {
                const snapshot = await db.collection("designRequests").orderBy("createdAt", "desc").limit(100).get();
                return res.status(200).json({ requests: snapshot.docs.map((doc) => publicRequest(doc.id, doc.data())) });
            } catch (error) {
                console.error("Design request list failed:", error.code || error.message);
                return sendError(res, 503, "design-request-unavailable", "Chưa thể tải danh sách yêu cầu thiết kế.");
            }
        }
        const id = String(req.query?.id || "");
        const token = String(req.query?.token || "");
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || !token) return sendError(res, 400, "invalid-design-request", "Mã yêu cầu hoặc mã truy cập không hợp lệ.");
        try {
            const snapshot = await db.collection("designRequests").doc(id).get();
            if (!snapshot.exists || !validAccessToken(token, snapshot.get("accessTokenHash"))) {
                return sendError(res, 404, "design-request-not-found", "Không tìm thấy yêu cầu thiết kế.");
            }
            return res.status(200).json({ request: publicRequest(snapshot.id, snapshot.data()) });
        } catch (error) {
            console.error("Design request lookup failed:", error.code || error.message);
            return sendError(res, 503, "design-request-unavailable", "Chưa thể tra cứu yêu cầu thiết kế.");
        }
    }

    if (req.method !== "POST") {
        res.setHeader("Allow", "GET, POST");
        return sendError(res, 405, "method-not-allowed", "API yêu cầu thiết kế chỉ chấp nhận GET hoặc POST.");
    }

    const action = String(req.body?.action || "");
    if (action === "create") {
        const user = await optionalUser(req, res);
        if (user === false) return;
        const customerName = cleanText(req.body?.customerName, 100);
        const phone = cleanText(req.body?.phone, 30);
        const address = cleanText(req.body?.address, 500);
        const deliveryDate = String(req.body?.deliveryDate || "");
        const deliveryTime = String(req.body?.deliveryTime || "");
        const deliveryZoneId = String(req.body?.deliveryZoneId || "");
        const design = parseDesign(req.body?.design);
        const stems = normalizeStems(req.body?.stems);
        const deliveryNote = cleanText(req.body?.deliveryNote, TEXT_LIMITS.deliveryNote);
        const referenceImage = validImage(req.body?.referenceImage || "");
        if (!customerName || !phone || !address || !stems || (!stems.length && !(design?.surprise && design.budget > 0))
            || !design || deliveryNote === null || referenceImage === null
            || !/^[A-Za-z0-9_-]{1,80}$/.test(deliveryZoneId)
            || orderRules.deliveryScheduleError(deliveryDate, deliveryTime)) {
            return sendError(res, 400, "invalid-design-request", "Thông tin người nhận, lịch giao hoặc thiết kế không hợp lệ.");
        }
        if (orderRules.normalizePhone(phone).length < 8 || orderRules.normalizePhone(phone).length > 15) {
            return sendError(res, 400, "invalid-design-request", "Số điện thoại không hợp lệ.");
        }
        const referenceToken = randomBytes(32).toString("base64url");
        const accessTokenHash = createHash("sha256").update(referenceToken).digest("hex");
        const requestRef = db.collection("designRequests").doc();
        const productRefs = stems.map((stem) => db.collection("products").doc(stem.productId));
        try {
            const result = await db.runTransaction(async (transaction) => {
                const [productSnapshots, zonesSnapshot, wrappingSnapshot] = await Promise.all([
                    transaction.getAll(...productRefs),
                    transaction.get(db.collection("metadata").doc("deliveryZones")),
                    transaction.get(db.collection("metadata").doc("bouquetWrapping"))
                ]);
                const { zone } = orderRules.resolveDeliveryZone(zonesSnapshot.data(), deliveryZoneId);
                const products = stems.map((stem, index) => {
                    const snapshot = productSnapshots[index];
                    if (!snapshot.exists || snapshot.get("status") === "hidden"
                        || orderRules.getProductSaleType(snapshot.data()) !== "flower") {
                        const error = new Error("Một loại hoa không còn khả dụng.");
                        error.code = "product-unavailable";
                        throw error;
                    }
                    const data = snapshot.data();
                    const availableColors = Array.isArray(data.colors) ? data.colors.map(canonicalColor) : [];
                    if (availableColors.length && !availableColors.includes(canonicalColor(stem.color))) {
                        const error = new Error(`Màu ${stem.color} của hoa ${String(data.title || "đã chọn")} hiện không có.`);
                        error.code = "product-unavailable";
                        throw error;
                    }
                    const price = orderRules.getProductPrice(data);
                    if (!Number.isSafeInteger(Number(data.quantity)) || Number(data.quantity) < stem.quantity) {
                        const error = new Error(`Hoa ${String(data.title || "đã chọn")} không còn đủ số lượng.`);
                        error.code = "insufficient-stock";
                        throw error;
                    }
                    return {
                        ...stem,
                        title: String(data.title || "Hoa").slice(0, 120),
                        image: String(data.image || "").slice(0, 1000),
                        price,
                        priceUpdatedAt: String(data.priceUpdatedAt || ""),
                        stock: Number(data.quantity)
                    };
                });
                const tiers = bouquetWrapping.normalizeTiers(wrappingSnapshot.data()?.tiers);
                if (!tiers) {
                    const error = new Error("Cửa hàng chưa cấu hình bậc phí bó hoa.");
                    error.code = "bouquet-wrapping-unavailable";
                    throw error;
                }
                const stemCount = products.reduce((sum, item) => sum + item.quantity, 0);
                const wrappingFee = stemCount > 0
                    ? bouquetWrapping.feeForDesign(tiers, stemCount, design)
                    : 0;
                const subtotal = products.reduce((sum, item) => sum + item.price * item.quantity, 0);
                const total = subtotal + wrappingFee;
                const mainProductId = design.mainProductId && products.some((item) => item.productId === design.mainProductId)
                    ? design.mainProductId
                    : products[0]?.productId || "";
                const request = {
                    uid: user?.uid || "",
                    customerName,
                    phone,
                    address,
                    deliveryDate,
                    deliveryTime,
                    deliveryZoneId: zone.id,
                    deliveryProvince: zone.province,
                    deliveryDistrict: zone.district,
                    deliveryNote,
                    stems: products,
                    design: { ...design, mainProductId },
                    referenceImage,
                    specialRequest: design.specialRequest || "",
                    subtotal,
                    wrappingFee,
                    estimatedTotal: total,
                    quotedTotal: 0,
                    quoteNote: "",
                    status: "Chờ tư vấn",
                    customerResponse: "",
                    accessTokenHash,
                    history: [addHistory("Chờ tư vấn", "Khách đã gửi yêu cầu thiết kế.")],
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp()
                };
                transaction.create(requestRef, request);
                return {
                    id: requestRef.id,
                    status: request.status,
                    subtotal,
                    wrappingFee,
                    estimatedTotal: total,
                    createdAt: new Date().toISOString()
                };
            });
            return res.status(201).json({ request: result, accessToken: referenceToken });
        } catch (error) {
            if (["product-unavailable", "insufficient-stock", "delivery-zone-unavailable", "bouquet-wrapping-unavailable"].includes(error.code)) {
                return sendError(res, 409, error.code, error.message);
            }
            console.error("Design request create failed:", error.code || error.message);
            return sendError(res, 503, "design-request-unavailable", "Chưa thể lưu yêu cầu thiết kế. Vui lòng thử lại.");
        }
    }

    if (action === "respond") {
        const id = String(req.body?.id || "");
        const token = String(req.body?.accessToken || "");
        const response = String(req.body?.response || "");
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || !token || !["accept", "reject"].includes(response)) {
            return sendError(res, 400, "invalid-design-response", "Phản hồi báo giá không hợp lệ.");
        }
        try {
            const reference = db.collection("designRequests").doc(id);
            const request = await db.runTransaction(async (transaction) => {
                const snapshot = await transaction.get(reference);
                if (!snapshot.exists || !validAccessToken(token, snapshot.get("accessTokenHash"))) {
                    const error = new Error("Không tìm thấy yêu cầu thiết kế.");
                    error.code = "design-request-not-found";
                    throw error;
                }
                if (snapshot.get("status") !== "Chờ khách xác nhận" || !Number.isSafeInteger(snapshot.get("quotedTotal"))) {
                    const error = new Error("Yêu cầu chưa có báo giá cần xác nhận.");
                    error.code = "design-quote-unavailable";
                    throw error;
                }
                const status = response === "accept" ? "Đang thực hiện" : "Đã hủy";
                const detail = response === "accept" ? "Khách đã chấp nhận báo giá." : "Khách đã từ chối báo giá.";
                transaction.update(reference, {
                    status,
                    customerResponse: response,
                    history: [...(Array.isArray(snapshot.get("history")) ? snapshot.get("history") : []), addHistory(status, detail)],
                    updatedAt: FieldValue.serverTimestamp()
                });
                return publicRequest(snapshot.id, { ...snapshot.data(), status, customerResponse: response });
            });
            return res.status(200).json({ request });
        } catch (error) {
            if (["design-request-not-found", "design-quote-unavailable"].includes(error.code)) {
                return sendError(res, error.code === "design-request-not-found" ? 404 : 409, error.code, error.message);
            }
            console.error("Design request response failed:", error.code || error.message);
            return sendError(res, 503, "design-request-unavailable", "Chưa thể cập nhật phản hồi. Vui lòng thử lại.");
        }
    }

    if (action === "admin-update") {
        let auth;
        try {
            auth = getAdminAuth();
        } catch (error) {
            console.error("Design request authentication configuration error:", error.code || error.message);
            return sendError(res, 503, "admin-api-not-configured", "API quản trị yêu cầu thiết kế chưa được thiết lập.");
        }
        const claims = await verifyAdminRequest(req, res, auth, db);
        if (!claims) return;
        const id = String(req.body?.id || "");
        const status = String(req.body?.status || "");
        const quotedTotal = req.body?.quotedTotal === "" || req.body?.quotedTotal == null ? null : Number(req.body.quotedTotal);
        const quoteNote = cleanText(req.body?.quoteNote, TEXT_LIMITS.quoteNote);
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || !STATUSES.includes(status) || quoteNote === null
            || (quotedTotal !== null && (!Number.isSafeInteger(quotedTotal) || quotedTotal < 0 || quotedTotal > 1000000000))
            || (status === "Chờ khách xác nhận" && quotedTotal === null)) {
            return sendError(res, 400, "invalid-design-update", "Trạng thái, báo giá hoặc ghi chú không hợp lệ.");
        }
        try {
            const reference = db.collection("designRequests").doc(id);
            const updated = await db.runTransaction(async (transaction) => {
                const snapshot = await transaction.get(reference);
                if (!snapshot.exists) {
                    const error = new Error("Không tìm thấy yêu cầu thiết kế.");
                    error.code = "design-request-not-found";
                    throw error;
                }
                const previousStatus = String(snapshot.get("status") || "Chờ tư vấn");
                const history = Array.isArray(snapshot.get("history")) ? snapshot.get("history") : [];
                const detail = status === "Chờ khách xác nhận"
                    ? `Cửa hàng gửi báo giá ${quotedTotal} ₫${quoteNote ? ` · ${quoteNote}` : ""}.`
                    : quoteNote || `Cửa hàng cập nhật trạng thái: ${status}.`;
                transaction.update(reference, {
                    status,
                    quotedTotal: quotedTotal ?? snapshot.get("quotedTotal") ?? 0,
                    quoteNote: quoteNote || "",
                    history: [...history, addHistory(status, detail)],
                    updatedAt: FieldValue.serverTimestamp()
                });
                return publicRequest(snapshot.id, {
                    ...snapshot.data(),
                    status,
                    quotedTotal: quotedTotal ?? snapshot.get("quotedTotal") ?? 0,
                    quoteNote: quoteNote || "",
                    updatedAt: new Date().toISOString()
                });
            });
            return res.status(200).json({ request: updated });
        } catch (error) {
            if (error.code === "design-request-not-found") return sendError(res, 404, error.code, error.message);
            console.error("Design request admin update failed:", error.code || error.message);
            return sendError(res, 503, "design-request-unavailable", "Chưa thể cập nhật yêu cầu thiết kế.");
        }
    }

    return sendError(res, 400, "invalid-design-action", "Thao tác yêu cầu thiết kế không hợp lệ.");
};

module.exports.internals = { STATUSES, COLORS, DESIGN_CHOICES, normalizeStems, parseDesign, validImage, validAccessToken, publicRequest };
