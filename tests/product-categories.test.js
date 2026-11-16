const assert = require("node:assert/strict");
const { getCategory, matchesCategory } = require("../flower.com/js/catalog/product-categories.js");

const catalog = require("../flower.com/flower.json").flower;
assert.equal(getCategory("birthday").title, "Hoa tặng sinh nhật");
assert.equal(getCategory("not-a-category"), null);
assert.equal(catalog.length, 30);
assert.ok(catalog.every((product) => matchesCategory(product, "flowers")));
assert.ok(catalog.some((product) => matchesCategory(product, "birthday")));
assert.equal(matchesCategory({ title: "Hoa tươi", quantity: 0 }, "delivery"), false);
assert.equal(matchesCategory({ title: "Hoa tươi", sameDayDelivery: true }, "delivery"), true);
assert.equal(matchesCategory({ title: "Hoa tươi", onSale: true }, "sale"), true);
assert.equal(matchesCategory({ title: "Hoa lan", category: "Hoa lan" }, "flowers"), true);
assert.equal(matchesCategory({ title: "Hoa sinh nhật", category: "Birthday" }, "flowers"), true);
assert.equal(matchesCategory({ title: "Cây cảnh", category: "Cây cảnh" }, "flowers"), false);
assert.equal(matchesCategory({ title: "Hoa lan", quantity: 1 }, "flowers"), true);
assert.equal(matchesCategory({ title: "Hoa lan" }, ""), true);

console.log("product-categories test passed");
