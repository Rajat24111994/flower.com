// Real client/Admin SDKs + Auth/Firestore emulators + HTTP to the native C# host.
// Never production, never a SQLite session, never a mocked verifyIdToken.
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { initializeApp, deleteApp } = require("firebase/app");
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword, signInWithCustomToken,
    signOut, inMemoryPersistence, setPersistence } = require("firebase/auth");
const h = require("./helpers");
const options = { timeout: 60_000, skip: !process.env.FLOWER_API_URL && "Requires native ASP.NET HTTP host: node aspnet/test-api.cjs" };
const mine = token => h.callApi("orders", { method: "GET", query: { action: "mine" }, token });
const revoke = (token, extra = {}) => h.callApi("firebaseLogout", { token, body: {}, ...extra });
const boundary = () => new Promise(resolve => setTimeout(resolve, 1100));

test.beforeEach(async () => { if (process.env.FLOWER_API_URL) await h.resetEmulators(); });

async function device(t, account) {
    const app = initializeApp({ projectId: h.PROJECT_ID, apiKey: "fake-api-key" }, randomUUID());
    t.after(() => deleteApp(app));
    const auth = getAuth(app);
    connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
    await setPersistence(auth, inMemoryPersistence);
    await signInWithEmailAndPassword(auth, account.email, account.password);
    return auth;
}

test("Firebase client signOut affects this session; exact saved tokens and second device still reach protected API", options, async t => {
    const account = await h.createUser();
    const first = await device(t, account);
    const savedFirst = await first.currentUser.getIdToken();
    await boundary();
    const second = await device(t, account);
    const savedSecond = await second.currentUser.getIdToken();
    assert.equal(first !== second && first.currentUser !== second.currentUser, true, "independent in-memory client instances");
    assert.equal(savedFirst !== savedSecond, true, "two distinct saved ID tokens");
    assert.equal((await mine(savedFirst)).status, 200);
    assert.equal((await mine(savedSecond)).status, 200);
    await signOut(first);
    assert.equal(first.currentUser, null);
    assert.equal(second.currentUser.uid, account.uid);
    assert.equal((await mine(savedFirst)).status, 200, "copied token is NOT revoked by browser signOut");
    assert.equal((await mine(savedSecond)).status, 200);
    assert.equal((await mine(await second.currentUser.getIdToken(true))).status, 200);
});

test("Firebase logout-all rejects exact saved tokens from two devices, preserves other account, permits fresh custom-token login", options, async t => {
    const account = await h.createUser(), other = await h.createUser();
    const first = await device(t, account);
    const savedFirst = await first.currentUser.getIdToken();
    await boundary();
    const second = await device(t, account);
    const savedSecond = await second.currentUser.getIdToken();
    assert.equal(first !== second && first.currentUser !== second.currentUser, true, "independent in-memory client instances");
    assert.equal(savedFirst !== savedSecond, true, "two distinct saved ID tokens");
    assert.equal((await mine(savedFirst)).status, 200);
    assert.equal((await mine(savedSecond)).status, 200);
    await boundary();
    const result = await revoke(savedFirst);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { ok: true, scope: "all" });
    assert.equal(result.headers["cache-control"], "no-store");
    await signOut(first);
    assert.equal((await mine(savedFirst)).status, 401);
    assert.equal((await mine(savedSecond)).status, 401);
    assert.equal((await revoke(savedFirst)).status, 401);
    assert.equal((await mine(other.token)).status, 200);
    // Same custom-token exchange used by the existing password-login frontend.
    await boundary();
    await signInWithCustomToken(first, await h.auth().createCustomToken(account.uid));
    assert.equal((await mine(await first.currentUser.getIdToken())).status, 200);
    assert.equal((await mine(savedFirst)).status, 401, "fresh login must not resurrect saved tokens");
});

test("Auth Emulator limitation: a revoked refresh grant can mint a new accepted ID token (not live-provider evidence)", options, async t => {
    const account = await h.createUser();
    const auth = await device(t, account);
    const saved = await auth.currentUser.getIdToken();
    await boundary();
    assert.equal((await revoke(saved)).status, 200);
    assert.equal((await mine(saved)).status, 401);
    // firebase-tools 13.35.1 does not check tokensValidAfterTime in validateRefreshToken.
    // The .NET SDK compares iat with the revocation cutoff, so the emulator's newly
    // issued token is accepted. With a real provider this refresh must be rejected.
    let refreshed;
    try { refreshed = await auth.currentUser.getIdToken(true); }
    catch { t.diagnostic("This Auth Emulator version rejects revoked refresh grants."); return; }
    assert.equal((await mine(refreshed)).status, 200);
    assert.equal((await mine(saved)).status, 401);
    t.diagnostic("KNOWN EMULATOR LIMITATION: old refresh grant produced a newly accepted unsigned ID token. Real Firebase refresh revocation is NOT verified.");
});

test("Firebase logout-all never accepts a target UID, unauthenticated/local cookie, wrong method, or invalid token", options, async () => {
    const caller = await h.createUser(), victim = await h.createUser();
    assert.equal((await revoke(undefined)).status, 401);
    assert.equal((await revoke(undefined, { headers: { Cookie: "flowerflow_session=local-session" } })).status, 401);
    assert.equal((await revoke("invalid-token")).status, 401);
    assert.equal((await revoke(caller.token, { method: "GET" })).status, 405);
    assert.equal((await revoke(caller.token, { body: { uid: victim.uid } })).status, 400);
    assert.equal((await revoke(caller.token, { query: { uid: victim.uid } })).status, 400);
    assert.equal((await revoke(caller.token, { body: { scope: "device" } })).status, 400);
    assert.equal((await revoke(caller.token, { headers: { Origin: "https://attacker.example" } })).status, 403);
    assert.equal((await mine(caller.token)).status, 200);
    assert.equal((await mine(victim.token)).status, 200);
    await boundary();
    assert.equal((await revoke(caller.token)).status, 200);
    assert.equal((await mine(caller.token)).status, 401);
    assert.equal((await mine(victim.token)).status, 200);
});

test("C# Firebase verification rejects invalid and expired emulator ID tokens at protected API and revocation endpoint", options, async () => {
    const user = await h.createUser();
    const parts = user.token.split(".");
    const claims = JSON.parse(Buffer.from(parts[1], "base64url"));
    claims.exp = Math.floor(Date.now() / 1000) - 3600;
    claims.iat = claims.exp - 3600;
    // Auth Emulator tokens are unsigned. This tests SDK expiration checks, not production signatures.
    const expired = `${parts[0]}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.`;
    assert.equal((await mine(user.token)).status, 200);
    for (const token of ["not-a-token", expired]) {
        assert.equal((await mine(token)).status, 401);
        assert.equal((await revoke(token)).status, 401);
    }
    assert.equal((await mine(user.token)).status, 200);
});

test("revoked admin token is rejected by protected C# management endpoints without removing role membership", options, async () => {
    const admin = await h.createUser("owner");
    const checks = () => Promise.all([
        h.callApi("adminUsers", { token: admin.token, body: {} }),
        h.callApi("products", { method: "GET", token: admin.token, query: { manage: "1" } }),
        h.callApi("deliveryZones", { method: "GET", token: admin.token, query: { manage: "1" } }),
        h.callApi("bouquetWrapping", { method: "GET", token: admin.token, query: { manage: "1" } })
    ]);
    assert.deepEqual((await checks()).map(r => r.status), [200, 200, 200, 200]);
    await boundary();
    assert.equal((await revoke(admin.token)).status, 200);
    assert.deepEqual((await checks()).map(r => r.status), [401, 401, 401, 401]);
    assert.equal((await h.db().doc(`adminRoles/${admin.uid}`).get()).exists, true);
});

test("direct Firestore replay documents limitation: saved unexpired token can still read own cart after API revocation", options, async () => {
    const user = await h.createUser(), other = await h.createUser();
    await h.db().doc(`shoppingCarts/${user.uid}`).set({ cart: [], wish: [] });
    const url = `http://${h.FIRESTORE_HOST}/v1/projects/${h.PROJECT_ID}/databases/(default)/documents/shoppingCarts/${user.uid}`;
    const direct = token => fetch(url, { headers: { authorization: `Bearer ${token}` } });
    const saved = user.token;
    assert.equal((await direct(saved)).status, 200);
    assert.equal((await direct(other.token)).status, 403);
    await boundary();
    assert.equal((await revoke(saved)).status, 200);
    assert.equal((await mine(saved)).status, 401);
    assert.equal((await direct(saved)).status, 200, "existing Rules do not consult Auth revocation time");
});
