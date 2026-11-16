const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const publicKey = fs.readFileSync(path.join(__dirname, "../flower.com/js/core/firebase-config.js"), "utf8")
    .match(/apiKey:\s*"([^"]+)"/)[1];

function setup(t, overrides = {}) {
    const vars = {
        FIREBASE_AUTH_EMULATOR_HOST: undefined, VERCEL: undefined, NODE_ENV: "test",
        FIREBASE_AUTH_PUBLIC_API_KEY: publicKey,
        FIREBASE_AUTH_SERVER_API_KEY: "private-server-test-key",
        FIREBASE_SERVICE_ACCOUNT_JSON: "private-test-account-secret",
        ...overrides
    };
    for (const [key, value] of Object.entries(vars)) {
        const previous = process.env[key];
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
        t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
    }
    delete require.cache[require.resolve("../flower.com/backend/accounts/password-auth")];
    return require("../flower.com/backend/accounts/password-auth");
}

function json(status, body) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }); }
function blockedResponse(method = "SignInWithPassword") {
    return json(403, { error: { details: [{ reason: "API_KEY_SERVICE_BLOCKED",
        metadata: { method: `google.cloud.identitytoolkit.v1.AuthenticationService.${method}` } }] } });
}
const auth = { app: { options: { projectId: "demo-flowerflow", credential: {
    async getAccessToken() { return { access_token: "private-oauth-token" }; }
} } } };

test("checks both public password entry points and caches only the verified result", async (t) => {
    const { assertPublicPasswordSignInBlocked } = setup(t);
    const urls = [];
    t.mock.method(globalThis, "fetch", async (url, options) => {
        urls.push(url);
        assert.equal(options.redirect, "error");
        return blockedResponse();
    });
    await assertPublicPasswordSignInBlocked();
    await assertPublicPasswordSignInBlocked();
    assert.equal(urls.length, 2);
    assert.match(urls[0], /accounts:signInWithPassword/);
    assert.match(urls[1], /relyingparty\/verifyPassword/);
});

test("an unprotected current or legacy endpoint prevents login", async (t) => {
    const { assertPublicPasswordSignInBlocked } = setup(t);
    let request = 0;
    t.mock.method(globalThis, "fetch", async () => ++request === 1
        ? blockedResponse() : json(400, { error: { message: "INVALID_LOGIN_CREDENTIALS" } }));
    await assert.rejects(assertPublicPasswordSignInBlocked, { code: "auth-service-unavailable" });
    // Failed probes must not be cached as a successful configuration.
    await assert.rejects(assertPublicPasswordSignInBlocked, { code: "auth-service-unavailable" });
    assert.ok(request > 2);
});

for (const [label, response] of [
    ["referrer restriction", () => json(403, { error: { details: [{ reason: "API_KEY_HTTP_REFERRER_BLOCKED" }] } })],
    ["Firebase throttling", () => json(429, { error: { message: "TOO_MANY_ATTEMPTS_TRY_LATER" } })],
    ["unrelated API restriction", () => blockedResponse("GetAccountInfo")],
    ["provider outage", () => json(503, { error: {} })]
]) {
    test(`${label} cannot be mistaken for password endpoint protection`, async (t) => {
        const { assertPublicPasswordSignInBlocked } = setup(t);
        t.mock.method(globalThis, "fetch", async () => response());
        await assert.rejects(assertPublicPasswordSignInBlocked, { code: "auth-service-unavailable" });
    });
}

test("a wrong browser key or shared public/server key fails closed", async (t) => {
    const { assertPublicPasswordSignInBlocked } = setup(t, { FIREBASE_AUTH_PUBLIC_API_KEY: "different-public-key" });
    await assert.rejects(assertPublicPasswordSignInBlocked, { code: "auth-service-unavailable" });
    process.env.FIREBASE_AUTH_PUBLIC_API_KEY = publicKey;
    process.env.FIREBASE_AUTH_SERVER_API_KEY = publicKey;
    await assert.rejects(assertPublicPasswordSignInBlocked, { code: "auth-service-unavailable" });
});

test("emulator shortcuts cannot be enabled on a deployed server or remote host", async (t) => {
    const { createPasswordAuth } = setup(t, { FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099", VERCEL: "1" });
    assert.throws(() => createPasswordAuth(auth), { code: "auth-service-unavailable" });
    delete process.env.VERCEL;
    process.env.FIREBASE_AUTH_EMULATOR_HOST = "attacker.example:9099";
    assert.throws(() => createPasswordAuth(auth), { code: "auth-service-unavailable" });
});

test("account lookup uses authenticated server metadata and stable UID, not client state", async (t) => {
    const { createPasswordAuth } = setup(t);
    t.mock.method(globalThis, "fetch", async (url, options) => {
        assert.match(url, /projects\/demo-flowerflow\/accounts:lookup$/);
        assert.equal(options.headers.Authorization, "Bearer private-oauth-token");
        assert.deepEqual(JSON.parse(options.body), { email: ["customer@example.test"] });
        return json(200, { users: [{ localId: "uid-1", passwordUpdatedAt: 123456, passwordHash: "never-return-this" }] });
    });
    const account = await createPasswordAuth(auth).lookup("customer@example.test");
    assert.deepEqual(account, { key: "uid-1", uid: "uid-1", passwordUpdatedAt: 123456, disabled: false });
});

test("unknown emails get opaque keys and a failed metadata lookup fails closed", async (t) => {
    const { createPasswordAuth } = setup(t);
    let status = 200;
    t.mock.method(globalThis, "fetch", async () => json(status, status === 200 ? {} : { error: {} }));
    const provider = createPasswordAuth(auth);
    const first = await provider.lookup("missing@example.test");
    assert.match(first.key, /^unknown-[a-f0-9]{64}$/);
    assert.equal((await provider.lookup("missing@example.test")).key, first.key);
    assert.notEqual((await provider.lookup("other@example.test")).key, first.key);
    status = 503;
    await assert.rejects(() => provider.lookup("missing@example.test"), { code: "auth-service-unavailable" });
});

test("only password errors count; successful upstream tokens are never returned", async (t) => {
    const { createPasswordAuth } = setup(t);
    let status = 400;
    let data = { error: { message: "INVALID_LOGIN_CREDENTIALS" } };
    t.mock.method(globalThis, "fetch", async (url, options) => {
        assert.ok(url.endsWith("key=private-server-test-key"));
        assert.deepEqual(JSON.parse(options.body), { email: "customer@example.test", password: "test-password", returnSecureToken: true });
        return json(status, data);
    });
    const verify = () => createPasswordAuth(auth).verifyPassword("customer@example.test", "test-password", { uid: "uid-1" });
    assert.equal(await verify(), false);
    for (const code of ["TOO_MANY_ATTEMPTS_TRY_LATER", "USER_DISABLED", "API_KEY_INVALID"]) {
        data = { error: { message: code } };
        await assert.rejects(verify, { code: "auth-service-unavailable" });
    }
    status = 200;
    data = { localId: "uid-1", idToken: "private-id-token", refreshToken: "private-refresh-token" };
    assert.equal(await verify(), true);
    data.localId = "different-account";
    await assert.rejects(verify, { code: "auth-service-unavailable" });
});
