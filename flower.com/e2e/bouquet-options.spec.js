import { test, expect } from "@playwright/test";

const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Ho_Chi_Minh",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
}).format(new Date());

const flowers = [
  { id: "rose", title: "Hoa hồng", image: "./favicon.svg", price: 100000, quantity: 8,
    status: "active", saleType: "flower", priceUpdatedAt: today },
  { id: "tulip", title: "Hoa tulip", image: "./favicon.svg", price: 75000, quantity: 8,
    status: "active", saleType: "flower", priceUpdatedAt: today }
];

test("custom bouquet totals current ingredient prices and adds the chosen quantities to cart", async ({ page }) => {
  await page.route("**/product-store.js*", (route) => route.fulfill({
    contentType: "text/javascript",
    body: `
      const fixture = ${JSON.stringify(flowers)};
      window.FlowerInventory = { initialize: async () => fixture, readProducts: () => fixture,
        readCategories: () => [], getCategories: async () => [], subscribeCategories: () => () => {} };
    `
  }));

  await page.goto("/custom-bouquet.html");
  await expect(page.locator("#custom-bouquet-list input[data-flower-id]")).toHaveCount(2);
  await page.getByLabel("Số cành Hoa hồng").fill("2");
  await page.getByLabel("Số cành Hoa tulip").fill("3");
  await expect(page.locator("#custom-bouquet-total")).toContainText("425.000");
  await page.locator("#custom-bouquet-add").click();
  await expect(page.locator("#custom-bouquet-message")).toContainText("Đã thêm thành phần bó hoa");

  await page.goto("/cart.html");
  await expect(page.locator("#product-container")).toContainText("Hoa hồng");
  await expect(page.locator("#product-container")).toContainText("Hoa tulip");
  await expect(page.locator("#total")).toContainText("425.000");
});
