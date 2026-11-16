// Unit test luồng đơn hàng của api/orders.js với Firestore giả (#125): báo giá, tạo đơn,
// chống đặt trùng, tra cứu, đơn của tài khoản và dọn đơn hết hạn. Transaction thật,
// Security Rules và đồng thời vẫn được tests/integration kiểm tra trên emulator.
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const path = require("node:path");
const { createRequire } = require("node:module");
const { fakeFirestore, loadHandler, call, adminRoles } = require("./helpers/fake-firestore");
const { Timestamp } = createRequire(path.join(__dirname, "../flower.com/package.json"))("firebase-admin/firestore");

// Chỉ dùng làm khóa HMAC cho giới hạn tạo đơn; không phải khóa thật.
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = "{\"unit\":\"test\"}";
process.env.CRON_SECRET = "unit-cron-secret";

const quiet = (t) => {
    const error = console.error;
    console.error = () => {};
    t.after(() => { console.error = error; });
};

function shop(overrides = {}) {
    return fakeFirestore({
        ...adminRoles,
        "products/1": { title: "Bó hồng", price: 250000, quantity: 5, status: "active", saleType: "ready_made", image: "./a.webp" },
        "products/2": { title: "Bó cúc", price: 180000, quantity: 1, status: "active", saleType: "ready_made" },
        "products/an": { title: "Bó ẩn", price: 100000, quantity: 9, status: "hidden" },
        "metadata/deliveryZones": { zones: [{ id: "z1", province: "Hà Nội", district: "Cầu Giấy", fee: 30000, enabled: true }] },
        "metadata/activePromotions": { items: [{ id: "p10", name: "Giảm 10%", discountPercent: 10, productIds: ["1"], active: true }] },
        ...overrides
    });
}

const deliveryDate = () => new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

async function quote(handler, body) {
    return call(handler, { method: "POST", body: { action: "quote", deliveryZoneId: "z1", ...body } });
}

function checkout(totals, overrides = {}) {
    return {
        customerName: "Nguyễn Văn A", phone: "0908123456", address: "147 Lê Lợi, Quận 1",
        deliveryDate: deliveryDate(), deliveryTime: "08:00–11:00", deliveryZoneId: "z1",
        paymentMethod: "cod", promotionId: "", idempotencyKey: randomUUID(), expectedTotals: totals,
        items: [{ id: "1", quantity: 2 }], ...overrides
    };
}

test("quote prices the cart on the server with promotion and delivery fee", async (t) => {
    quiet(t);
    const handler = loadHandler("api/orders.js", { db: shop() });
    const plain = await quote(handler, { items: [{ id: "1", quantity: 2 }] });
    assert.equal(plain.status, 200, JSON.stringify(plain.body));
    assert.deepEqual(plain.body.totals, { subtotal: 500000, savings: 0, tax: 0, wrappingFee: 0, shippingFee: 30000, total: 530000 });
    assert.equal(plain.body.deliveryZone.district, "Cầu Giấy");
    assert.equal(plain.body.items[0].unit, "bó");

    const promoted = await quote(handler, { items: [{ id: "1", quantity: 2 }], promotionId: "p10" });
    assert.equal(promoted.body.totals.savings, 50000);
    assert.equal(promoted.body.totals.total, 480000);
});

test("quote refuses invalid carts, hidden products and quantities above stock", async (t) => {
    quiet(t);
    const handler = loadHandler("api/orders.js", { db: shop() });
    assert.equal((await quote(handler, { items: [] })).status, 400);
    const hidden = await quote(handler, { items: [{ id: "an", quantity: 1 }] });
    assert.equal(hidden.status, 409);
    assert.equal(hidden.body.code, "product-unavailable");
    const short = await quote(handler, { items: [{ id: "2", quantity: 3 }, { id: "khong-co", quantity: 1 }] });
    assert.equal(short.status, 409);
    assert.equal(short.body.code, "insufficient-stock");
    assert.deepEqual(short.body.items.map((item) => item.available), [1, 0]);
    assert.match(short.body.error, /chỉ còn 1 sản phẩm.*đã hết hàng/);
    const noZone = await quote(handler, { items: [{ id: "1", quantity: 1 }], deliveryZoneId: "khong-co" });
    assert.equal(noZone.status, 409);
});

test("create order reserves stock, records the order and is idempotent", async (t) => {
    quiet(t);
    const db = shop();
    const handler = loadHandler("api/orders.js", { db });
    const { body: { totals } } = await quote(handler, { items: [{ id: "1", quantity: 2 }] });
    const body = checkout(totals);

    const created = await call(handler, { method: "POST", body });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.totals.total, 530000);
    const orderId = created.body.order.id;
    const order = db.data(`orders/${orderId}`);
    assert.equal(order.status, "Chờ xác nhận");
    assert.equal(order.inventoryState, "reserved");
    assert.equal(order.items[0].price, 250000, "đơn lưu giá tại lúc đặt");
    assert.equal(db.data("products/1").quantity, 3, "trừ 2 bó khỏi kho");

    const again = await call(handler, { method: "POST", body });
    assert.equal(again.body.order.id, orderId, "gửi lại cùng mã chống trùng trả lại đơn cũ");
    assert.equal(db.data("products/1").quantity, 3, "không trừ kho lần hai");

    const changed = await call(handler, { method: "POST", body: { ...body, idempotencyKey: randomUUID(), items: [{ id: "1", quantity: 1 }] } });
    assert.equal(changed.status, 409, "tổng tiền khách thấy khác giá máy chủ");
    assert.equal(changed.body.code, "price-changed");
});

test("create order rejects bad input before touching stock", async (t) => {
    quiet(t);
    const db = shop();
    const handler = loadHandler("api/orders.js", { db });
    const totals = { subtotal: 0, savings: 0, tax: 0, wrappingFee: 0, shippingFee: 30000, total: 30000 };
    assert.equal((await call(handler, { method: "POST", body: checkout(totals, { orderNote: "x".repeat(501) }) })).body.code, "note-too-long");
    assert.equal((await call(handler, { method: "POST", body: checkout(totals, { phone: "abc" }) })).body.code, "invalid-checkout");
    assert.equal((await call(handler, { method: "POST", body: checkout(totals, { items: [{ id: "1", quantity: 1000 }] }) })).status, 400);
    assert.equal(db.data("products/1").quantity, 5);
    assert.equal((await call(handler, { method: "PUT" })).status, 405);
    assert.equal((await call(handler, { method: "GET" })).status, 405);
});

test("lookup shows public tracking by order id and phone; accounts only see their own orders", async (t) => {
    quiet(t);
    const db = shop();
    const handler = loadHandler("api/orders.js", { db });
    const { body: { totals } } = await quote(handler, { items: [{ id: "1", quantity: 1 }] });
    const created = await call(handler, { method: "POST", body: checkout(totals, { items: [{ id: "1", quantity: 1 }] }), token: "user-token" });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.order.id;

    const lookup = (body, token) => call(handler, { method: "POST", body: { action: "lookup", ...body }, token });
    assert.equal((await lookup({ id, phone: "1" })).status, 400);
    assert.equal((await lookup({ id, phone: "0900000000" })).status, 404, "sai số điện thoại");
    const found = await lookup({ id: `#${id}`, phone: "0908 123 456" });
    assert.equal(found.status, 200);
    assert.equal(found.body.order.status, "Chờ xác nhận");
    assert.equal(JSON.stringify(found.body).includes("147 Lê Lợi"), false, "tra cứu công khai không lộ địa chỉ");

    const own = await lookup({ id }, "user-token");
    assert.equal(own.status, 200);
    assert.equal(own.body.order.address, "147 Lê Lợi, Quận 1");
    assert.equal((await lookup({ id }, "admin-token")).status, 404, "tài khoản khác không xem được");
    assert.equal((await lookup({ id }, "token-gia")).status, 401);
    assert.equal((await lookup({ id: "khong-co", phone: "0908123456" })).status, 404);

    const mine = await call(handler, { query: { action: "mine" }, token: "user-token" });
    assert.equal(mine.status, 200);
    assert.deepEqual(mine.body.orders.map((order) => order.id), [id]);
    assert.equal((await call(handler, { query: { action: "mine" } })).status, 401);
});

test("public lookup is rate limited per IP", async (t) => {
    quiet(t);
    const handler = loadHandler("api/orders.js", { db: shop() });
    let last;
    for (let index = 0; index < 21; index++) {
        last = await call(handler, { method: "POST", body: { action: "lookup", id: "khong-co", phone: "0908123456" } });
    }
    assert.equal(last.status, 429);
    assert.ok(Number(last.headers["retry-after"]) > 0);
});

test("expire releases stock of overdue reservations for the cron secret or an admin", async (t) => {
    quiet(t);
    const db = shop({
        "orders/het-han": {
            status: "Chờ xác nhận", paymentMethod: "cod", inventoryReserved: true, inventoryState: "reserved",
            reservationExpiresAt: Timestamp.fromMillis(Date.now() - 60_000), trackingHistory: [],
            items: [{ id: "1", productId: "1", quantity: 2, price: 250000 }]
        },
        "orders/con-han": {
            status: "Chờ xác nhận", paymentMethod: "cod", inventoryReserved: true, inventoryState: "reserved",
            reservationExpiresAt: Timestamp.fromMillis(Date.now() + 60 * 60_000), trackingHistory: [],
            items: [{ id: "2", productId: "2", quantity: 1, price: 180000 }]
        }
    });
    const handler = loadHandler("api/orders.js", { db });
    const expire = (token) => call(handler, { query: { action: "expire" }, token });

    assert.equal((await expire()).status, 401);
    assert.equal((await expire("user-token")).status, 403);
    const released = await expire("unit-cron-secret");
    assert.equal(released.status, 200);
    assert.equal(released.body.released, 1);
    assert.equal(db.data("products/1").quantity, 7, "hoàn 2 bó về kho");
    assert.equal(db.data("orders/het-han").inventoryReserved, false);
    assert.equal(db.data("orders/con-han").inventoryReserved, true, "đơn còn hạn giữ nguyên");
    assert.equal((await expire("admin-token")).body.released, 0, "chạy lại không hoàn kho lần nữa");
});
