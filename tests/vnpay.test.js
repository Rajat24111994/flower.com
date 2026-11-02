const test = require("node:test");
const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const {
    getVnpayConfig,
    createVnpayPaymentUrl,
    verifyVnpaySignature,
    formatVietnamDate
} = require("../flower.com/lib/vnpay.js");

const hashSecret = "sandbox-test-secret";
const config = {
    tmnCode: "DEMOV210",
    hashSecret,
    paymentUrl: "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html",
    returnUrl: "https://flowerflow.example/payment-result.html"
};

test("VNPay payment URL uses server amount, Vietnam timestamps and a valid HMAC", () => {
    const url = new URL(createVnpayPaymentUrl({
        txnRef: "a".repeat(32),
        amount: 125000,
        ipAddress: "203.0.113.7",
        createdAt: new Date("2026-11-02T02:00:00.000Z"),
        expiresAt: new Date("2026-11-02T02:15:00.000Z")
    }, config));
    const params = Object.fromEntries(url.searchParams.entries());
    assert.equal(url.origin + url.pathname, config.paymentUrl);
    assert.equal(params.vnp_Amount, "12500000");
    assert.equal(params.vnp_TmnCode, "DEMOV210");
    assert.equal(params.vnp_TxnRef, "a".repeat(32));
    assert.equal(params.vnp_CreateDate, "20261102090000");
    assert.equal(params.vnp_ExpireDate, "20261102091500");
    assert.equal(verifyVnpaySignature(params, hashSecret), true);
    params.vnp_Amount = "1";
    assert.equal(verifyVnpaySignature(params, hashSecret), false);
});

test("VNPay IPN signature ignores only signature fields and rejects malformed signatures", () => {
    const callback = {
        vnp_TmnCode: "DEMOV210",
        vnp_TxnRef: "a".repeat(32),
        vnp_Amount: "12500000",
        vnp_ResponseCode: "00",
        vnp_TransactionStatus: "00"
    };
    const canonical = new URLSearchParams(Object.entries(callback).sort(([a], [b]) => a.localeCompare(b))).toString();
    callback.vnp_SecureHash = createHmac("sha512", hashSecret).update(canonical).digest("hex");
    callback.vnp_SecureHashType = "HMACSHA512";
    assert.equal(verifyVnpaySignature(callback, hashSecret), true);
    assert.equal(verifyVnpaySignature({ ...callback, vnp_SecureHash: "bad" }, hashSecret), false);
});

test("VNPay config defaults to sandbox and requires the public HTTPS return origin", () => {
    const result = getVnpayConfig({
        VNPAY_TMN_CODE: "DEMOV210",
        VNPAY_HASH_SECRET: hashSecret,
        PUBLIC_APP_URL: "https://flowerflow.example"
    });
    assert.equal(result.paymentUrl, config.paymentUrl);
    assert.equal(result.returnUrl, config.returnUrl);
    assert.throws(() => getVnpayConfig({
        VNPAY_TMN_CODE: "DEMOV210",
        VNPAY_HASH_SECRET: hashSecret,
        PUBLIC_APP_URL: "http://flowerflow.example"
    }), { code: "vnpay-not-configured" });
});

test("VNPay timestamps are in the provider's GMT+7 format", () => {
    assert.equal(formatVietnamDate(new Date("2026-11-02T02:00:00.000Z")), "20261102090000");
});
