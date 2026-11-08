const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createLocalAccounts } = require("../flower.com/lib/local-accounts");
const { createLocalServer } = require("../flower.com/lib/local-server");
const profile = require("./helpers/local-profile");

async function fixture(t) {
    let time = 1_800_000_000_000;
    const accounts = createLocalAccounts({ now: () => time });
    const server = createLocalServer({ root: path.join(__dirname, "../flower.com"), localAccounts: accounts });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    t.after(() => new Promise((resolve) => {
        server.close(() => { accounts.close(); resolve(); });
        server.closeAllConnections();
    }));
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = (action, body, cookie) => fetch(`${base}/api/local-auth/${action}`, {
        method: action === "session" ? "GET" : "POST",
        headers: { "Content-Type": "application/json", Origin: base, ...(cookie ? { Cookie: cookie } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {})
    });
    return { accounts, base, request, advance(ms) { time += ms; } };
}

test("local pages announce local mode and register/login use an HttpOnly session", async (t) => {
    const { base, request } = await fixture(t);
    const page = await fetch(`${base}/login.html`);
    assert.match(await page.text(), /<script src="\/__local\/auth-runtime\.js"><\/script>/);
    assert.match(await (await fetch(`${base}/__local/auth-runtime.js`)).text(), /FlowerAuthMode = "local"/);
    const registered = await request("register", profile({ email: "own@example.test", password: "Local-password-123", role: "owner" }));
    assert.equal(registered.status, 200);
    const cookie = registered.headers.get("set-cookie");
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    const result = await registered.json();
    assert.equal(result.account.role, "customer");
    assert.equal(result.account.authProvider, "local");
    assert.ok(!Object.hasOwn(result, "sessionToken"));
    assert.equal(result.account.securityConfigured, true);
    assert.ok(!Object.hasOwn(result, "recoveryCode"));
    assert.ok(!JSON.stringify(result).includes(profile().pin));
    assert.ok(!JSON.stringify(result).includes("Local-password-123"));
    const session = await request("session", null, cookie.split(";")[0]);
    assert.equal((await session.json()).account.uid, result.account.uid);
    assert.equal((await request("session")).status, 401);
    assert.equal((await fetch(`${base}/.tools/local-auth/accounts.sqlite`)).status, 404);
});

test("parallel attempts share one account budget and cannot multiply the failure count", async (t) => {
    const { request, advance } = await fixture(t);
    await request("register", profile({ email: "target@demo", password: "Correct-test-password" }));
    const body = { email: "target@demo", password: "wrong" };
    for (let i = 0; i < 4; i++) assert.equal((await request("login", body)).status, 401);
    const results = await Promise.all(Array.from({ length: 20 }, () => request("login", body)));
    assert.ok(results.every((result) => result.status === 429));
    advance(15 * 60_000);
    const second = await request("login", body);
    assert.equal(second.status, 429);
    assert.equal((await second.json()).retryAfter, 1800);
    await request("register", profile({ email: "other@demo", password: "Other-test-password" }));
    assert.equal((await request("login", { email: "other@demo", password: "Other-test-password" })).status, 200);
});

test("mandatory password reset cannot be bypassed by knowing the username", async (t) => {
    const { request, advance } = await fixture(t);
    const registered = await request("register", profile({ email: "locked@demo", password: "Old-test-password" }));
    const cookie = registered.headers.get("set-cookie").split(";")[0];
    const login = (password) => request("login", { email: "locked@demo", password });
    for (let i = 0; i < 4; i++) await login("wrong");
    for (const minutes of [15, 30, 60, 120, 240]) { await login("wrong"); advance(minutes * 60_000); }
    const forced = await login("wrong");
    assert.equal(forced.status, 403);
    assert.equal((await forced.json()).code, "password-reset-required");
    assert.equal((await request("reset", { email: "locked@demo", newPassword: "New-test-password", pin: "123456" })).status, 401);
    assert.equal((await login("Old-test-password")).status, 403);
    assert.equal((await request("reset", { email: "locked@demo", newPassword: "New-test-password", pin: profile().pin })).status, 200);
    assert.equal((await request("session", null, cookie)).status, 401);
    assert.equal((await login("Old-test-password")).status, 401);
    assert.equal((await login("New-test-password")).status, 200);
});

test("PIN API protects secrets, rotates cookies and verifies all three answers", async t => {
    const { request } = await fixture(t);
    const input = profile();
    const registered = await request("register", input);
    const cookie = registered.headers.get("set-cookie").split(";")[0];
    const titles = await (await request("questions", { email: input.email })).json();
    assert.deepEqual(titles, { questions: input.questions.map(item => item.question) });
    const change = { ...input, oldPin: input.pin, newPin: "84710", confirmPin: "84710" };
    assert.equal((await request("change-pin", change)).status, 401);
    assert.equal((await request("change-pin", { ...change, oldPin: "123456" }, cookie)).status, 401);
    const changed = await request("change-pin", change, cookie);
    assert.equal(changed.status, 200);
    const newCookie = changed.headers.get("set-cookie").split(";")[0];
    assert.notEqual(newCookie, cookie);
    assert.equal((await request("session", null, cookie)).status, 401);
    const body = await changed.json();
    for (const key of ["pin", "pin_hash", "security_answers", "sessionToken"]) assert.ok(!Object.hasOwn(body, key));
    assert.equal((await request("setup-security", input, newCookie)).status, 409);
    const recover = { email: input.email, answers: input.questions.map(item => item.answer), newPin: "6273", confirmPin: "6273" };
    assert.equal((await request("recover-pin", { ...recover, answers: ["Sai một", "Sai hai", "Sai ba"] })).status, 401);
    const recovered = await request("recover-pin", recover);
    assert.equal(recovered.status, 200);
    assert.match(recovered.headers.get("set-cookie"), /Max-Age=0/);
    assert.equal((await request("session", null, newCookie)).status, 401);
    assert.equal((await request("reset", { email: input.email, pin: recover.newPin, newPassword: "New-password" })).status, 200);
});

test("five wrong PINs force recovery across endpoints; answers have a separate cooldown", async t => {
    const { request, advance } = await fixture(t);
    const input = profile();
    const registered = await request("register", input);
    const cookie = registered.headers.get("set-cookie").split(";")[0];
    for (let remaining = 4; remaining >= 1; remaining--) {
        const response = await request("reset", { email: input.email, pin: "123456", newPassword: "New-password" });
        assert.equal(response.status, 401); assert.equal((await response.json()).attemptsRemaining, remaining);
    }
    const change = { ...input, oldPin: "123456", newPin: "84710", confirmPin: "84710" };
    const blocked = await request("change-pin", change, cookie);
    assert.equal(blocked.status, 403); assert.equal(blocked.headers.get("retry-after"), null);
    const blockedBody = await blocked.json();
    assert.equal(blockedBody.code, "pin-reset-required"); assert.equal(blockedBody.attemptsRemaining, 0);
    assert.equal((await request("reset", { email: input.email, pin: input.pin, newPassword: "New-password" })).status, 403);
    const parallel = await Promise.all(Array.from({ length: 10 }, () => request("reset", {
        email: input.email, pin: input.pin, newPassword: "New-password"
    })));
    assert.ok(parallel.every(response => response.status === 403));
    const titles = await (await request("questions", { email: input.email })).json();
    assert.equal(titles.pinResetRequired, true); assert.equal(titles.questions.length, 3);
    const recover = { email: input.email, answers: ["Sai một", "Sai hai", "Sai ba"], newPin: "6273", confirmPin: "6273" };
    for (let remaining = 4; remaining >= 0; remaining--) {
        const response = await request("recover-pin", recover);
        assert.equal((await response.json()).attemptsRemaining, remaining);
    }
    assert.equal((await request("questions", { email: input.email })).status, 429);
    advance(15 * 60_000);
    assert.equal((await request("recover-pin", { ...recover, answers: input.questions.map(item => item.answer) })).status, 200);
    assert.equal((await request("reset", { email: input.email, pin: recover.newPin, newPassword: "New-password" })).status, 200);
});
