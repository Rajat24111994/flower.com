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
        await setDoc(doc(db, "products/1"), { id: 1, title: "Hoa", price: 10, quantity: 5 });
        await setDoc(doc(db, "orders/o1"), { uid: "alice", phone: "0908123456", status: "Chờ xác nhận", total: 100 });
        await setDoc(doc(db, "orders/o2"), { uid: "bob", phone: "0911222333", status: "Chờ xác nhận", total: 100 });
        await setDoc(doc(db, "reviews/r1"), { productIds: ["1"], customerName: "Alice", rating: 5, comment: "Đẹp" });
        await setDoc(doc(db, "metadata/activePromotions"), { items: [] });
        await setDoc(doc(db, "metadata/productCatalog"), { catalogSeeded: true });
        await setDoc(doc(db, "adminRoles/admin1"), { role: "admin" });
        await setDoc(doc(db, "messages/m1"), { text: "Xin chào" });
    });
});

const guest = () => env.unauthenticatedContext().firestore();
const alice = () => env.authenticatedContext("alice").firestore();
const admin = () => env.authenticatedContext("admin1", { admin: true }).firestore();
// Claim still in the token, but the owner already removed the adminRoles document.
const revokedAdmin = () => env.authenticatedContext("former", { admin: true }).firestore();

test("sản phẩm: ai cũng xem được, chỉ admin sửa được", async () => {
    await assertSucceeds(getDoc(doc(guest(), "products/1")));
    await assertFails(updateDoc(doc(guest(), "products/1"), { price: 1 }));
    await assertFails(updateDoc(doc(alice(), "products/1"), { quantity: 999 }));
    await assertFails(updateDoc(doc(revokedAdmin(), "products/1"), { quantity: 1 }));
    await assertSucceeds(updateDoc(doc(admin(), "products/1"), { quantity: 7 }));
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
    await assertSucceeds(getDocs(query(collection(alice(), "orders"), where("uid", "==", "alice"))));
    await assertFails(getDocs(collection(alice(), "orders")));
    await assertFails(setDoc(doc(alice(), "orders/new"), { uid: "alice", total: 0 }));
    await assertFails(updateDoc(doc(alice(), "orders/o1"), { status: "Đã giao", total: 0 }));
    await assertFails(deleteDoc(doc(alice(), "orders/o1")));
});

test("đơn hàng: admin xem và cập nhật được, admin đã bị thu hồi thì không", async () => {
    await assertSucceeds(getDocs(collection(admin(), "orders")));
    await assertSucceeds(updateDoc(doc(admin(), "orders/o1"), { status: "Đang giao" }));
    await assertFails(getDocs(collection(revokedAdmin(), "orders")));
});

test("đánh giá: ai cũng đọc được, khách không ghi trực tiếp được", async () => {
    await assertSucceeds(getDocs(collection(guest(), "reviews")));
    await assertFails(addDoc(collection(alice(), "reviews"), {
        productIds: ["1"], productName: "Hoa", customerName: "FlowerFlow", rating: 1, comment: "Lừa đảo", createdAt: serverTimestamp()
    }));
    await assertFails(updateDoc(doc(alice(), "reviews/r1"), { reply: "Giả mạo" }));
    await assertSucceeds(updateDoc(doc(admin(), "reviews/r1"), { reply: "Cảm ơn bạn" }));
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

test("bộ sưu tập lạ: mặc định chặn hết", async () => {
    await assertFails(getDoc(doc(admin(), "orderRequests/x")));
    await assertFails(setDoc(doc(alice(), "anything/x"), { a: 1 }));
});
