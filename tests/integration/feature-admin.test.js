// Feature tests: quản lý – API dành cho quản trị viên và chủ cửa hàng.
const test = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");

test.beforeEach(async () => {
    await h.resetEmulators();
});

test("quản trị viên xem được danh sách tài khoản", async () => {
    const admin = await h.createUser("admin");
    await h.createUser();
    const result = await h.callApi("adminUsers", { token: admin.token, body: {} });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.users.map((user) => user.role).sort(), ["admin", "customer"]);
});

test("chủ cửa hàng cấp và thu hồi quyền quản trị (kèm adminRoles cho Security Rules)", async () => {
    const owner = await h.createUser("owner");
    const staff = await h.createUser();
    const grant = await h.callApi("ownerUsers", { token: owner.token, body: { action: "grant-admin", uid: staff.uid } });
    assert.equal(grant.status, 200, JSON.stringify(grant.body));
    assert.equal((await h.auth().getUser(staff.uid)).customClaims.admin, true);
    assert.ok((await h.db().doc(`adminRoles/${staff.uid}`).get()).exists);

    const remove = await h.callApi("ownerUsers", { token: owner.token, body: { action: "remove-admin", uid: staff.uid } });
    assert.equal(remove.status, 200);
    assert.equal((await h.auth().getUser(staff.uid)).customClaims.admin, undefined);
    assert.equal((await h.db().doc(`adminRoles/${staff.uid}`).get()).exists, false);
});

test("chủ cửa hàng không tự hạ quyền mình và không đổi quyền chủ khác", async () => {
    const owner = await h.createUser("owner");
    const otherOwner = await h.createUser("owner");
    assert.equal((await h.callApi("ownerUsers", { token: owner.token, body: { action: "remove-admin", uid: owner.uid } })).status, 400);
    assert.equal((await h.callApi("ownerUsers", { token: owner.token, body: { action: "remove-admin", uid: otherOwner.uid } })).status, 403);
});

test("khôi phục sản phẩm mẫu bị thiếu, giữ nguyên sản phẩm đã có", async () => {
    const admin = await h.createUser("admin");
    await h.db().doc("products/1").set({ id: 1, title: "Đã sửa", price: 10, quantity: 3 });
    const result = await h.callApi("products", { token: admin.token, body: { action: "restore-catalog" } });
    assert.equal(result.status, 200);
    assert.equal(result.body.restored, h.catalog.length - 1);
    assert.equal((await h.db().doc("products/1").get()).data().title, "Đã sửa");
    const list = await h.callApi("products", { method: "GET" });
    assert.equal(list.body.products.length, h.catalog.length);
});

test("quản trị viên chạy được dọn đơn hết hạn", async () => {
    const admin = await h.createUser("admin");
    const result = await h.callApi("orders", { method: "GET", query: { action: "expire" }, token: admin.token });
    assert.equal(result.status, 200);
});
