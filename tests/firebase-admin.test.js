const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModule, response, memoryDatabase } = require('./helpers/api-fixture');

function fixture(t, value) {
    const previous = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (value === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    else process.env.FIREBASE_SERVICE_ACCOUNT_JSON = value;
    t.after(() => { if (previous === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
        else process.env.FIREBASE_SERVICE_ACCOUNT_JSON = previous; });
    const apps = [], initialized = [];
    const auth = { verifyIdToken: async () => ({ uid: 'a', admin: true, role: 'owner' }) };
    const db = memoryDatabase({ 'adminRoles/a': { role: 'owner' } });
    const api = loadModule('flower.com/lib/firebase-admin.js', {
        'firebase-admin/app': { getApps: () => apps, cert: account => ({ account }),
            initializeApp(options) { const app = { options }; initialized.push(app); apps.push(app); return app; } },
        'firebase-admin/auth': { getAuth: () => auth }, 'firebase-admin/firestore': { getFirestore: () => db }
    });
    return { api, auth, db, apps, initialized };
}
test('Admin SDK refuses missing/malformed configuration before initialization', t => {
    for (const value of [undefined, '{invalid']) {
        const f = fixture(t, value);
        assert.throws(() => f.api.getAdminAuth(), { code: 'admin-api-not-configured' });
        assert.equal(f.initialized.length, 0);
    }
});
test('Admin SDK reuses the configured app for Auth and Firestore', t => {
    const f = fixture(t, JSON.stringify({ project_id: 'demo-coverage' }));
    assert.equal(f.api.getAdminAuth(), f.auth);
    assert.equal(f.api.getAdminFirestore(), f.db);
    assert.equal(f.initialized.length, 1);
    assert.equal(f.apps[0].options.credential.account.project_id, 'demo-coverage');
});
test('token verification checks revocation and never accepts missing or failed credentials', async t => {
    const { api, auth } = fixture(t);
    for (const authorization of [undefined, 'Basic abc', 'Bearer ']) {
        const res = response(); assert.equal(await api.verifyRequest({ headers: { authorization } }, res, auth), null);
        assert.equal(res.statusCode, 401);
    }
    auth.verifyIdToken = async (token, revoked) => { assert.equal(token, 'token'); assert.equal(revoked, true); return { uid: 'a' }; };
    assert.equal((await api.verifyRequest({ headers: { authorization: 'Bearer token' } }, response(), auth)).uid, 'a');
    t.mock.method(console, 'error', () => {});
    auth.verifyIdToken = async () => { throw Object.assign(new Error('provider detail'), { code: 'auth/id-token-revoked' }); };
    const res = response(); assert.equal(await api.verifyRequest({ headers: { authorization: 'Bearer token' } }, res, auth), null);
    assert.equal(res.statusCode, 401); assert.ok(!JSON.stringify(res.body).includes('provider detail'));
});
test('admin/owner authorization requires live role data and fails closed on database faults', async t => {
    const { api, db, auth } = fixture(t);
    const req = { headers: { authorization: 'Bearer token' } };
    assert.equal((await api.verifyOwnerRequest(req, response(), auth, db)).uid, 'a');
    for (const claims of [{ uid: 'a' }, { uid: 'missing', admin: true }, { uid: 'a', admin: true, role: 'admin' }]) {
        auth.verifyIdToken = async () => claims;
        const res = response(); assert.equal(await api.verifyOwnerRequest(req, res, auth, db), null);
        assert.equal(res.statusCode, 403);
    }
    auth.verifyIdToken = async () => ({ uid: 'a', admin: true });
    assert.equal((await api.verifyAdminRequest(req, response(), auth, db)).uid, 'a');
    db.records.set('adminRoles/a', { role: 'admin' });
    auth.verifyIdToken = async () => ({ uid: 'a', admin: true, role: 'owner' });
    assert.equal(await api.verifyOwnerRequest(req, response(), auth, db), null);
    t.mock.method(console, 'error', () => {});
    db.collection = () => { throw new Error('database unavailable'); };
    const res = response(); assert.equal(await api.verifyAdminRequest(req, res, auth, db), null);
    assert.equal(res.statusCode, 503);
});
