const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { getRelatedProducts } = require('../flower.com/js/catalog/related-products.js');
const catalog = require('../flower.com/flower.json').flower;

const productPage = fs.readFileSync(
  path.join(__dirname, '..', 'flower.com', 'product.html'),
  'utf8'
);
const productStyles = fs.readFileSync(
  path.join(__dirname, '..', 'flower.com', 'css/catalog/product.css'),
  'utf8'
);
const productScript = fs.readFileSync(
  path.join(__dirname, '..', 'flower.com', 'js/catalog/product.js'),
  'utf8'
);

assert.match(productPage, /id="product-detail"/);
assert.ok(
  productPage.indexOf('<header class="catalog-heading">') < productPage.indexOf('<details id="sidebar" open>'),
  "the catalog title should appear before its filters"
);
assert.match(productPage, /<details id="sidebar" open>/);
assert.match(productPage, /<summary>Lọc và sắp xếp sản phẩm<\/summary>/);
assert.match(productPage, /id="related-flowers"[^>]*hidden/);
assert.match(productPage, /id="related-flowers-status"[^>]*role="status"/);
assert.match(productPage, /id="related-flowers-grid"/);
assert.match(productPage, /src="\.\/js\/catalog\/related-products\.js\?v=/);
assert.match(productPage, /id="detail-add-to-cart"/);
assert.match(productPage, /id="detail-wishlist"/);
assert.match(productStyles, /\.related-flowers-status\.is-loading/);
assert.match(productStyles, /\.related-flowers-status\.is-error/);
assert.match(productStyles, /@media \(max-width: 800px\)[\s\S]*?\.related-flowers-grid/);
assert.match(productStyles, /\.related-flower-image\.image-unavailable/);
assert.match(productScript, /img\.loading = index === 0 \? "eager" : "lazy"/);
assert.match(productScript, /img\.fetchPriority = "high"/);
assert.match(productScript, /new IntersectionObserver/);

const product = catalog.find((item) => String(item.id) === '1');
const related = getRelatedProducts(catalog, product, 4);
assert.strictEqual(related.length, 4);
assert.strictEqual(related.some((item) => String(item.id) === String(product.id)), false);
assert.strictEqual(new Set(related.map((item) => String(item.id))).size, related.length);

console.log('product-page test passed');
