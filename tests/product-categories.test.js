const assert = require("node:assert/strict");
const { getCategory, matchesCategory } = require("../flower.com/product-categories.js");

const catalog = require("../flower.com/flower.json").flower;
const birthdayProducts = catalog.filter((product) => matchesCategory(product, "birthday"));
const giftProducts = catalog.filter((product) => matchesCategory(product, "gift"));
const foodProducts = catalog.filter((product) => matchesCategory(product, "food"));
const sympathyProducts = catalog.filter((product) => matchesCategory(product, "sympathy"));
const plantsProducts = catalog.filter((product) => matchesCategory(product, "plants"));
const saleProducts = catalog.filter((product) => matchesCategory(product, "sale"));
const deliveryProducts = catalog.filter((product) => matchesCategory(product, "delivery"));

assert.equal(getCategory("birthday").title, "Hoa tặng sinh nhật");
assert.equal(getCategory("not-a-category"), null);
assert.ok(birthdayProducts.length > 0);
assert.ok(birthdayProducts.length < catalog.length);
assert.ok(giftProducts.length > 0);
assert.equal(foodProducts.length, 0);
assert.equal(sympathyProducts.length, 0);
assert.equal(plantsProducts.length, 0);
assert.equal(saleProducts.length, 0);
assert.equal(deliveryProducts.length, 2);
assert.ok(deliveryProducts.every((product) => product.sameDayDelivery));
assert.equal(matchesCategory({ title: "Hoa tươi", quantity: 0 }, "delivery"), false);
assert.equal(matchesCategory({ title: "Hoa tươi", sameDayDelivery: true }, "delivery"), true);
assert.equal(matchesCategory({ title: "Hoa tươi", onSale: true }, "sale"), true);
assert.equal(matchesCategory({ title: "Hoa lan", category: "Hoa lan" }, "flowers"), true);
assert.equal(matchesCategory({ title: "Hoa sinh nhật", category: "Birthday" }, "flowers"), true);
assert.equal(matchesCategory({ title: "Cây cảnh", category: "Cây cảnh" }, "flowers"), false);
assert.equal(matchesCategory({ title: "Hoa lan", quantity: 1 }, "flowers"), true);
assert.equal(matchesCategory({ title: "Hoa lan" }, ""), true);

console.log("product-categories test passed");
