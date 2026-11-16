// Exercise authorization through the native Firebase C# HTTP host, never a mocked guard.
const test = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");
const options = { skip: !process.env.FLOWER_API_URL && "Requires test-api.cjs native C# host" };
const adminReads = [
    ["adminUsers", { body: {} }],
    ["products", { method: "GET", query: { manage: "1" } }],
    ["deliveryZones", { method: "GET", query: { manage: "1" } }],
    ["bouquetWrapping", { method: "GET", query: { manage: "1" } }],
    ["adminAudit", { method: "GET" }],
    ["designRequests", { method: "GET", query: { manage: "1" } }]
];
const ownerReads = [
    ["ownerUsers", { body: { action: "list" } }],
    ["flowerPrices", { method: "GET" }],
    ["wiltingPrices", { method: "GET" }]
];
const protectedReads = [...adminReads, ...ownerReads];

test.beforeEach(async () => {
    if (!process.env.FLOWER_API_URL) return;
    await h.resetEmulators();
    await h.seedProducts();
});

async function expectAccess(routes, token, status, headers = {}) {
    for (const [name, request] of routes) {
        const response = await h.callApi(name, { ...request, token, headers });
        assert.equal(response.status, status, `${name}: ${JSON.stringify(response.body)}`);
        if (status === 401 || status === 403) {
            assert.equal(response.body.code, status === 401 ? "unauthenticated" : "permission-denied");
            if (token) assert.ok(!JSON.stringify(response.body).includes(token), "Token leaked in response");
        }
    }
}

test("C# protected reads reject absent, malformed and ambiguous bearer credentials", options, async () => {
    const owner = await h.createUser("owner");
    await expectAccess(protectedReads, undefined, 401);
    for (const authorization of ["Basic owner", "Bearer fake-token", `Bearer ${owner.token}, Bearer ${owner.token}`]) {
        await expectAccess(protectedReads, undefined, 401, { authorization });
    }
});

test("C# customer cannot acquire admin or owner access through headers, cookies or query claims", options, async () => {
    const customer = await h.createUser();
    const headers = { "X-Development-User": "owner", "X-User-Role": "owner",
        "X-Admin": "true", Cookie: "role=owner; admin=true; flower_session=forged" };
    await expectAccess(protectedReads, customer.token, 403, headers);
    for (const [name, request] of protectedReads) {
        const response = await h.callApi(name, { ...request, token: customer.token,
            query: { ...request.query, role: "owner", admin: "true", uid: "owner" }, headers });
        assert.equal(response.status, 403, name);
    }
    await expectAccess(protectedReads, undefined, 401, headers);
});

test("C# admin and owner access follow least privilege across every protected read", options, async () => {
    const admin = await h.createUser("admin"), owner = await h.createUser("owner");
    await expectAccess(adminReads, admin.token, 200);
    await expectAccess(ownerReads, admin.token, 403);
    await expectAccess(protectedReads, owner.token, 200);
    // The saved owner token has not expired; only the live role mirror has changed.
    await h.db().doc(`adminRoles/${owner.uid}`).update({ role: "admin" });
    await expectAccess(ownerReads, owner.token, 403);
    await expectAccess(adminReads, owner.token, 200);
});

test("C# live role document alone never grants privileges without a boolean admin claim", options, async () => {
    const customer = await h.createUser();
    await h.db().doc(`adminRoles/${customer.uid}`).set({ role: "owner" });
    await expectAccess(protectedReads, customer.token, 403);
    for (const admin of ["true", 1, false]) {
        await h.auth().setCustomUserClaims(customer.uid, { admin, role: "owner" });
        await expectAccess(protectedReads, await h.signIn(customer.email, customer.password), 403);
    }
});

test("C# removing the live owner role revokes every protected read immediately", options, async () => {
    const owner = await h.createUser("owner");
    await expectAccess(protectedReads, owner.token, 200);
    await h.db().doc(`adminRoles/${owner.uid}`).delete();
    await expectAccess(protectedReads, owner.token, 403);
});

test("C# disabled Firebase owner loses access even with a saved token and live role", options, async () => {
    const owner = await h.createUser("owner");
    await expectAccess(protectedReads, owner.token, 200);
    await h.auth().updateUser(owner.uid, { disabled: true });
    await expectAccess(protectedReads, owner.token, 401);
    for (const [name, request] of [
        ["orders", { method: "GET", query: { action: "mine" } }],
        ["firebaseLogout", { body: {} }],
        ["productImages", { body: { photo: "invalid-photo" } }]
    ]) {
        assert.equal((await h.callApi(name, { ...request, token: owner.token })).status, 401, name);
    }
    assert.equal((await h.db().doc(`adminRoles/${owner.uid}`).get()).exists, true);
});

test("C# Firebase SDK rejects tokens for another audience or issuer", options, async () => {
    const owner = await h.createUser("owner");
    const parts = owner.token.split(".");
    const original = JSON.parse(Buffer.from(parts[1], "base64url"));
    // Emulator tokens are unsigned: this validates SDK claim checks, not production signatures.
    for (const changes of [{ aud: "demo-another-project" }, { iss: "https://securetoken.google.com/demo-another-project" }]) {
        const token = `${parts[0]}.${Buffer.from(JSON.stringify({ ...original, ...changes })).toString("base64url")}.`;
        await expectAccess(protectedReads, token, 401);
    }
});

test("C# forbidden writes cannot change settings, roles, prices or payment verification", options, async () => {
    const customer = await h.createUser(), owner = await h.createUser("owner");
    const placed = await h.placeOrder({ paymentMethod: "qr" });
    assert.equal(placed.status, 201);
    const id = placed.body.order.id;
    const orderRef = h.db().doc(`orders/${id}`);
    const before = (await orderRef.get()).data();
    const productRef = h.db().doc("products/1");
    const beforeProduct = (await productRef.get()).data();
    const writes = [
        ["ownerUsers", { action: "grant-admin", uid: customer.uid }, "POST"],
        ["deliveryZones", { action: "delete", id: "test-zone" }, "POST"],
        ["bouquetWrapping", { tiers: [{ maxStems: 50, fee: 12345 }] }, "POST"],
        ["flowerPrices", { flowerId: "1", price: 99000 }, "PATCH"],
        ["wiltingPrices", { action: "save-rules", expectedRevision: 0, enabled: false, rules: [] }, "POST"],
        ["designRequests", { action: "admin-update", id: "missing", status: "Đã hủy" }, "POST"],
        ["orders", { action: "verify-qr-payment", orderId: id, amount: before.total, reconciliationReference: "blocked-write" }, "POST"]
    ];
    await h.db().doc(`adminRoles/${owner.uid}`).delete();
    for (const token of [customer.token, owner.token]) {
        for (const [name, body, method] of writes) {
            const response = await h.callApi(name, { token, body, method });
            assert.equal(response.status, 403, `${name}: ${JSON.stringify(response.body)}`);
        }
    }
    assert.deepEqual((await orderRef.get()).data(), before);
    assert.deepEqual((await productRef.get()).data(), beforeProduct);
    assert.equal((await h.db().doc("metadata/deliveryZones").get()).data().zones[0].id, "test-zone");
    assert.equal((await h.db().doc("metadata/bouquetWrapping").get()).exists, false);
    assert.equal((await h.db().doc("metadata/wiltingPricing").get()).exists, false);
    assert.equal((await h.db().doc(`adminRoles/${customer.uid}`).get()).exists, false);
    assert.equal((await h.auth().getUser(customer.uid)).customClaims?.admin, undefined);
    for (const collection of ["priceHistory", "adminAudit", "orderPaymentAudit", "designRequests"]) {
        assert.equal((await h.db().collection(collection).get()).size, 0, collection);
    }
});
