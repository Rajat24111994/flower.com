const test = require('node:test');
const assert = require('node:assert/strict');
const { findPromotion, isValidPromotionDate, priceCart } = require('../flower.com/api/orders').internals;

test('single-day promotions include both Vietnam midnight boundaries, including leap day', () => {
    const promotion = { id: 'leap', active: true, discountPercent: 10, allProducts: true,
        startDate: '2028-02-29', endDate: '2028-02-29' };
    for (const at of ['2028-02-28T17:00:00.000Z', '2028-02-29T16:59:59.999Z']) {
        assert.equal(findPromotion([promotion], 'leap', new Date(at)), promotion);
    }
    for (const at of ['2028-02-28T16:59:59.999Z', '2028-02-29T17:00:00.000Z']) {
        assert.throws(() => findPromotion([promotion], 'leap', new Date(at)), { code: 'invalid-promotion' });
    }
});
test('invalid calendar dates, reversed intervals and non-finite discounts cannot price an order', () => {
    const base = { id: 'p', active: true, discountPercent: 10 };
    for (const value of ['2029-02-29', '2028-04-31', '2028-13-01', '2028-2-01', 20280229]) {
        assert.equal(isValidPromotionDate(value), false);
        assert.throws(() => findPromotion([{ ...base, startDate: value }], 'p'), { code: 'invalid-promotion' });
    }
    for (const changes of [{ startDate: '2028-03-01', endDate: '2028-02-29' },
        { endDate: 'bad' }, { discountPercent: Infinity }, { discountPercent: NaN }]) {
        assert.throws(() => findPromotion([{ ...base, ...changes }], 'p'), { code: 'invalid-promotion' });
    }
});
test('discount rounds once across eligible lines and never discounts unrelated products', () => {
    const items = [{ productId: 'rose', price: 101, quantity: 1 }, { productId: 'rose', price: 101, quantity: 1 },
        { productId: 'tulip', price: 1000, quantity: 1 }];
    assert.deepEqual(priceCart(items, { discountPercent: 50, productIds: ['rose'] }),
        { subtotal: 1202, savings: 101, tax: 0, total: 1101 });
    assert.deepEqual(priceCart(items, { discountPercent: 100, allProducts: true }),
        { subtotal: 1202, savings: 1202, tax: 0, total: 0 });
});
