// Security tests: firestore.rules – who may read and write what, straight from the browser SDK.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");
const { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, collection, query, where, serverTimestamp } = require("firebase/firestore");
const h = require("./helpers");

let env;
const [host, port] = h.FIRESTORE_HOST.split(":");

test.before(async () => {
    env = await initializeTestEnvironment({
        projectId: h.PROJECT_ID,
        firestore: { host, port: Number(port), rules: fs.readFileSync(path.join(h.ROOT, "firestore.rules"), "utf8") }
    });
});
test.after(() => env.cleanup());

test.beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, "products/1"), { id: 1, title: "Hoa", price: 10, quantity: 5, saleType: "flower" });
        await setDoc(doc(db, "orders/o1"), {
            uid: "alice", phone: "0908123456", status: "Chờ xác nhận", total: 100,
            paymentMethod: "qr", paymentVerified: false, paymentStatus: "Chờ xác minh thanh toán"
        });
        await setDoc(doc(db, "orders/o2"), { uid: "bob", phone: "0911222333", status: "Chờ xác nhận", total: 100 });
        await setDoc(doc(db, "orders/cod1"), {
            uid: "alice", status: "Đang giao", paymentMethod: "cod",
            paymentStatus: "Thanh toán khi nhận hàng", paymentVerified: false, paidAt: ""
        });
        await setDoc(doc(db, "reviews/r1"), { productIds: ["1"], customerName: "Alice", authorUid: "alice", rating: 5, comment: "Đẹp", moderationStatus: "approved" });
        await setDoc(doc(db, "reviews/pending"), { productIds: ["1"], customerName: "Alice", authorUid: "alice", rating: 1, comment: "Chưa hài lòng", photoIds: ["photo"], moderationStatus: "pending" });
        await setDoc(doc(db, "metadata/activePromotions"), { items: [] });
        await setDoc(doc(db, "metadata/productCatalog"), { catalogSeeded: true });
        await setDoc(doc(db, "adminRoles/admin1"), { role: "admin" });
        await setDoc(doc(db, "adminRoles/owner1"), { role: "owner" });
        await setDoc(doc(db, "messages/m1"), { text: "Xin chào" });
        await setDoc(doc(db, "shoppingCarts/alice"), { cart: [], wish: [] });
    });
});

const guest = () => env.unauthenticatedContext().firestore();
const alice = () => env.authenticatedContext("alice").firestore();
const admin = () => env.authenticatedContext("admin1", { admin: true }).firestore();
const owner = () => env.authenticatedContext("owner1", { admin: true, role: "owner" }).firestore();
// Claim still in the token, but the owner already removed the adminRoles document.
const revokedAdmin = () => env.authenticatedContext("former", { admin: true }).firestore();

test("sản phẩm: ai cũng xem được, chỉ admin sửa được", async () => {
    await assertSucceeds(getDoc(doc(guest(), "products/1")));
    await assertFails(updateDoc(doc(guest(), "products/1"), { price: 1 }));
    await assertFails(updateDoc(doc(alice(), "products/1"), { quantity: 999 }));
    await assertFails(updateDoc(doc(revokedAdmin(), "products/1"), { quantity: 1 }));
    await assertSucceeds(updateDoc(doc(admin(), "products/1"), { quantity: 7 }));
    await assertFails(updateDoc(doc(guest(), "products/1"), { status: "hidden" }));
    await assertSucceeds(updateDoc(doc(admin(), "products/1"), { status: "hidden" }));
    await assertFails(updateDoc(doc(admin(), "products/1"), { status: "deleted" }));
});

test("giá sản phẩm chỉ được thay đổi qua API quản lý giá, không qua Firestore client", async () => {
    for (const db of [admin(), owner()]) {
        await assertFails(updateDoc(doc(db, "products/1"), { price: 15000 }));
        await assertFails(updateDoc(doc(db, "products/1"), { priceUpdatedAt: "2026-11-05" }));
        await assertFails(updateDoc(doc(db, "products/1"), { priceUpdatedBy: "attacker" }));
    }
    await assertFails(getDoc(doc(owner(), "priceHistory/entry")));
});

test("admin vẫn có thể cập nhật giá bó làm sẵn", async () => {
    const ref = doc(admin(), "products/ready-made");
    await assertSucceeds(setDoc(ref, {
        id: "ready-made", title: "Bó hoa", price: 250000, quantity: 5,
        image: "./images/products/product-flower-01.webp", description: "Bó làm sẵn",
        saleType: "ready_made"
    }));
    await assertSucceeds(updateDoc(ref, { price: 300000 }));
});

test("sản phẩm: tồn kho phải là số nguyên không âm", async () => {
    await assertFails(updateDoc(doc(admin(), "products/1"), { quantity: -1 }));
    await assertFails(updateDoc(doc(admin(), "products/1"), { quantity: 2.5 }));
    await assertFails(updateDoc(doc(admin(), "products/1"), { quantity: "10" }));
});

test("đơn hàng: khách chỉ đọc được đơn của mình, không tự tạo hay sửa đơn", async () => {
    await assertSucceeds(getDoc(doc(alice(), "orders/o1")));
    await assertFails(getDoc(doc(alice(), "orders/o2")));
    await assertFails(getDoc(doc(guest(), "orders/o1")));
    const history = await assertSucceeds(getDocs(query(collection(alice(), "orders"), where("uid", "==", "alice"))));
    assert.deepEqual(history.docs.map((order) => order.id).sort(), ["cod1", "o1"]);
    await assertFails(getDocs(query(collection(alice(), "orders"), where("uid", "==", "bob"))));
    await assertFails(getDocs(collection(alice(), "orders")));
    await assertFails(setDoc(doc(alice(), "orders/new"), { uid: "alice", total: 0 }));
    await assertFails(updateDoc(doc(alice(), "orders/o1"), { status: "Đã giao", total: 0 }));
    await assertFails(deleteDoc(doc(alice(), "orders/o1")));
});

test("đơn hàng: admin xem và cập nhật được, admin đã bị thu hồi thì không", async () => {
    await assertSucceeds(getDocs(collection(admin(), "orders")));
    await assertSucceeds(updateDoc(doc(admin(), "orders/o1"), { status: "Đang chuẩn bị" }));
    await assertSucceeds(updateDoc(doc(admin(), "orders/o1"), { status: "Đang giao" }));
    await assertFails(getDocs(collection(revokedAdmin(), "orders")));
});

test("đơn hàng: Rules chặn bỏ qua bước, cho hủy và chỉ khôi phục về chờ xác nhận", async () => {
    const orderRef = doc(admin(), "orders/o1");
    await assertFails(updateDoc(orderRef, { status: "Đang giao" }));
    await assertFails(updateDoc(orderRef, { status: "Đã giao" }));
    await assertSucceeds(updateDoc(orderRef, { status: "Đã hủy" }));
    await assertFails(updateDoc(orderRef, { status: "Đang chuẩn bị" }));
    await assertSucceeds(updateDoc(orderRef, { status: "Chờ xác nhận" }));
});

test("đơn QR đã thanh toán có thể được hủy nhưng không bị ghi nhầm thành đã hoàn tiền", async () => {
    await env.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), "orders/paid1"), {
            uid: "alice", status: "Đang chuẩn bị", paymentMethod: "qr",
            paymentVerified: true, paymentStatus: "Đã thanh toán", total: 100
        });
    });
    const orderRef = doc(admin(), "orders/paid1");
    await assertSucceeds(updateDoc(orderRef, { status: "Đã hủy" }));
    const cancelled = (await getDoc(orderRef)).data();
    assert.equal(cancelled.status, "Đã hủy");
    assert.equal(cancelled.paymentVerified, true);
    assert.equal(cancelled.paymentStatus, "Đã thanh toán");
    await assertFails(updateDoc(orderRef, { paymentStatus: "Đã hoàn tiền" }));
});

test("đơn hàng: admin không thể tự xác minh thanh toán hoặc thêm trường tùy ý", async () => {
    await assertFails(updateDoc(doc(admin(), "orders/o1"), {
        paymentVerified: true, paymentStatus: "Đã thanh toán", paidAt: "2026-01-01T00:00:00.000Z"
    }));
    await assertFails(updateDoc(doc(admin(), "orders/o1"), { paymentStatus: "Đã thanh toán" }));
    await assertFails(updateDoc(doc(admin(), "orders/o1"), { paymentReconciliationReference: "BANK-123" }));
    await assertFails(updateDoc(doc(admin(), "orders/o1"), { arbitraryAdminField: true }));
    await assertSucceeds(updateDoc(doc(admin(), "orders/cod1"), {
        status: "Đã giao", paymentStatus: "Đã thanh toán", paidAt: "2026-01-01T00:00:00.000Z"
    }));
    await assertFails(getDoc(doc(admin(), "orderPaymentAudit/audit1")));
    await assertFails(setDoc(doc(admin(), "orderPaymentAudit/audit1"), { action: "fake" }));
    await assertFails(updateDoc(doc(admin(), "orderPaymentAudit/audit1"), { action: "changed" }));
});

test("đánh giá: ai cũng đọc được, khách không ghi trực tiếp được", async () => {
    await assertSucceeds(getDocs(query(collection(guest(), "reviews"), where("moderationStatus", "==", "approved"))));
    await assertFails(getDocs(collection(guest(), "reviews")));
    await assertFails(addDoc(collection(alice(), "reviews"), {
        productIds: ["1"], productName: "Hoa", customerName: "FlowerFlow", rating: 1, comment: "Lừa đảo", createdAt: serverTimestamp()
    }));
    await assertFails(updateDoc(doc(alice(), "reviews/r1"), { reply: "Giả mạo" }));
    await assertSucceeds(updateDoc(doc(admin(), "reviews/r1"), { reply: "Cảm ơn bạn" }));
});

test("kiểm duyệt không cho admin sửa nội dung, sao, ảnh, tác giả hoặc xóa đánh giá", async () => {
    await assertFails(getDoc(doc(guest(), "reviews/pending")));
    await assertSucceeds(getDoc(doc(alice(), "reviews/pending")));
    await assertSucceeds(getDocs(collection(admin(), "reviews")));
    for (const changes of [{ comment: "Admin sửa" }, { rating: 5 }, { photoIds: [] }, { customerName: "Khác" },
        { productIds: ["2"] }, { authorUid: "admin1" }, { verifiedPurchase: true }]) {
        await assertFails(updateDoc(doc(admin(), "reviews/pending"), changes));
    }
    await assertFails(deleteDoc(doc(admin(), "reviews/pending")));
    await assertFails(setDoc(doc(admin(), "reviews/fake"), { rating: 5, comment: "Tự tạo" }));
    await assertFails(updateDoc(doc(admin(), "reviews/pending"), { moderationStatus: "approved" }));
    await assertSucceeds(updateDoc(doc(admin(), "reviews/pending"), {
        moderationStatus: "approved", moderatedBy: "admin1", moderatedAt: serverTimestamp(), reply: "Cửa hàng xin ghi nhận"
    }));
    await assertSucceeds(getDoc(doc(guest(), "reviews/pending")));
    await assertSucceeds(updateDoc(doc(admin(), "reviews/pending"), {
        moderationStatus: "hidden", moderatedBy: "admin1", moderatedAt: serverTimestamp(), moderationReason: "Ảnh chứa thông tin cá nhân"
    }));
    await assertFails(getDoc(doc(guest(), "reviews/pending")));
    const preserved = (await getDoc(doc(alice(), "reviews/pending"))).data();
    assert.equal(preserved.comment, "Chưa hài lòng");
    assert.equal(preserved.rating, 1);
    assert.deepEqual(preserved.photoIds, ["photo"]);
    await assertFails(setDoc(doc(admin(), "reviewImages/photo"), { bytes: "changed" }));
    // Product photos go only through /api/product-images, never straight from a browser.
    await assertFails(setDoc(doc(admin(), "productImages/photo"), { bytes: "changed" }));
    await assertFails(getDoc(doc(guest(), "productImages/photo")));
});

test("dữ liệu nội bộ: danh sách admin, lời nhắn, cấu hình chỉ admin truy cập", async () => {
    await assertFails(getDoc(doc(alice(), "adminRoles/admin1")));
    await assertFails(setDoc(doc(alice(), "adminRoles/alice"), { role: "admin" }));
    await assertFails(getDoc(doc(alice(), "messages/m1")));
    await assertSucceeds(getDoc(doc(guest(), "metadata/activePromotions")));
    await assertFails(getDoc(doc(guest(), "metadata/productCatalog")));
    await assertFails(setDoc(doc(alice(), "metadata/activePromotions"), { items: [{ id: "x", discountPercent: 100, active: true, allProducts: true }] }));
    await assertSucceeds(getDoc(doc(admin(), "messages/m1")));
});

test("giỏ và yêu thích đồng bộ riêng tư theo tài khoản, giới hạn số dòng", async () => {
    const aliceCart = doc(alice(), "shoppingCarts/alice");
    const bobCart = doc(env.authenticatedContext("bob").firestore(), "shoppingCarts/bob");
    await assertSucceeds(getDoc(aliceCart));
    await assertFails(getDoc(doc(alice(), "shoppingCarts/bob")));
    await assertFails(getDoc(doc(guest(), "shoppingCarts/alice")));
    await assertFails(getDoc(doc(admin(), "shoppingCarts/alice")));
    await assertSucceeds(setDoc(aliceCart, {
        cart: [{ id: "line-1", productId: "1", quantity: 2 }],
        wish: [{ id: "1" }]
    }));
    await assertSucceeds(setDoc(bobCart, { cart: [], wish: [] }));
    await assertFails(setDoc(aliceCart, {
        cart: Array.from({ length: 101 }, (_, index) => ({ id: String(index) })),
        wish: []
    }));
    await assertFails(setDoc(aliceCart, { cart: "invalid", wish: [] }));
    await assertFails(setDoc(aliceCart, { cart: [], wish: [], admin: true }));
});

test("bộ sưu tập lạ: mặc định chặn hết", async () => {
    await assertFails(getDoc(doc(admin(), "orderRequests/x")));
    await assertFails(setDoc(doc(alice(), "anything/x"), { a: 1 }));
});

test("không client nào được đọc, sửa hoặc xóa trạng thái khóa đăng nhập", async () => {
    for (const db of [guest(), alice(), admin(), owner()]) {
        const ref = doc(db, "loginProtection/alice");
        await assertFails(getDoc(ref));
        await assertFails(setDoc(ref, { failures: 0, lockedUntil: 0, resetRequired: false }));
        await assertFails(deleteDoc(ref));
    }
});
