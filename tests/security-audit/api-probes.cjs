// Audit observations, not regression assertions that insecure behavior should be retained.
// Historical baseline ac0fb9b only. Current checks: tests/{integration/,}security-remediation.test.js.
// Run only with the demo Auth/Firestore emulators; helpers refuses real project IDs.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const h = require("../integration/helpers");
const { createLocalAccounts } = require("../../flower.com/lib/local-accounts");
const { createLocalServer } = require("../../flower.com/lib/local-server");
const profile = require("../helpers/local-profile");
const results = [];
const record = (id, data) => { results.push({ id, ...data }); console.log(JSON.stringify({ id, ...data })); };

async function main() {
    await h.resetEmulators(); await h.seedProducts();
    const accounts = createLocalAccounts();
    const input = profile({ email: "audit@demo", questions: profile().questions.map(q => ({ ...q, answer: "12" })) });
    const created = accounts.register(input);
    const server = createLocalServer({ root: h.ROOT, localAccounts: accounts });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = (action, body) => fetch(`${base}/api/local-auth/${action}`, {
        method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify(body)
    });
    try {
        const known = await request("questions", { email: input.email });
        const unknown = await request("questions", { email: "missing@demo" });
        record("account-enumeration", { knownStatus: known.status, unknownStatus: unknown.status,
            publicQuestionCount: (await known.json()).questions.length });

        const guessed = await request("recover-pin", { email: input.email, answers: ["12", "12", "12"], newPin: "0123", confirmPin: "0123" });
        const reset = await request("reset", { email: input.email, pin: "0123", newPassword: "Audit-changed-password-123" });
        const logged = accounts.login({ email: input.email, password: "Audit-changed-password-123" });
        assert.equal(guessed.status, 200); assert.equal(reset.status, 200); assert.equal(logged.status, 200);
        record("weak-recovery-design", { prerequisite: "account chose the same common two-character answer for all questions",
            recoverPinStatus: guessed.status, passwordResetStatus: reset.status, newPasswordLoginStatus: logged.status });

        const failed = [];
        for (let i = 0; i < 5; i++) failed.push((await request("reset", { email: input.email, pin: "9999", newPassword: "Other-password-123" })).status);
        const correctAfterAttack = await request("reset", { email: input.email, pin: "0123", newPassword: "Other-password-123" });
        record("forced-pin-recovery-by-outsider", { unauthenticatedAttemptStatuses: failed, correctPinStatus: correctAfterAttack.status,
            code: (await correctAfterAttack.json()).code });

        const baselineStart = performance.now(); await (await fetch(`${base}/login.html`)).text();
        const baselineMs = performance.now() - baselineStart;
        const attackStart = performance.now();
        const duplicates = [request("register", input), request("register", input)];
        const ping = fetch(`${base}/login.html`).then(async response => { await response.text(); return performance.now() - attackStart; });
        const duplicateResponses = await Promise.all(duplicates);
        const contendedMs = await ping;
        record("unthrottled-sync-registration", { duplicateStatuses: duplicateResponses.map(r => r.status),
            baselinePageMs: Math.round(baselineMs), pageMsDuringTwoDuplicates: Math.round(contendedMs) });
        const page = await fetch(`${base}/login.html`);
        record("local-response-headers", { csp: page.headers.get("content-security-policy"),
            frameOptions: page.headers.get("x-frame-options"), contentTypeOptions: page.headers.get("x-content-type-options") });

        const quote = await h.callApi("orders", { body: { action: "quote", items: [{ id: "1", quantity: 1 }], deliveryZoneId: "test-zone" } });
        const localOrder = await h.callApi("orders", { headers: { cookie: `flower_local_session=${logged.sessionToken}` }, body: {
            customerName: input.name, phone: input.phone, address: "Audit address", deliveryDate: h.deliveryDate(), deliveryTime: "08:00–11:00",
            deliveryZoneId: "test-zone", paymentMethod: "cod", idempotencyKey: require("node:crypto").randomUUID(),
            expectedTotals: quote.body.totals, items: [{ id: "1", quantity: 1 }]
        } });
        assert.equal(localOrder.status, 201);
        const stored = (await h.db().doc(`orders/${localOrder.body.order.id}`).get()).data();
        record("local-order-identity-gap", { validLocalSession: Boolean(accounts.session(logged.sessionToken)), orderStatus: localOrder.status,
            storedUid: stored.uid, expectedUid: created.account.uid, identityBound: stored.uid === created.account.uid });

        await h.resetEmulators(); await h.seedProducts();
        const reserved = await h.placeOrder({ items: [{ id: "1", quantity: 10 }], paymentMethod: "cod" });
        assert.equal(reserved.status, 201);
        const held = (await h.db().doc(`orders/${reserved.body.order.id}`).get()).data();
        const nextQuote = await h.callApi("orders", { body: { action: "quote", items: [{ id: "1", quantity: 1 }], deliveryZoneId: "test-zone" } });
        record("anonymous-stock-reservation", { unauthenticatedOrderStatus: reserved.status, remainingStock: await h.stockOf("1"),
            reservationHours: Math.round((held.reservationExpiresAt.toMillis() - Date.now()) / 3600000), nextCustomerQuoteStatus: nextQuote.status });
        const extra = [];
        for (let i = 0; i < 3; i++) extra.push((await h.placeOrder({ items: [{ id: "2", quantity: 1 }] })).status);
        record("anonymous-repeat-orders", { statuses: extra });

        const admin = await h.createUser("admin");
        await h.db().doc(`adminRoles/${admin.uid}`).delete(); // Simulate role removal with failed token revocation.
        const expire = await h.callApi("orders", { method: "GET", query: { action: "expire" }, token: admin.token });
        const adminOperation = await h.callApi("orders", { token: admin.token, body: { action: "verify-qr-payment", orderId: reserved.body.order.id,
            amount: held.total, reconciliationReference: "audit-no-payment" } });
        record("stale-admin-cleanup-claim", { prerequisite: "live admin role removed but old ID token not yet revoked",
            cleanupStatus: expire.status, reconciliationStatus: adminOperation.status });
    } finally {
        await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); accounts.close();
    }
    const output = path.join(h.ROOT, ".tools/security-audit-api-results.json");
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify({ project: h.PROJECT_ID, observations: results }, null, 2));
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(() => h.db().terminate());
