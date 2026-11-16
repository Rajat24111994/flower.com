const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../flower.com/js/catalog/product-store.js"), "utf8");
const base = { id: "1", title: "Hoa", price: 100000, quantity: 10 };
const discounted = { ...base, price: 90000, basePrice: 100000, wiltingPricing: { ruleId: "r", price: 90000, basePrice: 100000, revision: 1 } };
function fixture(pathname = "/product.html", cached = []) {
    const data = new Map([["flowerInventory", JSON.stringify(cached)]]);
    const intervals = [], timeouts = []; let subscriptions = 0, offline = false;
    const context = vm.createContext({ URL, navigator: { onLine: true }, console: { warn() {} },
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
        window: { location: { pathname }, dispatchEvent() {},
            localStorage: { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) },
            setInterval: callback => { intervals.push(callback); return intervals.length; },
            setTimeout: callback => { timeouts.push(callback); return timeouts.length; } },
        __firebase: { db: {}, firestoreSdk: { collection: () => ({}), onSnapshot(_ref, callback) {
            subscriptions++; callback({ metadata: { fromCache: false }, docs: [{ id: "1", data: () => base }] }); return () => {};
        } } },
        async fetch(url) {
            if (String(url).startsWith("./flower.json")) return { ok: true, json: async () => ({ flower: [base] }) };
            if (offline) return { ok: false, status: 503 };
            return { ok: true, json: async () => ({ products: [discounted], wiltingPricingEnabled: true }) };
        }
    });
    const text = source.replace("async function getFirebaseApi() {", "async function getFirebaseApi() { return __firebase;");
    new vm.Script(text).runInContext(context);
    return { api: context.window.FlowerInventory, timeouts, intervals, subscriptions: () => subscriptions, offline: () => { offline = true; } };
}

test("public catalog preserves server wilting snapshots and does not replace them with Firestore base prices", async () => {
    const f = fixture();
    const products = await f.api.initialize();
    assert.equal(products[0].price, 90000); assert.equal(products[0].basePrice, 100000);
    assert.equal(products[0].wiltingPricing.ruleId, "r");
    for (const callback of f.timeouts) await callback();
    await new Promise(setImmediate);
    assert.equal(f.subscriptions(), 0);
    assert.equal(f.api.readProducts()[0].price, 90000);
});

test("admin reads original prices from a cache previously populated by a customer page", () => {
    const f = fixture("/admin.html", [discounted]);
    assert.equal(f.api.readProducts()[0].price, 100000);
    assert.equal(f.api.readProducts()[0].wiltingPricing, undefined);
    assert.equal(f.api.readProducts()[0].basePrice, undefined);
});

test("catalog API failure keeps the cached server price instead of inventing a fresh base price", async () => {
    const f = fixture(); await f.api.initialize();
    f.offline();
    for (const callback of f.intervals) await callback();
    assert.equal(f.api.readProducts()[0].price, 90000);
    assert.equal(f.subscriptions(), 0);
});
