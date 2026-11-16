const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const h = require("./helpers");
const enabled = Boolean(process.env.FLOWER_API_URL);

test.beforeEach(async () => { if (enabled) { await h.resetEmulators(); await h.seedProducts(); } });

// Exercise an actual rollout boundary: an order created by JS must be safely retryable
// against C#, including the exact existing requestHash and unchanged inventory.
test("ASP.NET accepts a retry of an order created by the legacy JS backend", { skip: !enabled }, async () => {
    const quote = await h.callApi("orders", { body: { action: "quote", items: [{ id: "1", quantity: 2 }], deliveryZoneId: "test-zone" } });
    const body = { customerName: "Nguyễn Văn A", phone: "0908123456", address: "147 Lê Lợi",
        deliveryDate: h.deliveryDate(), deliveryTime: "08:00–11:00", deliveryZoneId: "test-zone", paymentMethod: "cod",
        promotionId: "", idempotencyKey: randomUUID(), expectedTotals: quote.body.totals, items: [{ id: "1", quantity: 2 }] };
    let status, legacy;
    const res = { setHeader() {}, status(value) { status = value; return res; }, json(value) { legacy = value; } };
    await require("../../legacy-node/api/orders.js")({ method: "POST", headers: { "x-forwarded-for": "127.0.0.1" }, body, query: {} }, res);
    assert.equal(status, 201);
    const retried = await h.callApi("orders", { body });
    assert.equal(retried.status, 201, JSON.stringify(retried.body));
    assert.deepEqual(retried.body, legacy);
    assert.equal(await h.stockOf("1"), 8);
    assert.equal((await h.db().collection("orders").get()).size, 1);
});

test("ASP.NET preserves wrapping configuration and strict JSON field validation", { skip: !enabled }, async () => {
    const admin = await h.createUser("admin");
    const tiers = [{ maxStems: 10, fee: 25000 }, { maxStems: 50, fee: 50000 }];
    assert.equal((await h.callApi("bouquetWrapping", { method: "GET" })).body.configured, false);
    assert.equal((await h.callApi("bouquetWrapping", { body: { tiers } })).status, 401);
    assert.equal((await h.callApi("bouquetWrapping", { token: admin.token, body: { tiers } })).status, 200);
    assert.deepEqual((await h.callApi("bouquetWrapping", { method: "GET" })).body, { configured: true, tiers });
    assert.equal((await h.callApi("bouquetWrapping", { token: admin.token, body: { tiers: [{ maxStems: 50, fee: "50000" }] } })).status, 400);
    for (const pageToken of [123, [], {}, "x".repeat(2049)]) {
        assert.equal((await h.callApi("adminUsers", { token: admin.token, body: { pageToken } })).status, 400);
    }
    const users = await h.callApi("adminUsers", { token: admin.token });
    assert.equal(users.status, 200);
    assert.equal(users.body.nextPageToken, null);
    assert.match(users.body.users[0].creationTime, /GMT$/);
});

test("ASP.NET ignores spoofed forwarding headers for order lookup limits", { skip: !enabled }, async () => {
    const placed = await h.placeOrder();
    const body = { action: "lookup", id: placed.body.order.id, phone: "0908123456" };
    for (let i = 0; i < 20; i++) {
        assert.equal((await h.callApi("orders", { body, headers: { "x-forwarded-for": `203.0.113.${i + 1}` } })).status, 200);
    }
    const blocked = await h.callApi("orders", { body, headers: { "x-forwarded-for": "198.51.100.99", "x-real-ip": "198.51.100.99" } });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers["retry-after"]) > 0);
});

test("ASP.NET writes Firestore integer fields with the existing types", { skip: !enabled }, async () => {
    const placed = await h.placeOrder({ paymentMethod: "vnpay" });
    assert.equal(placed.status, 201);
    // REST representation distinguishes Firestore integers from doubles; JS SDK numbers do not.
    const admin = await h.createUser("admin");
    const response = await fetch(`http://${h.FIRESTORE_HOST}/v1/projects/${h.PROJECT_ID}/databases/(default)/documents/orders/${placed.body.order.id}`, {
        headers: { authorization: `Bearer ${admin.token}` }
    });
    assert.equal(response.status, 200, await response.clone().text());
    const document = await response.json();
    assert.equal(document.fields.total.integerValue, String(placed.body.totals.total));
    assert.equal(document.fields.items.arrayValue.values[0].mapValue.fields.quantity.integerValue, "1");
});
