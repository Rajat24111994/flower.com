// Unit test cho thân các hàm API với Firestore giả (#125). Kiểm tra quyền,
// nhánh lỗi và dữ liệu ghi xuống; hành vi trên Firestore thật nằm ở tests/integration.
const test = require("node:test");
const assert = require("node:assert/strict");
const { fakeFirestore, loadHandler, call, adminRoles } = require("./helpers/fake-firestore");

const configError = Object.assign(new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not configured."), { code: "admin-api-not-configured" });
const quiet = (t) => {
    const error = console.error;
    console.error = () => {};
    t.after(() => { console.error = error; });
};

const zone = (id, province, district, fee, enabled = true) => ({ id, province, district, fee, enabled });

test("delivery zones: public list hides disabled zones; manage view needs an active admin", async (t) => {
    quiet(t);
    const db = fakeFirestore({ ...adminRoles, "metadata/deliveryZones": { zones: [
        zone("cg", "Hà Nội", "Cầu Giấy", 30000), zone("hk", "Hà Nội", "Hoàn Kiếm", 25000, false), { id: "bad" }
    ] } });
    const handler = loadHandler("api/delivery-zones.js", { db });

    const publicList = await call(handler);
    assert.equal(publicList.status, 200);
    assert.deepEqual(publicList.body, { configured: true, zones: [zone("cg", "Hà Nội", "Cầu Giấy", 30000)] });

    assert.equal((await call(handler, { query: { manage: "1" } })).status, 401);
    assert.equal((await call(handler, { query: { manage: "1" }, token: "user-token" })).status, 403);
    const managed = await call(handler, { query: { manage: "1" }, token: "admin-token" });
    assert.equal(managed.status, 200);
    assert.equal(managed.body.zones.length, 2, "admin thấy cả khu vực đang tắt, bỏ dòng hỏng");
    assert.equal(managed.headers["cache-control"], "no-store");
});

test("delivery zones: upsert, duplicate area and delete are audited in one transaction", async (t) => {
    quiet(t);
    const db = fakeFirestore({ ...adminRoles });
    const handler = loadHandler("api/delivery-zones.js", { db });
    const post = (body, token = "admin-token") => call(handler, { method: "POST", body, token });

    assert.equal((await post({ action: "upsert", zone: zone("cg", "Hà Nội", "Cầu Giấy", 30000) }, "user-token")).status, 403);
    assert.equal((await post({ action: "rename" })).status, 400);
    assert.equal((await post({ action: "upsert", zone: zone("cg", "", "Cầu Giấy", 30000) })).status, 400);
    assert.equal((await post({ action: "upsert", zone: zone("cg", "Hà Nội", "Cầu Giấy", -1) })).status, 400);
    assert.equal((await post({ action: "delete", id: "có dấu" })).status, 400);

    const created = await post({ action: "upsert", zone: zone("cg", "Hà Nội", "Cầu Giấy", 30000) });
    assert.equal(created.status, 200);
    assert.deepEqual(created.body.zones, [zone("cg", "Hà Nội", "Cầu Giấy", 30000)]);

    const duplicate = await post({ action: "upsert", zone: zone("cg2", "hà nội", "cầu giấy", 20000) });
    assert.equal(duplicate.status, 409);
    assert.equal(db.data("metadata/deliveryZones").zones.length, 1, "khu vực trùng không được ghi");

    const removed = await post({ action: "delete", id: "cg" });
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.body, { configured: false, zones: [] });

    const audit = [...db.records].filter(([key]) => key.startsWith("adminAudit/")).map(([, value]) => value);
    assert.deepEqual(audit.map((entry) => entry.action), ["delivery-zone.upsert", "delivery-zone.delete"]);
    assert.equal(audit[1].details.before.district, "Cầu Giấy");
    assert.equal(audit[1].details.after, null);
});

test("delivery zones: wrong method, missing configuration and storage failure return JSON errors", async (t) => {
    quiet(t);
    const handler = loadHandler("api/delivery-zones.js", { db: fakeFirestore(adminRoles) });
    const wrong = await call(handler, { method: "DELETE" });
    assert.equal(wrong.status, 405);
    assert.equal(wrong.headers.allow, "GET, POST");

    const unconfigured = loadHandler("api/delivery-zones.js", { firestoreError: configError });
    assert.equal((await call(unconfigured)).status, 503);

    const noAuth = loadHandler("api/delivery-zones.js", { db: fakeFirestore(adminRoles), authError: configError });
    assert.equal((await call(noAuth, { query: { manage: "1" } })).status, 503);
    assert.equal((await call(noAuth, { method: "POST", body: { action: "delete", id: "x" } })).status, 503);

    const broken = fakeFirestore(adminRoles);
    broken.collection = (name) => name === "adminRoles"
        ? fakeFirestore(adminRoles).collection(name)
        : { doc: () => ({ get: async () => { throw Object.assign(new Error("down"), { code: 14 }); } }) };
    broken.runTransaction = async () => { throw Object.assign(new Error("down"), { code: 14 }); };
    const failing = loadHandler("api/delivery-zones.js", { db: broken });
    assert.equal((await call(failing)).body.code, "delivery-zone-service-unavailable");
    assert.equal((await call(failing, { method: "POST", token: "admin-token",
        body: { action: "delete", id: "cg" } })).body.code, "delivery-zone-service-unavailable");
});

test("bouquet wrapping is served through /api/delivery-zones?route=bouquet-wrapping", async (t) => {
    quiet(t);
    const db = fakeFirestore({ ...adminRoles });
    const handler = loadHandler("api/delivery-zones.js", { db });
    const route = (options) => call(handler, { ...options, query: { ...(options?.query || {}), route: "bouquet-wrapping" } });

    assert.deepEqual((await route()).body, { configured: false, tiers: [] });
    const tiers = [{ maxStems: 10, fee: 20000 }, { maxStems: 50, fee: 50000 }];
    assert.equal((await route({ method: "POST", body: { tiers }, token: "user-token" })).status, 403);
    assert.equal((await route({ method: "POST", body: { tiers: [{ maxStems: 10, fee: 1 }] }, token: "admin-token" })).status, 400,
        "bậc cuối phải phủ tới 50 cành");
    const saved = await route({ method: "POST", body: { tiers }, token: "admin-token" });
    assert.equal(saved.status, 200);
    assert.deepEqual(db.data("metadata/bouquetWrapping").tiers, tiers);
    assert.deepEqual((await route()).body, { configured: true, tiers });
    assert.equal((await call(handler, { query: { route: "khong-co" } })).status, 404);
});

test("admin users lists Firebase accounts with roles; audit route returns newest entries only to admins", async (t) => {
    quiet(t);
    const db = fakeFirestore({ ...adminRoles,
        "adminAudit/a": { action: "old", actorUid: "admin-uid", createdAt: new Date("2026-11-01T00:00:00Z") },
        "adminAudit/b": { action: "new", actorUid: "owner-uid", details: "không phải object", createdAt: new Date("2026-11-02T00:00:00Z") }
    });
    const auth = {
        ...require("./helpers/fake-firestore").fakeAuth(),
        listUsers: async (max, pageToken) => ({
            pageToken: pageToken ? undefined : "next",
            users: [
                { uid: "o", email: "o@x.test", providerData: [{ providerId: "password" }], metadata: {}, disabled: false, customClaims: { role: "owner", admin: true } },
                { uid: "a", providerData: [{ providerId: "google.com" }], metadata: { creationTime: "c", lastSignInTime: "l" }, disabled: true, customClaims: { admin: true } },
                { uid: "c", providerData: [], metadata: {}, disabled: false }
            ]
        })
    };
    const handler = loadHandler("api/admin/users.js", { db, auth });

    assert.equal((await call(handler, { method: "GET" })).status, 405);
    assert.equal((await call(handler, { method: "POST", token: "user-token" })).status, 403);
    assert.equal((await call(handler, { method: "POST", token: "admin-token", body: { pageToken: 5 } })).status, 400);
    const list = await call(handler, { method: "POST", token: "admin-token", body: {} });
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.users.map((user) => user.role), ["owner", "admin", "customer"]);
    assert.equal(list.body.nextPageToken, "next");
    assert.equal((await call(handler, { method: "POST", token: "admin-token", body: { pageToken: "next" } })).body.nextPageToken, null);

    const audit = await call(handler, { query: { route: "audit" }, token: "admin-token" });
    assert.equal(audit.status, 200);
    assert.deepEqual(audit.body.entries.map((entry) => entry.action), ["new", "old"]);
    assert.deepEqual(audit.body.entries[0].details, {}, "details không phải object bị bỏ");
    assert.equal((await call(handler, { query: { route: "audit" }, token: "user-token" })).status, 403);
    assert.equal((await call(handler, { method: "POST", query: { route: "audit" }, token: "admin-token" })).status, 405);

    const failingAuth = { ...auth, listUsers: async () => { throw Object.assign(new Error("x"), { code: "auth/internal-error" }); } };
    const failing = loadHandler("api/admin/users.js", { db, auth: failingAuth });
    assert.equal((await call(failing, { method: "POST", token: "admin-token", body: {} })).body.code, "user-list-failed");
    const unconfigured = loadHandler("api/admin/users.js", { firestoreError: configError });
    assert.equal((await call(unconfigured, { method: "POST" })).status, 503);
    assert.equal((await call(unconfigured, { query: { route: "audit" } })).status, 503);
});

test("products API hides hidden items publicly, repairs legacy catalog names/images and gates manage view", async (t) => {
    quiet(t);
    const db = fakeFirestore({ ...adminRoles,
        "products/vn-flower-01": { title: "B? hoa h?ng", image: "./img/p/GEN/lgwt/1.jpg", images: ["./img/p/GEN/lgwt/1.jpg", "./images/x.webp"], status: "active" },
        "products/an": { title: "Bó ẩn", status: "hidden", createdAt: new Date("2026-11-01T00:00:00Z") }
    });
    const handler = loadHandler("api/products.js", { db });

    const publicList = await call(handler);
    assert.equal(publicList.status, 200);
    assert.equal(publicList.body.products.length, 1);
    const [repaired] = publicList.body.products;
    assert.equal(repaired.title, "Bó Hoa Hồng Đỏ Nồng Nàn");
    assert.equal(repaired.image, "./images/products/product-flower-25.webp");
    assert.deepEqual(repaired.images, ["./images/x.webp"]);

    assert.equal((await call(handler, { query: { manage: "1" } })).status, 401);
    assert.equal((await call(handler, { query: { manage: "1" }, token: "user-token" })).status, 403);
    const managed = await call(handler, { query: { manage: "1" }, token: "admin-token" });
    assert.equal(managed.body.products.length, 2);
    assert.equal(managed.body.products.find((item) => item.id === "an").createdAt, "2026-11-01T00:00:00.000Z");
    assert.equal(managed.headers["cache-control"], "private, no-store");

    assert.equal((await call(handler, { method: "POST" })).status, 405);
    assert.equal((await call(loadHandler("api/products.js", { firestoreError: configError }))).status, 503);
    const broken = fakeFirestore();
    broken.collection = () => ({ get: async () => { throw new Error("down"); } });
    assert.equal((await call(loadHandler("api/products.js", { db: broken }))).body.code, "product-service-unavailable");
});

test("design requests: validation, token lookup, customer response and admin quote update", async (t) => {
    quiet(t);
    const { createHash } = require("node:crypto");
    const token = "a".repeat(43);
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const request = {
        accessTokenHash: tokenHash, status: "Chờ khách xác nhận", customerName: "Lan", phone: "0900000000",
        design: { size: "Vừa" }, stems: [], estimatedTotal: 100000, quotedTotal: 150000, history: [],
        createdAt: new Date("2026-11-01T00:00:00Z"), updatedAt: new Date("2026-11-01T00:00:00Z")
    };
    const db = fakeFirestore({ ...adminRoles, "designRequests/req1": request });
    const handler = loadHandler("api/design-requests.js", { db });

    assert.equal((await call(handler, { method: "PUT" })).status, 405);
    assert.equal((await call(handler, { query: { id: "req1" } })).status, 400);
    assert.equal((await call(handler, { query: { id: "nope", token } })).status, 404);
    assert.equal((await call(handler, { query: { id: "req1", token: "sai" } })).status, 404);
    const found = await call(handler, { query: { id: "req1", token } });
    assert.equal(found.status, 200);
    assert.equal(JSON.stringify(found.body).includes(tokenHash), false, "không trả bản băm mã truy cập");

    assert.equal((await call(handler, { query: { manage: "1" }, token: "user-token" })).status, 403);
    const managed = await call(handler, { query: { manage: "1" }, token: "admin-token" });
    assert.equal(managed.status, 200);

    assert.equal((await call(handler, { method: "POST", body: { action: "create" } })).status, 400);
    assert.equal((await call(handler, { method: "POST", body: { action: "respond", id: "req1", accessToken: token, response: "?" } })).status, 400);

    assert.equal((await call(handler, { method: "POST", token: "admin-token",
        body: { action: "admin-update", id: "req1", status: "Không có", quotedTotal: 1 } })).status, 400);
    const updated = await call(handler, { method: "POST", token: "admin-token",
        body: { action: "admin-update", id: "req1", status: "Chờ khách xác nhận", quotedTotal: 180000, quoteNote: "Thêm nơ" } });
    assert.equal(updated.status, 200);
    assert.equal(db.data("designRequests/req1").quotedTotal, 180000);
    assert.equal((await call(handler, { method: "POST", token: "admin-token",
        body: { action: "admin-update", id: "khong-co", status: "Chờ tư vấn" } })).status, 404);

    const respond = (response, accessToken = token) => call(handler, { method: "POST",
        body: { action: "respond", id: "req1", accessToken, response } });
    assert.equal((await respond("accept", "b".repeat(43))).status, 404, "sai mã truy cập");
    const accepted = await respond("accept");
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.request.status, "Đang thực hiện");
    assert.equal(db.data("designRequests/req1").customerResponse, "accept");
    assert.equal((await respond("reject")).status, 409, "đã phản hồi thì không còn báo giá chờ xác nhận");
    assert.equal((await call(handler, { method: "POST", body: { action: "lạ" } })).status, 400);
    assert.equal((await call(loadHandler("api/design-requests.js", { firestoreError: configError }))).status, 503);
});

test("flower prices (via /api/products?route=flower-prices): owner only, history and audited updates", async (t) => {
    quiet(t);
    const db = fakeFirestore({ ...adminRoles,
        "products/hong": { title: "Hoa hồng", saleType: "flower", unit: "cành", price: 15000, priceUpdatedByEmail: "owner@example.test" },
        "products/bo": { title: "Bó cưới", saleType: "ready_made", price: 900000 },
        "products/loi": { title: "Hoa lỗi", saleType: "flower", price: -5 }
    });
    const handler = loadHandler("api/products.js", { db });
    const prices = (options = {}) => call(handler, { ...options, query: { ...(options.query || {}), route: "flower-prices" } });

    assert.equal((await prices()).status, 401);
    assert.equal((await prices({ token: "admin-token" })).status, 403, "admin không phải owner");
    const list = await prices({ token: "owner-token" });
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.flowers.map((flower) => flower.flowerId).sort(), ["hong", "loi"]);

    assert.equal((await prices({ method: "PATCH", token: "owner-token", body: { flowerId: "hong", price: 500 } })).status, 400);
    assert.equal((await prices({ method: "PATCH", token: "owner-token", body: { flowerId: "bo", price: 20000 } })).status, 404);
    assert.equal((await prices({ method: "PATCH", token: "owner-token", body: { flowerId: "loi", price: 20000 } })).body.code, "invalid-current-price");
    assert.equal((await prices({ method: "PATCH", token: "owner-token", body: { flowerId: "hong", price: 15000 } })).body.changed, false);

    const updated = await prices({ method: "PATCH", token: "owner-token", body: { flowerId: "hong", price: 18000 } });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.flower.price, 18000);
    assert.equal(db.data("products/hong").price, 18000, "giá mới có hiệu lực ngay");
    const history = await prices({ token: "owner-token", query: { flowerId: "hong" } });
    assert.deepEqual(history.body.history.map((entry) => [entry.oldPrice, entry.newPrice]), [[15000, 18000]]);
    assert.equal([...db.records.keys()].filter((key) => key.startsWith("adminAudit/")).length, 1);
    assert.equal((await prices({ token: "owner-token", query: { flowerId: "a/b" } })).status, 400);
    assert.equal((await prices({ token: "owner-token", query: { flowerId: "khong-co" } })).status, 404);
    assert.equal((await prices({ method: "DELETE", token: "owner-token" })).status, 405);
});
