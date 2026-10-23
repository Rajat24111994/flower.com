const assert = require('assert');
const { getRelatedProducts } = require('../flower.com/related-products.js');

const current = {
  id: 'current',
  title: 'Pink Rose Bouquet',
  category: 'Birthday',
  description: 'A fresh arrangement',
};
const sameCategory = {
  id: 'same-category',
  title: 'Sunshine Bouquet',
  category: 'birthday',
};
const sameFlower = {
  id: 'same-flower',
  title: 'Red Roses',
  category: 'Anniversary',
};
const unrelated = {
  id: 'unrelated',
  title: 'White Orchids',
  category: 'Sympathy',
};
const catalog = [
  current,
  sameFlower,
  sameCategory,
  { ...sameCategory, title: 'Duplicated ID row' },
  { id: 'duplicate-title', title: 'Sunshine Bouquet', category: 'Birthday' },
  unrelated,
];

const related = getRelatedProducts(catalog, current, 4);
assert.deepStrictEqual(related.map((product) => product.id), ['same-category', 'same-flower', 'unrelated']);
assert.strictEqual(related.some((product) => product.id === current.id), false);
assert.strictEqual(new Set(related.map((product) => product.id)).size, related.length);
assert.strictEqual(new Set(related.map((product) => product.title.toLowerCase())).size, related.length);

const fallbackCatalog = [
  { id: 10, title: 'Product one' },
  { id: 11, title: 'Product two' },
  { id: 12, title: 'Product three' },
];
assert.deepStrictEqual(
  getRelatedProducts(fallbackCatalog, { id: 99, title: 'Current product' }, 2).map((product) => product.id),
  [10, 11]
);
assert.deepStrictEqual(getRelatedProducts(fallbackCatalog, fallbackCatalog[0], 20).map((product) => product.id), [11, 12]);
assert.deepStrictEqual(getRelatedProducts(fallbackCatalog, fallbackCatalog[0], 0).map((product) => product.id), [11, 12]);
assert.deepStrictEqual(getRelatedProducts(fallbackCatalog, null), []);
assert.deepStrictEqual(getRelatedProducts(null, fallbackCatalog[0]), []);

const originalCatalog = JSON.stringify(catalog);
getRelatedProducts(catalog, current);
assert.strictEqual(JSON.stringify(catalog), originalCatalog);

console.log('product-related test passed');
