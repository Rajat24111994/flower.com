const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const filename = path.join(__dirname, '../flower.com/js/catalog/product-store.js');
const rose = { id: 'rose', title: 'Hoa hồng', price: 100000, quantity: 4, image: 'rose.webp' };
function fixture({ cached = [], catalog = [rose], products = [rose], fault, pathname = '/product.html', storageFault = false } = {}) {
    const data = new Map([['flowerInventory', JSON.stringify(cached)], ['flowerCategories', JSON.stringify([' Rose ', 'Rose', 'Tulip'])]]);
    const intervals = [], timeouts = [], requests = [], events = [];
    const context = vm.createContext({ URL, console: { warn() {} }, navigator: { onLine: true },
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
        window: { location: { pathname }, localStorage: {
            getItem(key) { if (storageFault) throw new Error('storage blocked'); return data.get(key); },
            setItem: (key, value) => data.set(key, value) },
            dispatchEvent: event => events.push(event),
            setInterval: callback => { intervals.push(callback); return intervals.length; },
            setTimeout: callback => { timeouts.push(callback); return timeouts.length; } },
        async fetch(url) {
            requests.push(url);
            if (fault === 'offline') throw new Error('offline');
            if (url.startsWith('./flower.json')) return { ok: true, json: async () => ({ flower: catalog }) };
            if (fault === 'http') return { ok: false, status: 503 };
            if (fault === 'json') return { ok: true, json: async () => { throw new Error('bad JSON'); } };
            return { ok: true, json: async () => ({ products }) };
        }
    });
    new vm.Script(fs.readFileSync(filename, 'utf8'), { filename }).runInContext(context);
    return { api: context.window.FlowerInventory, data, intervals, timeouts, requests, events, context };
}
const plain = value => JSON.parse(JSON.stringify(value));
test('API catalog mirrors deletions, keeps polling and does not seed repository products', async () => {
    const f = fixture({ catalog: [{ ...rose, id: 'never-seed' }] });
    const first = f.api.initialize(), second = f.api.initialize();
    assert.equal((await first)[0].id, 'rose'); await second;
    assert.equal(f.requests.filter(url => url.startsWith('./flower.json')).length, 1);
    assert.equal(f.api.areProductsLoaded(), true); assert.equal(f.api.isFirestoreReachable(), false);
    assert.equal(f.api.getMissingCatalogProducts()[0].id, 'never-seed');
    assert.equal(f.intervals.length, 1); assert.equal(f.timeouts.length, 1);
    const empty = fixture({ products: [] });
    assert.deepEqual(plain(await empty.api.initialize()), []);
    assert.deepEqual(plain(empty.api.readProducts()), []);
    assert.equal(empty.api.areProductsLoaded(), true);
});
test('offline startup retains the cached inventory even when the bundled catalog cannot load', async () => {
    const f = fixture({ cached: [rose], fault: 'offline' });
    const result = await f.api.initialize();
    assert.equal(result[0].id, 'rose');
    await new Promise(setImmediate);
    assert.equal(f.api.readProducts()[0].quantity, 4);
});
test('failed API responses do not replace existing inventory or report a successful write', async () => {
    for (const fault of ['http', 'json']) {
        const f = fixture({ cached: [rose], fault });
        await f.api.initialize(); await new Promise(setImmediate);
        assert.equal(f.api.readProducts()[0].id, 'rose');
        await assert.rejects(f.api.saveProducts([]), /Firestore/);
        assert.equal(f.api.readProducts().length, 1);
        assert.equal(await f.api.restoreCatalogProducts(), 0);
    }
    const missing = fixture({ catalog: [{ ...rose, id: 'missing' }], cached: [rose], fault: 'http' });
    await missing.api.initialize(); await new Promise(setImmediate);
    await assert.rejects(missing.api.restoreCatalogProducts(), /Firestore/);
});
test('cache repair replaces damaged titles/legacy images while preserving remote stock and custom IDs', async () => {
    const f = fixture({ cached: [{ ...rose, title: 'Hoa h?ng', image: './images/flower-01.webp', quantity: 2 }] });
    const repaired = await f.api.initialize();
    assert.equal(repaired[0].title, rose.title); assert.equal(repaired[0].image, rose.image);
    assert.equal(repaired[0].quantity, 2);
    assert.equal(f.api.normalizeProduct({ id: 'custom-id', title: 'Custom', price: '1000' }).id, 'custom-id');
    assert.equal(f.api.toVndPrice(Infinity), 0);
});
test('corrupt/blocked storage and unavailable category service fail safely', async () => {
    const f = fixture();
    f.data.set('flowerInventory', '{bad'); f.data.set('flowerCategories', '{bad');
    assert.deepEqual(plain(f.api.readProducts()), []); assert.deepEqual(plain(f.api.readCategories()), []);
    f.data.set('flowerCategories', JSON.stringify([' Rose ', 'Rose', '', 'Tulip']));
    assert.deepEqual(plain(await f.api.getCategories()), ['Rose', 'Tulip']);
    await assert.rejects(f.api.initializeCategories(['Rose']), /Firestore/);
    await assert.rejects(f.api.saveCategories(['Rose']), /Firestore/);
    const unsubscribe = f.api.subscribeCategories(() => { throw new Error('should not receive unverified data'); });
    unsubscribe(); await new Promise(setImmediate);
    const blocked = fixture({ storageFault: true });
    assert.deepEqual(plain(blocked.api.readProducts()), []); assert.deepEqual(plain(blocked.api.readCategories()), []);
});
