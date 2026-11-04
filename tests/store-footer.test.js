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

for (const page of pages) {
  const html = fs.readFileSync(path.join(root, page), "utf8");
  assert.match(html, /store-footer\.css\?v=2/, `${page} should load the current shared footer styles`);
  assert.match(html, /store-footer\.js\?v=2/, `${page} should load the current shared footer markup`);
  if (page === "checkout.html") {
    assert.doesNotMatch(html, /id="bottomtext"|id="endline"/, "checkout should not retain its duplicate legacy footer");
  }
}

const footer = fs.readFileSync(path.join(root, "store-footer.js"), "utf8");
assert.match(footer, /Tất cả sản phẩm/);
assert.match(footer, /Theo dõi đơn hàng/);
assert.match(footer, /Cần giúp chọn hoa/);
assert.match(footer, /store-footer--checkout/);
assert.match(footer, /store-footer-brand/);
assert.match(footer, /aria-label="Mua sắm"/);
assert.match(footer, /aria-label="Hỗ trợ"/);
assert.match(footer, /new Date\(\)\.getFullYear\(\)/);
assert.match(footer, /index\.html#top/);

const footerStyles = fs.readFileSync(path.join(root, "store-footer.css"), "utf8");
assert.match(footerStyles, /\.store-footer--checkout\s*\{[^}]*background:\s*#382a31/s);
assert.match(footerStyles, /\.store-footer--checkout\s+\.store-footer-main\s*\{[^}]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
assert.match(footerStyles, /@media \(max-width: 640px\)[\s\S]*?\.store-footer--checkout \.store-footer-main[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);

for (const stylesheet of [
  "account.css",
  "forgot-password.css",
  "homepage.css",
  "login.css",
  "product.css",
  "store-footer.css",
  "checkout.css"
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
