const pricing = require('../../../flower.com/backend/orders/pricing');
const tests = [];
function add(method, input, work) {
  try { tests.push({ method, input, expected: work() }); }
  catch (error) { tests.push({ method, input, code: error.code, message: error.message }); }
}
for (const price of [null, '73.99', 73.99, 0, -1, 999.99, 1000, 1000.49, 1000.5, 'bad'])
  add('price', { price }, () => pricing.getProductPrice({ price }));
const items = [{ id: 'a', price: 101, quantity: 3 }, { id: 'b', productId: 'base-b', price: 54321, quantity: 2 }];
for (const percent of [1, 10, 33.33, 99.99, 100, '10']) for (const allProducts of [false, true]) {
  const promotion = { discountPercent: percent, allProducts, productIds: ['a', 'base-b'] };
  add('cart', { items, promotion }, () => pricing.priceCart(items, promotion));
}
add('cart', { items, promotion: null }, () => pricing.priceCart(items, null));
for (const overrides of [{}, { startDate: '2026-11-16' }, { endDate: '2026-11-14' }, { discountPercent: 0 },
  { discountPercent: 101 }, { startDate: '2026-02-29' }, { startDate: '2026-11-15', endDate: '2026-11-15' }, { active: false }]) {
  const promotions = [{ id: 'promo', active: true, discountPercent: 10, ...overrides }];
  add('promotion', { promotions, id: 'promo' }, () => pricing.findPromotion(promotions, 'promo', new Date('2026-11-15T12:00:00Z')));
}
for (const items of [[{ id: 'a', quantity: 2 }, { id: 'b', productId: 'a', quantity: 3 }],
  [{ id: 'a', quantity: -2 }, { id: 'a', quantity: 0 }, { id: 'b', quantity: '2' }], [], null])
  add('aggregate', { items }, () => pricing.aggregateItems(items));
const tiers = [{ maxStems: 10, fee: 5000 }, { maxStems: 50, fee: 15000 }];
for (const items of [[{ data: { saleType: 'flower' }, customBouquetId: 'one', quantity: 10 }],
  [{ data: { saleType: 'flower' }, customBouquetId: 'one', quantity: 51 }],
  [{ data: { saleType: 'flower' }, quantity: 1 }], [{ data: {}, customBouquetId: 'one', quantity: 1 }],
  [{ data: {}, quantity: 1 }]]) add('bouquets', { items, tiers }, () => pricing.calculateCustomBouquets(items, tiers));
process.stdout.write(JSON.stringify(tests));
