const test = require("node:test");
const assert = require("node:assert/strict");
const { createLoginProtection } = require("../flower.com/backend/accounts/login-protection");
const { createLoginHandler } = require("../flower.com/backend/accounts/login");
const { memoryDb } = require("./helpers/login-memory-db");

function fixture() {
    const db = memoryDb();
    let time = 1_800_000_000_000;
    let passwordUpdatedAt = 1000;
    let valid = false;
    let upstreamError = false;
    let checked = 0;
    let minted = 0;
    let ready = true;
    const protection = createLoginProtection(db, { now: () => time });
    const provider = {
        async assertReady() { if (!ready) throw new Error("not protected"); },
        async lookup(email) { return { key: email, uid: email, passwordUpdatedAt }; },
        async verifyPassword() {
            checked++;
            if (upstreamError) throw new Error("network failure");
            return valid;
        }
    };
    const handler = createLoginHandler({ db, protection, provider,
        auth: { async createCustomToken() { minted++; return "session-token"; } } });
    async function login({ email = "customer@example.test", password = "wrong", ip = "203.0.113.7", method = "POST" } = {}) {
        const response = { headers: {}, status: 200 };
        const res = {
            setHeader(name, value) { response.headers[name] = value; },
            status(status) { response.status = status; return this; },
            json(body) { response.body = body; return this; }
        };
        await handler({ method, body: { email, password }, headers: { "x-forwarded-for": ip } }, res);
        return response;
    }
    return { db, protection, login, advance(ms) { time += ms; },
        changePassword() { passwordUpdatedAt++; }, setValid(value) { valid = value; },
        setOutage(value) { upstreamError = value; }, setReady(value) { ready = value; },
        get checked() { return checked; }, get minted() { return minted; } };
}

test("5 wrong passwords, five increasing lockouts, then the 10th failure requires a reset", async () => {
    const f = fixture();
    for (let attempt = 1; attempt <= 4; attempt++) assert.equal((await f.login()).status, 401);
    for (const minutes of [15, 30, 60, 120, 240]) {
        const locked = await f.login();
        assert.equal(locked.status, 429);
        assert.equal(locked.body.retryAfter, minutes * 60);
        assert.equal(locked.headers["Retry-After"], String(minutes * 60));
        const count = f.checked;
        // Correct passwords are not checked during the lockout, nor do requests extend it.
        f.setValid(true);
        f.advance(minutes * 60_000 - 1);
        assert.equal((await f.login()).body.retryAfter, 1);
        assert.equal(f.checked, count);
        f.setValid(false);
        f.advance(1);
    }
    const reset = await f.login();
    assert.equal(reset.status, 403);
    assert.equal(reset.body.code, "password-reset-required");
    assert.equal(f.checked, 10);
    f.advance(365 * 24 * 60 * 60_000);
    f.setValid(true);
    assert.equal((await f.login()).body.code, "password-reset-required");
    assert.equal(f.checked, 10);
    assert.equal(f.minted, 0);
});

test("rotating IPs and changing email case cannot give one account extra attempts", async () => {
    const f = fixture();
    for (let i = 1; i <= 5; i++) {
        const response = await f.login({ email: i % 2 ? " CUSTOMER@EXAMPLE.TEST " : "customer@example.test", ip: `203.0.113.${i}` });
        assert.equal(response.status, i < 5 ? 401 : 429);
    }
    assert.equal((await f.login({ ip: "198.51.100.8" })).status, 429);
    assert.equal(f.checked, 5);
    assert.equal((await f.login({ email: "other@example.test" })).status, 401);
});

test("success clears the complete failure history, including after a lockout", async () => {
    const f = fixture();
    for (let i = 0; i < 5; i++) await f.login();
    f.advance(15 * 60_000);
    f.setValid(true);
    const success = await f.login();
    assert.equal(success.status, 200);
    assert.equal(success.body.customToken, "session-token");
    assert.equal(success.headers["Cache-Control"], "no-store");
    f.setValid(false);
    for (let i = 0; i < 4; i++) assert.equal((await f.login()).status, 401);
    assert.equal((await f.login()).body.retryAfter, 900);
});

test("only a confirmed Firebase password change clears mandatory recovery", async () => {
    const f = fixture();
    for (let i = 0; i < 4; i++) await f.login();
    for (const minutes of [15, 30, 60, 120, 240]) { await f.login(); f.advance(minutes * 60_000); }
    assert.equal((await f.login()).body.code, "password-reset-required");
    // Elapsing time, providing a password or requesting an email does not change the server version.
    f.advance(24 * 60 * 60_000);
    f.setValid(true);
    assert.equal((await f.login()).status, 403);
    f.changePassword();
    assert.equal((await f.login()).status, 200);
});

test("provider errors do not increase failures and a missing protection setup fails closed", async () => {
    const f = fixture();
    for (let i = 0; i < 4; i++) await f.login();
    f.setOutage(true);
    for (let i = 0; i < 6; i++) assert.equal((await f.login()).status, 503);
    f.setOutage(false);
    assert.equal((await f.login()).body.retryAfter, 900);
    const checked = f.checked;
    f.setReady(false);
    assert.equal((await f.login()).status, 503);
    assert.equal(f.checked, checked);
});

test("concurrent requests across instances cannot race past the fifth attempt", async () => {
    const f = fixture();
    for (let i = 0; i < 4; i++) await f.login();
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => f.login({ ip: `203.0.113.${i}` })));
    assert.equal(f.checked, 5);
    assert.ok(results.every((result) => [409, 429].includes(result.status)));
    const secondInstance = createLoginProtection(f.db);
    assert.equal((await secondInstance.acquire("customer@example.test", 1000)).code, "account-locked");
});

test("a crashed attempt expires without granting a stale request a session", async () => {
    const f = fixture();
    const first = await f.protection.acquire("customer@example.test", 1000);
    assert.equal((await f.login()).status, 409);
    f.advance(60_000);
    const next = await f.protection.acquire("customer@example.test", 1000);
    assert.equal((await f.protection.finish(first, "success")).status, 503);
    assert.equal((await f.protection.finish(next, "invalid")).status, 401);
});

test("a delayed metadata lookup cannot downgrade the password version and clear a later lock", async () => {
    const db = memoryDb();
    db.records.set("loginProtection/customer", {
        failures: 4, lockedUntil: 0, resetRequired: false, passwordUpdatedAt: 2000
    });
    const guard = createLoginProtection(db, { now: () => 1_800_000_000_000 });
    const delayed = await guard.acquire("customer", 1000);
    assert.equal((await guard.finish(delayed, "invalid")).code, "account-locked");
    assert.equal((await guard.acquire("customer", 2000)).code, "account-locked");
});

test("malformed requests and unsupported methods never check a password", async () => {
    const f = fixture();
    assert.equal((await f.login({ method: "GET" })).status, 405);
    assert.equal((await f.login({ email: "invalid" })).status, 400);
    assert.equal((await f.login({ password: "" })).status, 400);
    assert.equal((await f.login({ password: "x".repeat(4097) })).status, 400);
    assert.equal(f.checked, 0);
});
