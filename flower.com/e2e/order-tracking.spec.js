import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

const order = { id: "TRACK-1", uid: "customer-1", customerName: "Khách thử", phone: "0908123456", address: "1 Lê Lợi",
  createdAt: "2026-11-02T01:00:00Z", paymentMethod: "cod", total: 450000, items: [], status: "Chờ xác nhận",
  trackingHistory: [{ status: "Chờ xác nhận", updatedAt: "2026-11-02T01:00:00Z" }] };

test.beforeEach(async ({ page }) => {
  await page.route("**/order-store.js*", (route) => route.fulfill({ contentType: "text/javascript", body: `
    window.testOrder = ${JSON.stringify(order)};
    window.FlowerOrderStore = {
      getPublicOrder: async () => ({ ...window.testOrder, privacyLimited: true }),
      subscribeAccount: async (_uid, callback) => { window.emitOrders = callback; callback([window.testOrder]); return () => {}; }
    };` }));
  await page.route("**/store-header.js*", (route) => route.fulfill({ contentType: "text/javascript",
    body: readFileSync(path.join(__dirname, "../js/core/store-header.js"), "utf8").replace("void verifyStoredSession();", "") }));
});

test("guest sees all four stages, actual history, legacy completion and cancellation", async ({ page }, testInfo) => {
  await page.goto("/tracking.html");
  await page.locator("#tracking-order-id").fill("TRACK-1");
  await page.locator("#tracking-phone").fill("0908123456");
  const statuses = ["Chờ xác nhận", "Đang chuẩn bị", "Đang giao", "Đã giao"];
  for (const [index, status] of statuses.entries()) {
    await page.evaluate(({ status, index }) => {
      window.testOrder.status = status;
      if (index) window.testOrder.trackingHistory.push({ status, updatedAt: `2026-11-02T0${index + 1}:00:00Z` });
    }, { status, index });
    await page.locator('#tracking-search button[type="submit"]').click();
    await expect(page.locator("#order-progress li")).toHaveCount(4);
    await expect(page.locator('#order-progress [aria-current="step"] strong')).toHaveText(index === 3 ? "Hoàn thành" : status);
    await expect(page.locator("#tracking-timeline li")).toHaveCount(index + 1);
    await expect(page.locator(".order-details")).toBeHidden();
  }
  await expect(page.locator("#result-status")).toHaveText("Hoàn thành");
  await page.screenshot({ path: testInfo.outputPath("tracking-complete.png"), fullPage: true });
  await page.evaluate(() => { window.testOrder.status = "Đã hủy"; });
  await page.locator('#tracking-search button[type="submit"]').click();
  await expect(page.locator("#order-cancelled-note")).toBeVisible();
  await expect(page.locator('#order-progress [aria-current="step"]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});

test("account history follows the selected order through preparation and completion", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("loggedUser", JSON.stringify({ uid: "customer-1", email: "customer@example.test" })));
  await page.goto("/tracking.html");
  await expect(page.locator(".my-order-card")).toHaveCount(1);
  await page.locator(".my-order-card").click();
  await page.evaluate(() => {
    window.testOrder.status = "Đang chuẩn bị";
    window.testOrder.trackingHistory.push({ status: "Đang chuẩn bị", updatedAt: "2026-11-02T02:00:00Z" });
    window.emitOrders([window.testOrder]);
  });
  await expect(page.locator("#result-status")).toHaveText("Đang chuẩn bị");
  await expect(page.locator("#count-active")).toHaveText("1");
  await page.evaluate(() => {
    window.testOrder.status = "Đã giao";
    window.testOrder.trackingHistory.push({ status: "Đã giao", updatedAt: "2026-11-02T03:00:00Z" });
    window.emitOrders([window.testOrder]);
  });
  await expect(page.locator("#result-status")).toHaveText("Hoàn thành");
  await expect(page.locator("#count-done")).toHaveText("1");
  await expect(page.locator('[data-group="done"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#order-progress li").nth(2).locator("time")).toHaveCount(0);
});
