const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { createLocalAccounts } = require("../flower.com/lib/local-accounts");
const { createLocalServer } = require("../flower.com/lib/local-server");
const { createLocalAuthHandler } = require("../flower.com/lib/local-auth-http");
const { optionalCustomer } = require("../flower.com/backend/shared/request-identity");
const { SESSION_MS, SESSION_SECONDS } = require("../flower.com/lib/local-session");
const profile = require("./helpers/local-profile");

async function fixture(t) {
    let time = Date.now();
    const accounts = createLocalAccounts({ now: () => time });
    const server = createLocalServer({ root: path.join(__dirname, "../flower.com"), localAccounts: accounts,
        resolveApi: () => async (req, res) => {
            try {
                const account = await optionalCustomer(req);
                return account ? res.json({ uid: account.uid }) : res.status(401).json({ error: "unauthenticated" });
            } catch { return res.status(401).json({ error: "unauthenticated" }); }
        } });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise(resolve => { server.close(() => { accounts.close(); resolve(); }); server.closeAllConnections(); }));
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = (action, body, cookie, options = {}) => fetch(`${base}/api/local-auth/${action}`, {
        method: action === "session" ? "GET" : "POST",
        headers: { "Content-Type": "application/json", Origin: base, ...(cookie ? { Cookie: cookie } : {}), ...options.headers },
        ...(body ? { body: JSON.stringify(body) } : {}), ...options,
        ...(options.headers ? { headers: { "Content-Type": "application/json", Origin: base, ...(cookie ? { Cookie: cookie } : {}), ...options.headers } } : {})
    });
    const privateRequest = cookie => fetch(`${base}/api/private`, { headers: cookie ? { Cookie: cookie } : {} });
    return { accounts, base, request, privateRequest, now: () => time, advance: ms => { time += ms; } };
}
const cookieOf = response => response.headers.get("set-cookie").split(";")[0];

test("sessions expire at exactly 12 hours; reads cannot slide expiry and copied cookies fail at protected APIs", async t => {
    const h = await fixture(t);
    const registered = await h.request("register", profile());
    const cookie = cookieOf(registered), header = registered.headers.get("set-cookie"), body = await registered.json();
    assert.equal(body.account.sessionExpiresAt, h.now() + SESSION_MS);
    assert.match(header, /HttpOnly/); assert.match(header, /SameSite=Strict/); assert.match(header, /Path=\//);
    assert.match(header, new RegExp(`Max-Age=${SESSION_SECONDS}`)); assert.ok(!header.includes("Domain="));
    assert.ok(!Object.hasOwn(body, "sessionToken"));
    h.advance(SESSION_MS - 1);
    const before = await h.request("session", null, cookie);
    assert.equal(before.status, 200); assert.equal(before.headers.get("set-cookie"), null);
    assert.equal((await before.json()).account.sessionExpiresAt, body.account.sessionExpiresAt);
    h.advance(1);
    const expired = await h.request("session", null, cookie);
    assert.equal(expired.status, 401);
    assert.match(expired.headers.get("set-cookie"), /Max-Age=0/);
    assert.match(expired.headers.get("set-cookie"), /Expires=Thu, 01 Jan 1970/);
    assert.equal((await h.privateRequest(cookie)).status, 401);
});

test("successful re-login rotates the presented cookie; failure does not revoke it and other devices keep their sessions", async t => {
    const h = await fixture(t), input = profile();
    const old = cookieOf(await h.request("register", input));
    const otherDevice = cookieOf(await h.request("login", input));
    assert.equal((await h.request("login", { ...input, password: "wrong" }, old)).status, 401);
    assert.equal((await h.privateRequest(old)).status, 200);
    const replacement = cookieOf(await h.request("login", input, old));
    assert.notEqual(replacement, old);
    assert.equal((await h.privateRequest(old)).status, 401);
    assert.equal((await h.privateRequest(replacement)).status, 200);
    assert.equal((await h.privateRequest(otherDevice)).status, 200);
    assert.equal((await h.request("logout", null, replacement)).status, 200);
    assert.equal((await h.privateRequest(replacement)).status, 401);
    assert.equal((await h.privateRequest(otherDevice)).status, 200);
});

test("logout rejects cross-origin and GET requests, revokes the server record and is idempotent", async t => {
    const h = await fixture(t);
    const cookie = cookieOf(await h.request("register", profile()));
    assert.equal((await h.request("logout", null, cookie, { method: "GET" })).status, 405);
    assert.equal((await h.request("logout", null, cookie, { headers: { Origin: "https://attacker.example" } })).status, 403);
    assert.equal((await h.privateRequest(cookie)).status, 200);
    const logout = await h.request("logout", null, cookie);
    assert.equal(logout.status, 200); assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
    assert.equal((await h.request("session", null, cookie)).status, 401);
    assert.equal((await h.privateRequest(cookie)).status, 401);
    assert.equal((await h.request("logout", null, cookie)).status, 200);
});

test("ambiguous cookies cannot choose an account and logout revokes all presented tokens", async t => {
    const h = await fixture(t), input = profile();
    const first = cookieOf(await h.request("register", input));
    const second = cookieOf(await h.request("login", input));
    const ambiguous = first + "; " + second;
    assert.equal((await h.request("session", null, ambiguous)).status, 401);
    assert.equal((await h.privateRequest(ambiguous)).status, 401);
    assert.equal((await h.request("logout", null, ambiguous)).status, 200);
    assert.equal((await h.privateRequest(first)).status, 401);
    assert.equal((await h.privateRequest(second)).status, 401);
});

test("recovery revokes the target's sessions and any different account cookie being cleared", async t => {
    const h = await fixture(t), first = profile(), target = profile({ email: "recovery-target@demo" });
    const firstCookie = cookieOf(await h.request("register", first));
    const otherDevice = cookieOf(await h.request("login", first));
    const targetCookie = cookieOf(await h.request("register", target));
    const newPassword = "New-target-password-456";
    assert.equal((await h.request("reset", { ...target, newPassword }, firstCookie)).status, 200);
    assert.equal((await h.privateRequest(firstCookie)).status, 401);
    assert.equal((await h.privateRequest(targetCookie)).status, 401);
    assert.equal((await h.privateRequest(otherDevice)).status, 200);
    const nextFirst = cookieOf(await h.request("login", first));
    const nextTarget = cookieOf(await h.request("login", { ...target, password: newPassword }));
    assert.equal((await h.request("recover-pin", { ...target, answers: target.questions.map(q => q.answer), newPin: "6273", confirmPin: "6273" }, nextFirst)).status, 200);
    assert.equal((await h.privateRequest(nextFirst)).status, 401);
    assert.equal((await h.privateRequest(nextTarget)).status, 401);
    assert.equal((await h.privateRequest(otherDevice)).status, 200);
});

test("HTTPS issuance and deletion use Secure; forwarded headers cannot impersonate TLS on localhost", async t => {
    const accounts = createLocalAccounts(); t.after(() => accounts.close());
    const handler = createLocalAuthHandler(accounts);
    async function call(action, body, cookie, encrypted) {
        const headers = {}; let status, result;
        const req = { method: action === "session" ? "GET" : "POST", body, headers: { cookie, "x-forwarded-proto": "https" }, socket: { encrypted, remoteAddress: "127.0.0.1" } };
        const res = { setHeader: (key, value) => { headers[key] = value; }, status(value) { status = value; return this; }, json(value) { result = value; } };
        await handler(action, req, res);
        return { status, headers, result };
    }
    const secure = await call("register", profile(), "", true);
    assert.equal(secure.status, 200); assert.match(secure.headers["Set-Cookie"], /; Secure$/);
    const cookie = secure.headers["Set-Cookie"].split(";")[0];
    const deleted = await call("logout", null, cookie, true);
    assert.match(deleted.headers["Set-Cookie"], /Max-Age=0/); assert.match(deleted.headers["Set-Cookie"], /; Secure$/);
    assert.equal((await call("session", null, cookie, true)).status, 401);
    const local = await call("register", profile({ email: "local@demo" }), "", false);
    assert.equal(local.status, 200); assert.ok(!local.headers["Set-Cookie"].includes("; Secure"));
});

test("expiry and logout remain effective after reopening the SQLite database", t => {
    const folder = path.join(__dirname, "../flower.com/.tools/session-tests"); fs.mkdirSync(folder, { recursive: true });
    const filename = path.join(folder, randomUUID() + ".sqlite");
    let time = Date.now();
    const input = profile();
    let accounts = createLocalAccounts({ filename, now: () => time });
    t.after(() => accounts.close());
    const first = accounts.register(input);
    accounts.close(); accounts = createLocalAccounts({ filename, now: () => time });
    time += SESSION_MS - 1; assert.ok(accounts.session(first.sessionToken));
    time++; assert.equal(accounts.session(first.sessionToken), null);
    const second = accounts.login(input); accounts.logout(second.sessionToken);
    accounts.close(); accounts = createLocalAccounts({ filename, now: () => time });
    assert.equal(accounts.session(second.sessionToken), null);
});
