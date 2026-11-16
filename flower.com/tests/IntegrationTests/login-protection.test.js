const test = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");

test.beforeEach(() => h.resetEmulators());
const login = (email, password, ip = "203.0.113.7") => h.callApi("login", {
    body: { email, password }, headers: { "x-forwarded-for": ip }
});
const authUrl = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;
const authApi = `${authUrl}/identitytoolkit.googleapis.com/v1`;

test("real Firebase authentication, per-account locks and custom session exchange", async () => {
    const customer = await h.createUser();
    for (let i = 1; i <= 5; i++) {
        const response = await login(customer.email.toUpperCase(), "wrong-password", `198.51.100.${i}`);
        assert.equal(response.status, i < 5 ? 401 : 429);
    }
    assert.equal((await login(customer.email, customer.password)).status, 429);
    const ref = h.db().doc(`loginProtection/${customer.uid}`);
    await ref.update({ lockedUntil: Date.now() - 1 });
    const success = await login(customer.email, customer.password);
    assert.equal(success.status, 200);
    const exchange = await fetch(`${authApi}/accounts:signInWithCustomToken?key=emulator-key`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: success.body.customToken, returnSecureToken: true })
    });
    const session = await exchange.json();
    assert.equal(exchange.status, 200);
    assert.equal((await h.auth().verifyIdToken(session.idToken)).uid, customer.uid);
    assert.equal((await ref.get()).exists, false);
});

test("real Firestore transactions serialize requests arriving simultaneously", async () => {
    const customer = await h.createUser();
    for (let i = 0; i < 4; i++) assert.equal((await login(customer.email, "wrong-password")).status, 401);
    const responses = await Promise.all(Array.from({ length: 10 }, () => login(customer.email, "wrong-password")));
    assert.ok(responses.every((response) => [409, 429].includes(response.status)));
    assert.equal((await h.db().doc(`loginProtection/${customer.uid}`).get()).data().failures, 5);
});

test("sending a reset email does not unlock; completing Firebase's reset does", async () => {
    const customer = await h.createUser();
    const ref = h.db().doc(`loginProtection/${customer.uid}`);
    for (let i = 0; i < 4; i++) await login(customer.email, "wrong-password");
    for (const minutes of [15, 30, 60, 120, 240]) {
        const response = await login(customer.email, "wrong-password");
        assert.equal(response.body.retryAfter, minutes * 60);
        await ref.update({ lockedUntil: Date.now() - 1 });
    }
    assert.equal((await login(customer.email, "wrong-password")).body.code, "password-reset-required");
    const sent = await fetch(`${authApi}/accounts:sendOobCode?key=emulator-key`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestType: "PASSWORD_RESET", email: customer.email })
    });
    assert.equal(sent.status, 200);
    assert.equal((await login(customer.email, customer.password)).status, 403);
    const codes = await (await fetch(`${authUrl}/emulator/v1/projects/${h.PROJECT_ID}/oobCodes`)).json();
    const code = codes.oobCodes.find((item) => item.email === customer.email && item.requestType === "PASSWORD_RESET");
    assert.ok(code);
    const password = "New-Test-Password-123!";
    const reset = await fetch(`${authApi}/accounts:resetPassword?key=emulator-key`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oobCode: code.oobCode, newPassword: password })
    });
    assert.equal(reset.status, 200);
    assert.equal((await login(customer.email, password)).status, 200);
});
