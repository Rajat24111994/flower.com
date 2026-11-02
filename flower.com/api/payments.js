const { randomBytes } = require("node:crypto");
const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const { getAdminFirestore, sendError } = require("../lib/firebase-admin");
const {
    getVnpayConfig,
    createVnpayPaymentUrl
} = require("../lib/vnpay");
const { expireReservations, aggregateItems } = require("./orders.js").internals;

const PAYMENT_RESERVATION_MS = 15 * 60 * 1000;

function errorResponse(res, error) {
    if (["invalid-payment", "order-not-found", "payment-not-available", "payment-already-complete", "insufficient-stock"].includes(error.code)) {
        const status = error.code === "order-not-found" ? 404 : error.code === "invalid-payment" ? 400 : 409;
        return sendError(res, status, error.code, error.message);
    }
    if (error.code === "vnpay-not-configured") {
        return sendError(res, 503, error.code, "Thanh toán VNPay chưa được cấu hình. Vui lòng chọn thanh toán khi nhận hàng hoặc thử lại sau.");
    }
    console.error("VNPay payment request failed:", error.code || error.message);
    return sendError(res, 503, "payment-service-unavailable", "Chưa thể tạo liên kết thanh toán. Vui lòng thử lại sau.");
}

async function createOrReuseAttempt(db, { orderId, paymentReference, previousTxnRef = "" }) {
    await expireReservations(db);
    const orderRef = db.collection("orders").doc(orderId);
    const transactionRef = previousTxnRef
        ? db.collection("paymentTransactions").doc(previousTxnRef)
        : null;
    return db.runTransaction(async (transaction) => {
        const orderSnapshot = await transaction.get(orderRef);
        if (!orderSnapshot.exists) {
            const error = new Error("Không tìm thấy đơn hàng.");
            error.code = "order-not-found";
            throw error;
        }
        const order = orderSnapshot.data();
        if (previousTxnRef) {
            const previousSnapshot = await transaction.get(transactionRef);
            if (!previousSnapshot.exists || previousSnapshot.data().orderId !== orderId) {
                const error = new Error("Không tìm thấy giao dịch thanh toán.");
                error.code = "order-not-found";
                throw error;
            }
        } else if (order.paymentReference !== paymentReference) {
            const error = new Error("Không tìm thấy giao dịch thanh toán.");
            error.code = "order-not-found";
            throw error;
        }
        if (order.paymentMethod !== "vnpay") {
            const error = new Error("Đơn hàng này không sử dụng thanh toán VNPay.");
            error.code = "payment-not-available";
            throw error;
        }
        if (order.paymentVerified === true) {
            const error = new Error("Đơn hàng đã được xác nhận thanh toán.");
            error.code = "payment-already-complete";
            throw error;
        }

        const now = Date.now();
        const currentTxnRef = String(order.vnpTxnRef || "");
        if (currentTxnRef) {
            const currentRef = db.collection("paymentTransactions").doc(currentTxnRef);
            const currentSnapshot = currentTxnRef === previousTxnRef
                ? await transaction.get(transactionRef)
                : await transaction.get(currentRef);
            const current = currentSnapshot.exists ? currentSnapshot.data() : null;
            const expiresAt = current?.expiresAt?.toMillis?.() || 0;
            const reservationExpiry = order.reservationExpiresAt?.toMillis?.() || 0;
            if (current?.status === "pending" && expiresAt > now
                && order.inventoryReserved === true && reservationExpiry > now) {
                return {
                    txnRef: currentTxnRef,
                    amount: current.amount,
                    createdAt: current.createdAt?.toDate?.() || new Date(now),
                    expiresAt: current.expiresAt.toDate()
                };
            }
        }

        const items = aggregateItems(order.items);
        if (!items.length || !Number.isSafeInteger(order.total)
            || !Number.isSafeInteger(order.total * 100) || order.total <= 0) {
            const error = new Error("Đơn hàng không có số tiền thanh toán hợp lệ.");
            error.code = "invalid-payment";
            throw error;
        }

        const wasReserved = order.inventoryReserved === true;
        if (!wasReserved && !(order.status === "Đã hủy"
            && order.paymentStatus === "that_bai" && order.reservationExpiredAt)) {
            const error = new Error("Đơn hàng không còn ở trạng thái có thể thanh toán.");
            error.code = "payment-not-available";
            throw error;
        }

        const productRefs = wasReserved
            ? []
            : items.map((item) => db.collection("products").doc(item.id));
        const productSnapshots = productRefs.length ? await transaction.getAll(...productRefs) : [];
        const shortages = [];
        productSnapshots.forEach((snapshot, index) => {
            const available = snapshot.exists ? Number(snapshot.data().quantity) : 0;
            if (!Number.isInteger(available) || available < items[index].quantity) {
                shortages.push(snapshot.exists ? Math.max(0, available) : 0);
            }
        });
        if (shortages.length) {
            const error = new Error("Một số sản phẩm đã hết hàng. Hãy quay lại giỏ hàng để cập nhật đơn.");
            error.code = "insufficient-stock";
            throw error;
        }

        const txnRef = randomBytes(16).toString("hex");
        const createdAt = new Date(now);
        const expiresAt = wasReserved && order.reservationExpiresAt?.toMillis?.() > now
            ? order.reservationExpiresAt.toDate()
            : new Date(now + PAYMENT_RESERVATION_MS);
        const attemptNumber = Math.max(0, Number(order.vnpPaymentAttempt) || 0) + 1;
        const attemptRef = db.collection("paymentTransactions").doc(txnRef);
        if (!wasReserved) {
            productSnapshots.forEach((snapshot, index) => {
                transaction.update(snapshot.ref, { quantity: Number(snapshot.data().quantity) - items[index].quantity });
            });
        }
        transaction.create(attemptRef, {
            orderId,
            amount: order.total,
            status: "pending",
            attempt: attemptNumber,
            createdAt: Timestamp.fromDate(createdAt),
            expiresAt: Timestamp.fromDate(expiresAt)
        });
        transaction.update(orderRef, {
            ...(wasReserved ? {} : {
                status: "Chờ xác nhận",
                currentLocation: "Đơn hàng đang chờ thanh toán lại",
                inventoryReserved: true,
                inventoryState: "reserved",
                reservationExpiresAt: Timestamp.fromDate(expiresAt),
                reservationExpiredAt: FieldValue.delete(),
                trackingHistory: [
                    ...(Array.isArray(order.trackingHistory) ? order.trackingHistory : []),
                    {
                        status: "Chờ xác nhận",
                        location: "Đơn hàng đang chờ thanh toán lại",
                        estimatedDelivery: "",
                        updatedAt: createdAt.toISOString()
                    }
                ]
            }),
            paymentStatus: "chua_thanh_toan",
            vnpTxnRef: txnRef,
            vnpPaymentAttempt: attemptNumber,
            vnpPaymentCreatedAt: FieldValue.serverTimestamp()
        });
        return { txnRef, amount: order.total, createdAt, expiresAt };
    });
}

function clientIp(req) {
    const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    return forwarded || req.socket?.remoteAddress || "127.0.0.1";
}

async function createPaymentLink(req, res, isRetry) {
    try {
        const config = getVnpayConfig();
        const previousTxnRef = isRetry ? String(req.body?.txnRef || "") : "";
        if (isRetry && !/^[a-f0-9]{32}$/.test(previousTxnRef)) {
            const error = new Error("Mã giao dịch thanh toán không hợp lệ.");
            error.code = "invalid-payment";
            throw error;
        }
        const orderId = isRetry ? "" : String(req.body?.orderId || "").trim();
        const paymentReference = isRetry ? "" : String(req.body?.paymentReference || "").trim();
        if ((!isRetry && (!orderId || orderId.length > 128 || orderId.includes("/")
            || !paymentReference || paymentReference.length > 64))) {
            const error = new Error("Thông tin đơn hàng không hợp lệ.");
            error.code = "invalid-payment";
            throw error;
        }

        const db = getAdminFirestore();
        let targetOrderId = orderId;
        if (isRetry) {
            const previous = await db.collection("paymentTransactions").doc(previousTxnRef).get();
            if (!previous.exists) {
                const error = new Error("Không tìm thấy giao dịch thanh toán.");
                error.code = "order-not-found";
                throw error;
            }
            targetOrderId = String(previous.data().orderId || "");
        }
        const attempt = await createOrReuseAttempt(db, {
            orderId: targetOrderId,
            paymentReference,
            previousTxnRef
        });
        const url = createVnpayPaymentUrl({
            ...attempt,
            ipAddress: clientIp(req)
        }, config);
        return res.status(200).json({ paymentUrl: url, expiresAt: attempt.expiresAt.toISOString() });
    } catch (error) {
        return errorResponse(res, error);
    }
}

async function getPaymentStatus(req, res) {
    const txnRef = String(req.query?.txnRef || "");
    if (!/^[a-f0-9]{32}$/.test(txnRef)) {
        return sendError(res, 400, "invalid-payment", "Mã giao dịch thanh toán không hợp lệ.");
    }
    try {
        const db = getAdminFirestore();
        const snapshot = await db.collection("paymentTransactions").doc(txnRef).get();
        if (!snapshot.exists) return sendError(res, 404, "payment-not-found", "Không tìm thấy giao dịch thanh toán.");
        const payment = snapshot.data();
        const expired = payment.status === "pending" && payment.expiresAt?.toMillis?.() <= Date.now();
        return res.status(200).json({
            status: expired ? "expired" : payment.status,
            orderId: payment.orderId,
            retryAllowed: payment.status !== "success",
            latePayment: payment.latePayment === true
        });
    } catch (error) {
        console.error("VNPay payment status lookup failed:", error.code || error.message);
        return sendError(res, 503, "payment-service-unavailable", "Chưa thể kiểm tra trạng thái thanh toán.");
    }
}

module.exports = async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "GET" && req.query?.action === "status") return getPaymentStatus(req, res);
    if (req.method === "POST" && req.body?.action === "retry") return createPaymentLink(req, res, true);
    if (req.method === "POST" && req.body?.action === "create") return createPaymentLink(req, res, false);
    res.setHeader("Allow", "GET, POST");
    return sendError(res, 405, "method-not-allowed", "API thanh toán chỉ chấp nhận GET hoặc POST.");
};

module.exports.internals = { createOrReuseAttempt, PAYMENT_RESERVATION_MS };
