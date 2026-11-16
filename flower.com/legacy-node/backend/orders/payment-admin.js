// Admin xử lý thanh toán: đối soát chuyển khoản QR, ghi nhận tiền đến trễ, hoàn tiền, nhật ký thanh toán.
const { FieldValue } = require("firebase-admin/firestore");
const { getAdminAuth, getAdminFirestore, sendError, verifyRequest } = require("../shared/firebase-admin");
const { serializeTimestamp } = require("./tracking");

async function authorizeOrderAdmin(req, res) {
    const user = await verifyRequest(req, res, getAdminAuth());
    if (!user) return null;
    if (user.admin !== true) {
        sendError(res, 403, "forbidden", "Thao tác này chỉ dành cho quản trị viên.");
        return null;
    }
    const role = await getAdminFirestore().collection("adminRoles").doc(user.uid).get();
    if (!role.exists) {
        sendError(res, 403, "forbidden", "Quyền quản trị viên đã bị thu hồi.");
        return null;
    }
    return user;
}

async function reconcileQrPayment(req, res, latePayment = false) {
    const orderId = String(req.body?.orderId || "").trim();
    const reconciliationReference = String(req.body?.reconciliationReference || "").trim();
    const confirmedAmount = Number(req.body?.amount);
    if (!orderId || orderId.length > 128 || orderId.includes("/")
        || !reconciliationReference || reconciliationReference.length > 120
        || /[\u0000-\u001f\u007f]/.test(reconciliationReference)
        || !Number.isSafeInteger(confirmedAmount) || confirmedAmount <= 0) {
        return sendError(res, 400, "invalid-argument", "Cần mã đơn, mã giao dịch ngân hàng và số tiền đã đối chiếu hợp lệ.");
    }

    try {
        const user = await authorizeOrderAdmin(req, res);
        if (!user) return;
        const db = getAdminFirestore();
        const orderRef = db.collection("orders").doc(orderId);
        const auditRef = db.collection("orderPaymentAudit").doc();
        const result = await db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(orderRef);
            if (!snapshot.exists) {
                const error = new Error("Không tìm thấy đơn hàng.");
                error.code = "order-not-found";
                throw error;
            }
            const order = snapshot.data();
            if (order.paymentMethod !== "qr") {
                const error = new Error("Đơn hàng này không sử dụng chuyển khoản QR.");
                error.code = "payment-method-mismatch";
                throw error;
            }
            if (order.paymentVerified === true) {
                const error = new Error("Thanh toán của đơn này đã được xác nhận.");
                error.code = "payment-already-complete";
                throw error;
            }
            if (!Number.isSafeInteger(order.total) || order.total <= 0 || confirmedAmount !== order.total) {
                const error = new Error("Số tiền đối chiếu không khớp tổng tiền đơn hàng.");
                error.code = "payment-amount-mismatch";
                throw error;
            }
            if (latePayment ? order.status !== "Đã hủy" : order.status === "Đã hủy") {
                const error = new Error(latePayment
                    ? "Đơn này chưa bị hủy. Hãy dùng xác minh thanh toán thông thường."
                    : "Đơn này đã bị hủy. Hãy dùng thao tác ghi nhận thanh toán trễ.");
                error.code = latePayment ? "order-not-cancelled" : "order-cancelled";
                throw error;
            }
            if (!latePayment && order.inventoryState === "released") {
                const error = new Error("Đơn đã giải phóng tồn kho. Hãy khôi phục đơn trước khi xác nhận thanh toán.");
                error.code = "order-inventory-released";
                throw error;
            }

            const now = new Date();
            const action = latePayment ? "qr-late-payment-recorded" : "qr-payment-verified";
            transaction.update(orderRef, {
                paymentVerified: true,
                paymentStatus: latePayment
                    ? "Đã nhận tiền sau khi đơn bị hủy – cần khôi phục đơn hoặc hoàn tiền"
                    : "Đã thanh toán",
                paidAt: now.toISOString(),
                paymentVerifiedAt: FieldValue.serverTimestamp(),
                paymentVerifiedBy: user.uid,
                paymentReconciliationReference: reconciliationReference,
                ...(latePayment ? {
                    latePayment: true,
                    paymentAttention: "Thanh toán đến sau khi đơn đã hủy; cần kiểm tra và xử lý hoàn tiền hoặc khôi phục đơn."
                } : {})
            });
            transaction.create(auditRef, {
                orderId,
                action,
                actorUid: user.uid,
                actorEmail: String(user.email || "").slice(0, 254),
                actorRole: "admin",
                amountVnd: order.total,
                paymentReference: String(order.paymentReference || "").slice(0, 120),
                reconciliationReference,
                previousPaymentStatus: String(order.paymentStatus || "").slice(0, 120),
                orderStatus: String(order.status || "").slice(0, 80),
                createdAt: FieldValue.serverTimestamp()
            });
            return { auditId: auditRef.id };
        });
        return res.status(200).json({ ok: true, auditId: result.auditId });
    } catch (error) {
        if (String(error.code || "").startsWith("auth/")) {
            return sendError(res, 401, "unauthenticated", "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.");
        }
        const statuses = {
            "order-not-found": 404,
            "payment-method-mismatch": 409,
            "payment-already-complete": 409,
            "payment-amount-mismatch": 409,
            "order-not-cancelled": 409,
            "order-cancelled": 409,
            "order-inventory-released": 409
        };
        if (statuses[error.code]) return sendError(res, statuses[error.code], error.code, error.message);
        console.error("QR payment reconciliation failed:", error.code || error.message);
        return sendError(res, 503, "payment-reconciliation-unavailable", "Chưa thể ghi nhận đối soát. Vui lòng thử lại.");
    }
}

async function recordPaymentRefund(req, res) {
    const orderId = String(req.body?.orderId || "").trim();
    const refundReference = String(req.body?.refundReference || "").trim();
    if (!orderId || orderId.length > 128 || orderId.includes("/")
        || !refundReference || refundReference.length > 120
        || /[\u0000-\u001f\u007f]/.test(refundReference)) {
        return sendError(res, 400, "invalid-argument", "Cần mã đơn và mã giao dịch hoàn tiền hợp lệ.");
    }

    try {
        const user = await authorizeOrderAdmin(req, res);
        if (!user) return;
        const db = getAdminFirestore();
        const orderRef = db.collection("orders").doc(orderId);
        const auditRef = db.collection("orderPaymentAudit").doc();
        const result = await db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(orderRef);
            if (!snapshot.exists) {
                const error = new Error("Không tìm thấy đơn hàng.");
                error.code = "order-not-found";
                throw error;
            }
            const order = snapshot.data();
            if (order.paymentRefunded === true) {
                const error = new Error("Đơn hàng này đã được ghi nhận hoàn tiền.");
                error.code = "payment-already-refunded";
                throw error;
            }
            const paymentStatus = String(order.paymentStatus || "").trim().toLocaleLowerCase("vi");
            const paid = order.paymentVerified === true
                || ["đã thanh toán", "paid", "da_thanh_toan"].includes(paymentStatus);
            if (!paid) {
                const error = new Error("Chỉ ghi nhận hoàn tiền cho đơn đã xác nhận thanh toán.");
                error.code = "payment-not-complete";
                throw error;
            }
            if (!Number.isSafeInteger(order.total) || order.total <= 0) {
                const error = new Error("Tổng tiền đơn hàng không hợp lệ để hoàn tiền.");
                error.code = "invalid-refund-amount";
                throw error;
            }

            transaction.update(orderRef, {
                paymentRefunded: true,
                paymentRefundAmount: order.total,
                paymentRefundedAt: FieldValue.serverTimestamp(),
                paymentRefundedBy: user.uid,
                paymentRefundReference: refundReference,
                paymentStatus: "Đã hoàn tiền"
            });
            transaction.create(auditRef, {
                orderId,
                action: "payment-refunded",
                actorUid: user.uid,
                actorEmail: String(user.email || "").slice(0, 254),
                actorRole: "admin",
                amountVnd: order.total,
                paymentReference: String(order.paymentReference || "").slice(0, 120),
                reconciliationReference: refundReference,
                previousPaymentStatus: String(order.paymentStatus || "").slice(0, 120),
                orderStatus: String(order.status || "").slice(0, 80),
                createdAt: FieldValue.serverTimestamp()
            });
            return { auditId: auditRef.id, amountVnd: order.total };
        });
        return res.status(200).json({ ok: true, ...result });
    } catch (error) {
        if (String(error.code || "").startsWith("auth/")) {
            return sendError(res, 401, "unauthenticated", "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.");
        }
        const statuses = {
            "order-not-found": 404,
            "payment-not-complete": 409,
            "payment-already-refunded": 409,
            "invalid-refund-amount": 409
        };
        if (statuses[error.code]) return sendError(res, statuses[error.code], error.code, error.message);
        console.error("Payment refund recording failed:", error.code || error.message);
        return sendError(res, 503, "payment-refund-unavailable", "Chưa thể ghi nhận hoàn tiền. Vui lòng thử lại.");
    }
}

async function getQrPaymentAudit(req, res) {
    const orderId = String(req.query?.orderId || "").trim();
    if (!orderId || orderId.length > 128 || orderId.includes("/")) {
        return sendError(res, 400, "invalid-argument", "Mã đơn không hợp lệ.");
    }
    try {
        if (!await authorizeOrderAdmin(req, res)) return;
        const db = getAdminFirestore();
        const snapshot = await db.collection("orderPaymentAudit")
            .where("orderId", "==", orderId)
            .orderBy("createdAt", "desc")
            .limit(25)
            .get();
        const entries = snapshot.docs.map((document) => {
            const data = document.data();
            return {
                id: document.id,
                action: data.action,
                actorUid: data.actorUid,
                actorEmail: data.actorEmail,
                actorRole: data.actorRole,
                amountVnd: data.amountVnd,
                paymentReference: data.paymentReference,
                reconciliationReference: data.reconciliationReference,
                previousPaymentStatus: data.previousPaymentStatus,
                orderStatus: data.orderStatus,
                createdAt: serializeTimestamp(data.createdAt)
            };
        });
        return res.status(200).json({ entries });
    } catch (error) {
        if (String(error.code || "").startsWith("auth/")) {
            return sendError(res, 401, "unauthenticated", "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.");
        }
        console.error("QR payment audit lookup failed:", error.code || error.message);
        return sendError(res, 503, "payment-audit-unavailable", "Chưa thể tải lịch sử đối soát. Vui lòng thử lại.");
    }
}

module.exports = { authorizeOrderAdmin, reconcileQrPayment, recordPaymentRefund, getQrPaymentAudit };
