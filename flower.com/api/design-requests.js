const { createHash, randomBytes, timingSafeEqual } = require("node:crypto");
const { FieldValue } = require("firebase-admin/firestore");
const { getAdminAuth, getAdminFirestore, sendError, verifyRequest, verifyAdminRequest } = require("../lib/firebase-admin");
const { internals: orderRules } = require("./orders");
const bouquetWrapping = require("../js/catalog/bouquet-wrapping.js");

const STATUSES = ["Chờ tư vấn", "Chờ báo giá", "Chờ khách xác nhận", "Đang thực hiện", "Hoàn thành", "Đã hủy"];
const COLORS = ["trắng", "đen", "kem", "hồng", "đỏ", "vàng", "cam", "xanh", "tím", "nhiều màu", "khác"];
const TEXT_LIMITS = {
    arrangement: 40, size: 20, wrapStyle: 40, paperMaterial: 40, paperColor: 30,
    bowStyle: 30, bowColor: 30, theme: 40, style: 40, palette: 40,
    greetingCardTemplate: 40, greetingCard: 300, fragrance: 30, specialRequest: 1500, deliveryNote: 500,
    quoteNote: 1000
};
const DESIGN_CHOICES = {
    arrangement: ["Đối xứng", "Tự nhiên", "Hoa chính ở giữa", "Hoa xen kẽ"],
    size: ["Mini", "Nhỏ", "Vừa", "Lớn"],
    wrapStyle: ["Bó tròn", "Bó dài", "Bó một mặt", "Bó Hàn Quốc", "Bó tối giản", "Không gói"],
    paperMaterial: ["Giấy kraft", "Giấy nhám", "Giấy Hàn Quốc", "Giấy bóng kính"],
    bowStyle: ["Nơ nhỏ", "Nơ lớn", "Nơ lụa", "Không nơ"],
    theme: ["Sinh nhật", "Tình yêu", "Tốt nghiệp", "Khai trương", "Cảm ơn", "Kỷ niệm", "Ngày lễ", "Tự chọn"],
    style: ["Lãng mạn", "Sang trọng", "Dễ thương", "Tối giản", "Cổ điển", "Tự nhiên"],
    palette: ["Trắng - kem", "Hồng pastel", "Đỏ ấm", "Vàng tươi", "Xanh dịu", "Tím", "Nhiều màu"],
    greetingCardTemplate: ["Không cần thiệp", "Hoa lá", "Tối giản", "Chúc mừng", "Tình cảm"]
};

function cleanText(value, maxLength) {
    const text = String(value || "").trim();
    return text.length <= maxLength ? text : null;
}

function canonicalColor(value) {
    const key = String(value || "").trim().toLocaleLowerCase("vi");
    const aliases = { white: "trắng", black: "đen", cream: "kem", pink: "hồng", red: "đỏ", yellow: "vàng", orange: "cam", green: "xanh", blue: "xanh", purple: "tím", multicolor: "nhiều màu" };
    return aliases[key] || key;
}

function validImage(dataUri) {
    if (!dataUri) return "";
    if (typeof dataUri !== "string" || dataUri.length > 360000) return null;
    const match = dataUri.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match) return null;
    const bytes = Buffer.from(match[2], "base64");
    if (bytes.toString("base64") !== match[2]) return null;
    if (bytes.length < 12 || bytes.length > 250000) return null;
    const valid = match[1] === "png"
        ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : match[1] === "jpeg"
            ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
            : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
    return valid ? dataUri : null;
}

function parseDesign(value = {}) {
    const design = {};
    for (const [key, limit] of Object.entries(TEXT_LIMITS)) {
        const cleaned = cleanText(value[key], limit);
        if (cleaned === null) return null;
        if (cleaned) design[key] = cleaned;
    }
    design.paperLayers = Number(value.paperLayers || 1);
    design.mainProductId = String(value.mainProductId || "");
    if (design.mainProductId.length > 128 || design.mainProductId.includes("/")) return null;
    design.greenery = value.greenery === true;
    design.addons = Array.isArray(value.addons)
        ? [...new Set(value.addons.map((item) => String(item)).filter((item) => ["gấu bông nhỏ", "hộp quà", "túi quà", "chocolate", "hoa baby phụ"].includes(item)))]
        : [];
    if (Array.isArray(value.addons) && design.addons.length !== new Set(value.addons).size) return null;
    design.surprise = value.surprise === true;
    design.confirmBeforeMaking = value.confirmBeforeMaking !== false;
    design.anonymousGreetingCard = value.anonymousGreetingCard === true;
    design.lowFragrance = value.lowFragrance === true;
    design.dislikedFlowers = Array.isArray(value.dislikedFlowers)
        ? [...new Set(value.dislikedFlowers.map((item) => String(item).trim()).filter((item) => item && item.length <= 60))].slice(0, 10)
        : [];
    design.excludedFlowers = Array.isArray(value.excludedFlowers)
        ? [...new Set(value.excludedFlowers.map((item) => String(item).trim()).filter((item) => item && item.length <= 60))].slice(0, 10)
        : [];
    design.budget = value.budget === "" || value.budget == null ? 0 : Number(value.budget);
    if (!Number.isInteger(design.paperLayers) || design.paperLayers < 0 || design.paperLayers > 5
        || !Number.isSafeInteger(design.budget) || design.budget < 0 || design.budget > 1000000000
        || Object.entries(DESIGN_CHOICES).some(([key, choices]) => design[key] && !choices.includes(design[key]))
        || (design.paperColor && !COLORS.includes(design.paperColor.toLocaleLowerCase("vi")))
        || (design.bowColor && !COLORS.includes(design.bowColor.toLocaleLowerCase("vi")))) return null;
    return design;
}

function normalizeStems(value) {
    if (!Array.isArray(value) || value.length > 20) return null;
    const seen = new Set();
    const stems = [];
    for (const item of value) {
        const productId = String(item?.productId || "").trim();
        const quantity = Number(item?.quantity);
        const color = cleanText(item?.color, 30);
        const role = String(item?.role || "support");
        if (!productId || productId.length > 128 || productId.includes("/") || seen.has(productId)
            || !Number.isInteger(quantity) || quantity < 1 || quantity > 50
            || !color || !COLORS.includes(color.toLocaleLowerCase("vi"))
            || !["main", "support"].includes(role)) return null;
        seen.add(productId);
        stems.push({ productId, quantity, color, role });
    }
    if (stems.reduce((sum, item) => sum + item.quantity, 0) > bouquetWrapping.MAX_STEMS_PER_BOUQUET) return null;
    return stems;
}

function safeDate(value) {
    return value?.toDate?.().toISOString() || value || "";
}

function publicRequest(id, data) {
    const { accessTokenHash, ...safeData } = data;
    return {
        id,
        ...safeData,
        createdAt: safeDate(data.createdAt),
        updatedAt: safeDate(data.updatedAt),
        history: (Array.isArray(data.history) ? data.history : []).map((event) => ({
            ...event,
            createdAt: safeDate(event.createdAt)
        }))
    };
}

function validAccessToken(token, savedHash) {
    if (typeof token !== "string" || token.length < 32 || token.length > 100 || typeof savedHash !== "string") return false;
    const received = createHash("sha256").update(token).digest();
    const expected = Buffer.from(savedHash, "hex");
    return received.length === expected.length && timingSafeEqual(received, expected);
}

function addHistory(status, detail = "") {
    return { status, detail: String(detail || "").slice(0, 500), createdAt: new Date().toISOString() };
}

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
