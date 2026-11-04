import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";

const { findDuplicateProductImages } = createRequire(__filename)("../js/catalog/product-store.js");

const products = [
  { id: 1, title: "Hoa hồng sắp hết", description: "Bó hoa đỏ", image: "./images/flower-01.webp", images: [], category: "Hoa sinh nhật", price: 250000, quantity: 3, status: "active" },
  { id: 2, title: "Hoa cúc hết hàng", description: "Bó hoa vàng", image: "./images/flower-01.webp", images: [], category: "Hoa khai trương", price: 180000, quantity: 0, status: "active" },
  { id: 3, title: "Hoa lan đang ẩn", description: "Bó hoa tím", image: "", images: [], category: "Hoa sinh nhật", price: 420000, quantity: 8, status: "hidden" }
];

async function setupAdmin(page) {
  await page.addInitScript(() => localStorage.setItem("loggedUser", JSON.stringify({ uid: "admin-test", email: "admin@example.test" })));
  await page.route("**/firebase-app.js", (route) => route.fulfill({ contentType: "text/javascript", body: `
    export const getApps = () => [];
    export const initializeApp = () => ({});
    export const getApp = () => ({});
  ` }));
  await page.route("**/firebase-auth.js", (route) => route.fulfill({ contentType: "text/javascript", body: `
    const user = { uid: "admin-test", email: "admin@example.test", getIdToken: async () => "test-token", getIdTokenResult: async () => ({ claims: { admin: true, role: "admin" } }) };
    export const getAuth = () => ({});
    export const onAuthStateChanged = (_auth, callback) => { queueMicrotask(() => callback(user)); return () => {}; };
    export const signOut = async () => {};
  ` }));
  await page.route("**/product-store.js*", (route) => route.fulfill({ contentType: "text/javascript", body: `
    window.testProducts = JSON.parse(localStorage.getItem("adminProductsFixture") || ${JSON.stringify(JSON.stringify(products))});
    window.testCategories = ["Hoa sinh nhật", "Hoa khai trương"];
    window.productSaveCount = 0;
    window.FlowerInventory = {
      findDuplicateProductImages: ${findDuplicateProductImages.toString()},
      initialize: async () => window.testProducts,
      readProducts: () => window.testProducts,
      initializeCategories: async () => window.testCategories,
      subscribeCategories: () => () => {},
      areProductsLoaded: () => true,
      isFirestoreReachable: () => true,
      getMissingCatalogProducts: () => [],
      saveProducts: async (next) => {
        window.productSaveCount += 1;
        if (window.delayProductSave) await new Promise((resolve) => setTimeout(resolve, 150));
        if (window.failProductSave) throw Object.assign(new Error("Mất kết nối Firestore nên thay đổi chưa được lưu."), { code: "unavailable" });
        window.testProducts = next;
        localStorage.setItem("adminProductsFixture", JSON.stringify(next));
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

test("admin filters product status, validates form, previews images and reports Firestore errors", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await setupAdmin(page);

  await expect(page.locator(".product-stock-alert")).toContainText("1 sản phẩm");
  await expect(page.locator(".product-state--out-of-stock")).toHaveText("Hết hàng");
  await expect(page.locator(".product-image-audit summary")).toContainText("2 sản phẩm · 1 đường dẫn ảnh");
  await page.locator(".product-image-audit summary").click();
  await expect(page.locator(".product-image-audit")).toContainText("Hoa hồng sắp hết (mã 1)");
  await expect(page.locator(".product-image-audit")).toContainText("Hoa cúc hết hàng (mã 2)");
  await expect(page.locator(".product-table tbody")).toContainText("Chưa có ảnh: Hoa lan đang ẩn");

  await page.locator("#product-filter-status").selectOption("hidden");
  await page.locator("#product-search-form button[type=submit]").click();
  await expect(page.locator(".product-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".product-table tbody")).toContainText("Hoa lan đang ẩn");

  await page.locator("#product-filter-status").selectOption("");
  await page.locator("#product-filter-min-price").fill("300000");
  await page.locator("#product-search-form button[type=submit]").click();
  await expect(page.locator(".product-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".product-table tbody")).toContainText("Hoa lan đang ẩn");
  await page.locator("#product-filter-min-price").fill("500000");
  await page.locator("#product-filter-max-price").fill("400000");
  await page.locator("#product-search-form button[type=submit]").click();
  await expect(page.locator("#product-search-message")).toContainText("Giá từ không được lớn hơn giá đến");
  await page.locator("#product-filter-min-price").fill("");
  await page.locator("#product-filter-max-price").fill("");
  await page.locator("#product-filter-price-sort").selectOption("price-asc");
  await page.locator("#product-search-form button[type=submit]").click();
  await expect(page.locator(".product-table tbody tr").first()).toContainText("Hoa cúc hết hàng");
  await page.locator("#product-filter-price-sort").selectOption("price-desc");
  await page.locator("#product-search-form button[type=submit]").click();
  await expect(page.locator(".product-table tbody tr").first()).toContainText("Hoa lan đang ẩn");
  await page.locator("#product-search").fill("khong co san pham nay");
  await page.locator("#product-search-form button[type=submit]").click();
  await expect(page.locator(".product-table tbody")).toContainText("Không tìm thấy sản phẩm phù hợp");
  await page.locator('[data-action="clear-search"]').click();
  await page.locator("#product-search").fill("Hoa hồng");
  await page.locator("#product-filter-category").selectOption("Hoa sinh nhật");
  await page.locator("#product-search-form button[type=submit]").click();
  await expect(page.locator(".product-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".product-table tbody")).toContainText("Hoa hồng sắp hết");
  await page.locator('[data-action="clear-search"]').click();

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
  await page.evaluate(() => { window.delayProductSave = true; });
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#add-product-form").evaluate((form) => {
    form.requestSubmit();
    form.requestSubmit();
  });
  await expect.poll(() => page.evaluate(() => window.testProducts.some((product) => product.title === "Hoa mới"))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.productSaveCount)).toBe(2);
  await page.evaluate(() => { window.delayProductSave = false; });

  await page.locator("#product-filter-status").selectOption("");
  await page.locator("#product-search-form button[type=submit]").click();
  const newProductRow = page.locator(".product-table tbody tr").filter({ hasText: "Hoa mới" });
  await expect(newProductRow).toContainText("Sắp hết hàng");
  page.once("dialog", (dialog) => dialog.accept());
  await newProductRow.locator('[data-action="toggle-product-visibility"]').click();
  await expect.poll(() => page.evaluate(() => window.testProducts.find((product) => product.title === "Hoa mới").status)).toBe("hidden");
  await expect(newProductRow).toContainText("Tạm ẩn");

  await newProductRow.locator(".edit-product").click();
  await page.locator("#product-price").fill("650000");
  await page.locator("#product-image").fill("https://cdn.example.test/hoa-moi.webp");
  page.once("dialog", (dialog) => dialog.accept());
  await submitProductForm(page);
  await expect.poll(() => page.evaluate(() => {
    const product = window.testProducts.find((item) => item.title === "Hoa mới");
    return product && `${product.price}:${product.image}:${product.status}`;
  })).toBe("650000:https://cdn.example.test/hoa-moi.webp:hidden");

  await page.reload();
  await page.locator("#product_page").click();
  await expect(page.locator(".product-table tbody")).toContainText("Hoa mới");
  await expect.poll(() => page.evaluate(() => window.testProducts.find((item) => item.title === "Hoa mới").price)).toBe(650000);

  const updatedProductRow = page.locator(".product-table tbody tr").filter({ hasText: "Hoa mới" });
  page.once("dialog", (dialog) => dialog.dismiss());
  await updatedProductRow.locator(".delete-product").click();
  await expect(updatedProductRow).toHaveCount(1);
  page.once("dialog", (dialog) => dialog.accept());
  await updatedProductRow.locator(".delete-product").click();
  await expect.poll(() => page.evaluate(() => window.testProducts.some((product) => product.title === "Hoa mới"))).toBe(false);

  await page.screenshot({ path: testInfo.outputPath("admin-products.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath("admin-products-320.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("admin uploads a product photo from the computer and the field gets its address", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const uploads = [];
  await page.route("**/api/product-images", async (route) => {
    const request = route.request();
    uploads.push({ auth: request.headers().authorization, photo: request.postDataJSON().photo });
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ url: "/images/flower-02.webp" }) });
  });
  await setupAdmin(page);

  await page.locator("#product-image-file").setInputFiles(`${__dirname}/../images/start.jpeg`);
  await expect(page.locator("#product-image")).toHaveValue("/images/flower-02.webp");
  await expect(page.locator("#product-image-upload-status")).toContainText("Đã tải ảnh lên");
  await expect(page.locator("#product-image-previews img").first()).toBeVisible();
  expect(uploads).toHaveLength(1);
  expect(uploads[0].auth).toBe("Bearer test-token");
  expect(uploads[0].photo).toMatch(/^data:image\/jpeg;base64,/);
  expect((uploads[0].photo.length - 23) * 3 / 4).toBeLessThanOrEqual(120 * 1024);

  await page.locator("#product-image-file").setInputFiles({ name: "note.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(page.locator("#product-image-upload-status")).toContainText("Chỉ nhận ảnh JPG, PNG hoặc WebP");
  expect(uploads).toHaveLength(1);
  expect(errors).toEqual([]);
});
