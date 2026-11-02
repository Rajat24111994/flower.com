// Unit tests: what the order API accepts from the browser.
const test = require("node:test");
const assert = require("node:assert/strict");
const { internals } = require("../flower.com/api/orders.js");

const { validateCheckout, validateQuote, normalizePhone, aggregateItems, publicTrackingOrder, reviewIdForOrder } = internals;

function tomorrow() {
    return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function checkout(overrides = {}) {
    return {
        customerName: "Nguyễn Văn A",
        phone: "0908 123 456",
        address: "147 Lê Lợi, Quận 1",
        deliveryDate: tomorrow(),
        deliveryTime: "08:00–12:00",
        paymentMethod: "cod",
        idempotencyKey: "1b4e28ba-2fa1-4d3b-a3f5-ef19b5a7633b",
        expectedTotals: { subtotal: 100, savings: 0, tax: 0, total: 100 },
        items: [{ id: "1", quantity: 2 }],
        ...overrides
    };
}

test("normalizePhone() chỉ giữ chữ số", () => {
    assert.equal(normalizePhone("+84 908-123-456"), "84908123456");
    assert.equal(normalizePhone(null), "");
});

test("validateCheckout() nhận đơn hợp lệ và chuẩn hóa dữ liệu", () => {
    const result = validateCheckout(checkout({ paymentReference: "FF<script>12" }));
    assert.ok(result);
    assert.equal(result.recipientName, "Nguyễn Văn A");
    assert.equal(result.recipientPhone, "0908 123 456");
    assert.equal(result.giftWrap, "none");
    assert.equal(result.paymentReference, "FFscript12");
    assert.deepEqual(result.items, [{ id: "1", quantity: 2 }]);
});

test("validateCheckout() từ chối thông tin khách thiếu hoặc sai", () => {
    for (const overrides of [
        { customerName: "" },
        { customerName: "x".repeat(101) },
        { address: "" },
        { phone: "123" },
        { recipientPhone: "12" },
        { paymentMethod: "card" },
        { idempotencyKey: "not-a-uuid" },
        { deliveryDate: "2020-01-01" },
        { deliveryDate: "2026-02-30" },
        { deliveryTime: "23:00" },
        { giftWrap: "gold" },
        { greetingCard: "x".repeat(301) }
    ]) {
        assert.equal(validateCheckout(checkout(overrides)), null, JSON.stringify(overrides));
    }
});

test("validateCheckout() từ chối danh sách sản phẩm và tổng tiền sai", () => {
    for (const overrides of [
        { items: [] },
        { items: [{ id: "1", quantity: 0 }] },
        { items: [{ id: "1", quantity: 1.5 }] },
        { items: [{ id: "1", quantity: 51 }] },
        { items: [{ id: "1", quantity: 1 }, { id: "1", quantity: 1 }] },
        { items: [{ id: "../orders/x", quantity: 1 }] },
        { items: Array.from({ length: 51 }, (_, index) => ({ id: String(index), quantity: 1 })) },
        { expectedTotals: null },
        { expectedTotals: { subtotal: 1, savings: 0, tax: 0, total: -1 } },
        { expectedTotals: { subtotal: 1.5, savings: 0, tax: 0, total: 1.5 } }
    ]) {
        assert.equal(validateCheckout(checkout(overrides)), null, JSON.stringify(overrides).slice(0, 80));
    }
});

test("validateQuote() kiểm tra sản phẩm giống như khi đặt hàng", () => {
    assert.deepEqual(validateQuote({ items: [{ id: 6, quantity: "3" }] }), { items: [{ id: "6", quantity: 3 }], promotionId: "" });
    assert.equal(validateQuote({ items: [{ id: "6", quantity: -1 }] }), null);
    assert.equal(validateQuote({}), null);
});

test("aggregateItems() gộp cùng sản phẩm để trừ kho đúng", () => {
    assert.deepEqual(aggregateItems([{ id: 1, quantity: 2 }, { id: "1", quantity: 3 }, { id: 2 }]), [
        { id: "1", quantity: 5 },
        { id: "2", quantity: 1 }
    ]);
});

test("tra cứu công khai không lộ tên, số điện thoại, địa chỉ", () => {
    const order = publicTrackingOrder("abc", {
        status: "Đang giao",
        customerName: "Nguyễn Văn A",
        phone: "0908123456",
        address: "147 Lê Lợi",
        paymentMethod: "cod",
        total: 100,
        trackingHistory: [{ status: "Đang giao", location: "Kho", updatedAt: "2026-10-26T00:00:00Z" }]
    });
    assert.equal(order.privacyLimited, true);
    for (const key of ["customerName", "phone", "address", "total", "items"]) assert.equal(order[key], undefined, key);
});

test("tra cứu công khai chỉ hiện thông tin chuyển khoản cho đơn QR đang chờ tiền", () => {
    const waiting = publicTrackingOrder("abc", { status: "Chờ xác nhận", paymentMethod: "qr", paymentVerified: false, total: 500, paymentReference: "FFABC" });
    assert.equal(waiting.total, 500);
    assert.equal(waiting.paymentReference, "FFABC");
    const paid = publicTrackingOrder("abc", { status: "Chờ xác nhận", paymentMethod: "qr", paymentVerified: true, total: 500 });
    assert.equal(paid.total, undefined);
});

test("mỗi đơn có đúng một mã đánh giá và không lộ mã đơn", () => {
    assert.equal(reviewIdForOrder("abc"), reviewIdForOrder("abc"));
    assert.notEqual(reviewIdForOrder("abc"), reviewIdForOrder("abd"));
    assert.equal(reviewIdForOrder("abc").length, 40);
    assert.ok(!reviewIdForOrder("abc").includes("abc"));
});
