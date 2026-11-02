const { FieldValue } = require("firebase-admin/firestore");
const { getAdminFirestore, sendError } = require("../lib/firebase-admin");
const { getVnpaySecrets, verifyVnpaySignature } = require("../lib/vnpay");
const { expireReservations } = require("./orders.js").internals;

function ipnReply(res, code, message) {
    return res.status(200).json({ RspCode: code, Message: message });
}

module.exports = async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        return sendError(res, 405, "method-not-allowed", "VNPay IPN chỉ chấp nhận GET.");
    }

    let secrets;
    try {
        secrets = getVnpaySecrets();
    } catch {
        return ipnReply(res, "99", "Configuration error");
    }
    const params = req.query || {};
    if (!verifyVnpaySignature(params, secrets.hashSecret)
        || String(params.vnp_TmnCode || "") !== secrets.tmnCode) {
        return ipnReply(res, "97", "Invalid signature");
    }
    const txnRef = String(params.vnp_TxnRef || "");
    if (!/^[a-f0-9]{32}$/.test(txnRef)) return ipnReply(res, "01", "Order not found");

    try {
        const db = getAdminFirestore();
        await expireReservations(db);
        const attemptRef = db.collection("paymentTransactions").doc(txnRef);
        const result = await db.runTransaction(async (transaction) => {
            const attemptSnapshot = await transaction.get(attemptRef);
            if (!attemptSnapshot.exists) return { code: "01", message: "Order not found" };
            const attempt = attemptSnapshot.data();
            const orderRef = db.collection("orders").doc(String(attempt.orderId || ""));
            const orderSnapshot = await transaction.get(orderRef);
            if (!orderSnapshot.exists) return { code: "01", message: "Order not found" };
            const order = orderSnapshot.data();
            if (String(params.vnp_TmnCode || "") !== secrets.tmnCode) return { code: "97", message: "Invalid signature" };
            const amount = String(params.vnp_Amount || "");
            if (params.vnp_CurrCode !== "VND"
                || !/^\d+$/.test(amount)
                || !Number.isSafeInteger(Number(amount))
                || Number(amount) !== attempt.amount * 100
                || Number(amount) !== order.total * 100) {
                return { code: "04", message: "Invalid amount" };
            }
            if (attempt.status === "success") return { code: "00", message: "Confirm Success" };

            const paid = params.vnp_ResponseCode === "00" && params.vnp_TransactionStatus === "00";
            const now = new Date();
            const late = paid && (order.inventoryReserved !== true || order.status === "Đã hủy");
            transaction.update(attemptRef, {
                status: paid ? "success" : "failed",
                responseCode: String(params.vnp_ResponseCode || ""),
                transactionStatus: String(params.vnp_TransactionStatus || ""),
                transactionNo: String(params.vnp_TransactionNo || "").slice(0, 100),
                processedAt: FieldValue.serverTimestamp(),
                ...(late ? { latePayment: true } : {})
            });
            if (paid && order.paymentVerified !== true) {
                transaction.update(orderRef, {
                    paymentStatus: "da_thanh_toan",
                    paymentVerified: true,
                    paidAt: now.toISOString(),
                    vnpTransactionNo: String(params.vnp_TransactionNo || "").slice(0, 100),
                    vnpTxnRef: txnRef,
                    ...(late ? {
                        latePayment: true,
                        paymentAttention: "Thanh toán đến sau khi đơn đã hủy; cần kiểm tra và xử lý hoàn tiền hoặc khôi phục đơn."
                    } : {})
                });
            } else if (!paid && order.paymentVerified !== true && order.vnpTxnRef === txnRef) {
                transaction.update(orderRef, {
                    paymentStatus: "that_bai",
                    vnpResponseCode: String(params.vnp_ResponseCode || "").slice(0, 10)
                });
            } else if (paid && order.paymentVerified === true) {
                transaction.update(attemptRef, { latePayment: true });
                transaction.update(orderRef, {
                    latePayment: true,
                    paymentAttention: "Có thêm giao dịch VNPay thành công cho đơn đã thanh toán; cần kiểm tra và xử lý hoàn tiền."
                });
            }
            return { code: "00", message: "Confirm Success" };
        });
        return ipnReply(res, result.code, result.message);
    } catch (error) {
        console.error("VNPay IPN processing failed:", error.code || error.message);
        return ipnReply(res, "99", "Unknown error");
    }
};

module.exports.internals = { ipnReply };
