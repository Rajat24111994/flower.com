// Feature tests: đặt hàng (báo giá, tạo đơn, giữ kho, hết hạn, tra cứu) through the real API.
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const h = require("./helpers");

const { Timestamp } = h;

test.beforeEach(async () => {
    await h.resetEmulators();
    await h.seedProducts();
});

test("báo giá trả tổng tiền, giá từng sản phẩm và tồn kho", async () => {
    const quote = await h.callApi("orders", { body: { action: "quote", items: [{ id: "1", quantity: 2 }] } });
    assert.equal(quote.status, 200);
    assert.equal(quote.body.items[0].price, h.catalog.find((item) => item.id === 1).price);
    assert.equal(quote.body.totals.subtotal, quote.body.items[0].price * 2);
    assert.equal(quote.body.totals.total, quote.body.totals.subtotal);
    assert.equal(quote.body.items[0].stock, 10);
});

test("đặt đơn COD: lưu đơn, trừ kho, trạng thái chờ xác nhận", async () => {
    const result = await h.placeOrder({ items: [{ id: "1", quantity: 3 }] });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    const order = (await h.db().doc(`orders/${result.body.order.id}`).get()).data();
    assert.equal(order.status, "Chờ xác nhận");
    assert.equal(order.paymentMethod, "cod");
    assert.equal(order.inventoryState, "reserved");
    assert.equal(order.total, result.quote.body.totals.total);
    assert.equal(order.uid, "");
    assert.equal(await h.stockOf("1"), 7);
});

test("gửi lại cùng một yêu cầu đặt hàng không tạo đơn thứ hai", async () => {
    const quote = await h.callApi("orders", { body: { action: "quote", items: [{ id: "2", quantity: 1 }] } });
    const body = {
        customerName: "Khách", phone: "0908123456", address: "1 Lê Lợi", deliveryDate: h.deliveryDate(),
        deliveryTime: "12:00–16:00", paymentMethod: "cod", idempotencyKey: randomUUID(),
        expectedTotals: quote.body.totals, items: [{ id: "2", quantity: 1 }]
    };
    const first = await h.callApi("orders", { body });
    const second = await h.callApi("orders", { body });
    assert.equal(first.status, 201);
    assert.equal(second.body.order.id, first.body.order.id);
    assert.equal((await h.db().collection("orders").get()).size, 1);
    assert.equal(await h.stockOf("2"), 9);
});

test("giá thay đổi sau khi báo giá thì không đặt được đơn", async () => {
    const result = await h.placeOrder({ overrides: { expectedTotals: { subtotal: 1, savings: 0, tax: 0, total: 1 } } });
    assert.equal(result.status, 409);
    assert.equal(result.body.code, "price-changed");
    assert.equal(await h.stockOf("1"), 10);
});

test("thiếu hàng: báo rõ sản phẩm nào còn bao nhiêu", async () => {
    await h.db().doc("products/6").update({ quantity: 1 });
    const quote = await h.callApi("orders", { body: { action: "quote", items: [{ id: "6", quantity: 3 }] } });
    assert.equal(quote.status, 409);
    assert.equal(quote.body.code, "insufficient-stock");
    assert.deepEqual(quote.body.items.map(({ id, available }) => ({ id, available })), [{ id: "6", available: 1 }]);
});

test("ghi chú quá 500 ký tự bị từ chối, không bị cắt", async () => {
    const result = await h.placeOrder({ overrides: { orderNote: "a".repeat(501) } });
    assert.equal(result.status, 400);
    assert.equal(result.body.code, "note-too-long");
});

test("sản phẩm chưa đổi giá (còn lưu USD) vẫn được tính đúng bằng VND", async () => {
    await h.db().doc("products/1").update({ price: 73.99 });
    const quote = await h.callApi("orders", { body: { action: "quote", items: [{ id: "1", quantity: 1 }] } });
    assert.equal(quote.body.items[0].price, 1920000);
    assert.equal(quote.body.totals.total, 1920000);
});

test("ưu đãi: máy chủ tính giảm giá và lưu vào đơn", async () => {
    await h.setPromotions([{ id: "p20", name: "Giảm 20%", discountPercent: 20, active: true, allProducts: true, productIds: [] }]);
    const result = await h.placeOrder({ items: [{ id: "1", quantity: 2 }], promotionId: "p20" });
    assert.equal(result.status, 201);
    const order = (await h.db().doc(`orders/${result.body.order.id}`).get()).data();
    assert.equal(order.promotionId, "p20");
    assert.ok(order.savings > 0);
    assert.equal(order.total, order.subtotal - order.savings);
    const expired = await h.placeOrder({ promotionId: "khong-co" });
    assert.equal(expired.body.code, "invalid-promotion");
});

test("đơn QR quá 30 phút chưa trả tiền: tự hủy và trả hàng về kho", async () => {
    const result = await h.placeOrder({ items: [{ id: "3", quantity: 2 }], paymentMethod: "qr" });
    const id = result.body.order.id;
    assert.equal(await h.stockOf("3"), 8);
    await h.db().doc(`orders/${id}`).update({ reservationExpiresAt: Timestamp.fromMillis(Date.now() - 1000) });
    const cron = await h.callApi("orders", { method: "GET", query: { action: "expire" }, headers: { authorization: "Bearer test-cron-secret" } });
    assert.equal(cron.status, 200);
    assert.equal(cron.body.released, 1);
    const order = (await h.db().doc(`orders/${id}`).get()).data();
    assert.equal(order.status, "Đã hủy");
    assert.equal(order.inventoryState, "released");
    assert.equal(await h.stockOf("3"), 10);
});

test("đơn QR đã xác nhận tiền thì không bị hủy khi hết hạn", async () => {
    const result = await h.placeOrder({ paymentMethod: "qr" });
    const id = result.body.order.id;
    await h.db().doc(`orders/${id}`).update({ paymentVerified: true, reservationExpiresAt: Timestamp.fromMillis(Date.now() - 1000) });
    await h.callApi("orders", { method: "GET", query: { action: "expire" }, headers: { authorization: "Bearer test-cron-secret" } });
    assert.equal((await h.db().doc(`orders/${id}`).get()).data().status, "Chờ xác nhận");
});

test("tra cứu bằng mã đơn và số điện thoại", async () => {
    const result = await h.placeOrder({ paymentMethod: "qr" });
    const id = result.body.order.id;
    const found = await h.callApi("orders", { body: { action: "lookup", id, phone: "0908 123 456" } });
    assert.equal(found.status, 200);
    assert.equal(found.body.order.status, "Chờ xác nhận");
    assert.equal(found.body.order.total, result.quote.body.totals.total);
    const wrongPhone = await h.callApi("orders", { body: { action: "lookup", id, phone: "0999999999" } });
    assert.equal(wrongPhone.status, 404);
});
