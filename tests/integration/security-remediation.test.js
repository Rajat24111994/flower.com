const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const h = require("./helpers");
const { createLocalAccounts } = require("../../flower.com/lib/local-accounts");
const { createLocalServer } = require("../../flower.com/lib/local-server");
const profile = require("../helpers/local-profile");

test.beforeEach(async () => { await h.resetEmulators(); await h.seedProducts(); });

test("rotating IPs and idempotency keys cannot bypass the phone creation quota", async () => {
    const quote = await h.callApi("orders", { body: { action: "quote", items: [{ id: "1", quantity: 1 }], deliveryZoneId: "test-zone" } });
    const body = { customerName: "Audit customer", phone: "0908123456", address: "Test address", deliveryDate: h.deliveryDate(),
        deliveryTime: "08:00–11:00", deliveryZoneId: "test-zone", paymentMethod: "cod", expectedTotals: quote.body.totals, items: [{ id: "1", quantity: 1 }] };
    const responses = await Promise.all(Array.from({ length: 6 }, (_, i) => h.callApi("orders", {
        headers: { "x-forwarded-for": `198.51.100.${i}` }, body: { ...body, idempotencyKey: randomUUID() }
    })));
    assert.equal(responses.filter(r => r.status === 201).length, 3);
    assert.ok(responses.filter(r => r.status !== 201).every(r => r.status === 429));
    assert.equal(await h.stockOf("1"), 7);
    const orders = await h.db().collection("orders").get();
    const order = orders.docs[0].data();
    assert.ok(order.reservationExpiresAt.toMillis() - Date.now() <= 30 * 60000);
    const retry = await h.callApi("orders", { body: { ...body, idempotencyKey: (await h.db().collection("orderRequests").where("orderId", "==", orders.docs[0].id).get()).docs[0].id } });
    assert.equal(retry.status, 201, "a retry must remain safe after the quota is exhausted");
});

test("guest bulk reservation is rejected without consuming stock", async () => {
    const response = await h.placeOrder({ items: [{ id: "1", quantity: 10 }] });
    assert.equal(response.status, 400);
    assert.equal(response.body.code, "guest-quantity-limit");
    assert.equal(await h.stockOf("1"), 10);
});

test("removing the live admin role immediately blocks manual reservation cleanup", async () => {
    const admin = await h.createUser("admin");
    await h.db().doc(`adminRoles/${admin.uid}`).delete();
    assert.equal((await h.callApi("orders", { method: "GET", query: { action: "expire" }, token: admin.token })).status, 403);
    assert.equal((await h.callApi("orders", { method: "GET", query: { action: "expire" }, headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } })).status, 200);
});

test("local cookie binds orders to the owner and protects listing and lookup", async t => {
    const accounts = createLocalAccounts();
    const owner = accounts.register(profile());
    const other = accounts.register(profile({ email: "other@demo" }));
    const server = createLocalServer({ root: h.ROOT, localAccounts: accounts });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise(resolve => { server.close(() => { accounts.close(); resolve(); }); server.closeAllConnections(); }));
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = (body, sessionToken, url = "/api/orders") => fetch(base + url, {
        method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", Cookie: `flower_local_session=${sessionToken}` },
        ...(body ? { body: JSON.stringify(body) } : {}) });
    const quote = await h.callApi("orders", { body: { action: "quote", items: [{ id: "1", quantity: 1 }], deliveryZoneId: "test-zone" } });
    const placed = await call({ customerName: "Test", phone: "0908123456", address: "Test address", deliveryDate: h.deliveryDate(),
        deliveryTime: "08:00–11:00", deliveryZoneId: "test-zone", paymentMethod: "cod", idempotencyKey: randomUUID(),
        expectedTotals: quote.body.totals, items: [{ id: "1", quantity: 1 }], uid: other.account.uid }, owner.sessionToken);
    assert.equal(placed.status, 201);
    const id = (await placed.json()).order.id;
    assert.equal((await h.db().doc(`orders/${id}`).get()).get("uid"), owner.account.uid);
    assert.equal((await call({ action: "lookup", id }, owner.sessionToken)).status, 200);
    assert.equal((await call({ action: "lookup", id }, other.sessionToken)).status, 404);
    const listed = await call(null, owner.sessionToken, "/api/orders?action=mine");
    assert.equal((await listed.json()).orders[0].id, id);
    const empty = await call(null, other.sessionToken, "/api/orders?action=mine");
    assert.deepEqual((await empty.json()).orders, []);
    assert.equal((await call({ action: "lookup", id }, "forged")).status, 401);
    assert.equal((await call(null, "forged", "/api/orders?action=mine")).status, 401);
});
