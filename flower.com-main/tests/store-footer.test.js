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
  "forgot-password.html",
  "about.html",
  "contact.html",
  "shipping.html",
  "returns.html",
  "payment.html",
  "faq.html",
  "privacy.html",
  "terms.html"
];

for (const page of pages) {
  const html = fs.readFileSync(path.join(root, page), "utf8");
  assert.match(html, /store-footer\.css\?v=3/, `${page} should load the current shared footer styles`);
  assert.match(html, /store-footer\.js\?v=3/, `${page} should load the current shared footer markup`);
  if (["about.html", "contact.html", "shipping.html", "returns.html", "payment.html", "faq.html", "privacy.html", "terms.html"].includes(page)) {
    assert.match(html, /store-header\.js\?v=4/, `${page} should load the shared storefront header`);
    assert.match(html, /info-pages\.css\?v=1/, `${page} should load the shared information page styles`);
  }
  if (page === "checkout.html") {
    assert.doesNotMatch(html, /id="bottomtext"|id="endline"/, "checkout should not retain its duplicate legacy footer");
  }
}

const footer = fs.readFileSync(path.join(root, "store-footer.js"), "utf8");
assert.match(footer, /Tất cả sản phẩm/);
assert.match(footer, /Theo dõi đơn hàng/);
assert.match(footer, /Cần giúp chọn hoa/);
assert.match(footer, /Thông tin &amp; chính sách|Thông tin & chính sách/);
assert.match(footer, /store-footer--checkout/);
assert.match(footer, /store-footer-brand/);
assert.match(footer, /aria-label="Mua sắm"/);
assert.match(footer, /aria-label="Hỗ trợ"/);
assert.match(footer, /new Date\(\)\.getFullYear\(\)/);
assert.match(footer, /index\.html#top/);
for (const page of ["about", "contact", "shipping", "returns", "payment", "faq", "privacy", "terms"]) {
  assert.match(footer, new RegExp(`href="\\./${page}\\.html"`), `footer should link to ${page}.html`);
  assert.ok(fs.existsSync(path.join(root, `${page}.html`)), `${page}.html should exist`);
}

const contactPage = fs.readFileSync(path.join(root, "contact.html"), "utf8");
assert.match(contactPage, /hello@flowerflow\.vn/);
assert.match(contactPage, /zalo\.me\/g\/s7osfsriyfdvdqcfxeac/);
assert.match(contactPage, /Địa chỉ cửa hàng chưa được cập nhật/);
assert.match(contactPage, /Số điện thoại cửa hàng chưa được cập nhật/);

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
