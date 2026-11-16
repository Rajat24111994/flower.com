const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const http = require("node:http");
const { createLocalServer } = require("../flower.com/lib/local-server");

async function start(t, options = {}) {
    const server = createLocalServer({ root: path.join(__dirname, "../flower.com"), ...options });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    t.after(() => new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
    }));
    return { base: `http://127.0.0.1:${server.address().port}`, port: server.address().port };
}

test("one local origin serves both the login page and API with JSON body/query parsing", async (t) => {
    const { base } = await start(t, { resolveApi: (route) => route === "login" ? async (req, res) => {
        res.status(200).json({ email: req.body.email, query: req.query, ip: req.headers["x-forwarded-for"] });
    } : null });
    const page = await fetch(`${base}/login.html`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type"), /text\/html/);
    assert.match(await page.text(), /id="signIn"/);
    const response = await fetch(`${base}/api/login?label=a&label=b`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": "attacker" },
        body: JSON.stringify({ email: "customer@example.test" })
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /application\/json/);
    assert.deepEqual(await response.json(), {
        email: "customer@example.test", query: { label: ["a", "b"] }, ip: "127.0.0.1"
    });
});

test("local server never serves credentials, internal source or configuration files", async (t) => {
    const { base } = await start(t);
    for (const file of [".env", ".env.example", "backend/shared/firebase-admin.js", "scripts/dev.js", "backend/accounts/login.js",
        "node_modules/firebase-admin/package.json", "package.json", "firebase.json", "vercel.json", "firestore.rules",
        ".tools/retest-unit.log", "%2eenv", "images/..%5c.env.example"]) {
        assert.equal((await fetch(`${base}/${file}`)).status, 404, file);
    }
    assert.equal((await fetch(`${base}/js/core/firebase-config.js`)).status, 200);
    assert.equal((await fetch(`${base}/flower.json`)).status, 200);
    const head = await fetch(`${base}/login.html`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
});

test("bad JSON and oversized login payloads fail before invoking authentication", async (t) => {
    let called = 0;
    const { base } = await start(t, { resolveApi: () => async (req, res) => { called++; res.json({ ok: true }); } });
    const post = (body) => fetch(`${base}/api/login`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body
    });
    assert.equal((await post("{bad-json")).status, 400);
    assert.equal((await post(JSON.stringify({ password: "x".repeat(33_000) }))).status, 413);
    assert.equal(called, 0);
});

test("different origins and unexpected Host headers cannot reach the local API", async (t) => {
    let called = 0;
    const { base, port } = await start(t, { resolveApi: () => async (req, res) => { called++; res.json({ ok: true }); } });
    const crossOrigin = await fetch(`${base}/api/login`, {
        method: "POST", headers: { Origin: "http://attacker.example", "Content-Type": "application/json" }, body: "{}"
    });
    assert.equal(crossOrigin.status, 403);
    const rebinding = await new Promise((resolve, reject) => {
        const request = http.get({ hostname: "127.0.0.1", port, path: "/api/login", headers: { Host: "attacker.example" } },
            (response) => { response.resume(); resolve(response.statusCode); });
        request.once("error", reject);
    });
    assert.equal(rebinding, 403);
    assert.equal(called, 0);
});

test("missing API routes return JSON and handler errors never disclose secrets", async (t) => {
    const { base } = await start(t, { resolveApi: (route) => route === "broken" ? async () => {
        throw new Error("private-secret-do-not-expose");
    } : null });
    const missing = await fetch(`${base}/api/missing`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).code, "api-not-found");
    const failed = await fetch(`${base}/api/broken`);
    assert.equal(failed.status, 500);
    assert.ok(!(await failed.text()).includes("private-secret"));
});

test("the real login route is reachable and reports missing Firebase setup as JSON", async (t) => {
    const previous = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    t.after(() => {
        if (previous !== undefined) process.env.FIREBASE_SERVICE_ACCOUNT_JSON = previous;
    });
    const { base } = await start(t);
    const response = await fetch(`${base}/api/login`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "customer@example.test", password: "not-a-real-password" })
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "auth-service-unavailable");
});

test("local startup reports missing Firebase configuration before attempting a login", async (t) => {
    let called = false;
    const { base } = await start(t, {
        missingLoginConfiguration: ["FIREBASE_AUTH_SERVER_API_KEY", "FIREBASE_SERVICE_ACCOUNT_JSON"],
        resolveApi: () => async (req, res) => { called = true; res.json({ ok: true }); }
    });
    const response = await fetch(`${base}/api/login`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "customer@example.test", password: "not-a-real-password" })
    });
    assert.equal(response.status, 503);
    const result = await response.json();
    assert.equal(result.code, "login-not-configured");
    assert.match(result.error, /FIREBASE_AUTH_SERVER_API_KEY/);
    assert.match(result.error, /FIREBASE_SERVICE_ACCOUNT_JSON/);
    assert.match(result.error, /\.env/);
    assert.equal(called, false);
});
