// Unit tests: backups are encrypted, because the repository (and its Actions artifacts) is public.
const test = require("node:test");
const assert = require("node:assert/strict");
const { encryptBackup, decryptBackup, serializeValue, deserializeValue } = require("../flower.com/lib/firestore-backup.js");

test("bản sao lưu được mã hóa, đúng mật khẩu thì giải ra đúng dữ liệu", () => {
    const backup = { format: "flowerflow-backup-v1", collections: { orders: { a1: { phone: "0908123456", total: 1920000 } } } };
    const encrypted = encryptBackup(backup, "mat-khau-rat-dai-123");
    assert.ok(!encrypted.includes("0908123456"), "file mã hóa không được lộ số điện thoại");
    assert.deepEqual(decryptBackup(encrypted, "mat-khau-rat-dai-123"), backup);
});

test("sai mật khẩu hoặc file bị sửa thì không giải được", () => {
    const encrypted = encryptBackup({ format: "flowerflow-backup-v1", collections: {} }, "dung-mat-khau-123");
    assert.throws(() => decryptBackup(encrypted, "sai-mat-khau-123"), /mật khẩu/);
    const tampered = JSON.parse(encrypted);
    tampered.data = tampered.data.slice(0, -4) + "AAAA";
    assert.throws(() => decryptBackup(JSON.stringify(tampered), "dung-mat-khau-123"), /mật khẩu/);
});

test("mật khẩu quá ngắn bị từ chối", () => {
    assert.throws(() => encryptBackup({}, "ngan"), /12 ký tự/);
});

test("giữ nguyên kiểu thời gian Firestore khi sao lưu và khôi phục", () => {
    const fakeTimestamp = { toDate: () => new Date("2026-10-28T01:02:03.000Z") };
    const serialized = serializeValue({ createdAt: fakeTimestamp, items: [{ at: fakeTimestamp }], n: 1, s: "a", z: null });
    assert.deepEqual(serialized.createdAt, { __type: "timestamp", value: "2026-10-28T01:02:03.000Z" });
    const restored = deserializeValue(serialized, (date) => ({ restored: date.toISOString() }));
    assert.deepEqual(restored.createdAt, { restored: "2026-10-28T01:02:03.000Z" });
    assert.deepEqual(restored.items[0].at, { restored: "2026-10-28T01:02:03.000Z" });
    assert.equal(restored.n, 1);
    assert.equal(restored.z, null);
});
