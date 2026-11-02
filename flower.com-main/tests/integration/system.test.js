// System test: one order end to end – browser SDK (with firestore.rules) + API + Firestore,
// the way the customer page and the admin page use them.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { initializeTestEnvironment } = require("@firebase/rules-unit-testing");
const { doc, getDoc, getDocs, updateDoc, collection, query, where } = require("firebase/firestore");
const h = require("./helpers");

let env;
const [host, port] = h.FIRESTORE_HOST.split(":");

test.before(async () => {
    env = await initializeTestEnvironment({
        projectId: h.PROJECT_ID,
        firestore: { host, port: Number(port), rules: fs.readFileSync(path.join(h.ROOT, "firestore.rules"), "utf8") }
    });
    await h.resetEmulators();
    await h.seedProducts();
});
test.after(() => env.cleanup());

test("khách đặt hàng → admin giao hàng → khách theo dõi và đánh giá → mọi người thấy đánh giá", async () => {
    const customer = await h.createUser();
    const admin = await h.createUser("admin");
    const customerDb = env.authenticatedContext(customer.uid).firestore();
    const adminDb = env.authenticatedContext(admin.uid, { admin: true }).firestore();
    const guestDb = env.unauthenticatedContext().firestore();

    // 1. Khách đặt hàng qua API (trang checkout).
    const placed = await h.placeOrder({ items: [{ id: "5", quantity: 2 }], paymentMethod: "qr", token: customer.token });
    assert.equal(placed.status, 201);
    const id = placed.body.order.id;
    assert.equal(await h.stockOf("5"), 8);

    // 2. Khách thấy đơn trong "Đơn hàng của bạn" (đọc Firestore trực tiếp, qua rules).
    const mine = await getDocs(query(collection(customerDb, "orders"), where("uid", "==", customer.uid)));
    assert.deepEqual(mine.docs.map((item) => item.id), [id]);

    // 3. Admin xác nhận tiền và giao hàng (trang admin).
    const adminOrders = await getDocs(collection(adminDb, "orders"));
    assert.equal(adminOrders.size, 1);
    await updateDoc(doc(adminDb, "orders", id), { paymentVerified: true, paymentStatus: "Đã thanh toán" });
    await updateDoc(doc(adminDb, "orders", id), { status: "Đang giao", currentLocation: "Quận 1" });

    // 4. Người chỉ có mã đơn + số điện thoại tra cứu được tiến độ nhưng không thấy địa chỉ.
    const lookup = await h.callApi("orders", { body: { action: "lookup", id, phone: "0908123456" } });
    assert.equal(lookup.body.order.status, "Đang giao");
    assert.equal(lookup.body.order.address, undefined);

    // 5. Giao xong, cron dọn đơn không đụng tới đơn đã giao.
    await updateDoc(doc(adminDb, "orders", id), { status: "Đã giao", inventoryState: "sold", inventoryReserved: false });
    await h.callApi("orders", { method: "GET", query: { action: "expire" }, headers: { authorization: "Bearer test-cron-secret" } });
    assert.equal((await getDoc(doc(customerDb, "orders", id))).data().status, "Đã giao");
    assert.equal(await h.stockOf("5"), 8);

    // 6. Khách đánh giá; admin trả lời; khách vãng lai thấy cả hai ở trang sản phẩm.
    const review = await h.callApi("orders", { token: customer.token, body: { action: "review", orderId: id, rating: 5, comment: "Hoa tươi lắm" } });
    assert.equal(review.status, 201);
    await updateDoc(doc(adminDb, "reviews", review.body.review.id), { reply: "Cảm ơn bạn!" });
    const publicReviews = await getDocs(query(collection(guestDb, "reviews"), where("productIds", "array-contains", "5")));
    assert.equal(publicReviews.size, 1);
    assert.equal(publicReviews.docs[0].data().reply, "Cảm ơn bạn!");
});
