const test = require("node:test");
const assert = require("node:assert/strict");
const options = require("../flower.com/js/catalog/bouquet-options.js");
const { createShoppingStore } = require("../flower.com/js/order/shopping-store.js");
const { internals: api } = require("../flower.com/api/orders.js");

function shopping() {
  const data = new Map();
  return createShoppingStore(() => ({ getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value) }));
}
const flower = { id: 1, productId: "1", price: 130000, quantity: 4,
  size: "large", color: "pink", cardMessage: "Chúc mừng sinh nhật", personalNote: "Gói giấy kraft" };

test("cấu hình giống nhau được gộp; khác thiệp, màu hoặc cỡ giữ thành dòng riêng", () => {
  const store = shopping();
  store.addToCart(flower);
  store.addToCart(flower);
  store.addToCart({ ...flower, color: "white" });
  const cart = store.addToCart({ ...flower, cardMessage: "Cảm ơn mẹ" });
  assert.equal(cart.length, 3);
  assert.equal(cart[0].quantity, 2);
  assert.equal(new Set(cart.map((item) => item.id)).size, 3);
  assert.throws(() => store.addToCart({ ...flower, size: "premium" }), (error) => error.code === "exceeds-stock");
  assert.equal(options.demand(cart, "1"), 4);
});

test("giá theo cỡ dùng chung frontend/backend; ưu đãi áp dụng theo sản phẩm gốc", () => {
  assert.equal(options.price(100000, "standard"), 100000);
  assert.equal(options.price(100000, "large"), 130000);
  assert.equal(options.price(100000, "premium"), 160000);
  const totals = api.priceCart([{ ...flower, id: "line1", quantity: 2 }],
    { discountPercent: 10, productIds: ["1"] });
  assert.equal(totals.total, 234000);
  assert.deepEqual(api.aggregateItems([{ ...flower, id: "line1", quantity: 2 },
    { ...flower, id: "line2", quantity: 1 }]), [{ id: "1", quantity: 3 }]);
});

test("API giữ lựa chọn hợp lệ và từ chối cỡ/màu/độ dài giả mạo", () => {
  const item = { ...flower, id: "line1", quantity: 1 };
  assert.deepEqual(api.validateQuote({ items: [item] }).items[0],
    { id: "line1", quantity: 1, ...options.normalize(item) });
  for (const changed of [{ size: "free" }, { color: "fake" }, { productId: "../secret" },
    { cardMessage: "a".repeat(301) }, { personalNote: "a".repeat(501) }]) {
    assert.equal(api.validateQuote({ items: [{ ...item, ...changed }] }), null);
  }
});
