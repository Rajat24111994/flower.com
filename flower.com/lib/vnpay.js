const { createHmac, timingSafeEqual } = require("node:crypto");
const net = require("node:net");

const SANDBOX_PAYMENT_URL = "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html";
const PRODUCTION_PAYMENT_URL = "https://pay.vnpay.vn/vpcpay.html";

function getVnpaySecrets(env = process.env) {
    const tmnCode = String(env.VNPAY_TMN_CODE || "").trim();
    const hashSecret = String(env.VNPAY_HASH_SECRET || "").trim();
    if (!tmnCode || !hashSecret) {
        const error = new Error("Thiếu cấu hình VNPay trên máy chủ.");
        error.code = "vnpay-not-configured";
        throw error;
    }
    return { tmnCode, hashSecret };
}

function getVnpayConfig(env = process.env) {
    const { tmnCode, hashSecret } = getVnpaySecrets(env);
    const mode = String(env.VNPAY_ENV || "sandbox").trim().toLowerCase();
    if (!["sandbox", "production"].includes(mode)) {
        const error = new Error("Môi trường VNPay không hợp lệ.");
        error.code = "vnpay-not-configured";
        throw error;
    }
    let appUrl;
    try {
        appUrl = new URL(String(env.PUBLIC_APP_URL || ""));
    } catch {
        const error = new Error("Thiếu URL công khai của cửa hàng trong cấu hình máy chủ.");
        error.code = "vnpay-not-configured";
        throw error;
    }
    if (appUrl.protocol !== "https:" && appUrl.hostname !== "localhost") {
        const error = new Error("URL công khai của cửa hàng phải dùng HTTPS.");
        error.code = "vnpay-not-configured";
        throw error;
    }
    return {
        tmnCode,
        hashSecret,
        paymentUrl: mode === "production" ? PRODUCTION_PAYMENT_URL : SANDBOX_PAYMENT_URL,
        returnUrl: new URL("/payment-result.html", appUrl).toString()
    };
}

function formatVietnamDate(date) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Ho_Chi_Minh",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return `${values.year}${values.month}${values.day}${values.hour}${values.minute}${values.second}`;
}

function canonicalQuery(params) {
    const entries = Object.entries(params)
        .filter(([key, value]) => key.startsWith("vnp_")
            && key !== "vnp_SecureHash"
            && key !== "vnp_SecureHashType"
            && value !== undefined
            && value !== null
            && String(value) !== "")
        .map(([key, value]) => [key, String(value)])
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    const query = new URLSearchParams();
    entries.forEach(([key, value]) => query.append(key, value));
    return query.toString();
}

function createVnpayPaymentUrl({ txnRef, amount, ipAddress, createdAt, expiresAt }, config) {
    if (!/^[A-Za-z0-9]{1,100}$/.test(String(txnRef))
        || !Number.isSafeInteger(amount) || amount <= 0
        || !Number.isSafeInteger(amount * 100) || amount * 100 > 999999999999) {
        const error = new Error("Thông tin giao dịch VNPay không hợp lệ.");
        error.code = "invalid-payment";
        throw error;
    }
    const now = createdAt instanceof Date ? createdAt : new Date(createdAt);
    const expiration = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
    if (!Number.isFinite(now.getTime()) || !Number.isFinite(expiration.getTime()) || expiration <= now) {
        const error = new Error("Thời hạn thanh toán VNPay không hợp lệ.");
        error.code = "invalid-payment";
        throw error;
    }
    const ip = net.isIP(String(ipAddress || "")) ? String(ipAddress) : "127.0.0.1";
    const params = {
        vnp_Version: "2.1.0",
        vnp_Command: "pay",
        vnp_TmnCode: config.tmnCode,
        vnp_Amount: String(amount * 100),
        vnp_CurrCode: "VND",
        vnp_TxnRef: txnRef,
        vnp_OrderInfo: `Thanh toan Flowerflow ${txnRef}`,
        vnp_OrderType: "other",
        vnp_Locale: "vn",
        vnp_ReturnUrl: config.returnUrl,
        vnp_IpAddr: ip,
        vnp_CreateDate: formatVietnamDate(now),
        vnp_ExpireDate: formatVietnamDate(expiration)
    };
    const query = canonicalQuery(params);
    const signature = createHmac("sha512", config.hashSecret).update(query, "utf8").digest("hex");
    return `${config.paymentUrl}?${query}&vnp_SecureHash=${signature}`;
}

function verifyVnpaySignature(params, hashSecret) {
    const actual = String(params?.vnp_SecureHash || "").toLowerCase();
    if (!/^[a-f0-9]{128}$/.test(actual)) return false;
    const expected = createHmac("sha512", hashSecret)
        .update(canonicalQuery(params), "utf8")
        .digest();
    const received = Buffer.from(actual, "hex");
    return received.length === expected.length && timingSafeEqual(received, expected);
}

module.exports = {
    SANDBOX_PAYMENT_URL,
    PRODUCTION_PAYMENT_URL,
    getVnpaySecrets,
    getVnpayConfig,
    canonicalQuery,
    createVnpayPaymentUrl,
    verifyVnpaySignature,
    formatVietnamDate
};
