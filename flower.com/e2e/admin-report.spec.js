import { test, expect } from "@playwright/test";

const products = [{ id: "a", title: "Hoa hồng", quantity: 0, price: 100000 }, { id: "b", title: "Hoa lan", quantity: 4, price: 500000 }, { id: "c", title: "Hoa cúc", quantity: 12, price: 200000 }];
const orders = [
  { id: "R1", createdAt: "2026-11-01T01:00:00Z", paidAt: "2026-11-02T01:00:00Z", status: "Đã giao", paymentMethod: "cod", paymentStatus: "Đã thanh toán", total: 270000,
    items: [{ id: "custom-a", productId: "a", title: "Hoa hồng", quantity: 3, price: 100000 }] },
  { id: "R2", createdAt: "2026-10-30T01:00:00Z", paidAt: "2026-11-02T02:00:00Z", status: "Đã giao", paymentMethod: "qr", paymentVerified: true, total: 500000,
    items: [{ id: "b", title: "Hoa lan", quantity: 1, price: 500000 }] },
  { id: "R3", createdAt: "2026-11-02T02:00:00Z", status: "Đã giao", paymentMethod: "qr", paymentVerified: false, total: 100000, items: [] },
  { id: "R4", createdAt: "2026-11-02T03:00:00Z", status: "Đã hủy", total: 400000, items: [] }
];
async function fixtures(page, admin = true) {
  await page.route("**/firebase-app.js", (route) => route.fulfill({ contentType: "text/javascript", body: "export const getApps = () => []; export const initializeApp = () => ({}); export const getApp = () => ({});" }));
  await page.route("**/firebase-auth.js", (route) => route.fulfill({ contentType: "text/javascript", body: `
    export const getAuth = () => ({}); export const signOut = async () => {};
    export const onAuthStateChanged = (_auth, callback) => { queueMicrotask(() => callback({ uid: "admin", email: "admin@example.test", getIdTokenResult: async () => ({claims: { admin: ${admin} }}) })); return () => {}; };` }));
  await page.route("**/product-store.js*", (route) => route.fulfill({ contentType: "text/javascript", body: `
    window.testProducts = ${JSON.stringify(products)};
    window.FlowerInventory = { initialize: async () => window.testProducts, readProducts: () => window.testProducts,
      initializeCategories: async () => [], subscribeCategories: () => () => {}, areProductsLoaded: () => true,
      isFirestoreReachable: () => true, getMissingCatalogProducts: () => [] };` }));
  await page.route("**/order-store.js*", (route) => route.fulfill({ contentType: "text/javascript", body: `
    window.testOrders = ${JSON.stringify(orders)};
    window.FlowerOrderStore = { expireReservations: async () => {}, initializePromotions: async () => [],
      subscribePromotions: async () => () => {}, subscribeAdmin: async (callback) => { window.emitAdminOrders = callback; callback(window.testOrders); return () => {}; } };` }));
  await page.route("**/review-store.js*", (route) => route.fulfill({ contentType: "text/javascript", body: "window.FlowerReviewStore = { migrateLegacyAdminReviews: async () => {}, subscribeAll: (callback) => {callback([]); return () => {}; } };" }));
  await page.route("**/message-store.js*", (route) => route.fulfill({ contentType: "text/javascript", body: "window.FlowerMessageStore = { migrateLegacyMessages: async () => {}, subscribeAdmin: async (callback) => { callback([]); return () => {}; } };" }));
}

test("dashboard filters, revenue, stock, live refresh and Excel snapshot", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await fixtures(page);
  await page.goto("/admin.html");
  await expect(page.locator("#admin-report-filters")).toBeVisible();
  await page.locator('[name="period"]').selectOption("all");
  await page.locator('#admin-report-filters button[type="submit"]').click();
  const revenue = page.locator(".report-metric").filter({ has: page.getByRole("heading", { name: "Doanh thu ghi nhận", exact: true }) }).locator("strong");
  await expect(revenue).toContainText("770.000");
  await expect(page.getByRole("table", { name: "Bán chạy trong đơn hoàn thành và thanh toán" }).locator("tbody tr").first()).toContainText("Hoa hồng");
  await expect(page.getByRole("table", { name: "Tồn kho ≤ 5 bó" }).locator("tbody tr")).toHaveCount(2);
  await expect(page.locator(".report-chart-scroll svg")).toBeVisible();
  const downloadEvent = page.waitForEvent("download");
  await page.locator("#report-export").click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
  await download.saveAs(testInfo.outputPath("admin-report.xlsx"));
  await page.screenshot({ path: testInfo.outputPath("admin-dashboard.png"), fullPage: true });
  await page.evaluate(() => {
    window.emitAdminOrders([...window.testOrders, { ...window.testOrders[0], id: "R5", total: 100000 }]);
  });
  await expect(page.locator(".dashboard")).toBeVisible();
  await expect(revenue).toContainText("870.000");
  await expect(page.locator('[name="period"]')).toHaveValue("all");
  await page.locator("#revenue_page").click();
  await page.locator('[name="period"]').selectOption("custom");
  await page.locator('[name="start"]').fill("2026-11-03");
  await page.locator('[name="end"]').fill("2026-11-02");
  await page.locator('#admin-report-filters button[type="submit"]').click();
  await expect(page.locator("#report-feedback")).toContainText("không được sau");
  await expect(revenue).toContainText("870.000");
  await page.locator('[name="start"]').fill("2026-11-03");
  await page.locator('[name="end"]').fill("2026-11-04");
  await page.locator('#admin-report-filters button[type="submit"]').click();
  await expect(revenue).toContainText("0");
  await expect(page.locator("#report-period-label")).toContainText("2026-11-03");
  await page.locator("#dashboard_page").click();
  await expect(page.locator(".dashboard")).toBeVisible();
  await expect(page.locator("#report-period-label")).toContainText("2026-11-03");
  await page.locator("#revenue_page").click();
  await page.locator("#report-reset").click();
  const currentMonth = await page.evaluate(() => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit"
    }).formatToParts(new Date());
    return `${parts.find((part) => part.type === "year").value}-${parts.find((part) => part.type === "month").value}`;
  });
  await expect(page.locator('[name="period"]')).toHaveValue("month");
  await expect(page.locator('[name="month"]')).toHaveValue(currentMonth);
  await expect(page.locator('[name="lowStock"]')).toHaveValue("5");
  await expect(page.locator("#report-period-label")).toContainText(`${currentMonth}-01`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test("non-admin cannot open report or export", async ({ page }) => {
  await fixtures(page, false);
  await page.goto("/admin.html");
  await expect(page).toHaveURL(/login\.html/);
  await expect(page.locator("#report-export")).toHaveCount(0);
});
