const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "flower.com");
const pages = [
  "index.html",
  "product.html",
  "cart.html",
  "checkout.html",
  "placeorder.html",
  "wish.html",
  "tracking.html",
  "account.html",
  "login.html",
  "forgot-password.html"
];

const informationPages = [
  "about.html",
  "contact.html",
  "delivery.html",
  "returns.html",
  "privacy.html",
  "terms.html",
  "ordering.html",
  "faq.html"
];

for (const page of pages) {
  const html = fs.readFileSync(path.join(root, page), "utf8");
  assert.match(html, /store-footer\.css\?v=3/, `${page} should load the current shared footer styles`);
  assert.match(html, /store-footer\.js\?v=4/, `${page} should load the current shared footer markup`);
  if (page === "checkout.html") {
    assert.doesNotMatch(html, /id="bottomtext"|id="endline"/, "checkout should not retain its duplicate legacy footer");
  }
}

for (const page of informationPages) {
  const html = fs.readFileSync(path.join(root, page), "utf8");
  assert.match(html, /store-header\.js\?v=\d+/, `${page} should load the shared header`);
  assert.match(html, /store-footer\.css\?v=3/, `${page} should load the current shared footer styles`);
  assert.match(html, /store-footer\.js\?v=4/, `${page} should load the current shared footer markup`);
  assert.match(html, /information-page\.css\?v=1/, `${page} should load the information page styles`);
  assert.match(html, /<main\b[^>]*id="main-content"/, `${page} should provide a main landmark`);
  assert.match(html, /<title>[^<]+<\/title>/, `${page} should have a descriptive title`);
  assert.match(html, /name="description"/, `${page} should have a meta description`);
  for (const [, destination] of html.matchAll(/href="\.\/([^"#?]+)(?:[#?][^"]*)?"/g)) {
    assert.ok(
      fs.existsSync(path.join(root, destination)),
      `${page} should link only to existing internal destinations (missing ${destination})`
    );
  }
}

const footer = fs.readFileSync(path.join(root, "js/core/store-footer.js"), "utf8");
assert.match(footer, /Tất cả sản phẩm/);
assert.match(footer, /Theo dõi đơn hàng/);
assert.match(footer, /Cần giúp chọn hoa/);
assert.match(footer, /store-footer--checkout/);
assert.match(footer, /store-footer-brand/);
assert.match(footer, /aria-label="Mua sắm"/);
assert.match(footer, /aria-label="Hỗ trợ"/);
assert.match(footer, /aria-label="Thông tin cửa hàng"/);
assert.match(footer, /new Date\(\)\.getFullYear\(\)/);
assert.match(footer, /index\.html#top/);
for (const page of informationPages) {
  assert.equal(
    footer.match(new RegExp(`href="./${page}"`, "g"))?.length,
    2,
    `${page} should be linked from both standard and checkout footer variants`
  );
  assert.ok(fs.existsSync(path.join(root, page)), `${page} should resolve to an existing page`);
}

const footerStyles = fs.readFileSync(path.join(root, "css/core/store-footer.css"), "utf8");
assert.match(footerStyles, /\.store-footer--checkout\s*\{[^}]*background:\s*#382a31/s);
assert.match(footerStyles, /\.store-footer--checkout\s+\.store-footer-main\s*\{[^}]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
assert.match(footerStyles, /@media \(max-width: 640px\)[\s\S]*?\.store-footer--checkout \.store-footer-main[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);

for (const stylesheet of [
  "css/account/account.css",
  "css/account/forgot-password.css",
  "css/core/homepage.css",
  "css/account/login.css",
  "css/catalog/product.css",
  "css/core/store-footer.css",
  "css/order/checkout.css"
]) {
  const styles = fs.readFileSync(path.join(root, stylesheet), "utf8");
  if (styles.includes("Playfair Display")) {
    assert.match(
      styles,
      /Playfair Display", "Segoe UI", Arial, serif/,
      `${stylesheet} should fall back to a Vietnamese-capable font`
    );
  }
}

console.log("store-footer test passed");
