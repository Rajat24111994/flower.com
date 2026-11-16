// Integration test: the free backup really brings every collection back after data is lost.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
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
