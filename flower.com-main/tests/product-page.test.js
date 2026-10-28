const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { getRelatedProducts } = require('../flower.com/related-products.js');
const catalog = require('../flower.com/flower.json').flower;

const productPage = fs.readFileSync(
  path.join(__dirname, '..', 'flower.com', 'product.html'),
  'utf8'
);
const productStyles = fs.readFileSync(
  path.join(__dirname, '..', 'flower.com', 'product.css'),
  'utf8'
);

assert.match(productPage, /id="product-detail"/);
assert.match(productPage, /id="related-flowers"[^>]*hidden/);
assert.match(productPage, /id="related-flowers-status"[^>]*role="status"/);
assert.match(productPage, /id="related-flowers-grid"/);
assert.match(productPage, /src="\.\/related-products\.js\?v=/);
assert.match(productPage, /id="detail-add-to-cart"/);
assert.match(productPage, /id="detail-wishlist"/);
assert.match(productStyles, /\.related-flowers-status\.is-loading/);
assert.match(productStyles, /\.related-flowers-status\.is-error/);
assert.match(productStyles, /@media \(max-width: 800px\)[\s\S]*?\.related-flowers-grid/);
assert.match(productStyles, /\.related-flower-image\.image-unavailable/);

const product = catalog.find((item) => String(item.id) === '1');
const related = getRelatedProducts(catalog, product, 4);
assert.strictEqual(related.length, 4);
assert.strictEqual(related.some((item) => String(item.id) === String(product.id)), false);
assert.strictEqual(new Set(related.map((item) => String(item.id))).size, related.length);

console.log('product-page test passed');
