const { FieldValue } = require("firebase-admin/firestore");
const { getAdminAuth, getAdminFirestore, sendError, verifyRequest } = require("../shared/firebase-admin");
const { toVndPrice } = require("../../js/catalog/product-store.js");
const { addAdminAudit } = require("../shared/admin-audit");

const MIN_PRICE = 1000;
const MAX_PRICE = 1_000_000_000;

function vietnameseDate(now = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Ho_Chi_Minh",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(now);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}

function timestampToIso(value) {
    if (value && typeof value.toDate === "function") return value.toDate().toISOString();
    if (typeof value === "string" && value) return value;
    return "";
}

function validFlowerId(value) {
    return typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= 128
        && !/[\/\u0000-\u001f\u007f]/.test(value);
}

function validPrice(value) {
    return Number.isSafeInteger(value) && value >= MIN_PRICE && value <= MAX_PRICE;
}

function serializeFlower(id, data) {
    return {
        flowerId: id,
        name: String(data.title || ""),
        image: String(data.image || ""),
        unit: String(data.unit || "cành"),
        price: toVndPrice(data.price),
        priceUpdatedAt: timestampToIso(data.priceChangedAt) || String(data.priceUpdatedAt || ""),
        updatedBy: String(data.priceUpdatedByEmail || data.priceUpdatedBy || "")
    };
}

async function authorizeOwner(req, res) {
    let auth;
    try {
        auth = getAdminAuth();
    } catch (error) {
        console.error("Firebase Admin API configuration error:", error.message);
        sendError(res, 503, "admin-api-not-configured", "API quản trị Firebase chưa được cấu hình.");
        return null;
    }

    const token = await verifyRequest(req, res, auth);
    if (!token) return null;
    if (token.role !== "owner" || token.admin !== true) {
        sendError(res, 403, "permission-denied", "Chỉ chủ cửa hàng mới được quản lý giá hoa.");
        return null;
    }

    let db;
    try {
        db = getAdminFirestore();
        const role = await db.collection("adminRoles").doc(token.uid).get();
        if (!role.exists || role.data().role !== "owner") {
            sendError(res, 403, "permission-denied", "Tài khoản không còn quyền Owner.");
            return null;
        }
    } catch (error) {
        console.error("Flower price authorization failed:", error.code || error.message);
        sendError(res, 503, "price-service-unavailable", "Chưa thể xác minh quyền quản lý giá.");
        return null;
    }
    return { token, db };
}

async function listFlowers(db) {
    const snapshot = await db.collection("products").where("saleType", "==", "flower").get();
    return snapshot.docs
        .map((doc) => serializeFlower(doc.id, doc.data()))
        .sort((left, right) => left.name.localeCompare(right.name, "vi"));
}

async function getPriceHistory(db, flowerId) {
    const flower = await db.collection("products").doc(flowerId).get();
    if (!flower.exists || flower.data().saleType !== "flower") {
        return { error: "Không tìm thấy loại hoa." };
    }
    const snapshot = await db.collection("priceHistory").where("flowerId", "==", flowerId).get();
    const history = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
            id: doc.id,
            oldPrice: Number(data.oldPrice),
            newPrice: Number(data.newPrice),
            updatedAt: timestampToIso(data.updatedAt),
            updatedBy: String(data.updatedByEmail || data.updatedBy || "")
        };
    }).sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
    return { history };
}

async function updateFlowerPrice(db, token, body) {
    const flowerId = body.flowerId;
    const price = body.price;
    if (!validFlowerId(flowerId) || !validPrice(price)) {
        return { error: "Mã hoa hoặc giá bán không hợp lệ.", code: "invalid-argument" };
    }

    const productRef = db.collection("products").doc(flowerId);
    const historyRef = db.collection("priceHistory").doc();
    const now = new Date();
    const email = String(token.email || "").slice(0, 320);
    return db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(productRef);
        if (!snapshot.exists || snapshot.data().saleType !== "flower") {
            return { error: "Không tìm thấy loại hoa.", code: "flower-not-found" };
        }
        const product = snapshot.data();
        const oldPrice = toVndPrice(product.price);
        if (!Number.isSafeInteger(oldPrice) || oldPrice < MIN_PRICE || oldPrice > MAX_PRICE) {
            return { error: "Giá hiện tại của loại hoa không hợp lệ.", code: "invalid-current-price" };
        }
        if (oldPrice === price) {
            return { changed: false, flower: serializeFlower(flowerId, product) };
        }

        const updatedAt = FieldValue.serverTimestamp();
        transaction.update(productRef, {
            price,
            priceUpdatedAt: vietnameseDate(now),
            priceChangedAt: updatedAt,
            priceUpdatedBy: token.uid
        });
        transaction.create(historyRef, {
            flowerId,
            oldPrice,
            newPrice: price,
            updatedAt,
            updatedBy: token.uid,
            updatedByEmail: email
        });
        addAdminAudit(transaction, db, token, "flower-price.update", "flower", flowerId, { oldPrice, newPrice: price });
        return {
            changed: true,
            flower: {
                ...serializeFlower(flowerId, product),
                price,
                priceUpdatedAt: now.toISOString(),
                updatedBy: email || token.uid
            }
        };
    });
}

module.exports = async function handler(req, res) {
    res.setHeader("Cache-Control", "private, no-store");
    if (!["GET", "PATCH"].includes(req.method)) {
        res.setHeader("Allow", "GET, PATCH");
        return sendError(res, 405, "method-not-allowed", "API chỉ chấp nhận GET hoặc PATCH.");
    }

    const access = await authorizeOwner(req, res);
    if (!access) return;

    try {
        if (req.method === "GET") {
            const flowerId = req.query?.flowerId;
            if (flowerId !== undefined) {
                if (!validFlowerId(flowerId)) {
                    return sendError(res, 400, "invalid-argument", "Mã hoa không hợp lệ.");
                }
                const result = await getPriceHistory(access.db, flowerId);
                if (result.error) return sendError(res, 404, "flower-not-found", result.error);
                return res.status(200).json(result);
            }
            return res.status(200).json({ flowers: await listFlowers(access.db) });
        }

        const result = await updateFlowerPrice(access.db, access.token, req.body || {});
        if (result.error) {
            const status = result.code === "flower-not-found" ? 404 : 400;
            return sendError(res, status, result.code || "invalid-argument", result.error);
        }
        return res.status(200).json(result);
    } catch (error) {
        console.error("Flower prices API failed:", error.code || error.message);
        return sendError(res, 503, "price-service-unavailable", "Chưa thể tải hoặc cập nhật giá hoa. Vui lòng thử lại.");
    }
};

module.exports.internals = { validFlowerId, validPrice, serializeFlower, updateFlowerPrice };
