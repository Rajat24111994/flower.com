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
const vercelConfig = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'flower.com', 'vercel.json'),
  'utf8'
));
const homePage = fs.readFileSync(
  path.join(__dirname, '..', 'flower.com', 'index.html'),
  'utf8'
);
const robotsTxt = fs.readFileSync(
  path.join(__dirname, '..', 'flower.com', 'robots.txt'),
  'utf8'
);
const sitemapXml = fs.readFileSync(
  path.join(__dirname, '..', 'flower.com', 'sitemap.xml'),
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
assert.match(productPage, /rel="canonical"/);
assert.match(productPage, /property="og:title"/);
assert.match(productPage, /name="twitter:card"/);
assert.match(productPage, /id="product-jsonld" type="application\/ld\+json"/);
assert.match(productPage, /<noscript>[\s\S]*product\.html\?id=1/);
assert.match(homePage, /rel="canonical"/);
assert.match(homePage, /property="og:image"/);
assert.match(homePage, /name="twitter:card"/);
assert.match(homePage, /fetchpriority="high"/);
assert.match(robotsTxt, /Sitemap: https:\/\/flower-com-six\.vercel\.app\/sitemap\.xml/);
assert.match(sitemapXml, /https:\/\/flower-com-six\.vercel\.app\/product\.html/);
const securityHeaders = vercelConfig.headers[0].headers;
assert.ok(securityHeaders.some((header) => header.key === 'Content-Security-Policy'));
assert.ok(securityHeaders.some((header) => header.key === 'X-Frame-Options' && header.value === 'DENY'));
assert.ok(securityHeaders.some((header) => header.key === 'X-Content-Type-Options' && header.value === 'nosniff'));

const product = catalog.find((item) => String(item.id) === '1');
const related = getRelatedProducts(catalog, product, 4);
assert.strictEqual(related.length, 4);
assert.strictEqual(related.some((item) => String(item.id) === String(product.id)), false);
assert.strictEqual(new Set(related.map((item) => String(item.id))).size, related.length);

console.log('product-page test passed');
