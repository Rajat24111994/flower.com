// Security tests: the API refuses missing, fake and under-privileged credentials, and does not
// leak personal data.
const test = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");

test.beforeEach(async () => {
    await h.resetEmulators();
    await h.seedProducts();
});

test("API quản trị từ chối khi không có hoặc sai mã đăng nhập", async () => {
    for (const name of ["adminUsers", "ownerUsers"]) {
        assert.equal((await h.callApi(name, { body: { action: "list" } })).status, 401, name);
        assert.equal((await h.callApi(name, { token: "gia-mao", body: { action: "list" } })).status, 401, name);
    }
    assert.equal((await h.callApi("products", { body: { action: "restore-catalog" } })).status, 405);
    assert.equal((await h.callApi("products", { method: "GET", query: { manage: "1" } })).status, 401);
});

test("khách thường không dùng được API quản trị", async () => {
    const customer = await h.createUser();
    assert.equal((await h.callApi("adminUsers", { token: customer.token, body: {} })).status, 403);
    assert.equal((await h.callApi("ownerUsers", { token: customer.token, body: { action: "list" } })).status, 403);
    assert.equal((await h.callApi("products", { token: customer.token, body: { action: "restore-catalog" } })).status, 405);
    assert.equal((await h.callApi("products", { method: "GET", query: { manage: "1" }, token: customer.token })).status, 403);
    // The shared admin guard distinguishes an authenticated customer (403) from no session (401).
    assert.equal((await h.callApi("orders", { method: "GET", query: { action: "expire" }, token: customer.token })).status, 403);
});

test("claim quản trị đã thu hồi không thể dùng API nội bộ", async () => {
    const admin = await h.createUser("admin");
    await h.db().doc(`adminRoles/${admin.uid}`).delete();

    assert.equal((await h.callApi("adminUsers", { token: admin.token, body: {} })).status, 403);
    assert.equal((await h.callApi("deliveryZones", { method: "GET", query: { manage: "1" }, token: admin.token })).status, 403);
    assert.equal((await h.callApi("deliveryZones", {
        method: "POST",
        token: admin.token,
        body: { action: "delete", id: "unused" }
    })).status, 403);
    assert.equal((await h.callApi("orders", {
        method: "GET",
        query: { action: "expire" },
        token: admin.token
    })).status, 403);

    // Every admin surface must honor immediate revocation in adminRoles, even while
    // the already-issued Firebase ID token still contains admin:true.
    assert.equal((await h.callApi("adminAudit", { method: "GET", token: admin.token })).status, 403);
    assert.equal((await h.callApi("bouquetWrapping", { method: "GET", query: { manage: "1" }, token: admin.token })).status, 403);
    assert.equal((await h.callApi("bouquetWrapping", { token: admin.token, body: { tiers: [] } })).status, 403);
    assert.equal((await h.callApi("designRequests", { method: "GET", query: { manage: "1" }, token: admin.token })).status, 403);
    assert.equal((await h.callApi("designRequests", { token: admin.token, body: { action: "admin-update", id: "missing", status: "Đã hủy" } })).status, 403);
});

test("admin đang có quyền truy cập được các bề mặt quản trị đã thống nhất guard", async () => {
    const admin = await h.createUser("admin");
    assert.equal((await h.callApi("adminAudit", { method: "GET", token: admin.token })).status, 200);
    assert.equal((await h.callApi("bouquetWrapping", { method: "GET", query: { manage: "1" }, token: admin.token })).status, 200);
    assert.equal((await h.callApi("designRequests", { method: "GET", query: { manage: "1" }, token: admin.token })).status, 200);
});

test("chủ cửa hàng đã thu hồi không thể quản lý tài khoản", async () => {
    const owner = await h.createUser("owner");
    await h.db().doc(`adminRoles/${owner.uid}`).delete();

    assert.equal((await h.callApi("ownerUsers", {
        token: owner.token,
        body: { action: "list" }
    })).status, 403);
});

test("admin thường không cấp được quyền (chỉ chủ cửa hàng)", async () => {
    const admin = await h.createUser("admin");
    const customer = await h.createUser();
    const result = await h.callApi("ownerUsers", { token: admin.token, body: { action: "grant-admin", uid: customer.uid } });
    assert.equal(result.status, 403);
    assert.equal((await h.auth().getUser(customer.uid)).customClaims?.admin, undefined);
});

test("dọn đơn hết hạn cần đúng khóa cron", async () => {
    assert.equal((await h.callApi("orders", { method: "GET", query: { action: "expire" } })).status, 401);
    assert.equal((await h.callApi("orders", { method: "GET", query: { action: "expire" }, headers: { authorization: "Bearer sai-khoa" } })).status, 401);
});

test("tra cứu đơn: không lộ tên, số điện thoại, địa chỉ; chặn dò mã đơn", async () => {
    const id = (await h.placeOrder()).body.order.id;
    const found = await h.callApi("orders", { body: { action: "lookup", id, phone: "0908123456" } });
    const text = JSON.stringify(found.body);
    for (const secret of ["Nguyễn Văn A", "0908123456", "147 Lê Lợi"]) assert.ok(!text.includes(secret), secret);

    let status = 0;
    for (let attempt = 0; attempt < 25 && status !== 429; attempt += 1) {
        status = (await h.callApi("orders", {
            body: { action: "lookup", id: `doan-${attempt}`, phone: "0908123456" },
            headers: { "x-real-ip": `198.51.100.${attempt + 1}` }
        })).status;
    }
    assert.equal(status, 429, "phải chặn sau nhiều lần tra cứu");
});

test("tra cứu đơn đã đăng nhập chỉ trả chi tiết cho đúng chủ tài khoản", async () => {
    const owner = await h.createUser();
    const stranger = await h.createUser();
    const id = (await h.placeOrder({ token: owner.token })).body.order.id;
    const lookup = (token, phone = "") => h.callApi("orders", {
        token,
        body: { action: "lookup", id, phone }
    });

    const ownOrder = await lookup(owner.token);
    assert.equal(ownOrder.status, 200);
    assert.equal(ownOrder.body.order.uid, owner.uid);
    assert.equal(ownOrder.body.order.address, "147 Lê Lợi, Quận 1");
    assert.notEqual(ownOrder.body.order.privacyLimited, true);

    const otherAccount = await lookup(stranger.token, "0908123456");
    assert.equal(otherAccount.status, 404);
    assert.equal(otherAccount.body.code, "order-not-found");
    assert.equal((await lookup("invalid-token")).status, 401);

    const guestLookup = await lookup(undefined, "0908123456");
    assert.equal(guestLookup.status, 200);
    assert.equal(guestLookup.body.order.privacyLimited, true);
    assert.equal(guestLookup.body.order.address, undefined);
});

test("thông tin thẻ không được lưu và dữ liệu thanh toán/giao hàng không lộ qua tra cứu công khai", async () => {
    const placed = await h.placeOrder({
        overrides: { cardNumber: "4111111111111111", cvv: "123", billingAddress: "Địa chỉ thanh toán bí mật" }
    });
    assert.equal(placed.status, 201);

    const orderId = placed.body.order.id;
    const storedOrder = (await h.db().doc(`orders/${orderId}`).get()).data();
    for (const key of ["cardNumber", "cvv", "billingAddress"]) assert.equal(storedOrder[key], undefined, key);

    const lookup = await h.callApi("orders", {
        body: { action: "lookup", id: orderId, phone: "0908123456" }
    });
    assert.equal(lookup.status, 200);
    const response = JSON.stringify(lookup.body);
    for (const secret of ["4111111111111111", "Địa chỉ thanh toán bí mật", "0908123456", "147 Lê Lợi"]) {
        assert.ok(!response.includes(secret), secret);
    }

    const cardPayment = await h.placeOrder({ paymentMethod: "card" });
    assert.equal(cardPayment.status, 400);
});

test("đối soát QR chỉ qua API admin, kiểm tra số tiền và ghi audit bất biến", async () => {
    const admin = await h.createUser("admin");
    const placed = await h.placeOrder({ paymentMethod: "qr" });
    const orderId = placed.body.order.id;
    const orderRef = h.db().doc(`orders/${orderId}`);
    const order = (await orderRef.get()).data();
    const payload = {
        action: "verify-qr-payment",
        orderId,
        amount: order.total,
        reconciliationReference: "BANK-TRANSFER-001"
    };

    assert.equal((await h.callApi("orders", { body: payload })).status, 401);
    const customer = await h.createUser();
    assert.equal((await h.callApi("orders", { token: customer.token, body: payload })).status, 403);
    const wrongAmount = await h.callApi("orders", { token: admin.token, body: { ...payload, amount: order.total + 1 } });
    assert.equal(wrongAmount.status, 409);
    assert.equal(wrongAmount.body.code, "payment-amount-mismatch");
    assert.equal((await orderRef.get()).data().paymentVerified, false);

    const verified = await h.callApi("orders", { token: admin.token, body: payload });
    assert.equal(verified.status, 200, JSON.stringify(verified.body));
    const paid = (await orderRef.get()).data();
    assert.equal(paid.paymentVerified, true);
    assert.equal(paid.paymentVerifiedBy, admin.uid);
    assert.equal(paid.paymentReconciliationReference, payload.reconciliationReference);

    const audit = await h.db().collection("orderPaymentAudit").where("orderId", "==", orderId).get();
    assert.equal(audit.size, 1);
    assert.equal(audit.docs[0].data().actorUid, admin.uid);
    assert.equal(audit.docs[0].data().actorEmail, admin.email);
    assert.equal(audit.docs[0].data().amountVnd, order.total);
    assert.equal(audit.docs[0].data().reconciliationReference, payload.reconciliationReference);
    assert.equal(audit.docs[0].data().action, "qr-payment-verified");
    const auditResponse = await h.callApi("orders", {
        method: "GET",
        query: { action: "payment-audit", orderId },
        token: admin.token
    });
    assert.equal(auditResponse.status, 200);
    assert.equal(auditResponse.body.entries.length, 1);
    assert.equal(auditResponse.body.entries[0].reconciliationReference, payload.reconciliationReference);
    assert.equal((await h.callApi("orders", {
        method: "GET",
        query: { action: "payment-audit", orderId },
        token: customer.token
    })).status, 403);

    const duplicate = await h.callApi("orders", { token: admin.token, body: payload });
    assert.equal(duplicate.status, 409);
    assert.equal((await h.db().collection("orderPaymentAudit").where("orderId", "==", orderId).get()).size, 1);
});

test("thanh toán QR đến sau khi đơn hủy được ghi nhận riêng, không dùng xác minh thường", async () => {
    const admin = await h.createUser("admin");
    const placed = await h.placeOrder({ paymentMethod: "qr" });
    const orderId = placed.body.order.id;
    const orderRef = h.db().doc(`orders/${orderId}`);
    await orderRef.update({ reservationExpiresAt: h.Timestamp.fromMillis(Date.now() - 1000) });
    await h.callApi("orders", {
        method: "GET",
        query: { action: "expire" },
        headers: { authorization: "Bearer test-cron-secret" }
    });
    const order = (await orderRef.get()).data();
    const basePayload = {
        orderId,
        amount: order.total,
        reconciliationReference: "BANK-LATE-002"
    };
    const regular = await h.callApi("orders", {
        token: admin.token, body: { ...basePayload, action: "verify-qr-payment" }
    });
    assert.equal(regular.status, 409);
    const late = await h.callApi("orders", {
        token: admin.token, body: { ...basePayload, action: "record-late-qr-payment" }
    });
    assert.equal(late.status, 200, JSON.stringify(late.body));
    const updated = (await orderRef.get()).data();
    assert.equal(updated.paymentVerified, true);
    assert.equal(updated.latePayment, true);
    const audit = await h.db().collection("orderPaymentAudit").where("orderId", "==", orderId).get();
    assert.equal(audit.size, 1);
    assert.equal(audit.docs[0].data().action, "qr-late-payment-recorded");
});

test("hoàn tiền cần quyền admin, chỉ áp dụng đơn đã trả và ghi audit idempotent", async () => {
    const admin = await h.createUser("admin");
    const customer = await h.createUser();
    const placed = await h.placeOrder({ paymentMethod: "qr" });
    const orderId = placed.body.order.id;
    const orderRef = h.db().doc(`orders/${orderId}`);
    const order = (await orderRef.get()).data();
    const payload = {
        action: "record-payment-refund",
        orderId,
        refundReference: "BANK-REFUND-003"
    };

    assert.equal((await h.callApi("orders", { body: payload })).status, 401);
    assert.equal((await h.callApi("orders", { token: customer.token, body: payload })).status, 403);
    const unpaid = await h.callApi("orders", { token: admin.token, body: payload });
    assert.equal(unpaid.status, 409);
    assert.equal(unpaid.body.code, "payment-not-complete");

    assert.equal((await h.callApi("orders", {
        token: admin.token,
        body: {
            action: "verify-qr-payment",
            orderId,
            amount: order.total,
            reconciliationReference: "BANK-TRANSFER-003"
        }
    })).status, 200);
    const refunded = await h.callApi("orders", { token: admin.token, body: payload });
    assert.equal(refunded.status, 200, JSON.stringify(refunded.body));
    assert.equal(refunded.body.amountVnd, order.total);
    const updated = (await orderRef.get()).data();
    assert.equal(updated.paymentRefunded, true);
    assert.equal(updated.paymentRefundAmount, order.total);
    assert.equal(updated.paymentRefundReference, payload.refundReference);
    assert.equal(updated.paymentStatus, "Đã hoàn tiền");
    assert.equal((await h.callApi("orders", { token: admin.token, body: payload })).body.code, "payment-already-refunded");
    const publicOrder = await h.callApi("orders", {
        body: { action: "lookup", id: orderId, phone: "0908123456" }
    });
    assert.equal(publicOrder.body.order.paymentStatus, "Đã hoàn tiền");
    assert.equal(publicOrder.body.order.paymentMethod, "qr");
    assert.equal(publicOrder.body.order.paymentRefundReference, undefined);

    const audit = await h.db().collection("orderPaymentAudit").where("orderId", "==", orderId).get();
    assert.equal(audit.size, 2);
    assert.ok(audit.docs.some((entry) => entry.data().action === "payment-refunded"
        && entry.data().amountVnd === order.total
        && entry.data().reconciliationReference === payload.refundReference));
});

test("khách không tự đặt giá hay số lượng bất thường", async () => {
    for (const items of [[{ id: "1", quantity: -5 }], [{ id: "1", quantity: 1000 }], [{ id: "../adminRoles/x", quantity: 1 }]]) {
        assert.equal((await h.callApi("orders", { body: { action: "quote", items } })).status, 400, JSON.stringify(items));
    }
    const cheap = await h.placeOrder({ overrides: { expectedTotals: { subtotal: 0, savings: 0, tax: 0, shippingFee: 0, total: 0 } } });
    assert.equal(cheap.status, 409);
});
