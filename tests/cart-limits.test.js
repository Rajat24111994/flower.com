// Unit tests: a cart line can hold at most what the order API accepts (50 of each product).
const test = require("node:test");
const assert = require("node:assert/strict");
const { createShoppingStore, MAX_QUANTITY_PER_PRODUCT } = require("../flower.com/js/order/shopping-store.js");
const { internals } = require("../flower.com/api/orders.js");

function memoryStore(cart = []) {
    const values = new Map([["cart", JSON.stringify(cart)]]);
    return createShoppingStore(() => ({ getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }));
}

test("giỏ hàng và máy chủ dùng cùng giới hạn 50 sản phẩm mỗi loại (F46)", () => {
    assert.equal(MAX_QUANTITY_PER_PRODUCT, 50);
    assert.equal(internals.MAX_QUANTITY_PER_PRODUCT, 50);
});

test("không thêm quá 50 sản phẩm một loại dù kho còn nhiều hơn (F46)", () => {
    const store = memoryStore([{ id: 3, title: "Hoa", price: 100000, quantity: 45 }]);
    const product = { id: 3, title: "Hoa", price: 100000, quantity: 100 };
    assert.throws(() => store.addToCart(product, 10), (error) => error.code === "quantity-limit" && /50/.test(error.message));
    assert.equal(store.addToCart(product, 5)[0].quantity, 50);
});
