const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createLocalAccounts } = require("../flower.com/lib/local-accounts");
const { createLocalAccountWorker } = require("../flower.com/lib/local-account-worker");
const { createLocalServer } = require("../flower.com/lib/local-server");
const { optionalCustomer } = require("../flower.com/lib/request-identity");
const profile = require("./helpers/local-profile");
const root = path.join(__dirname, "../flower.com");

async function serverFor(t, accounts, resolveApi) {
    const server = createLocalServer({ root, localAccounts: accounts, resolveApi });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    t.after(async () => {
        await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
        await accounts.close();
    });
    return `http://127.0.0.1:${server.address().port}`;
}

test("weak and repeated security answers are rejected before account creation", t => {
    const accounts = createLocalAccounts(); t.after(() => accounts.close());
    for (const answers of [["12", "12", "12"], ["Cáo xanh", "CÁO XANH", "Canh bí"], ["123456", "Canh bí", "Mây tím"], ["password", "Canh bí", "Mây tím"]]) {
        const input = profile(); input.questions.forEach((q, i) => { q.answer = answers[i]; });
        assert.throws(() => accounts.register(input), { code: "invalid-security-questions" });
    }
    assert.ok(accounts.register(profile()).account.uid);
});

test("username-only probes neither expose questions nor consume the PIN budget", t => {
    const accounts = createLocalAccounts(); t.after(() => accounts.close());
    const input = profile(); accounts.register(input);
    assert.deepEqual(accounts.questions({ email: input.email }), accounts.questions({ email: "missing@demo" }));
    for (let i = 0; i < 10; i++) {
        assert.equal(accounts.reset({ email: input.email, pin: "0000", newPassword: "Changed-password1" }).code, "invalid-recovery");
    }
    assert.equal(accounts.reset({ ...input, pin: "0000", newPassword: "Changed-password1" }).attemptsRemaining, 4);
    assert.equal(accounts.reset({ ...input, newPassword: "Changed-password1" }).status, 200);
});

test("crypto in the default account worker does not block serving static pages", async t => {
    const accounts = createLocalAccountWorker();
    const base = await serverFor(t, accounts);
    let finished = false;
    const registration = accounts.register(profile()).then(value => { finished = true; return value; });
    const response = await fetch(base + "/login.html");
    assert.equal(response.status, 200);
    assert.equal(finished, false, "the HTTP event loop must serve the page while crypto is running");
    assert.equal((await registration).account.authProvider, "local");
    const queue = Array.from({ length: 17 }, () => accounts.login({ email: "missing@demo", password: "wrong" }));
    const results = await Promise.allSettled(queue);
    assert.ok(results.some(result => result.status === "rejected" && result.reason.code === "local-auth-busy"));
});

test("registration throttling cannot be bypassed by spoofing forwarded IP headers", async t => {
    const accounts = createLocalAccounts();
    const base = await serverFor(t, accounts);
    for (let i = 0; i < 6; i++) {
        const response = await fetch(base + "/api/local-auth/register", { method: "POST",
            headers: { "Content-Type": "application/json", "x-forwarded-for": `198.51.100.${i}` }, body: "{}" });
        assert.equal(response.status, i < 5 ? 400 : 429);
        if (i === 5) assert.ok(Number(response.headers.get("retry-after")) > 0);
    }
});

test("local API identity comes from the verified cookie and forged cookies fail closed", async t => {
    const accounts = createLocalAccounts();
    const registered = accounts.register(profile());
    const base = await serverFor(t, accounts, () => async (req, res) => {
        try { res.json({ account: await optionalCustomer(req) }); }
        catch { res.status(401).json({ error: "unauthenticated" }); }
    });
    const valid = await fetch(base + "/api/orders", { method: "POST", headers: { "Content-Type": "application/json",
        Cookie: `flower_local_session=${registered.sessionToken}` }, body: JSON.stringify({ uid: "forged-owner" }) });
    assert.equal((await valid.json()).account.uid, registered.account.uid);
    assert.equal((await fetch(base + "/api/orders", { headers: { Cookie: "flower_local_session=forged" } })).status, 401);
});

test("CSP permits the actual static scripts but no arbitrary inline code", () => {
    const { inlineScriptHashes } = require("../flower.com/lib/content-security");
    const config = require("../flower.com/vercel.json");
    const csp = config.headers[0].headers.find(h => h.key === "Content-Security-Policy").value;
    const scripts = csp.split(";").find(rule => rule.trim().startsWith("script-src "));
    assert.ok(!scripts.includes("'unsafe-inline'"));
    for (const hash of inlineScriptHashes(root)) assert.ok(scripts.includes(hash), "run node flower.com/scripts/update-csp.js after changing an inline script");
    const unknownHash = require("node:crypto").createHash("sha256").update("window.injected=1").digest("base64");
    assert.ok(!scripts.includes(unknownHash));
});
