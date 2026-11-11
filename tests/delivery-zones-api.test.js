const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModule, memoryDatabase, adminDependency, call } = require('./helpers/api-fixture');
const zone = (id = 'one', enabled = true) => ({ id, province: 'Province', district: id, fee: 20000, enabled });
function fixture(seed = {}) {
    const db = memoryDatabase(seed), admin = adminDependency(db), audits = [];
    const handler = loadModule('flower.com/api/delivery-zones.js', {
        '../lib/firebase-admin': admin, '../lib/admin-audit': { addAdminAudit: (...args) => audits.push(args) }
    });
    return { db, admin, audits, handler };
}
test('public zones filter disabled/malformed data; privileged reads require authorization', async () => {
    const f = fixture({ 'metadata/deliveryZones': { zones: [zone(), zone('disabled', false), { id: 'invalid' }] } });
    const publicResult = await call(f.handler);
    assert.deepEqual(publicResult.body, { configured: true, zones: [zone()] });
    assert.equal(publicResult.headers['Cache-Control'], 'no-store');
    assert.equal((await call(f.handler, 'GET', {}, { manage: '1' })).statusCode, 403);
    assert.equal((await call(f.handler, 'GET', {}, { manage: '1' }, 'Bearer admin')).body.zones.length, 2);
    assert.deepEqual((await call(fixture().handler)).body, { configured: false, zones: [] });
});
test('zone writes replace by ID, audit changes and delete without losing other areas', async () => {
    const f = fixture({ 'metadata/deliveryZones': { zones: [zone(), zone('two')] } });
    const updated = { ...zone(), fee: 0 };
    assert.equal((await call(f.handler, 'POST', { action: 'upsert', zone: updated }, {}, 'Bearer admin')).statusCode, 200);
    assert.equal(f.db.records.get('metadata/deliveryZones').zones.find(z => z.id === 'one').fee, 0);
    assert.equal(f.audits.length, 1);
    const deleted = await call(f.handler, 'POST', { action: 'delete', id: 'one' }, {}, 'Bearer admin');
    assert.deepEqual(deleted.body.zones, [zone('two')]);
});
test('invalid/duplicate zone writes never commit and service errors stay opaque', async t => {
    t.mock.method(console, 'error', () => {});
    const f = fixture({ 'metadata/deliveryZones': { zones: [zone()] } });
    assert.equal((await call(f.handler, 'POST', { action: 'delete', id: 'one' })).statusCode, 403);
    for (const body of [{ action: 'bad' }, { action: 'delete', id: '../bad' }, { action: 'upsert', zone: { ...zone(), fee: -1 } }]) {
        assert.equal((await call(f.handler, 'POST', body, {}, 'Bearer admin')).statusCode, 400);
    }
    const duplicate = { ...zone('other'), district: 'ONE', province: 'PROVINCE' };
    assert.equal((await call(f.handler, 'POST', { action: 'upsert', zone: duplicate }, {}, 'Bearer admin')).statusCode, 409);
    assert.equal(f.db.writes.length, 0);
    assert.equal((await call(f.handler, 'PATCH')).headers.Allow, 'GET, POST');
    f.db.runTransaction = async () => { throw new Error('private infrastructure'); };
    const failed = await call(f.handler, 'POST', { action: 'delete', id: 'one' }, {}, 'Bearer admin');
    assert.equal(failed.statusCode, 503); assert.ok(!JSON.stringify(failed.body).includes('private infrastructure'));
    f.admin.getAdminFirestore = () => { throw new Error('missing config'); };
    // The loaded handler captures its dependency functions, so use a fresh isolated module.
    const handler = loadModule('flower.com/api/delivery-zones.js', { '../lib/firebase-admin': f.admin });
    assert.equal((await call(handler)).statusCode, 503);
});
