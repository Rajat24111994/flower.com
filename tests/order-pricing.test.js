// Unit tests: prices (whole VND), promotions and totals (server api/orders.js and browser currency.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { internals } = require("../flower.com/api/orders.js");

const { priceCart, findPromotion } = internals;
const { toVndPrice } = require("../flower.com/product-store.js");
const catalog = require("../flower.com/flower.json").flower;

function loadBrowserCurrency(selectedPromotionId = "", saved = {}) {
    const writes = {};
    const context = {
        window: {
            FlowerSafeStorage: {
                readText: () => selectedPromotionId,
                readJson: (key, { fallback }) => saved[key] ?? fallback,
                writeJson: (key, value) => { writes[key] = value; }
            },
            addEventListener() {}
        },
        document: { getElementById: () => null },
        Intl
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../flower.com/currency.js"), "utf8"), context);
    context.writes = writes;
    return context;
}

const promo20All = { id: "p20", name: "Giảm 20%", discountPercent: 20, active: true, allProducts: true, productIds: [] };
const promo30One = { id: "p30", name: "Giảm 30% hoa 1", discountPercent: 30, active: true, productIds: ["1"] };

test("giá trong flower.json là số nguyên VND, làm tròn tới 1.000 ₫", () => {
    for (const product of catalog) {
        assert.ok(Number.isSafeInteger(product.price), `id ${product.id}: ${product.price}`);
        assert.equal(product.price % 1000, 0, `id ${product.id}: ${product.price}`);
        assert.ok(product.price >= 1000, `id ${product.id}: ${product.price}`);
    }
});

test("toVndPrice() giữ giá VND, chỉ đổi giá USD cũ (dưới 1.000)", () => {
    assert.equal(toVndPrice(450000), 450000);
    assert.equal(toVndPrice("1920000"), 1920000);
    assert.equal(toVndPrice(73.99), 1920000);
    assert.equal(toVndPrice(49.99), 1297000);
    assert.equal(toVndPrice(0), 0);
    assert.equal(toVndPrice("abc"), 0);
    assert.equal(toVndPrice(-5), 0);
});

test("trình duyệt và máy chủ đổi giá cũ giống hệt nhau", () => {
    const browser = loadBrowserCurrency();
    for (const value of [0.5, 9.99, 49.99, 73.99, 999.99, 1000, 450000]) {
        assert.equal(browser.toVndPrice(value), toVndPrice(value), String(value));
    }
});

test("giỏ hàng và yêu thích lưu giá USD cũ được đổi sang VND khi mở trang", () => {
    const browser = loadBrowserCurrency("", {
        cart: [{ id: "1", price: 73.99, quantity: 2 }, { id: "2", price: 1297000, quantity: 1 }],
        wish: [{ id: "3", price: 59.99 }]
    });
    assert.deepEqual(browser.writes.cart.map((item) => item.price), [1920000, 1297000]);
    assert.deepEqual(browser.writes.wish.map((item) => item.price), [1557000]);
    const untouched = loadBrowserCurrency("", { cart: [{ id: "2", price: 1297000, quantity: 1 }] });
    assert.equal(untouched.writes.cart, undefined);
});

test("formatVnd() hiện số tiền VND, không quy đổi", () => {
    const browser = loadBrowserCurrency();
    assert.equal(browser.formatVnd(450000).replace(/\s/g, " "), "450.000 ₫");
    assert.equal(browser.formatVnd(0).replace(/\s/g, " "), "0 ₫");
});

test("priceCart() không ưu đãi: tổng = tổng từng dòng, không lệch đồng nào", () => {
    const items = [{ id: "1", price: 1920000, quantity: 2 }, { id: "3", price: 1557000, quantity: 1 }];
    assert.deepEqual(priceCart(items, null), { subtotal: 5397000, savings: 0, tax: 0, total: 5397000 });
});

test("priceCart() ưu đãi toàn bộ sản phẩm", () => {
    const totals = priceCart([{ id: "1", price: 1920000, quantity: 2 }, { id: "3", price: 1557000, quantity: 1 }], promo20All);
    assert.deepEqual(totals, { subtotal: 5397000, savings: 1079400, tax: 0, total: 4317600 });
});

test("priceCart() ưu đãi chỉ áp dụng cho sản phẩm được chọn", () => {
    const totals = priceCart([{ id: "1", price: 100000, quantity: 1 }, { id: "2", price: 100000, quantity: 1 }], promo30One);
    assert.equal(totals.savings, 30000);
    assert.equal(totals.total, 170000);
});

test("priceCart() tiền giảm lẻ được làm tròn tới đồng", () => {
    const totals = priceCart([{ id: "1", price: 1297000, quantity: 1 }], { ...promo20All, discountPercent: 15.5 });
    assert.equal(totals.savings, 201035);
    assert.ok(Number.isSafeInteger(totals.total));
});

test("priceCart() tiền giảm không vượt quá tạm tính (giảm 100%)", () => {
    const totals = priceCart([{ id: "1", price: 100000, quantity: 3 }], { ...promo20All, discountPercent: 100 });
    assert.equal(totals.total, 0);
    assert.equal(totals.savings, totals.subtotal);
});

test("findPromotion() trả về null khi không chọn ưu đãi", () => {
    assert.equal(findPromotion([promo20All], ""), null);
});

test("findPromotion() từ chối ưu đãi không tồn tại, đã tắt hoặc sai phần trăm", () => {
    assert.throws(() => findPromotion([promo20All], "nope"), { code: "invalid-promotion" });
    assert.throws(() => findPromotion([{ ...promo20All, active: false }], "p20"), { code: "invalid-promotion" });
    for (const discountPercent of [0, -5, 101, "abc"]) {
        assert.throws(() => findPromotion([{ ...promo20All, discountPercent }], "p20"), { code: "invalid-promotion" });
    }
    assert.equal(findPromotion([promo20All], "p20"), promo20All);
});

test("giá hiển thị ở trình duyệt khớp giá máy chủ tính (không lệch khi đặt hàng)", () => {
    const cart = [{ id: "1", price: 1920000, quantity: 2 }, { id: "3", price: 1557000, quantity: 1 }, { id: "9", price: 2205000, quantity: 3 }];
    for (const promotion of [null, promo20All, promo30One]) {
        const browser = loadBrowserCurrency(promotion?.id || "");
        browser.setTrustedPromotions(promotion ? [promotion] : []);
        const client = browser.calculateCartTotals(cart, promotion?.id || "");
        const server = priceCart(cart, promotion);
        assert.deepEqual({ ...client }, server, `lệch giá với ưu đãi ${promotion?.id || "không"}`);
    }
});

test("trình duyệt chỉ liệt kê ưu đãi đang bật và có sản phẩm trong giỏ", () => {
    const browser = loadBrowserCurrency();
    browser.setTrustedPromotions([promo20All, promo30One, { ...promo30One, id: "off", active: false }, { ...promo30One, id: "p99", productIds: ["99"] }]);
    const ids = browser.getAvailableCartPromotions([{ id: "1", price: 1, quantity: 1 }]).map((item) => item.id);
    assert.deepEqual(ids, ["p20", "p30"]);
});
