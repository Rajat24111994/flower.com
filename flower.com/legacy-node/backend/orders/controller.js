// Controller của module đơn hàng: nhận request /api/orders và chuyển tới đúng service.
//   POST action=quote             -> checkout.quoteOrder       (báo giá giỏ hàng)
//   POST (không action)           -> checkout.createOrder      (tạo đơn, giữ kho)
//   POST action=lookup            -> tracking.lookupOrder      (tra cứu đơn)
//   GET  action=mine              -> tracking.accountOrders    (đơn của tài khoản)
//   POST action=review|review-get -> reviews                   (đánh giá theo đơn)
//   POST action=verify-qr-payment|record-late-qr-payment|record-payment-refund,
//   GET  action=payment-audit     -> payment-admin             (admin đối soát, hoàn tiền)
//   GET  action=expire            -> reservations              (dọn đơn hết hạn, cron hoặc admin)
const { getAdminFirestore, sendError } = require("../shared/firebase-admin");
const { MAX_QUANTITY_PER_PRODUCT, VNPAY_RESERVATION_MS, DELIVERY_TIME_WINDOWS, MAX_ORDER_NOTE_LENGTH } = require("./config");
const { normalizePhone, getVietnameseDateTime, deliveryScheduleError, validateCheckout, validateQuote, isValidPromotionDate, vietnameseDate } = require("./validation");
const { getEnabledDeliveryZones, resolveDeliveryZone, calculateCustomBouquets, getProductSaleType, getProductPrice, aggregateItems, paymentReferenceFor, findPromotion, priceCart } = require("./pricing");
const { expireReservations } = require("./reservations");
const { publicTrackingOrder, lookupOrder, accountOrders } = require("./tracking");
const { quoteOrder, createOrder } = require("./checkout");
const { authorizeOrderAdmin, reconcileQrPayment, recordPaymentRefund, getQrPaymentAudit } = require("./payment-admin");
const { reviewIdForOrder, getOwnReview, submitReview } = require("./reviews");

module.exports = async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "POST") {
        if (req.body?.action === "verify-qr-payment") return reconcileQrPayment(req, res);
        if (req.body?.action === "record-late-qr-payment") return reconcileQrPayment(req, res, true);
        if (req.body?.action === "record-payment-refund") return recordPaymentRefund(req, res);
        if (req.body?.action === "quote") return quoteOrder(req, res);
        if (req.body?.action === "lookup") return lookupOrder(req, res);
        if (req.body?.action === "review") return submitReview(req, res);
        if (req.body?.action === "review-get") return getOwnReview(req, res);
        return createOrder(req, res);
    }
    if (req.method !== "GET") {
        res.setHeader("Allow", "GET, POST");
        return sendError(res, 405, "method-not-allowed", "API đơn hàng chỉ chấp nhận phương thức GET hoặc POST.");
    }

    if (req.query?.action === "payment-audit") return getQrPaymentAudit(req, res);
    if (req.query?.action === "mine") return accountOrders(req, res);

    if (req.query?.action === "expire") {
        const match = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
        let authorized = Boolean(process.env.CRON_SECRET && match?.[1] === process.env.CRON_SECRET);
        if (!authorized && match?.[1]) {
            if (!await authorizeOrderAdmin(req, res)) return;
            authorized = true;
        }
        if (!authorized) return sendError(res, 401, "unauthenticated", "Quyền dọn đơn hết hạn không hợp lệ.");
        try {
            const released = await expireReservations(getAdminFirestore());
            return res.status(200).json({ released });
        } catch (error) {
            console.error("Reservation cleanup failed:", error.code || "unknown");
            return sendError(res, 503, "order-service-unavailable", "Chưa thể giải phóng tồn kho đơn hết hạn.");
        }
    }

    return sendError(res, 405, "method-not-allowed", "Tra cứu đơn hàng cần dùng phương thức POST.");
};

// Hàm thuần, xuất ra cho unit test (giữ nguyên tên như trước khi tách file).
module.exports.internals = {
    normalizePhone,
    aggregateItems,
    findPromotion,
    isValidPromotionDate,
    vietnameseDate,
    priceCart,
    validateCheckout,
    validateQuote,
    deliveryScheduleError,
    getVietnameseDateTime,
    getEnabledDeliveryZones,
    resolveDeliveryZone,
    getProductPrice,
    getProductSaleType,
    calculateCustomBouquets,
    DELIVERY_TIME_WINDOWS,
    paymentReferenceFor,
    publicTrackingOrder,
    reviewIdForOrder,
    expireReservations,
    aggregateItems,
    MAX_ORDER_NOTE_LENGTH,
    MAX_QUANTITY_PER_PRODUCT,
    VNPAY_RESERVATION_MS
};
