// Unit tests (F48): each account keeps its own cart and wishlist on a shared browser.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function browser(initial = {}) {
    const values = new Map(Object.entries(initial).map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)]));
    const localStorage = {
        getItem: (key) => (values.has(key) ? values.get(key) : null),
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: (key) => values.delete(key)
    };
    const context = { localStorage, console };
    context.globalThis = context;
    vm.createContext(context);
    const load = () => vm.runInContext(fs.readFileSync(path.join(__dirname, "../flower.com/js/core/safe-storage.js"), "utf8"), context);
    load();
    const read = (key) => (values.has(key) ? JSON.parse(values.get(key)) : null);
    const login = (uid) => { values.set("loggedUser", JSON.stringify({ uid, role: "customer" })); load(); };
    const logout = () => { values.delete("loggedUser"); load(); };
    return { read, login, logout, values, context };
}

const rose = { id: 1, title: "Hoa hồng", price: 100000, quantity: 2 };
const lily = { id: 2, title: "Hoa ly", price: 200000, quantity: 1 };

test("đăng xuất: giỏ được cất cho tài khoản, máy dùng chung không thấy", () => {
    const b = browser({ loggedUser: { uid: "an", role: "customer" }, flowerShoppingOwner: "an", cart: [rose], wish: [lily] });
    b.logout();
    assert.deepEqual(b.read("cart"), null);
    assert.deepEqual(b.read("wish"), null);
    b.login("binh");
    assert.deepEqual(b.read("cart") || [], []);
    assert.deepEqual(b.read("wish") || [], []);
});

test("đăng nhập lại: giỏ cũ của tài khoản quay về", () => {
    const b = browser({ loggedUser: { uid: "an", role: "customer" }, flowerShoppingOwner: "an", cart: [rose], wish: [lily] });
    b.logout();
    b.login("an");
    assert.deepEqual(b.read("cart"), [rose]);
    assert.deepEqual(b.read("wish"), [lily]);
});

test("hoa chọn lúc chưa đăng nhập được gộp vào giỏ của tài khoản, không mất món nào", () => {
    const b = browser({ flowerCart_an: [rose], flowerWish_an: [rose] });
    b.values.set("cart", JSON.stringify([{ ...rose, quantity: 1 }, lily]));
    b.values.set("wish", JSON.stringify([lily]));
    b.login("an");
    assert.deepEqual(b.read("cart").map((item) => [item.id, item.quantity]), [[1, 3], [2, 1]]);
    assert.deepEqual(b.read("wish").map((item) => item.id).sort(), [1, 2]);
});

test("đang có giỏ từ trước khi có tính năng này thì giữ nguyên cho tài khoản đang đăng nhập", () => {
    const b = browser({ loggedUser: { uid: "an", role: "customer" }, cart: [rose] });
    assert.deepEqual(b.read("cart"), [rose]);
    assert.equal(b.values.get("flowerShoppingOwner"), "an");
});

test("số lượng trên biểu tượng giỏ tính theo số bó, không phải số dòng sản phẩm", () => {
    const b = browser();
    assert.equal(b.context.FlowerSafeStorage.countCartUnits([
        { id: 1, quantity: 3 },
        { id: 2 },
        { id: 3, quantity: 0 }
    ]), 5);
    assert.equal(b.context.FlowerSafeStorage.countCartUnits([]), 0);
});
