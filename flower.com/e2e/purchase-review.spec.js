import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

const jpeg = readFileSync(path.join(__dirname, "../images/start.jpeg"));
const reviewId = "b".repeat(40);
const product = { id: "review-product", title: "Bó hoa hồng", description: "Hoa hồng đỏ", price: 100000, quantity: 5, image: "./images/flower-01.webp" };
const order = { id: "review-order", uid: "buyer", customerName: "Người mua", phone: "0908123456", address: "1 Lê Lợi", status: "Đã giao", total: 100000,
  paymentMethod: "cod", paymentStatus: "Đã thanh toán", createdAt: "2026-11-02T01:00:00Z", items: [{ ...product, quantity: 1 }] };
const pending = { id: reviewId, authorUid: "buyer", productIds: [product.id], productName: product.title, customerName: "Người mua", rating: 2,
  comment: "Hoa không như mong đợi", photoIds: [`${reviewId}_0`], verifiedPurchase: true, moderationStatus: "pending", createdAt: "2026-11-02T02:00:00Z" };

async function setup(page, role, reviews = []) {
  await page.addInitScript(({ role, reviews }) => {
    window.testRole = role; window.reviewFixtures = reviews;
    if (role !== "guest") localStorage.setItem("loggedUser", JSON.stringify({ uid: role, email: `${role}@example.test` }));
  }, { role, reviews });
  await page.route("**/store-header.js*", (route) => route.fulfill({ contentType: "text/javascript", body:
    readFileSync(path.join(__dirname, "../js/core/store-header.js"), "utf8").replace("void verifyStoredSession();", "") }));
  await page.route("**/firebase-app.js", (route) => route.fulfill({ contentType: "text/javascript", body: "export const getApps = () => []; export const initializeApp = () => ({}); export const getApp = () => ({});" }));
  await page.route("**/firebase-auth.js", (route) => route.fulfill({ contentType: "text/javascript", body: `
    const user = window.testRole === "guest" ? null : {uid: window.testRole, email: "fixture@example.test", getIdToken: async () => "fixture-token", getIdTokenResult: async () => ({claims: { admin: window.testRole === "admin" }})};
    export const getAuth = () => ({currentUser: user, authStateReady: async () => {}});
    export const signOut = async () => {};
    export const onAuthStateChanged = (_auth, callback) => { queueMicrotask(() => callback(user)); return () => {}; };` }));
  await page.route("**/firebase-firestore.js", (route) => route.fulfill({ contentType: "text/javascript", body: `
    const listeners = [];
    export const getFirestore = () => ({});
    export const collection = (_db, name) => ({name});
    export const doc = (_db, _name, id) => ({id});
    export const where = (field, operation, value) => ({field, operation, value});
    export const query = (ref, ...filters) => ({...ref, filters});
    const snap = (row) => ({id: row.id, data: () => row, exists: () => true});
    const emit = (ref, callback) => callback({docs: window.reviewFixtures.filter((row) => (ref.filters || []).every((filter) => filter.operation === "array-contains" ? row[filter.field]?.includes(filter.value) : row[filter.field] === filter.value)).map(snap)});
    export const onSnapshot = (ref, callback) => { listeners.push([ref, callback]); emit(ref, callback); return () => {}; };
    export const getDoc = async (ref) => { const row = window.reviewFixtures.find((row) => row.id === ref.id); return row ? snap(row) : {exists: () => false}; };
    export const serverTimestamp = () => new Date().toISOString();
    export const deleteField = () => null;
    export const updateDoc = async (ref, changes) => { const row = window.reviewFixtures.find((row) => row.id === ref.id); Object.assign(row, changes); listeners.forEach(([query, callback]) => emit(query, callback)); };
  ` }));
  await page.route("**/product-store.js*", (route) => route.fulfill({ contentType: "text/javascript", body: `
    const fixture = [${JSON.stringify(product)}]; window.FlowerInventory = { initialize: async () => fixture, readProducts: () => fixture,
      readCategories: () => [], getCategories: async () => [], initializeCategories: async () => [], subscribeCategories: () => () => {},
      areProductsLoaded: () => true, isFirestoreReachable: () => true, getMissingCatalogProducts: () => [] };` }));
  await page.route("**/order-store.js*", (route) => route.fulfill({ contentType: "text/javascript", body: `
    const order = ${JSON.stringify(order)}; window.FlowerOrderStore = { subscribeAccount: async (_uid, callback) => { callback([order]); return () => {}; },
      subscribeAdmin: async (callback) => { callback([order]); return () => {}; }, expireReservations: async () => {},
      initializePromotions: async () => [], subscribePromotions: async () => () => {} };` }));
  await page.route("**/message-store.js*", (route) => route.fulfill({ contentType: "text/javascript", body: "window.FlowerMessageStore = { migrateLegacyMessages: async () => {}, subscribeAdmin: async (callback) => {callback([]); return () => {}; } };" }));
  await page.route("**/api/review-images?*", (route) => route.fulfill({ contentType: "image/jpeg", body: jpeg }));
}

test("buyer uploads photos, keeps draft after error and receives pending moderation", async ({ page }) => {
  await setup(page, "buyer");
  let submitted = null, tries = 0;
  await page.route("**/api/orders", async (route) => {
    const body = route.request().postDataJSON();
    if (body.action === "review-get") return route.fulfill({ json: { review: submitted } });
    if (body.action === "review") {
      tries++;
      if (tries === 1) return route.fulfill({ status: 503, json: { error: "Lỗi mạng, hãy thử lại" } });
      expect(body.photos).toHaveLength(1);
      expect(body.photos[0]).toMatch(/^data:image\/jpeg;base64,/);
      submitted = { ...pending, comment: body.comment, rating: body.rating, orderId: order.id };
      return route.fulfill({ status: 201, json: { review: submitted } });
    }
  });
  await page.goto("/tracking.html?id=review-order");
  await expect(page.locator("#order-review-form")).toBeVisible();
  await page.locator('[data-rating="2"]').click();
  await page.locator("#review-comment").fill("Hoa không như mong đợi");
  await page.locator("#review-photos").setInputFiles({ name: "after-purchase.jpg", mimeType: "image/jpeg", buffer: jpeg });
  await expect(page.locator("#review-photo-preview img")).toHaveCount(1);
  await page.locator(".review-submit").click();
  await expect(page.locator("#review-feedback")).toContainText("Lỗi mạng");
  await expect(page.locator("#review-comment")).toHaveValue("Hoa không như mong đợi");
  await page.locator(".review-submit").click();
  await expect(page.locator("#review-feedback")).toContainText("Đang chờ kiểm duyệt");
  await expect(page.locator("#order-review-form")).toBeHidden();
  expect(tries).toBe(2);
});

test("admin approves or hides while the buyer's rating, comment and photo stay intact", async ({ page }) => {
  await setup(page, "admin", [pending]);
  await page.goto("/admin.html");
  await page.locator("#reviews_page").click();
  await page.locator(".show-record-details").click();
  await expect(page.locator(".detail-block")).toContainText(pending.comment);
  await page.locator("[data-review-photos]").click();
  await expect(page.locator(".review-admin-photos img")).toHaveCount(1);
  await page.locator('[data-review-moderation="approved"]').click();
  await page.locator("#review-moderation-filter").selectOption("approved");
  await page.locator(".show-record-details").click();
  await page.locator(".review-moderation-reason").fill("Ảnh có thông tin cá nhân");
  await page.locator('[data-review-moderation="hidden"]').click();
  await page.locator("#review-moderation-filter").selectOption("hidden");
  const stored = await page.evaluate(() => window.reviewFixtures[0]);
  expect(stored).toMatchObject({ rating: 2, comment: pending.comment, photoIds: pending.photoIds, moderationStatus: "hidden", moderatedBy: "admin" });
  const error = await page.evaluate(async () => {
    try { await window.FlowerReviewStore.update(window.reviewFixtures[0].id, { comment: "Admin sửa" }); return ""; }
    catch (error) { return error.message; }
  });
  expect(error).toContain("Không được sửa");
});

test("product only displays approved reviews, photos and verified purchase badge", async ({ page }) => {
  await setup(page, "guest", [pending, { ...pending, id: "c".repeat(40), moderationStatus: "approved", rating: 5, comment: "Hoa rất tươi" }]);
  await page.goto("/product.html?id=review-product");
  await page.locator("#product-reviews").scrollIntoViewIfNeeded();
  await expect(page.locator("#product-reviews-list")).toContainText("Hoa rất tươi");
  await expect(page.locator("#product-reviews-list")).not.toContainText(pending.comment);
  await expect(page.locator(".review-verified")).toHaveText("Đã mua hàng");
  await expect(page.locator("#product-reviews-list .review-photos img")).toHaveCount(1);
});
