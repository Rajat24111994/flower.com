// Integration test: the free backup really brings every collection back after data is lost.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const h = require("./helpers");

const { GeoPoint } = require(require.resolve("firebase-admin/firestore", { paths: [h.ROOT] }));
const { exportDatabase, importDatabase, encryptBackup, decryptBackup, countDocuments } = require(path.join(h.ROOT, "lib/firestore-backup.js"));

test("sao lưu -> mất dữ liệu -> khôi phục: đủ sản phẩm, đơn hàng, đánh giá, đúng kiểu thời gian", async () => {
    await h.resetEmulators();
    await h.seedProducts();
    const customer = await h.createUser();
    const placed = await h.placeOrder({ items: [{ id: "1", quantity: 2 }], paymentMethod: "qr", token: customer.token });
    const orderId = placed.body.order.id;
    await h.db().doc(`orders/${orderId}`).update({ status: "Đã giao" });
    await h.callApi("orders", { token: customer.token, body: { action: "review", orderId, rating: 5, comment: "Đẹp" } });
    await h.db().doc("orderLookupLimits/x").set({ attempts: 3 });
    const before = (await h.db().doc(`orders/${orderId}`).get()).data();

    const encrypted = encryptBackup(await exportDatabase(h.db()), "mat-khau-sao-luu-123");
    await h.resetEmulators();
    assert.equal((await h.db().collection("orders").get()).size, 0);

    const restored = decryptBackup(encrypted, "mat-khau-sao-luu-123");
    const counts = await importDatabase(h.db(), restored, { Timestamp: h.Timestamp, GeoPoint });
    assert.equal(counts.products, h.catalog.length);
    assert.equal(counts.orders, 1);
    assert.equal(counts.reviews, 1);
    assert.equal(counts.orderLookupLimits, undefined, "bộ đếm tra cứu không cần sao lưu");

    const after = (await h.db().doc(`orders/${orderId}`).get()).data();
    assert.equal(after.total, before.total);
    assert.equal(after.paymentReference, before.paymentReference);
    assert.equal(typeof after.createdAt.toDate, "function", "createdAt vẫn là Timestamp của Firestore");
    assert.equal(after.createdAt.toMillis(), before.createdAt.toMillis());
    assert.equal(after.reservationExpiresAt.toMillis(), before.reservationExpiresAt.toMillis());
    assert.deepEqual(countDocuments(restored), counts);
});

test("recursive backup restores 400+ documents, nested and orphan subcollections with native types", async () => {
    await h.resetEmulators(); await h.seedProducts();
    const db = h.db(), batch = db.batch();
    for (let i = 0; i < 401; i++) batch.set(db.doc(`backupDrill/doc${i}`), { sequence: i });
    batch.set(db.doc("backupDrill/types"), { at: h.Timestamp.fromMillis(1794873600123), point: new GeoPoint(10, 106),
        bytes: Buffer.from([0, 1, 255]), reference: db.doc("backupDrill/doc0"), nested: [null, true, { value: 3 }],
        coordinateMap: { latitude: 10, longitude: 106, label: "Keep this address" } });
    batch.set(db.doc("backupDrill/doc0/events/one"), { value: "child" });
    batch.set(db.doc("backupDrill/doc0/events/one/notes/leaf"), { value: "grandchild" });
    batch.set(db.doc("backupDrill/missing/events/orphan"), { value: "orphan-child" });
    batch.set(db.doc("orderLookupLimits/skip"), { count: 2 });
    await batch.commit();
    const archive = await exportDatabase(db);
    assert.equal(archive.projectId, h.PROJECT_ID);
    assert.equal(countDocuments(archive).backupDrill, 402);
    assert.equal(countDocuments(archive)["backupDrill/missing/events"], 1);
    const encrypted = encryptBackup(archive, "backup-drill-fixture-passphrase");
    await h.resetEmulators();
    await db.doc("backupDrill/keep").set({ untouched: true });
    const decoded = decryptBackup(encrypted, "backup-drill-fixture-passphrase");
    const counts = await importDatabase(db, decoded, { Timestamp: h.Timestamp, GeoPoint });
    assert.equal(counts.backupDrill, 402);
    assert.equal((await db.collection("backupDrill").get()).size, 403);
    assert.equal((await db.doc("backupDrill/keep").get()).data().untouched, true);
    assert.equal((await db.doc("backupDrill/missing").get()).exists, false);
    assert.equal((await db.doc("backupDrill/missing/events/orphan").get()).data().value, "orphan-child");
    assert.equal((await db.doc("backupDrill/doc0/events/one/notes/leaf").get()).data().value, "grandchild");
    const typed = (await db.doc("backupDrill/types").get()).data();
    assert.equal(typed.at.toMillis(), 1794873600123);
    assert.equal(typed.point.latitude, 10); assert.deepEqual(typed.bytes, Buffer.from([0, 1, 255]));
    assert.equal(typed.reference.path, "backupDrill/doc0"); assert.deepEqual(typed.nested, [null, true, { value: 3 }]);
    assert.deepEqual(typed.coordinateMap, { latitude: 10, longitude: 106, label: "Keep this address" });
    assert.equal((await db.doc("orderLookupLimits/skip").get()).exists, false);
    assert.deepEqual(await importDatabase(db, decoded, { Timestamp: h.Timestamp, GeoPoint }), counts);
    assert.equal((await db.collection("backupDrill").get()).size, 403);
});

test("backup/restore CLI previews without credentials and refuses missing or mismatched target", async () => {
    await h.resetEmulators();
    const db = h.db();
    await db.doc("cliDrill/one").set({ value: "private-fixture-payload" });
    await db.doc("cliDrill/private-customer-id/events/one").set({ value: "child" });
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ff-backup-cli-"));
    const file = path.join(directory, "backup.json.enc"), tamperedFile = path.join(directory, "tampered.json.enc");
    const env = { ...process.env, BACKUP_PASSPHRASE: "cli-fixture-passphrase-2026" };
    const run = (script, args, overrides = {}) => spawnSync(process.execPath,
        [path.join(h.ROOT, "scripts", script), ...args], { env: { ...env, ...overrides }, encoding: "utf8", windowsHide: true, timeout: 60_000 });
    try {
        const backup = run("backup-firestore.js", ["--out", file]);
        assert.equal(backup.status, 0, backup.stderr);
        assert.ok(!fs.readFileSync(file, "utf8").includes("private-fixture-payload"));
        await db.doc("cliDrill/one").update({ value: "after-backup" });
        await db.doc("cliDrill/keep").set({ untouched: true });
        const preview = run("restore-firestore.js", [file], { FIREBASE_SERVICE_ACCOUNT_JSON: "not-json" });
        assert.equal(preview.status, 0, preview.stderr);
        assert.ok(!backup.stdout.includes("private-customer-id"));
        assert.ok(!preview.stdout.includes("private-customer-id"));
        assert.equal((await db.doc("cliDrill/one").get()).data().value, "after-backup");
        assert.notEqual(run("restore-firestore.js", [file, "--dong-y"]).status, 0);
        assert.notEqual(run("restore-firestore.js", [file, "--dong-y", "--project", "demo-wrong-target"]).status, 0);
        assert.notEqual(run("restore-firestore.js", [file], { BACKUP_PASSPHRASE: "wrong-passphrase" }).status, 0);
        const tampered = JSON.parse(fs.readFileSync(file, "utf8"));
        const data = Buffer.from(tampered.data, "base64"); data[0] ^= 1; tampered.data = data.toString("base64");
        fs.writeFileSync(tamperedFile, JSON.stringify(tampered));
        assert.notEqual(run("restore-firestore.js", [tamperedFile, "--dong-y", "--project", h.PROJECT_ID]).status, 0);
        assert.equal((await db.doc("cliDrill/one").get()).data().value, "after-backup");
        const restored = run("restore-firestore.js", [file, "--dong-y", "--project", h.PROJECT_ID]);
        assert.equal(restored.status, 0, restored.stderr);
        assert.equal((await db.doc("cliDrill/one").get()).data().value, "private-fixture-payload");
        assert.equal((await db.doc("cliDrill/keep").get()).data().untouched, true);
        assert.ok(!backup.stdout.includes("private-fixture-payload"));
    } finally {
        for (const created of [file, tamperedFile]) if (fs.existsSync(created)) fs.unlinkSync(created);
        fs.rmdirSync(directory);
    }
});
