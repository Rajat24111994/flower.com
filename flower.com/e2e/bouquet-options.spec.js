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
    status: "active", saleType: "flower", priceUpdatedAt: today },
  { id: "lily", title: "Hoa ly", image: "./favicon.svg", price: 90000, quantity: 0,
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
  await page.route("**/api/bouquet-wrapping*", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ configured: true, tiers: [{ maxStems: 50, fee: 25000 }] })
  }));
  await page.route("**/api/delivery-zones*", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ zones: [{ id: "test-zone", province: "Hà Nội", district: "Ba Đình", fee: 0, enabled: true }] })
  }));
  await page.route("**/api/orders", async (route) => {
    const request = route.request().postDataJSON();
    if (request.action !== "quote") return route.continue();
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        totals: { subtotal: 425000, savings: 0, tax: 0, shippingFee: 0, wrappingFee: 25000, total: 450000 },
        customBouquets: [{ id: request.items[0].customBouquetId, stemCount: 5, wrappingFee: 25000 }]
      })
    });
  });

  await page.goto("/custom-bouquet.html");
  await expect(page.locator("#custom-bouquet-list input[data-flower-id]")).toHaveCount(3);
  await expect(page.locator("#custom-bouquet-list")).toContainText("Hết hàng");
  await expect(page.getByLabel("Số cành Hoa ly")).toBeDisabled();
  await page.getByLabel("Số cành Hoa hồng").fill("2");
  await page.getByLabel("Số cành Hoa tulip").fill("3");
  await expect(page.locator("#custom-bouquet-total")).toContainText("450.000");
  await page.locator("#custom-bouquet-add").click();
  await expect(page.locator("#custom-bouquet-message")).toContainText("Đã thêm bó hoa gồm 5 cành");

  await page.goto("/cart.html");
  await expect(page.locator("#product-container")).toContainText("Hoa hồng");
  await expect(page.locator("#product-container")).toContainText("Hoa tulip");
  await expect(page.locator("#total")).toContainText("450.000");
});
