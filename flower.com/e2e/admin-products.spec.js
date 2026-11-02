import { test, expect } from "@playwright/test";

const products = [
  { id: 1, title: "Hoa hồng sắp hết", description: "Bó hoa đỏ", image: "./images/flower-01.webp", images: [], category: "Hoa sinh nhật", price: 250000, quantity: 3, status: "active" },
  { id: 2, title: "Hoa cúc hết hàng", description: "Bó hoa vàng", image: "./images/flower-02.webp", images: [], category: "Hoa khai trương", price: 180000, quantity: 0, status: "active" },
  { id: 3, title: "Hoa lan đang ẩn", description: "Bó hoa tím", image: "./images/flower-03.webp", images: [], category: "Hoa sinh nhật", price: 420000, quantity: 8, status: "hidden" }
];

async function setupAdmin(page) {
  await page.addInitScript(() => localStorage.setItem("loggedUser", JSON.stringify({ uid: "admin-test", email: "admin@example.test" })));
  await page.route("**/firebase-app.js", (route) => route.fulfill({ contentType: "text/javascript", body: `
    export const getApps = () => [];
    export const initializeApp = () => ({});
    export const getApp = () => ({});
  ` }));
  await page.route("**/firebase-auth.js", (route) => route.fulfill({ contentType: "text/javascript", body: `
    const user = { uid: "admin-test", email: "admin@example.test", getIdTokenResult: async () => ({ claims: { admin: true, role: "admin" } }) };
    export const getAuth = () => ({});
    export const onAuthStateChanged = (_auth, callback) => { queueMicrotask(() => callback(user)); return () => {}; };
    export const signOut = async () => {};
  ` }));
  await page.route("**/product-store.js*", (route) => route.fulfill({ contentType: "text/javascript", body: `
    window.testProducts = ${JSON.stringify(products)};
    window.testCategories = ["Hoa sinh nhật", "Hoa khai trương"];
    window.FlowerInventory = {
      initialize: async () => window.testProducts,
      readProducts: () => window.testProducts,
      initializeCategories: async () => window.testCategories,
      subscribeCategories: () => () => {},
      areProductsLoaded: () => true,
      isFirestoreReachable: () => true,
      getMissingCatalogProducts: () => [],
      saveProducts: async (next) => {
        if (window.failProductSave) throw Object.assign(new Error("Mất kết nối Firestore nên thay đổi chưa được lưu."), { code: "unavailable" });
        window.testProducts = next;
      }
    };
  ` }));
  await page.route("**/order-store.js*", (route) => route.fulfill({ contentType: "text/javascript", body: `
    window.FlowerOrderStore = {
      expireReservations: async () => {},
      initializePromotions: async () => [],
      subscribePromotions: async () => () => {},
      subscribeAdmin: async (callback) => { callback([]); return () => {}; }
    };
  ` }));
  await page.route("**/review-store.js*", (route) => route.fulfill({ contentType: "text/javascript", body: `
    window.FlowerReviewStore = { migrateLegacyAdminReviews: async () => {}, subscribeAll: () => () => {} };
  ` }));
  await page.route("**/message-store.js*", (route) => route.fulfill({ contentType: "text/javascript", body: `
    window.FlowerMessageStore = { migrateLegacyMessages: async () => {}, subscribeAdmin: async (callback) => { callback([]); return () => {}; } };
  ` }));
  await page.goto("/admin.html");
  await expect(page.locator("main")).not.toContainText("Đang xác thực quyền quản trị");
  await page.locator("#product_page").click();
  await expect(page.locator("#add-product-form")).toBeVisible();
}

async function submitProductForm(page) {
  await page.locator("#add-product-form").evaluate((form) => form.requestSubmit());
}

test("admin filters product status, validates form, previews images and reports Firestore errors", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await setupAdmin(page);

  await expect(page.locator(".product-stock-alert")).toContainText("1 sản phẩm");
  await expect(page.locator(".product-state--out-of-stock")).toHaveText("Hết hàng");
  await page.locator("#product-filter-status").selectOption("hidden");
  await page.locator("#product-search-form button[type=submit]").click();
  await expect(page.locator(".product-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".product-table tbody")).toContainText("Hoa lan đang ẩn");

  await page.locator("#product-title").fill("Sản phẩm lỗi");
  await page.locator("#product-image").fill("javascript:alert(1)");
  await page.locator("#product-price").fill("-1");
  await page.locator("#product-quantity").fill("1.5");
  await page.locator("#product-description").fill("Mô tả");
  await page.locator("#product-category").selectOption("Hoa sinh nhật");
  await submitProductForm(page);
  await expect(page.locator("#product-form-message")).toContainText("đường dẫn ảnh đại diện");
  await expect(page.locator("#product-price")).toHaveAttribute("aria-invalid", "true");

  await page.route("https://cdn.example.test/broken.webp", (route) => route.fulfill({ status: 404, body: "" }));
  await page.locator("#product-image").fill("https://cdn.example.test/broken.webp");
  await expect(page.locator(".product-image-preview")).toContainText("Không tải được ảnh");
  await page.locator("#product-title").fill("Hoa mới");
  await page.locator("#product-image").fill("./images/flower-04.webp");
  await page.locator("#product-images").fill("./images/flower-05.webp\n./images/flower-06.webp");
  await expect(page.locator(".product-image-preview")).toHaveCount(3);
  await page.locator("#product-price").fill("550000");
  await page.locator("#product-quantity").fill("4");
  await page.locator("#product-description").fill("Bó hoa mới dành tặng bạn.");
  await page.locator("#product-category").selectOption("Hoa sinh nhật");

  await page.evaluate(() => { window.failProductSave = true; });
  page.once("dialog", (dialog) => dialog.accept());
  await submitProductForm(page);
  await expect.poll(() => page.evaluate(() => window.testProducts.some((product) => product.title === "Hoa mới"))).toBe(false);
  await page.evaluate(() => { window.failProductSave = false; });
  page.once("dialog", (dialog) => dialog.accept());
  await submitProductForm(page);
  await expect.poll(() => page.evaluate(() => window.testProducts.some((product) => product.title === "Hoa mới"))).toBe(true);

  await page.locator("#product-filter-status").selectOption("");
  await page.locator("#product-search-form button[type=submit]").click();
  const newProductRow = page.locator(".product-table tbody tr").filter({ hasText: "Hoa mới" });
  await expect(newProductRow).toContainText("Sắp hết hàng");
  page.once("dialog", (dialog) => dialog.accept());
  await newProductRow.locator('[data-action="toggle-product-visibility"]').evaluate((button) => button.click());
  await expect.poll(() => page.evaluate(() => window.testProducts.find((product) => product.title === "Hoa mới").status)).toBe("hidden");
  await expect(newProductRow).toContainText("Tạm ẩn");

  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});
