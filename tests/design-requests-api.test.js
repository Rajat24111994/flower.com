const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { loadModule, memoryDatabase, adminDependency, call } = require('./helpers/api-fixture');
const { DELIVERY_TIME_WINDOWS } = require('../flower.com/api/orders').internals;
const token = 'private-reference-token-'.repeat(2);
const saved = () => ({ status: 'Chờ khách xác nhận', quotedTotal: 90000,
    accessTokenHash: createHash('sha256').update(token).digest('hex'), history: [] });
function fixture(extra = {}) {
    const db = memoryDatabase({
        'metadata/deliveryZones': { zones: [{ id: 'zone', province: 'Province', district: 'District', fee: 15000, enabled: true }] },
        'metadata/bouquetWrapping': { tiers: [{ maxStems: 50, fee: 5000 }] },
        'products/rose': { title: 'Rose', price: 10000, quantity: 5, saleType: 'flower', colors: ['pink'] },
        'designRequests/request': saved(), ...extra
    });
    const state = {}, auth = { async verifyIdToken() { if (state.tokenError) throw new Error('revoked'); return { uid: 'buyer' }; } };
    const admin = adminDependency(db);
    admin.getAdminFirestore = () => { if (state.databaseError) throw new Error('missing database'); return db; };
    admin.getAdminAuth = () => { if (state.authError) throw new Error('missing auth'); return auth; };
    const handler = loadModule('flower.com/api/design-requests.js', { '../lib/firebase-admin': admin });
    return { handler, db, state };
}
const create = () => ({ action: 'create', customerName: 'Buyer', phone: '0908123456', address: '1 Test Street',
    deliveryDate: '2099-01-01', deliveryTime: DELIVERY_TIME_WINDOWS[0], deliveryZoneId: 'zone',
    stems: [{ productId: 'rose', quantity: 2, color: 'hồng', role: 'main' }], design: {} });

test('guest lookup requires its capability and never reveals the stored access hash', async () => {
    const f = fixture();
    assert.equal((await call(f.handler, 'GET', {}, { id: '../request', token })).statusCode, 400);
    assert.equal((await call(f.handler, 'GET', {}, { id: 'missing', token })).statusCode, 404);
    assert.equal((await call(f.handler, 'GET', {}, { id: 'request', token: 'wrong'.repeat(8) })).statusCode, 404);
    const result = await call(f.handler, 'GET', {}, { id: 'request', token });
    assert.equal(result.statusCode, 200); assert.equal(result.body.request.accessTokenHash, undefined);
    assert.equal((await call(f.handler, 'GET', {}, { manage: '1' })).statusCode, 403);
    const managed = await call(f.handler, 'GET', {}, { manage: '1' }, 'Bearer admin');
    assert.equal(managed.body.requests.length, 1); assert.equal(managed.body.requests[0].accessTokenHash, undefined);
});
test('create calculates price from stored products, returns a one-time capability and does not reserve stock', async () => {
    const f = fixture();
    const result = await call(f.handler, 'POST', { ...create(), estimatedTotal: 1 }, {}, 'Bearer buyer');
    assert.equal(result.statusCode, 201, JSON.stringify(result.body));
    assert.equal(result.body.request.estimatedTotal, 25000);
    assert.equal(result.body.request.subtotal, 20000);
    const path = 'designRequests/' + result.body.request.id;
    const stored = f.db.records.get(path);
    assert.equal(stored.uid, 'buyer'); assert.equal(stored.accessToken, undefined);
    assert.equal(stored.accessTokenHash, createHash('sha256').update(result.body.accessToken).digest('hex'));
    assert.equal(f.db.records.get('products/rose').quantity, 5);
    assert.equal(f.db.writes.filter(write => write.ref.path.startsWith('products/')).length, 0);
});
test('design validation and unavailable products reject before committing any request', async () => {
    for (const changes of [{ phone: '12' }, { customerName: '' }, { deliveryZoneId: '../zone' },
        { deliveryNote: 'x'.repeat(501) }, { referenceImage: 'https://invalid.test/image.png' }, { stems: [] }]) {
        const f = fixture(); assert.equal((await call(f.handler, 'POST', { ...create(), ...changes })).statusCode, 400);
        assert.equal(f.db.writes.length, 0);
    }
    for (const product of [undefined, { status: 'hidden' }, { saleType: 'ready_made' },
        { quantity: 0, saleType: 'flower' }, { quantity: 10, saleType: 'flower', colors: ['white'] }]) {
        const f = fixture();
        if (product === undefined) f.db.records.delete('products/rose');
        else f.db.records.set('products/rose', product);
        assert.equal((await call(f.handler, 'POST', create())).statusCode, 409);
        assert.equal(f.db.writes.length, 0);
    }
    for (const path of ['metadata/deliveryZones', 'metadata/bouquetWrapping']) {
        const f = fixture(); f.db.records.delete(path);
        assert.equal((await call(f.handler, 'POST', create())).statusCode, 409);
        assert.equal(f.db.writes.length, 0);
    }
});
test('quote acceptance/rejection needs the right token and a currently pending quote', async () => {
    for (const response of ['accept', 'reject']) {
        const f = fixture(); const body = { action: 'respond', id: 'request', accessToken: token, response };
        const result = await call(f.handler, 'POST', body);
        assert.equal(result.statusCode, 200); assert.equal(result.body.request.customerResponse, response);
        assert.equal(result.body.request.accessTokenHash, undefined);
        assert.equal(f.db.records.get('designRequests/request').history.length, 1);
        assert.equal((await call(f.handler, 'POST', body)).statusCode, 409);
        assert.equal(f.db.records.get('designRequests/request').history.length, 1);
    }
    const f = fixture();
    assert.equal((await call(f.handler, 'POST', { action: 'respond', id: 'request', accessToken: token, response: 'bad' })).statusCode, 400);
    assert.equal((await call(f.handler, 'POST', { action: 'respond', id: 'missing', accessToken: token, response: 'accept' })).statusCode, 404);
    assert.equal((await call(f.handler, 'POST', { action: 'respond', id: 'request', accessToken: 'bad', response: 'accept' })).statusCode, 404);
    assert.equal(f.db.writes.length, 0);
});
test('admin quote updates require authorization, valid prices and an existing request', async () => {
    const f = fixture(), body = { action: 'admin-update', id: 'request', status: 'Chờ khách xác nhận', quotedTotal: 100000, quoteNote: 'Updated quote' };
    assert.equal((await call(f.handler, 'POST', body)).statusCode, 403);
    for (const changes of [{ quotedTotal: -1 }, { quotedTotal: '' }, { status: 'unsupported' }, { quoteNote: 'x'.repeat(1001) }]) {
        assert.equal((await call(f.handler, 'POST', { ...body, ...changes }, {}, 'Bearer admin')).statusCode, 400);
    }
    assert.equal((await call(f.handler, 'POST', { ...body, id: 'missing' }, {}, 'Bearer admin')).statusCode, 404);
    const updated = await call(f.handler, 'POST', body, {}, 'Bearer admin');
    assert.equal(updated.statusCode, 200); assert.equal(updated.body.request.quotedTotal, 100000);
    assert.equal(updated.body.request.accessTokenHash, undefined);
});
test('configuration, authentication and infrastructure faults fail closed with opaque responses', async t => {
    t.mock.method(console, 'error', () => {});
    const f = fixture();
    f.state.databaseError = true; assert.equal((await call(f.handler)).statusCode, 503); f.state.databaseError = false;
    f.state.authError = true;
    assert.equal((await call(f.handler, 'GET', {}, { manage: '1' }, 'Bearer admin')).statusCode, 503);
    assert.equal((await call(f.handler, 'POST', create(), {}, 'Bearer buyer')).statusCode, 503);
    assert.equal((await call(f.handler, 'POST', { action: 'admin-update' }, {}, 'Bearer admin')).statusCode, 503);
    f.state.authError = false; f.state.tokenError = true;
    assert.equal((await call(f.handler, 'POST', create(), {}, 'Bearer buyer')).statusCode, 401);
    assert.equal((await call(f.handler, 'DELETE')).headers.Allow, 'GET, POST');
    assert.equal((await call(f.handler, 'POST', { action: 'unknown' })).statusCode, 400);
    f.db.runTransaction = async () => { throw new Error('private failure'); };
    const result = await call(f.handler, 'POST', create());
    assert.equal(result.statusCode, 503); assert.ok(!JSON.stringify(result.body).includes('private failure'));
    f.db.collection = () => { throw new Error('private read error'); };
    assert.equal((await call(f.handler, 'GET', {}, { manage: '1' }, 'Bearer admin')).statusCode, 503);
    assert.equal((await call(f.handler, 'GET', {}, { id: 'request', token })).statusCode, 503);
});
