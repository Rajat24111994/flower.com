const assert = require('assert');
const { findDuplicateProductImages, mergeCatalogProducts, normalizeProduct, repairCatalogProducts } = require('../flower.com/js/catalog/product-store.js');

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
    status: 'active',
    category: 'Hoa hồng',
    categoryKey: 'flowers',
    sameDayDelivery: true,
    onSale: true,
    description: '',
  }
);
assert.strictEqual(normalizeProduct({ id: 11, title: 'Hoa ẩn', quantity: 3, status: 'hidden' }).status, 'hidden');

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

const migratedImages = mergeCatalogProducts(
  [
    {
      ...fullCatalog[0],
      image: 'https://legacy.example.test/img/p/GEN/lgwt/1103.jpg',
      images: ['https://legacy.example.test/img/p/GEN/lgwt/1103.jpg', 'https://cdn.example.test/custom-detail.webp'],
    },
    { ...fullCatalog[1], image: './images/flower-02.webp' },
    { ...fullCatalog[2], image: 'https://admin.example.test/custom-flower.webp' },
  ],
  fullCatalog
);
assert.strictEqual(migratedImages[0].image, fullCatalog[0].image);
assert.deepStrictEqual(migratedImages[0].images, ['https://cdn.example.test/custom-detail.webp']);
assert.strictEqual(migratedImages[1].image, fullCatalog[1].image);
assert.strictEqual(migratedImages[2].image, 'https://admin.example.test/custom-flower.webp');

const canonicalProduct = fullCatalog.find((product) => String(product.id) === '10');
const repairedProducts = repairCatalogProducts([
  {
    ...canonicalProduct,
    title: 'B? hoa h?ng t?m bay b?ng',
    image: './images/flower-04.webp',
    price: 1557000,
    quantity: 1044,
  },
  { id: 999, title: 'Sản phẩm tùy chỉnh?', image: './images/custom.webp', price: 900000 },
], fullCatalog);
assert.strictEqual(repairedProducts.length, 2);
assert.strictEqual(repairedProducts[0].title, canonicalProduct.title);
assert.strictEqual(repairedProducts[0].image, canonicalProduct.image);
assert.strictEqual(repairedProducts[0].price, 1557000);
assert.strictEqual(repairedProducts[0].quantity, 1044);
assert.strictEqual(repairedProducts[1].title, 'Sản phẩm tùy chỉnh?');
assert.strictEqual(repairedProducts[1].image, './images/custom.webp');

const imageProducts = [
  { id: 1, image: './images/rose.webp?v=2', images: ['./images/detail.webp'] },
  { id: 2, image: 'https://cdn.example.test/tulip.webp' },
];
assert.deepStrictEqual(
  findDuplicateProductImages(imageProducts, ['./images/rose.webp?v=5'], { baseUrl: 'https://shop.example.test/admin.html' }),
  ['https://shop.example.test/images/rose.webp']
);
assert.deepStrictEqual(
  findDuplicateProductImages(imageProducts, ['./images/unique.webp', 'https://shop.example.test/images/unique.webp'], { baseUrl: 'https://shop.example.test/admin.html' }),
  ['https://shop.example.test/images/unique.webp']
);
assert.deepStrictEqual(
  findDuplicateProductImages(imageProducts, ['./images/rose.webp?v=5'], {
    baseUrl: 'https://shop.example.test/admin.html',
    excludeProductId: 1,
  }),
  []
);
assert.deepStrictEqual(
  findDuplicateProductImages(imageProducts, ['./images/rose.webp', './images/rose.webp'], { baseUrl: 'https://shop.example.test/admin.html' }),
  ['https://shop.example.test/images/rose.webp']
);

console.log('product-store sync test passed');
