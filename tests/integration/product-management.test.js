const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");
const sdk = require("firebase/firestore");
const h = require("./helpers");

let env;
const original = { id: "test-flower", title: "Hoa thử nghiệm", price: 250000, quantity: 5,
    image: "./images/flower-01.webp", description: "Hoa tươi", category: "Sinh nhật", status: "active" };

// Execute the actual inventory store with the real Firestore SDK. Only dependency loading
// and browser storage are substituted; writes and Security Rules run on the emulator.
function inventory(db, products = []) {
    const data = new Map([["flowerInventory", JSON.stringify(products)]]);
    const context = {
        __firebase: { db, firestoreSdk: sdk }, console, navigator: { onLine: true },
        window: { localStorage: { getItem: (key) => data.get(key), setItem: (key, value) => data.set(key, value) }, dispatchEvent() {} },
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } }
    };
    const source = fs.readFileSync(path.join(h.ROOT, "js/catalog/product-store.js"), "utf8")
        .replace("async function getFirebaseApi() {", "async function getFirebaseApi() { return __firebase;");
    new Function("window", "__firebase", "navigator", "CustomEvent", source)(
        context.window, context.__firebase, context.navigator, context.CustomEvent);
    return { api: context.window.FlowerInventory, context };
}

test.before(async () => {
    const [host, port] = h.FIRESTORE_HOST.split(":");
    env = await initializeTestEnvironment({ projectId: h.PROJECT_ID,
        firestore: { host, port: Number(port), rules: fs.readFileSync(path.join(h.ROOT, "firestore.rules"), "utf8") } });
});
test.after(() => env.cleanup());
test.beforeEach(async () => {
    await h.resetEmulators();
    await h.db().doc("adminRoles/admin-test").set({ role: "admin" });
    await h.db().doc("adminRoles/owner-test").set({ role: "owner" });
    await h.db().doc("metadata/productCatalog").set({ catalogSeeded: true });
});

test("store thật: thêm/sửa/ẩn/hiện/xóa lưu bền, API khách cập nhật, lịch sử đơn giữ nguyên", async () => {
    const db = env.authenticatedContext("admin-test", { admin: true }).firestore();
    const store = inventory(db).api;
    await store.saveProducts([original]);
    assert.equal((await h.db().doc("products/test-flower").get()).data().price, 250000);
    const reloaded = inventory(db, [(await h.db().doc("products/test-flower").get()).data()]).api;
    await reloaded.saveProducts([{ ...original, price: 350000, image: "./images/flower-02.webp" }]);
    let list = await h.callApi("products", { method: "GET" });
    assert.equal(list.body.products[0].price, 350000);
    assert.equal(list.body.products[0].image, "./images/flower-02.webp");
    await h.db().doc("orders/history-test").set({ items: [{ ...original, quantity: 1 }], total: 250000 });
    await reloaded.saveProducts(reloaded.readProducts().map((item) => ({ ...item, status: "hidden" })));
    list = await h.callApi("products", { method: "GET" });
    assert.equal(list.body.products.length, 0);
    await reloaded.saveProducts(reloaded.readProducts().map((item) => ({ ...item, status: "active", quantity: 0 })));
    assert.equal((await h.callApi("products", { method: "GET" })).body.products[0].quantity, 0);
    await reloaded.saveProducts([]);
    assert.equal((await h.db().doc("products/test-flower").get()).exists, false);
    assert.equal((await h.db().doc("orders/history-test").get()).data().items[0].title, original.title);
});

test("lưu giá không ghi đè tồn kho mới; xung đột cùng trường và trùng ID không ghi đè", async () => {
    const db = env.authenticatedContext("admin-test", { admin: true }).firestore();
    await h.db().doc("products/test-flower").set(original);
    const store = inventory(db, [original]).api;
    await h.db().doc("products/test-flower").update({ quantity: 2 });
    await store.saveProducts([{ ...original, price: 300000 }]);
    assert.equal(await h.stockOf("test-flower"), 2);
    assert.equal(store.readProducts()[0].quantity, 2);
    await h.db().doc("products/test-flower").update({ price: 400000 });
    await assert.rejects(store.saveProducts(store.readProducts().map((item) => ({ ...item, price: 500000 }))), /thay đổi ở nơi khác/);
    await assert.rejects(inventory(db).api.saveProducts([original]), /thay đổi ở nơi khác/);
    assert.equal((await h.db().doc("products/test-flower").get()).data().price, 400000);
});

test("mất mạng/thu hồi quyền: không báo lưu thành công, không đổi cache hay Firestore", async () => {
    const db = env.authenticatedContext("admin-test", { admin: true }).firestore();
    const { api, context } = inventory(db);
    context.navigator.onLine = false;
    await assert.rejects(api.saveProducts([original]), /Mất kết nối/);
    assert.equal(api.readProducts().length, 0);
    context.navigator.onLine = true;
    // disableNetwork controls snapshot streams, but the transaction RPC can still reach
    // this emulator. Inject a transport error to exercise the failed-write path explicitly.
    context.__firebase.firestoreSdk = { ...sdk, runTransaction: async () => {
        throw Object.assign(new Error("Transport unavailable"), { code: "unavailable" });
    } };
    try {
        await assert.rejects(api.saveProducts([original]), /Mất kết nối/);
        assert.equal(api.readProducts().length, 0);
    } finally {
        context.__firebase.firestoreSdk = sdk;
    }
    await h.db().doc("adminRoles/admin-test").delete();
    await assert.rejects(api.saveProducts([original]), /không có quyền/);
    assert.equal(api.readProducts().length, 0);
    assert.equal((await h.db().doc("products/test-flower").get()).exists, false);
});

test("Rules: Admin/Owner CRUD; Customer/Guest không CRUD; chặn dữ liệu sai từ SDK", async () => {
    for (const db of [env.unauthenticatedContext().firestore(), env.authenticatedContext("customer").firestore()]) {
        await assertFails(sdk.setDoc(sdk.doc(db, "products/test-flower"), original));
    }
    for (const [uid, role] of [["admin-test", "admin"], ["owner-test", "owner"]]) {
        const db = env.authenticatedContext(uid, { admin: true, role }).firestore();
        const ref = sdk.doc(db, "products/test-flower");
        await assertSucceeds(sdk.setDoc(ref, original));
        for (const changes of [{ title: "   " }, { price: -1 }, { price: 1.5 }, { quantity: -1 }, { quantity: 0.5 }, { image: "" }, { description: "" }]) {
            await assertFails(sdk.updateDoc(ref, changes));
            await assertFails(sdk.setDoc(sdk.doc(db, "products/invalid"), { ...original, ...changes }));
        }
        const customer = env.authenticatedContext("customer").firestore();
        await assertFails(sdk.updateDoc(sdk.doc(customer, "products/test-flower"), { price: 999000 }));
        await assertFails(sdk.deleteDoc(sdk.doc(customer, "products/test-flower")));
        await assertSucceeds(sdk.updateDoc(ref, { quantity: 0, status: "hidden" }));
        await assertSucceeds(sdk.deleteDoc(ref));
    }
});
