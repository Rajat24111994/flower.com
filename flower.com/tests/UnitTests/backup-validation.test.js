const test = require("node:test");
const assert = require("node:assert/strict");
const { importDatabase, countDocuments, summarizeDocuments, serializeValue, deserializeValue, FORMAT } = require("../../lib/firestore-backup");

for (const collections of [null, [], { "a/b": {} }, { "a//b": {} }, { a: [] }, { a: { "x/y": {} } }, { a: { x: null } }]) {
    test(`malformed backup is rejected before any database access: ${JSON.stringify(collections)}`, async () => {
        let touched = false;
        const db = new Proxy({}, { get() { touched = true; throw new Error("Unexpected database access"); } });
        const archive = { format: FORMAT, collections };
        assert.throws(() => countDocuments(archive), /hợp lệ/);
        await assert.rejects(importDatabase(db, archive), /hợp lệ/);
        assert.equal(touched, false);
    });
}

test("v1 archives accept full nested collection paths and preserve document counts", () => {
    const archive = { format: FORMAT, collections: { a: { parent: { value: 1 } }, "a/parent/events": { event: { value: 2 } } } };
    assert.deepEqual(countDocuments(archive), { a: 1, "a/parent/events": 1 });
    assert.deepEqual(summarizeDocuments(archive), { a: 2 });
    assert.ok(!JSON.stringify(summarizeDocuments(archive)).includes("parent"));
});

test("backup CLI rejects a short passphrase before parsing credentials or reading Firestore", () => {
    const { spawnSync } = require("node:child_process");
    const path = require("node:path");
    const result = spawnSync(process.execPath, [path.resolve(__dirname, "../../scripts/backup-firestore.js")], {
        env: { ...process.env, BACKUP_PASSPHRASE: "short", FIREBASE_SERVICE_ACCOUNT_JSON: "not-json" },
        encoding: "utf8", windowsHide: true, timeout: 10_000
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /12 ký tự/);
    assert.equal(result.stdout, "");
});

test("malformed service-account diagnostics never print credential content", () => {
    const { spawnSync } = require("node:child_process");
    const path = require("node:path");
    const result = spawnSync(process.execPath, [path.resolve(__dirname, "../../scripts/backup-firestore.js")], {
        env: { ...process.env, BACKUP_PASSPHRASE: "valid-fixture-passphrase", FIREBASE_SERVICE_ACCOUNT_JSON: '{"private_key":"credential-canary' },
        encoding: "utf8", windowsHide: true, timeout: 10_000
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /service account hợp lệ/);
    assert.ok(!result.stderr.includes("credential-canary"));
    assert.equal(result.stdout, "");
});

test("plain coordinate maps keep their metadata instead of becoming GeoPoints", () => {
    const original = { latitude: 10, longitude: 106, label: "Keep this address" };
    const serialized = serializeValue(original);
    assert.deepEqual(serialized, original);
    assert.deepEqual(deserializeValue(serialized, () => { throw new Error("Unexpected timestamp"); }), original);
});
