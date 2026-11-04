const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
}

function loadSafeStorage() {
  const context = {
    localStorage: createStorage(),
    sessionStorage: createStorage()
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "../flower.com/js/core/safe-storage.js"), "utf8"),
    context
  );
  return context;
}

test("checkout data can be scoped to session storage instead of persistent local storage", () => {
  const context = loadSafeStorage();
  const checkout = { address: "147 Lê Lợi", phone: "0908123456" };

  assert.equal(context.FlowerSafeStorage.writeJson("flowerCheckout", checkout, { storage: "session" }), true);
  assert.equal(context.localStorage.getItem("flowerCheckout"), null);
  assert.deepEqual(
    JSON.parse(context.sessionStorage.getItem("flowerCheckout")),
    checkout
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.FlowerSafeStorage.readJson("flowerCheckout", { storage: "session" }))),
    checkout
  );

  assert.equal(context.FlowerSafeStorage.remove("flowerCheckout", { storage: "session" }), true);
  assert.equal(context.sessionStorage.getItem("flowerCheckout"), null);
});
