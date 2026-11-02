// VNPay sandbox flow through the real API handlers and Firestore emulator.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const h = require("./helpers");
const { canonicalQuery } = require("../../flower.com/lib/vnpay.js");

const hashSecret = process.env.VNPAY_HASH_SECRET;

test.beforeEach(async () => {
    await h.resetEmulators();
    await h.seedProducts();
});

function signCallback(values) {
    const callback = {
        vnp_TmnCode: "DEMOV210",
        vnp_TxnRef: values.txnRef,
        vnp_Amount: String(values.amount),
        vnp_CurrCode: "VND",
        vnp_ResponseCode: values.responseCode || "00",
        vnp_TransactionStatus: values.transactionStatus || "00",
        vnp_TransactionNo: values.transactionNo || "12345678"
    };
    callback.vnp_SecureHash = createHmac("sha512", hashSecret).update(canonicalQuery(callback)).digest("hex");
    return callback;
}

test("VNPay payment URL uses server total and IPN alone confirms payment", async () => {
    const placed = await h.placeOrder({ paymentMethod: "vnpay" });
    assert.equal(placed.status, 201, JSON.stringify(placed.body));
    const orderId = placed.body.order.id;
    const orderRef = h.db().doc(`orders/${orderId}`);
    const before = (await orderRef.get()).data();
    assert.equal(before.paymentStatus, "chua_thanh_toan");
    assert.equal(before.total, placed.quote.body.totals.total);
    assert.equal(await h.stockOf("1"), 9);

    const created = await h.callApi("payments", {
        body: { action: "create", orderId, paymentReference: before.paymentReference }
    });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const paymentUrl = new URL(created.body.paymentUrl);
    assert.equal(paymentUrl.hostname, "sandbox.vnpayment.vn");
    assert.equal(paymentUrl.searchParams.get("vnp_Amount"), String(before.total * 100));
    const txnRef = paymentUrl.searchParams.get("vnp_TxnRef");
    const attempt = (await h.db().doc(`paymentTransactions/${txnRef}`).get()).data();
    assert.equal(attempt.amount, before.total);

    const forged = await h.callApi("vnpayIpn", {
        method: "GET",
        query: { ...signCallback({ txnRef, amount: before.total * 100 }), vnp_SecureHash: "0".repeat(128) }
    });
    assert.equal(forged.body.RspCode, "97");
    assert.equal((await orderRef.get()).data().paymentVerified, false);

    const ipn = await h.callApi("vnpayIpn", {
        method: "GET",
        query: signCallback({ txnRef, amount: before.total * 100 })
    });
    assert.equal(ipn.body.RspCode, "00");
    const paid = (await orderRef.get()).data();
    assert.equal(paid.paymentVerified, true);
    assert.equal(paid.paymentStatus, "da_thanh_toan");
    assert.ok(paid.paidAt);

    const duplicate = await h.callApi("vnpayIpn", {
        method: "GET",
        query: signCallback({ txnRef, amount: before.total * 100 })
    });
    assert.equal(duplicate.body.RspCode, "00");
    assert.equal(await h.stockOf("1"), 9);
});

test("VNPay IPN rejects a correctly signed amount mismatch", async () => {
    const placed = await h.placeOrder({ paymentMethod: "vnpay" });
    const orderId = placed.body.order.id;
    const order = (await h.db().doc(`orders/${orderId}`).get()).data();
    const created = await h.callApi("payments", {
        body: { action: "create", orderId, paymentReference: order.paymentReference }
    });
    const txnRef = new URL(created.body.paymentUrl).searchParams.get("vnp_TxnRef");
    const response = await h.callApi("vnpayIpn", {
        method: "GET",
        query: signCallback({ txnRef, amount: (order.total + 1) * 100 })
    });
    assert.equal(response.body.RspCode, "04");
    assert.equal((await h.db().doc(`orders/${orderId}`).get()).data().paymentVerified, false);
});

test("retry reuses a live VNPay attempt and a paid order cannot get another link", async () => {
    const placed = await h.placeOrder({ paymentMethod: "vnpay" });
    const orderId = placed.body.order.id;
    const orderRef = h.db().doc(`orders/${orderId}`);
    const order = (await orderRef.get()).data();
    const first = await h.callApi("payments", {
        body: { action: "create", orderId, paymentReference: order.paymentReference }
    });
    const txnRef = new URL(first.body.paymentUrl).searchParams.get("vnp_TxnRef");
    const retry = await h.callApi("payments", { body: { action: "retry", txnRef } });
    assert.equal(retry.status, 200);
    assert.equal(new URL(retry.body.paymentUrl).searchParams.get("vnp_TxnRef"), txnRef);

    await h.callApi("vnpayIpn", {
        method: "GET",
        query: signCallback({ txnRef, amount: order.total * 100 })
    });
    const paidRetry = await h.callApi("payments", { body: { action: "retry", txnRef } });
    assert.equal(paidRetry.status, 409);
    assert.equal(paidRetry.body.code, "payment-already-complete");
});

test("expired VNPay order releases stock and retry reserves it again when available", async () => {
    const placed = await h.placeOrder({ paymentMethod: "vnpay" });
    const orderId = placed.body.order.id;
    const orderRef = h.db().doc(`orders/${orderId}`);
    const order = (await orderRef.get()).data();
    const created = await h.callApi("payments", {
        body: { action: "create", orderId, paymentReference: order.paymentReference }
    });
    const txnRef = new URL(created.body.paymentUrl).searchParams.get("vnp_TxnRef");

    await orderRef.update({ reservationExpiresAt: h.Timestamp.fromMillis(Date.now() - 1000) });
    const expired = await h.callApi("orders", {
        method: "GET",
        query: { action: "expire" },
        headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }
    });
    assert.equal(expired.status, 200);
    assert.equal(await h.stockOf("1"), 10);
    assert.equal((await orderRef.get()).data().paymentStatus, "that_bai");

    const retry = await h.callApi("payments", { body: { action: "retry", txnRef } });
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    assert.notEqual(new URL(retry.body.paymentUrl).searchParams.get("vnp_TxnRef"), txnRef);
    assert.equal(await h.stockOf("1"), 9);
    const reopened = (await orderRef.get()).data();
    assert.equal(reopened.status, "Chờ xác nhận");
    assert.equal(reopened.inventoryReserved, true);
    assert.equal(reopened.vnpPaymentAttempt, 2);
});
