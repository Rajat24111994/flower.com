const assert = require("assert");
const { InventoryReservationError, reserveInventory } = require("../flower.com/lib/order-inventory.js");

function createMemoryFirestore(initialProducts) {
  const products = new Map(Object.entries(initialProducts).map(([id, product]) => [
    id,
    { ...product, id }
  ]));
  const reservations = new Map();
  const db = {
    collection(name) {
      return {
        doc(id) {
          return { collection: name, id: String(id) };
        }
      };
    },
    async runTransaction(callback) {
      const updates = [];
      const creates = [];
      const transaction = {
        async get(ref) {
          const collection = ref.collection === "products" ? products : reservations;
          const value = collection.get(ref.id);
          return {
            exists: value !== undefined,
            ref,
            data: () => value && { ...value }
          };
        },
        update(ref, fields) {
          updates.push({ ref, fields });
        },
        create(ref, value) {
          creates.push({ ref, value });
        }
      };
      const result = await callback(transaction);
      updates.forEach(({ ref, fields }) => {
        products.set(ref.id, { ...products.get(ref.id), ...fields });
      });
      creates.forEach(({ ref, value }) => reservations.set(ref.id, value));
      return result;
    }
  };
  return { db, products, reservations };
}

async function run() {
  const { db, products, reservations } = createMemoryFirestore({
    rose: { quantity: 7 },
    tulip: { quantity: 2 }
  });
  const firstReservation = await reserveInventory(db, "order-123", [
    { id: "rose", quantity: 3 },
    { id: "tulip", quantity: 2 }
  ]);
  assert.deepStrictEqual(firstReservation, {
    alreadyReserved: false,
    stocks: [
      { id: "rose", quantity: 4 },
      { id: "tulip", quantity: 0 }
    ]
  });
  assert.strictEqual(products.get("rose").quantity, 4);
  assert.strictEqual(products.get("tulip").quantity, 0);
  assert.strictEqual(reservations.size, 1);

  products.set("rose", { ...products.get("rose"), quantity: 3 });
  const retry = await reserveInventory(db, "order-123", [
    { id: "rose", quantity: 3 },
    { id: "tulip", quantity: 2 }
  ]);
  assert.strictEqual(retry.alreadyReserved, true);
  assert.strictEqual(retry.stocks.find((item) => item.id === "rose").quantity, 3);
  assert.strictEqual(products.get("rose").quantity, 3);

  await assert.rejects(
    reserveInventory(db, "order-456", [{ id: "rose", quantity: 5 }]),
    (error) => error instanceof InventoryReservationError && error.code === "insufficient-stock"
  );
  assert.strictEqual(products.get("rose").quantity, 3);
  assert.strictEqual(reservations.has("order-456"), false);

  await assert.rejects(
    reserveInventory(db, "order-123", [{ id: "rose", quantity: 1 }]),
    (error) => error.code === "order-id-conflict"
  );
  await assert.rejects(
    reserveInventory(db, "bad/id", [{ id: "rose", quantity: 1 }]),
    (error) => error.code === "invalid-argument"
  );
  await assert.rejects(
    reserveInventory(db, "order-789", [{ id: "missing", quantity: 1 }]),
    (error) => error.code === "product-not-found"
  );
  assert.strictEqual(reservations.has("order-789"), false);

  console.log("order-inventory test passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
