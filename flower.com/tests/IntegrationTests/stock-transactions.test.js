// Native C# HTTP requests with real SDK transactions on the demo Firestore Emulator.
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const h = require("./helpers");
const options = { timeout: 120_000, skip: !process.env.FLOWER_API_URL && "Requires test-api.cjs native C# host" };

test.beforeEach(async () => {
    if (!process.env.FLOWER_API_URL) return;
    await h.resetEmulators(); await h.seedProducts();
});

async function checkout(items = [{ id: "1", quantity: 1 }]) {
    const quote = await h.callApi("orders", { body: { action: "quote", items, deliveryZoneId: "test-zone" } });
    assert.equal(quote.status, 200, JSON.stringify(quote.body));
    return { customerName: "Khách kiểm thử", phone: "0908123456", address: "1 Lê Lợi",
        deliveryDate: h.deliveryDate(), deliveryTime: "11:00–14:00", deliveryZoneId: "test-zone",
        paymentMethod: "cod", idempotencyKey: randomUUID(), expectedTotals: quote.body.totals, items };
}

test("12 concurrent identical C# checkouts reserve stock and record idempotency once", options, async () => {
    const body = await checkout();
    const responses = await Promise.all(Array.from({ length: 12 }, () => h.callApi("orders", { body })));
    for (const response of responses) assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(new Set(responses.map(response => response.body.order.id)).size, 1);
    assert.equal(await h.stockOf("1"), 9);
    assert.equal((await h.db().collection("orders").get()).size, 1);
    assert.equal((await h.db().collection("orderRequests").get()).size, 1);
    const stored = (await h.db().doc(`orders/${responses[0].body.order.id}`).get()).data();
    assert.equal(stored.inventoryState, "reserved"); assert.equal(stored.inventoryReserved, true);
    assert.equal((await h.callApi("orders", { body: { ...body, address: "Địa chỉ khác" } })).status, 409);
    assert.equal(await h.stockOf("1"), 9);
});

test("five competing C# checkouts cannot oversell the final three products", options, async () => {
    await h.db().doc("products/1").update({ quantity: 3 });
    const body = await checkout();
    const replies = await Promise.all(Array.from({ length: 5 }, (_, index) => h.callApi("orders", {
        body: { ...body, idempotencyKey: randomUUID(), phone: `090812340${index}` }
    })));
    assert.deepEqual(replies.map(reply => reply.status).sort(), [201, 201, 201, 409, 409]);
    for (const reply of replies.filter(reply => reply.status === 409)) assert.equal(reply.body.code, "insufficient-stock");
    assert.equal(await h.stockOf("1"), 0);
    assert.equal((await h.db().collection("orders").get()).size, 3);
    assert.equal((await h.db().collection("orderRequests").get()).size, 3);
});

test("multi-product checkout failure rolls back stock, orders and idempotency", options, async () => {
    const body = await checkout([{ id: "1", quantity: 2 }, { id: "2", quantity: 2 }]);
    await h.db().doc("products/2").update({ quantity: 1 });
    const response = await h.callApi("orders", { body });
    assert.equal(response.status, 409); assert.equal(response.body.code, "insufficient-stock");
    assert.equal(await h.stockOf("1"), 10); assert.equal(await h.stockOf("2"), 1);
    assert.equal((await h.db().collection("orders").get()).size, 0);
    assert.equal((await h.db().doc(`orderRequests/${body.idempotencyKey}`).get()).exists, false);
    // Correcting stock permits the same previously uncommitted key to succeed.
    await h.db().doc("products/2").update({ quantity: 2 });
    assert.equal((await h.callApi("orders", { body })).status, 201);
    assert.equal(await h.stockOf("1"), 8); assert.equal(await h.stockOf("2"), 0);
});

test("concurrent expiry restores aggregated stock once and never releases paid holds", options, async () => {
    const body = await checkout([{ id: "first", productId: "1", quantity: 2 }, { id: "second", productId: "1", quantity: 1 }]);
    const placed = await h.callApi("orders", { body });
    assert.equal(placed.status, 201, JSON.stringify(placed.body));
    const ref = h.db().doc(`orders/${placed.body.order.id}`);
    await ref.update({ reservationExpiresAt: h.Timestamp.fromMillis(Date.now() - 1000) });
    const cleanup = () => h.callApi("orders", { method: "GET", query: { action: "expire" },
        headers: { authorization: "Bearer test-cron-secret" } });
    const responses = await Promise.all(Array.from({ length: 6 }, cleanup));
    for (const response of responses) assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(responses.reduce((count, response) => count + response.body.released, 0), 1);
    assert.equal(await h.stockOf("1"), 10);
    const expired = (await ref.get()).data();
    assert.equal(expired.inventoryReserved, false); assert.equal(expired.inventoryState, "released");
    assert.equal(expired.status, "Đã hủy");
    assert.equal((await cleanup()).body.released, 0);
    const paid = await h.placeOrder({ items: [{ id: "2", quantity: 2 }], paymentMethod: "qr" });
    assert.equal(paid.status, 201);
    const paidRef = h.db().doc(`orders/${paid.body.order.id}`);
    await paidRef.update({ paymentVerified: true, paymentStatus: "Đã thanh toán",
        reservationExpiresAt: h.Timestamp.fromMillis(Date.now() - 1000) });
    assert.equal((await cleanup()).body.released, 0);
    assert.equal(await h.stockOf("2"), 8);
    assert.equal((await paidRef.get()).data().inventoryReserved, true);
});
