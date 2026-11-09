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
    const logLines = [];
    const originalInfo = console.info;
    console.info = (...args) => logLines.push(args.join(" "));
    let grant;
    let remove;
    try {
        grant = await h.callApi("ownerUsers", { token: owner.token, body: { action: "grant-admin", uid: staff.uid } });
        assert.equal(grant.status, 200, JSON.stringify(grant.body));
        assert.equal((await h.auth().getUser(staff.uid)).customClaims.admin, true);
        assert.ok((await h.db().doc(`adminRoles/${staff.uid}`).get()).exists);

        remove = await h.callApi("ownerUsers", { token: owner.token, body: { action: "remove-admin", uid: staff.uid } });
        assert.equal(remove.status, 200);
        assert.equal((await h.auth().getUser(staff.uid)).customClaims.admin, undefined);
        assert.equal((await h.db().doc(`adminRoles/${staff.uid}`).get()).exists, false);
    } finally {
        console.info = originalInfo;
    }
    const consoleLog = logLines.join(" ");
    for (const privateValue of [owner.uid, staff.uid, owner.token]) assert.equal(consoleLog.includes(privateValue), false);
});

test("chủ cửa hàng không tự hạ quyền mình và không đổi quyền chủ khác", async () => {
    const owner = await h.createUser("owner");
    const otherOwner = await h.createUser("owner");
    assert.equal((await h.callApi("ownerUsers", { token: owner.token, body: { action: "remove-admin", uid: owner.uid } })).status, 400);
    assert.equal((await h.callApi("ownerUsers", { token: owner.token, body: { action: "remove-admin", uid: otherOwner.uid } })).status, 403);
});

test("API sản phẩm chỉ đọc và không nạp lại dữ liệu mẫu", async () => {
    const admin = await h.createUser("admin");
    await h.db().doc("products/1").set({ id: 1, title: "Đã sửa", price: 10, quantity: 3 });
    const result = await h.callApi("products", { method: "POST", token: admin.token, body: { action: "restore-catalog" } });
    assert.equal(result.status, 405);
    assert.equal((await h.db().doc("products/1").get()).data().title, "Đã sửa");
    const list = await h.callApi("products", { method: "GET" });
    assert.equal(list.body.products.length, 1);
    await h.db().doc(`adminRoles/${admin.uid}`).delete();
    assert.equal((await h.callApi("products", { method: "POST", token: admin.token, body: { action: "restore-catalog" } })).status, 405);
});

test("sản phẩm tạm ẩn chỉ hiện trong API quản trị đã xác thực", async () => {
    const admin = await h.createUser("admin");
    const customer = await h.createUser();
    await h.db().doc("products/1").set({ ...h.catalog[0], quantity: 4, status: "hidden" });

    const publicList = await h.callApi("products", { method: "GET" });
    assert.equal(publicList.status, 200);
    assert.equal(publicList.body.products.some((product) => String(product.id) === "1"), false);
    const adminList = await h.callApi("products", { method: "GET", query: { manage: "1" }, token: admin.token });
    assert.equal(adminList.status, 200);
    assert.equal(adminList.body.products.find((product) => String(product.id) === "1").status, "hidden");
    assert.equal((await h.callApi("products", { method: "GET", query: { manage: "1" } })).status, 401);
    assert.equal((await h.callApi("products", { method: "GET", query: { manage: "1" }, token: customer.token })).status, 403);
});

test("API giữ nguyên tên và ảnh sản phẩm động, không ghi đè Firestore", async () => {
    const damagedProduct = {
        id: "10",
        title: "Bó hoa hồng tầm bay bổng",
        image: "./images/flower-04.webp",
        price: 1557000,
        quantity: 1044
    };
    await h.db().doc("products/10").set(damagedProduct);

    const publicList = await h.callApi("products", { method: "GET" });
    const publicProduct = publicList.body.products.find((product) => String(product.id) === "10");
    assert.equal(publicProduct.title, damagedProduct.title);
    assert.equal(publicProduct.image, damagedProduct.image);
    assert.equal(publicProduct.price, damagedProduct.price);
    assert.equal(publicProduct.quantity, damagedProduct.quantity);

    const storedProduct = (await h.db().doc("products/10").get()).data();
    assert.equal(storedProduct.title, damagedProduct.title);
    assert.equal(storedProduct.image, damagedProduct.image);
});

test("quản trị viên chạy được dọn đơn hết hạn", async () => {
    const admin = await h.createUser("admin");
    const result = await h.callApi("orders", { method: "GET", query: { action: "expire" }, token: admin.token });
    assert.equal(result.status, 200);
});
