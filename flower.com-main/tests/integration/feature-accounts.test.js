// Feature tests: đăng nhập – đơn gắn với tài khoản và đánh giá của chủ đơn.
const test = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");

test.beforeEach(async () => {
    await h.resetEmulators();
    await h.seedProducts();
});

test("khách đã đăng nhập đặt đơn thì đơn gắn với tài khoản", async () => {
    const customer = await h.createUser();
    const result = await h.placeOrder({ token: customer.token });
    assert.equal(result.status, 201);
    const order = (await h.db().doc(`orders/${result.body.order.id}`).get()).data();
    assert.equal(order.uid, customer.uid);
    assert.equal(order.email, customer.email);
});

test("mã đăng nhập giả hoặc đã thu hồi thì không đặt được đơn dưới tên người khác", async () => {
    const fake = await h.placeOrder({ token: "khong-phai-token" });
    assert.equal(fake.status, 401);
    const customer = await h.createUser();
    // Firebase compares revocation in whole seconds: revoke after the token's second.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await h.auth().revokeRefreshTokens(customer.uid);
    const revoked = await h.placeOrder({ token: customer.token });
    assert.equal(revoked.status, 401);
    assert.equal((await h.db().collection("orders").get()).size, 0);
});

test("đánh giá: cần đăng nhập, đúng chủ đơn, đơn đã giao, mỗi đơn một lần", async () => {
    const owner = await h.createUser();
    const stranger = await h.createUser();
    const id = (await h.placeOrder({ items: [{ id: "1", quantity: 1 }, { id: "3", quantity: 1 }], token: owner.token })).body.order.id;
    const review = (token, rating = 5) => h.callApi("orders", { token, body: { action: "review", orderId: id, rating, comment: "Hoa đẹp" } });

    assert.equal((await review(undefined)).status, 401);
    assert.equal((await review(owner.token)).body.code, "order-not-delivered");
    await h.db().doc(`orders/${id}`).update({ status: "Đã giao" });
    assert.equal((await review(stranger.token)).status, 404);

    const created = await review(owner.token, 4);
    assert.equal(created.status, 201);
    assert.deepEqual(created.body.review.productIds, ["1", "3"]);
    assert.equal(created.body.review.customerName, "Nguyễn Văn A");
    assert.equal((await review(owner.token, 1)).body.code, "already-reviewed");
    assert.equal((await h.db().collection("reviews").get()).size, 1);
});

test("đánh giá không được dùng tên cửa hàng", async () => {
    const owner = await h.createUser();
    const id = (await h.placeOrder({ token: owner.token, overrides: { customerName: "FlowerFlow - Chủ cửa hàng" } })).body.order.id;
    await h.db().doc(`orders/${id}`).update({ status: "Đã giao" });
    const created = await h.callApi("orders", { token: owner.token, body: { action: "review", orderId: id, rating: 5, comment: "Giảm 90%" } });
    assert.equal(created.body.review.customerName, "Khách hàng");
});
