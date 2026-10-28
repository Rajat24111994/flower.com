const assert = require('assert');
const { mergeCatalogProducts, normalizeProduct } = require('../flower.com/product-store.js');

const catalog = [
  { id: 1, title: 'Hoa hồng', price: 250000, quantity: 8, image: 'rose.jpg', description: 'Hoa hồng đỏ' },
  { id: 2, title: 'Hoa cúc', price: 320000, quantity: 5, image: 'chrysanthemum.jpg', description: 'Hoa cúc vàng' },
];

const existing = [
  { id: 1, title: 'Hoa hồng cập nhật', price: 260000, quantity: 10, image: 'rose.jpg', description: 'Hoa hồng đỏ' },
  { id: 3, title: 'Hoa lan', price: 410000, quantity: 6, image: 'orchid.jpg', description: 'Hoa lan trắng' },
];

const merged = mergeCatalogProducts(existing, catalog);

assert.strictEqual(Array.isArray(merged), true);
assert.strictEqual(merged.length, 3);
assert.strictEqual(merged.find((item) => item.id === 1).title, 'Hoa hồng cập nhật');
assert.strictEqual(merged.find((item) => item.id === 1).quantity, 10);
assert.strictEqual(merged.find((item) => item.id === 2).title, 'Hoa cúc');
// Prices are whole VND; old USD prices (below 1.000) are converted and rounded to 1.000 ₫.
assert.strictEqual(normalizeProduct({ id: '7', title: '  Hoa tulip  ', price: '750000', quantity: '9', image: 'tulip.jpg' }).price, 750000);
assert.strictEqual(normalizeProduct({ id: 8, title: 'Hoa cẩm chướng', price: 739900 }).price, 739900);
assert.strictEqual(normalizeProduct({ id: 9, title: 'Giỏ hoa', price: 73.99 }).price, 1920000);
assert.deepStrictEqual(
  normalizeProduct({
    id: 10,
    title: 'Hoa mẫu',
    image: 'main.jpg',
    images: ['detail-1.jpg', '', 42],
    category: 'Hoa hồng',
    categoryKey: 'flowers',
    sameDayDelivery: true,
    onSale: true,
  }),
  {
    id: 10,
    title: 'Hoa mẫu',
    price: 0,
    quantity: 10,
    image: 'main.jpg',
    images: ['detail-1.jpg'],
    category: 'Hoa hồng',
    categoryKey: 'flowers',
    sameDayDelivery: true,
    onSale: true,
    description: '',
  }
);

const partialRemote = [
  { id: 1, title: 'Hoa hồng cập nhật', price: 260000, quantity: 2, image: 'rose.jpg', description: 'Hoa hồng đỏ' },
];
const restoredCatalog = mergeCatalogProducts(partialRemote, catalog);

assert.strictEqual(restoredCatalog.length, 2);
assert.strictEqual(restoredCatalog.find((item) => item.id === 1).quantity, 2);
assert.strictEqual(restoredCatalog.find((item) => item.id === 2).quantity, 5);

const fullCatalog = require('../flower.com/flower.json').flower;
const restoredFullCatalog = mergeCatalogProducts(
  [
    { ...fullCatalog[0], quantity: 2 },
    { ...fullCatalog[24], quantity: 7 },
    { id: 999, title: 'Hoa tùy chỉnh', quantity: 3 },
  ],
  fullCatalog
);

// Products that share an image or a title are still different products: only ids deduplicate.
assert.strictEqual(fullCatalog.length, 50);
assert.strictEqual(restoredFullCatalog.length, 51);
assert.strictEqual(restoredFullCatalog.find((item) => item.id === fullCatalog[0].id).quantity, 2);
assert.strictEqual(restoredFullCatalog.find((item) => item.id === fullCatalog[24].id).quantity, 7);
assert.strictEqual(restoredFullCatalog.find((item) => item.id === 999).title, 'Hoa tùy chỉnh');
assert.strictEqual(new Set(restoredFullCatalog.map((item) => String(item.id))).size, restoredFullCatalog.length);
assert.strictEqual(
  mergeCatalogProducts([], [{ id: 1, title: 'A', image: 'same.webp' }, { id: 2, title: 'B', image: 'same.webp' }]).length,
  2
);

console.log('product-store sync test passed');
