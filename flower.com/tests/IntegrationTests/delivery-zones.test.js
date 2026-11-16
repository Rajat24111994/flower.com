const test = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");

test.beforeEach(async () => {
    await h.resetEmulators();
    await h.seedProducts();
});

test("owner/admin API manages configured zones and server quote applies stored fees", async () => {
    const customer = await h.createUser();
    const denied = await h.callApi("deliveryZones", {
        method: "POST",
        token: customer.token,
        body: {
            action: "upsert",
            zone: { id: "test-zone", province: "Test Province", district: "Test District", fee: 45000, enabled: true }
        }
    });
    assert.equal(denied.status, 403);

    const admin = await h.createUser("admin");
    const saved = await h.callApi("deliveryZones", {
        method: "POST",
        token: admin.token,
        body: {
            action: "upsert",
            zone: { id: "test-zone", province: "Test Province", district: "Test District", fee: 45000, enabled: true }
        }
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.zones[0].fee, 45000);

    const publicZones = await h.callApi("deliveryZones", { method: "GET" });
    assert.deepEqual(publicZones.body.zones.map((zone) => zone.id), ["test-zone"]);
    const order = await h.placeOrder();
    assert.equal(order.status, 201, JSON.stringify(order.body));
    const stored = (await h.db().doc(`orders/${order.body.order.id}`).get()).data();
    assert.equal(stored.shippingFee, 45000);
    assert.equal(stored.total, stored.subtotal - stored.savings + 45000);
});

test("disabled configured zones cannot be selected for a quote", async () => {
    await h.db().doc("metadata/deliveryZones").set({
        zones: [{ id: "off-zone", province: "Test Province", district: "Test District", fee: 0, enabled: false }]
    });
    const result = await h.callApi("orders", {
        body: { action: "quote", items: [{ id: "1", quantity: 1 }], deliveryZoneId: "off-zone" }
    });
    assert.equal(result.status, 409);
    assert.equal(result.body.code, "delivery-zone-unavailable");
});
