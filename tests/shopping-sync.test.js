const test = require("node:test");
const assert = require("node:assert/strict");

const shoppingSyncPromise = import("../flower.com/js/core/shopping-sync.js");

test("đồng bộ chỉ giữ trường cần cho mua hàng và từ chối dữ liệu không hợp lệ", async () => {
  const { internals } = await shoppingSyncPromise;
  assert.deepEqual(internals.normalizeShoppingList([{
    id: "line-rose",
    productId: 7,
    title: "Hoa hồng",
    price: 250000,
    quantity: 2,
    image: "./images/rose.webp",
    personalNote: "Giao buổi sáng",
    privateField: "không được đồng bộ"
  }], "cart"), [{
    id: "line-rose",
    productId: 7,
    title: "Hoa hồng",
    price: 250000,
    quantity: 2,
    image: "./images/rose.webp",
    personalNote: "Giao buổi sáng"
  }]);

  assert.throws(() => internals.normalizeShoppingList("not a list", "cart"), { code: "invalid-shopping-data" });
  assert.throws(() => internals.normalizeShoppingList([{ id: "line", quantity: 0 }], "cart"), { code: "invalid-shopping-data" });
  assert.throws(() => internals.normalizeShoppingList([{ id: "line", productId: {} }], "cart"), { code: "invalid-shopping-data" });
  assert.throws(() => internals.normalizeShoppingList(Array.from({ length: 101 }, (_, index) => ({ id: String(index) })), "wish"), {
    code: "shopping-list-limit"
  });
  assert.throws(() => internals.normalizeShoppingData({
    cart: Array.from({ length: 100 }, (_, index) => ({ id: String(index), images: Array(8).fill("a".repeat(2048)) })),
    wish: []
  }), { code: "shopping-data-too-large" });
});

test("lần đồng bộ đầu gộp giỏ cũ mà không cộng trùng số lượng và hợp nhất yêu thích", async () => {
  const { internals } = await shoppingSyncPromise;
  const merged = internals.mergeInitialData(
    {
      cart: [{ id: "same", productId: 1, title: "Hoa", quantity: 2 }, { id: "remote", productId: 2, quantity: 1 }],
      wish: [{ id: 2, title: "Hoa ly" }]
    },
    {
      cart: [{ id: "same", productId: 1, title: "Hoa", quantity: 3 }, { id: "local", productId: 3, quantity: 1 }],
      wish: [{ id: 2, title: "Hoa ly cũ" }, { id: 3, title: "Hoa tulip" }]
    }
  );

  assert.deepEqual(merged.cart.map(({ id, quantity }) => [id, quantity]), [
    ["same", 3],
    ["remote", 1],
    ["local", 1]
  ]);
  assert.deepEqual(merged.wish.map(({ id }) => id), ["2", "3"]);
});

test("đồng bộ tải dữ liệu trên thiết bị mới và đẩy thay đổi cục bộ lên tài khoản", async () => {
  const { startShoppingSync } = await shoppingSyncPromise;
  const values = new Map([
    ["cart", JSON.stringify([{ id: "local", productId: 1, quantity: 1 }])],
    ["wish", JSON.stringify([])]
  ]);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value))
  };
  const eventTarget = new EventTarget();
  const writes = [];
  let onSnapshot;
  let unsubscribed = false;
  const firestoreSdk = {
    doc: (_db, collection, uid) => ({ collection, uid }),
    onSnapshot: (_ref, callback) => {
      onSnapshot = callback;
      return () => { unsubscribed = true; };
    },
    setDoc: async (_ref, data) => writes.push(structuredClone(data))
  };
  const stop = startShoppingSync({ uid: "customer-1", db: {}, firestoreSdk, storage, eventTarget });
  onSnapshot({ exists: () => false, data: () => null });
  await new Promise(setImmediate);
  assert.deepEqual(writes[0].cart.map(({ id }) => id), ["local"]);

  onSnapshot({
    exists: () => true,
    data: () => ({ cart: [{ id: "remote", productId: 2, quantity: 2 }], wish: [] })
  });
  assert.deepEqual(JSON.parse(values.get("cart")).map(({ id }) => id), ["remote"]);

  values.set("cart", JSON.stringify([{ id: "new", productId: 3, quantity: 1 }]));
  eventTarget.dispatchEvent(new CustomEvent("flowerstoragechange", { detail: { key: "cart" } }));
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.deepEqual(writes.at(-1).cart.map(({ id }) => id), ["new"]);
  stop();
  assert.equal(unsubscribed, true);
});

test("lỗi đồng bộ không xóa dữ liệu đang lưu trên thiết bị", async () => {
  const { startShoppingSync } = await shoppingSyncPromise;
  const values = new Map([["cart", JSON.stringify([{ id: "local", quantity: 1 }])], ["wish", "[]"]]);
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const eventTarget = new EventTarget();
  const states = [];
  eventTarget.addEventListener("flowershoppingsync", (event) => states.push(event.detail.state));
  let onSnapshot;
  const firestoreSdk = {
    doc: () => ({}),
    onSnapshot: (_ref, callback) => { onSnapshot = callback; return () => {}; },
    setDoc: async () => { throw Object.assign(new Error("offline"), { code: "unavailable" }); }
  };
  const stop = startShoppingSync({ uid: "customer-1", db: {}, firestoreSdk, storage, eventTarget });
  onSnapshot({ exists: () => false, data: () => null });
  await new Promise(setImmediate);
  onSnapshot({
    exists: () => true,
    data: () => ({ cart: [{ id: "stale", quantity: 1 }], wish: [] })
  });
  assert.deepEqual(JSON.parse(values.get("cart")).map(({ id }) => id), ["local"]);
  assert.ok(states.includes("error"));
  stop();
});
