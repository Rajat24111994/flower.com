const test = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");
test.beforeEach(async () => { await h.resetEmulators(); await h.seedProducts(); });
test("removed VNPay checkout cannot create orders or reserve stock", async () => {
 const result = await h.placeOrder({ paymentMethod: "vnpay" });
 assert.equal(result.status, 400);
 assert.equal((await h.db().collection("orders").get()).size, 0);
 assert.equal(await h.stockOf("1"), 10);
});
test("removed payment routes cannot confirm a QR order", async () => {
 const placed = await h.placeOrder({ paymentMethod: "qr" });
 assert.equal(placed.status, 201, JSON.stringify(placed.body));
 const orderId = placed.body.order.id;
 assert.equal((await h.callApi("payments", { body: { action: "create", orderId } })).status, 410);
 assert.equal((await h.callApi("vnpayIpn", { method: "GET", query: { vnp_ResponseCode: "00", vnp_TxnRef: orderId } })).status, 410);
 const order = (await h.db().doc('orders/' + orderId).get()).data();
 assert.equal(order.paymentVerified, false);
 assert.equal(order.paymentMethod, "qr");
});
