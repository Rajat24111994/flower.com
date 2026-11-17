const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { initializeTestEnvironment, assertFails } = require("@firebase/rules-unit-testing");
const { setDoc, doc } = require("firebase/firestore");
const h = require("./helpers");
const enabled = Boolean(process.env.FLOWER_API_URL);
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
function date(offset) { const value = new Date(`${today()}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + offset); return value.toISOString().slice(0, 10); }
const rule = (overrides = {}) => ({ id: "global", name: "Giảm theo ngày", enabled: true, scope: "all", productIds: [], startAfterDays: 1, dailyDiscountPercent: 10, minPrice: 10000, ...overrides });
const api = (owner, body) => h.callApi("wiltingPrices", { token: owner.token, body });
const save = (owner, rules = [rule()], expectedRevision = 0, active = true) => api(owner, { action: "save-rules", enabled: active, rules, expectedRevision });
const received = (owner, productId = "1", receivedDate = date(-1), expectedReceivedDate = "") => api(owner, { action: "set-received-date", productId, receivedDate, expectedReceivedDate });
const quote = (items = [{ id: "1", quantity: 1 }]) => h.callApi("orders", { body: { action: "quote", items, deliveryZoneId: "test-zone" } });
const checkout = totals => ({ customerName: "Khách giá héo", phone: "0908123456", address: "147 Lê Lợi", deliveryDate: h.deliveryDate(), deliveryTime: "08:00–11:00", deliveryZoneId: "test-zone", paymentMethod: "cod", idempotencyKey: randomUUID(), items: [{ id: "1", quantity: 1 }], expectedTotals: totals });

test.beforeEach(async () => { if (enabled) { await h.resetEmulators(); await h.seedProducts(); } });

test("wilting defaults off and only a live Owner can configure it", { skip: !enabled }, async () => {
    const owner = await h.createUser("owner"), admin = await h.createUser("admin"), customer = await h.createUser();
    assert.equal((await h.callApi("wiltingPrices", { method: "GET" })).status, 401);
    for (const user of [admin, customer]) {
        assert.equal((await h.callApi("wiltingPrices", { method: "GET", token: user.token })).status, 403);
        assert.equal((await save(user)).status, 403);
    }
    const config = await h.callApi("wiltingPrices", { method: "GET", token: owner.token });
    assert.deepEqual(config.body.settings, { enabled: false, revision: 0, rules: [] });
    assert.equal((await quote()).body.items[0].price, 250000);
    assert.equal((await h.db().doc("metadata/wiltingPricing").get()).exists, false);
    await h.db().doc(`adminRoles/${owner.uid}`).delete();
    assert.equal((await save(owner)).status, 403);
});

test("wilting price is per item, promotions follow it and order snapshots stay unchanged", { skip: !enabled }, async () => {
    const owner = await h.createUser("owner");
    assert.equal((await received(owner)).status, 200);
    assert.equal((await save(owner)).status, 200);
    const publicList = await h.callApi("products", { method: "GET" });
    const flower = publicList.body.products.find(product => String(product.id) === "1");
    assert.equal(flower.price, 225000); assert.equal(flower.basePrice, 250000);
    assert.equal(flower.wiltingPricing.ruleId, "global");
    const manage = await h.callApi("products", { method: "GET", query: { manage: "1" }, token: owner.token });
    assert.equal(manage.body.products.find(product => String(product.id) === "1").price, 250000);
    await h.setPromotions([{ id: "p10", active: true, allProducts: true, discountPercent: 10 }]);
    const placed = await h.placeOrder({ promotionId: "p10" });
    assert.equal(placed.status, 201, JSON.stringify(placed.body));
    assert.equal(placed.body.totals.total, 202500);
    const ref = h.db().doc(`orders/${placed.body.order.id}`);
    const original = (await ref.get()).data();
    assert.equal(original.items[0].price, 225000);
    assert.equal(original.items[0].wiltingPricing.basePrice, 250000);
    assert.equal(original.items[0].wiltingPricing.revision, 1);
    assert.equal(await h.stockOf("1"), 9);
    assert.equal((await save(owner, [rule({ dailyDiscountPercent: 20 })], 1)).status, 200);
    assert.deepEqual((await ref.get()).data(), original);
    assert.equal((await h.db().doc("products/1").get()).data().price, 250000);
    assert.equal((await h.db().collection("adminAudit").where("action", "==", "wilting.rules.updated").get()).size, 2);
});

test("wilting rules honor product > group > all and never require buying the entire group", { skip: !enabled }, async () => {
    const owner = await h.createUser("owner");
    for (const id of ["1", "2", "3"]) await received(owner, id);
    const rules = [rule(), rule({ id: "group", scope: "group", productIds: ["1", "2"], dailyDiscountPercent: 20 }), rule({ id: "one", scope: "product", productIds: ["1"], dailyDiscountPercent: 30 })];
    assert.equal((await save(owner, rules)).status, 200);
    assert.equal((await quote()).body.items[0].price, 175000);
    assert.equal((await quote([{ id: "2", quantity: 1 }])).body.items[0].price, 200000);
    assert.equal((await quote([{ id: "3", quantity: 1 }])).body.items[0].price, 225000);
    assert.equal((await save(owner, [rule({ minPrice: 240000 })], 1)).status, 200);
    assert.equal((await quote()).body.items[0].price, 240000);
});

test("changing wilting rules or received dates invalidates stale checkout without reserving stock", { skip: !enabled }, async () => {
    const owner = await h.createUser("owner"); await received(owner); await save(owner);
    const totals = (await quote()).body.totals;
    await save(owner, [rule({ dailyDiscountPercent: 20 })], 1);
    const changed = await h.callApi("orders", { body: checkout(totals) });
    assert.equal(changed.status, 409); assert.equal(changed.body.code, "price-changed");
    assert.equal(await h.stockOf("1"), 10);
    assert.equal((await h.db().collection("orders").get()).size, 0);
    const freshQuote = (await quote()).body.totals;
    await received(owner, "1", today(), date(-1));
    assert.equal((await h.callApi("orders", { body: checkout(freshQuote) })).body.code, "price-changed");
    const latest = checkout((await quote()).body.totals);
    const first = await h.callApi("orders", { body: latest });
    const retry = await h.callApi("orders", { body: latest });
    assert.equal(first.status, 201); assert.deepEqual(retry.body, first.body);
    assert.equal(await h.stockOf("1"), 9);
});

test("wilting settings reject unsafe input, overlaps, future dates and stale concurrent edits", { skip: !enabled }, async () => {
    const owner = await h.createUser("owner");
    for (const bad of [rule({ dailyDiscountPercent: "10" }), rule({ minPrice: -1 }), rule({ scope: "product", productIds: [] }), rule({ scope: "group", productIds: ["missing"] })])
        assert.equal((await save(owner, [bad])).status, 400);
    assert.equal((await save(owner, [rule(), rule({ id: "duplicate" })])).status, 400);
    assert.equal((await received(owner, "1", date(1))).status, 400);
    assert.equal((await received(owner, "../bad")).status, 400);
    const results = await Promise.all([save(owner), save(owner, [rule({ dailyDiscountPercent: 20 })])]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    assert.equal((await h.db().collection("adminAudit").where("action", "==", "wilting.rules.updated").get()).size, 1);
    assert.equal((await received(owner)).status, 200);
    assert.equal((await received(owner, "1", today())).status, 409);
    assert.equal((await received(owner, "1", "", date(-1))).status, 200);
    assert.equal((await quote()).body.items[0].price, 250000);
});

test("wilting settings and freshness cannot be changed directly through the client SDK", { skip: !enabled }, async () => {
    const [host, port] = h.FIRESTORE_HOST.split(":");
    const env = await initializeTestEnvironment({ projectId: h.PROJECT_ID, firestore: { host, port: Number(port), rules: fs.readFileSync(path.join(h.ROOT, "firestore.rules"), "utf8") } });
    try {
        await h.db().doc("adminRoles/owner-client").set({ role: "owner" });
        const db = env.authenticatedContext("owner-client", { admin: true, role: "owner" }).firestore();
        await assertFails(setDoc(doc(db, "metadata/wiltingPricing"), { enabled: true, rules: [] }));
        await assertFails(setDoc(doc(db, "productFreshness/1"), { receivedDate: date(-1) }));
    } finally { await env.cleanup(); }
});

test("design requests use wilting estimates without reserving inventory", { skip: !enabled }, async () => {
    const owner = await h.createUser("owner"); await received(owner); await save(owner);
    await h.db().doc("products/1").update({ saleType: "flower" });
    await h.db().doc("metadata/bouquetWrapping").set({ tiers: [{ maxStems: 50, fee: 20000 }] });
    const result = await h.callApi("designRequests", { body: { action: "create", customerName: "Khách", phone: "0908123456", address: "Hà Nội", deliveryDate: h.deliveryDate(), deliveryTime: "08:00–11:00", deliveryZoneId: "test-zone", stems: [{ productId: "1", quantity: 2, color: "hồng", role: "main" }], design: {} } });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    assert.equal(result.body.request.estimatedTotal, 470000);
    const stored = (await h.db().doc(`designRequests/${result.body.request.id}`).get()).data();
    assert.equal(stored.stems[0].wiltingPricing.price, 225000);
    assert.equal(await h.stockOf("1"), 10);
});

test("QR preserves the saved wilting order total even after rules change", { skip: !enabled }, async () => {
    const owner = await h.createUser("owner"); await received(owner); await save(owner);
    const placed = await h.placeOrder({ paymentMethod: "qr" });
    assert.equal(placed.status, 201, JSON.stringify(placed.body));
    await save(owner, [rule({ dailyDiscountPercent: 50 })], 1);
    const stored = (await h.db().doc(`orders/${placed.body.order.id}`).get()).data();
    assert.equal(stored.total, 225000);
    assert.equal(stored.paymentMethod, "qr");
    assert.equal(stored.paymentVerified, false);
});
