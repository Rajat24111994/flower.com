// Tra cứu đơn: công khai bằng mã đơn + số điện thoại (có giới hạn lượt), hoặc theo tài khoản.
const { createHmac } = require("node:crypto");
const { Timestamp } = require("firebase-admin/firestore");
const { getAdminFirestore, sendError } = require("../shared/firebase-admin");
const { optionalCustomer, LOCAL_IDENTITY } = require("../shared/request-identity");
const { ORDER_LOOKUP_WINDOW_MS, ORDER_LOOKUP_MAX_ATTEMPTS } = require("./config");
const { normalizePhone } = require("./validation");

function serializeTimestamp(value) {
    if (value && typeof value.toDate === "function") return value.toDate().toISOString();
    return typeof value === "string" ? value : "";
}

function publicTrackingOrder(id, data) {
    return {
        id,
        status: data.status || "Chờ xác nhận",
        estimatedDelivery: data.estimatedDelivery || "",
        trackingHistory: Array.isArray(data.trackingHistory)
            ? data.trackingHistory.map((event) => ({
                status: event.status || data.status || "Chờ xác nhận",
                estimatedDelivery: event.estimatedDelivery || "",
                updatedAt: serializeTimestamp(event.updatedAt) || event.updatedAt || ""
            }))
            : [],
        // What a customer needs to finish a QR transfer (no name, phone or address).
        ...(data.paymentRefunded === true ? {
            paymentMethod: data.paymentMethod || "",
            paymentStatus: "Đã hoàn tiền"
        } : awaitsQrTransfer(data) ? {
            paymentMethod: "qr",
            paymentStatus: data.paymentStatus || "Chờ xác minh thanh toán",
            total: Number(data.total) || 0,
            wrappingFee: Number(data.wrappingFee) || 0,
            paymentReference: data.paymentReference || "",
            reservationExpiresAt: serializeTimestamp(data.reservationExpiresAt)
        } : data.paymentMethod === "vnpay" ? {
            paymentMethod: "vnpay",
            paymentStatus: data.paymentStatus || "chua_thanh_toan"
        } : {}),
        privacyLimited: true
    };
}

function accountTrackingOrder(id, data) {
    return {
        ...data,
        id,
        createdAt: serializeTimestamp(data.createdAt) || data.createdAt || "",
        reservationExpiresAt: serializeTimestamp(data.reservationExpiresAt) || data.reservationExpiresAt || "",
        trackingHistory: Array.isArray(data.trackingHistory)
            ? data.trackingHistory.map((event) => ({
                ...event,
                updatedAt: serializeTimestamp(event.updatedAt) || event.updatedAt || ""
            }))
            : []
    };
}

function awaitsQrTransfer(data) {
    return data.paymentMethod === "qr" && data.paymentVerified !== true
        && ["Chờ xác nhận", "Đang chuẩn bị"].includes(data.status || "Chờ xác nhận");
}

async function checkOrderLookupLimit(db, req) {
    // Vercel overwrites X-Forwarded-For at its edge. Do not trust caller-controlled
    // X-Real-IP or socket fallbacks, which would let clients rotate their limiter key.
    const forwardedFor = String(req.headers["x-forwarded-for"] || "");
    const clientIp = forwardedFor.split(",")[0].trim();
    if (!clientIp || clientIp.length > 64) throw new Error("Trusted client IP is unavailable for order lookup rate limiting.");

    const secret = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!secret) throw new Error("Firebase service credentials are required for order lookup rate limiting.");
    const key = createHmac("sha256", secret).update(clientIp).digest("hex");
    const limitRef = db.collection("orderLookupLimits").doc(key);
    const now = Timestamp.now();

    return db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(limitRef);
        const record = snapshot.exists ? snapshot.data() : {};
        const windowStartedAt = record.windowStartedAt?.toMillis?.() || 0;
        const sameWindow = now.toMillis() - windowStartedAt < ORDER_LOOKUP_WINDOW_MS;
        const attempts = sameWindow ? Number(record.attempts) || 0 : 0;
        if (attempts >= ORDER_LOOKUP_MAX_ATTEMPTS) {
            return {
                allowed: false,
                retryAfter: Math.max(1, Math.ceil((windowStartedAt + ORDER_LOOKUP_WINDOW_MS - now.toMillis()) / 1000))
            };
        }
        transaction.set(limitRef, {
            windowStartedAt: sameWindow ? record.windowStartedAt : now,
            attempts: attempts + 1,
            expiresAt: Timestamp.fromMillis(now.toMillis() + 24 * 60 * 60 * 1000)
        });
        return { allowed: true, retryAfter: 0 };
    });
}

async function optionalAuthenticatedUser(req) {
    return optionalCustomer(req);
}

async function lookupOrder(req, res) {
    try {
        const db = getAdminFirestore();
        const limit = await checkOrderLookupLimit(db, req);
        if (!limit.allowed) {
            res.setHeader("Retry-After", String(limit.retryAfter));
            return sendError(res, 429, "rate-limited", "Bạn đã tra cứu quá nhiều lần. Vui lòng thử lại sau.");
        }

        const authorization = String(req.headers.authorization || "").trim();
        let user = null;
        if (authorization || req[LOCAL_IDENTITY]) {
            if (authorization && !/^Bearer\s+\S+$/i.test(authorization)) {
                return sendError(res, 401, "unauthenticated", "Phiên đăng nhập không hợp lệ.");
            }
            try {
                user = await optionalAuthenticatedUser(req);
            } catch (error) {
                if (String(error.code || "").startsWith("auth/")) {
                    return sendError(res, 401, "unauthenticated", "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.");
                }
                console.error("Order lookup authentication failed:", error.code || "unknown");
                return sendError(res, 503, "order-service-unavailable", "Chưa thể xác minh phiên đăng nhập. Vui lòng thử lại.");
            }
        }

        const id = String(req.body?.id || "").trim().replace(/^#/, "");
        const phone = normalizePhone(req.body?.phone);
        if (!id || id.length > 128 || id.includes("/")
            || (!user && (phone.length < 8 || phone.length > 15))) {
            return sendError(res, 400, "invalid-argument", "Mã đơn hàng hoặc số điện thoại không hợp lệ.");
        }

        const snapshot = await db.collection("orders").doc(id).get();
        if (!snapshot.exists) {
            return sendError(res, 404, "order-not-found", "Không tìm thấy đơn hàng. Hãy kiểm tra lại mã đơn và số điện thoại.");
        }
        if (user) {
            const data = snapshot.data();
            if (data.uid !== user.uid) {
                return sendError(res, 404, "order-not-found", "Không tìm thấy đơn hàng trong tài khoản.");
            }
            return res.status(200).json({ order: accountTrackingOrder(snapshot.id, data) });
        }
        if (normalizePhone(snapshot.get("phone")) !== phone) {
            return sendError(res, 404, "order-not-found", "Không tìm thấy đơn hàng. Hãy kiểm tra lại mã đơn và số điện thoại.");
        }
        return res.status(200).json({ order: publicTrackingOrder(snapshot.id, snapshot.data()) });
    } catch (error) {
        console.error("Order lookup failed:", error.code || "unknown");
        return sendError(res, 503, "order-service-unavailable", "Chưa thể tra cứu đơn hàng. Vui lòng thử lại sau.");
    }
}

async function accountOrders(req, res) {
    try {
        const user = await optionalAuthenticatedUser(req);
        if (!user) return sendError(res, 401, "unauthenticated", "Đăng nhập để xem đơn hàng.");
        const snapshot = await getAdminFirestore().collection("orders").where("uid", "==", user.uid)
            .orderBy("createdAt", "desc").limit(100).get();
        return res.status(200).json({ accountUid: user.uid, orders: snapshot.docs.map(doc => accountTrackingOrder(doc.id, doc.data())) });
    } catch (error) {
        if (String(error.code || "").startsWith("auth/")) return sendError(res, 401, "unauthenticated", "Phiên đăng nhập hết hạn.");
        return sendError(res, 503, "order-service-unavailable", "Chưa thể tải danh sách đơn hàng.");
    }
}

module.exports = { serializeTimestamp, publicTrackingOrder, accountTrackingOrder, awaitsQrTransfer, checkOrderLookupLimit, optionalAuthenticatedUser, lookupOrder, accountOrders };
