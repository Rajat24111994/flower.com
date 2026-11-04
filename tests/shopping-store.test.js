const assert = require('assert');
const { createShoppingStore, ShoppingStoreError } = require('../flower.com/shopping-store.js');

function createMemoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    values,
  };
}

const storage = createMemoryStorage({
  cart: JSON.stringify([
    { id: 1, title: 'Hoa cũ', price: 50, quantity: 2 },
    { id: 1, title: 'Hoa trùng', price: 49, quantity: 1 },
    { id: 2, title: 'Hoa khác', price: 20, quantity: 1 },
  ]),
});
const store = createShoppingStore(() => storage);
const updatedCart = store.addToCart(
  { id: 1, title: 'Hoa mới', price: 60, quantity: 8, image: 'new.jpg' },
  2
);

assert.strictEqual(updatedCart.length, 2);
assert.deepStrictEqual(updatedCart.find((item) => item.id === 1), {
  id: 1,
  title: 'Hoa mới',
  price: 60,
  quantity: 5,
  image: 'new.jpg',
  stockQuantity: 8,
});
assert.strictEqual(updatedCart.find((item) => item.id === 2).quantity, 1);

assert.throws(
  () => store.addToCart({ id: 1, title: 'Hoa mới', price: 70, quantity: 5 }, 4),
  (error) => error instanceof ShoppingStoreError && error.code === 'exceeds-stock'
);
assert.throws(
  () => store.addToCart({ id: 3, title: 'Hết hàng', price: 1, quantity: 0 }, 1),
  (error) => error.code === 'out-of-stock'
);
assert.throws(
  () => store.addToCart({ id: 3, title: 'Số lượng sai', price: 1, quantity: 4 }, 1.5),
  (error) => error.code === 'invalid-quantity'
);
assert.strictEqual(store.readCart().find((item) => item.id === 1).price, 60);

const product = { id: 9, title: 'Hoa yêu thương', price: 25, quantity: 3 };
assert.deepStrictEqual(store.toggleWishlist(product), {
  wishlist: [product],
  added: true,
});
assert.deepStrictEqual(store.toggleWishlist(product), {
  wishlist: [],
  added: false,
});
store.toggleWishlist(product);
assert.deepStrictEqual(store.removeFromWishlist(9), []);

const invalidStorage = createMemoryStorage({ cart: '{bad json' });
assert.throws(
  () => createShoppingStore(() => invalidStorage).readCart(),
  (error) => error.code === 'storage-invalid-data'
);

const malformedCartStorage = createMemoryStorage({ cart: JSON.stringify([null]) });
assert.throws(
  () => createShoppingStore(() => malformedCartStorage).readCart(),
  (error) => error.code === 'storage-invalid-data'
);

const unavailableStorage = createShoppingStore(() => {
  throw new Error('blocked');
});
assert.throws(
  () => unavailableStorage.readWishlist(),
  (error) => error.code === 'storage-unavailable'
);

const writeFailingStorage = createMemoryStorage();
writeFailingStorage.setItem = () => {
  throw new Error('quota exceeded');
};
assert.throws(
  () => createShoppingStore(() => writeFailingStorage).addToCart(
    { id: 4, title: 'Hoa', price: 10, quantity: 2 },
    1
  ),
  (error) => error.code === 'storage-write-failed'
);

console.log('shopping-store test passed');
