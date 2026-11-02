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
    assert.equal((await h.callApi("products", { body: { action: "restore-catalog" } })).status, 401);
});

test("khách thường không dùng được API quản trị", async () => {
    const customer = await h.createUser();
    assert.equal((await h.callApi("adminUsers", { token: customer.token, body: {} })).status, 403);
    assert.equal((await h.callApi("ownerUsers", { token: customer.token, body: { action: "list" } })).status, 403);
    assert.equal((await h.callApi("products", { token: customer.token, body: { action: "restore-catalog" } })).status, 403);
    assert.equal((await h.callApi("orders", { method: "GET", query: { action: "expire" }, token: customer.token })).status, 401);
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
        status = (await h.callApi("orders", { body: { action: "lookup", id: `doan-${attempt}`, phone: "0908123456" } })).status;
    }
    assert.equal(status, 429, "phải chặn sau nhiều lần tra cứu");
});

test("khách không tự đặt giá hay số lượng bất thường", async () => {
    for (const items of [[{ id: "1", quantity: -5 }], [{ id: "1", quantity: 1000 }], [{ id: "../adminRoles/x", quantity: 1 }]]) {
        assert.equal((await h.callApi("orders", { body: { action: "quote", items } })).status, 400, JSON.stringify(items));
    }
    const cheap = await h.placeOrder({ overrides: { expectedTotals: { subtotal: 0, savings: 0, tax: 0, total: 0 } } });
    assert.equal(cheap.status, 409);
});
