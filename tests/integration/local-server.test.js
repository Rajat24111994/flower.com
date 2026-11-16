const test = require("node:test");
const assert = require("node:assert/strict");
const { createLocalServer } = require("../../flower.com/lib/local-server");
const h = require("./helpers");

test("local HTTP server runs the real login and nested admin APIs on one origin", async (t) => {
    await h.resetEmulators();
    const server = createLocalServer({ root: h.ROOT });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    t.after(() => new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
    }));
    const base = `http://127.0.0.1:${server.address().port}`;
    const customer = await h.createUser();
    const login = (password) => fetch(`${base}/api/login`, {
        method: "POST", headers: { "Content-Type": "application/json", Origin: base },
        body: JSON.stringify({ email: customer.email, password })
    });
    assert.equal((await login("wrong-password")).status, 401);
    const success = await login(customer.password);
    assert.equal(success.status, 200);
    const { customToken } = await success.json();
    const exchange = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=emulator-key`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: customToken, returnSecureToken: true })
    });
    assert.equal(exchange.status, 200);
    const session = await exchange.json();
    assert.equal((await h.auth().verifyIdToken(session.idToken)).uid, customer.uid);
    const admin = await h.createUser("admin");
    const list = await fetch(`${base}/api/admin/users`, {
        method: "POST", headers: { Authorization: `Bearer ${admin.token}`, "Content-Type": "application/json" },
        body: "{}"
    });
    assert.equal(list.status, 200);
    assert.ok((await list.json()).users.some((user) => user.uid === customer.uid));
});
