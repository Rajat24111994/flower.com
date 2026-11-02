import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

const catalog = JSON.parse(readFileSync(path.join(__dirname, "../flower.json"), "utf8")).flower
  .map((item) => ({ ...item, quantity: 5 }));

test("personalized bouquet keeps its price, color and message through cart and review", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Isolate catalog and promotion data from external Firebase; exercise the actual UI and API client.
  await page.route("**/product-store.js*", (route) => route.fulfill({ contentType: "text/javascript", body: `
    const fixture = ${JSON.stringify(catalog)};
    window.FlowerInventory = { initialize: async () => fixture, readProducts: () => fixture,
      readCategories: () => [], getCategories: async () => [], subscribeCategories: () => () => {} };
  ` }));
  await page.route("**/review-store.js*", (route) => route.fulfill({ contentType: "text/javascript",
    body: "window.FlowerReviewStore = { subscribe: (_id, callback) => { callback([]); return () => {}; } };" }));
  await page.route("**/order-store.js*", (route) => route.fulfill({ contentType: "text/javascript",
    body: readFileSync(path.join(__dirname, "../order-store.js"), "utf8")
      + "\nwindow.FlowerOrderStore.getPromotions = async () => [];" }));
  await page.route("**/api/products", (route) => route.fulfill({ json: { products: catalog } }));
  const quoteRequests = [];
  await page.route("**/api/orders", (route) => {
    const body = route.request().postDataJSON();
    quoteRequests.push(body);
    const items = body.items.map((item) => {
      const product = catalog.find((candidate) => String(candidate.id) === String(item.productId ?? item.id));
      return { ...item, title: product.title, image: product.image, stock: 5,
        price: Math.round(product.price * ({ standard: 1, large: 1.3, premium: 1.6 }[item.size || "standard"])) };
    });
    const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    return route.fulfill({ json: { items, totals: { subtotal: total, savings: 0, tax: 0, total } } });
  });

  await page.goto("/product.html?id=1");
  await expect(page.locator("#product-detail")).toBeVisible();
  await expect(page.locator("#detail-thumbnails button")).toHaveCount(2);
  await page.locator("#detail-thumbnails button").nth(1).click();
  await expect(page.locator("#detail-main-image")).toHaveAttribute("src", catalog[0].image);
  await expect(page.locator("#detail-gallery-caption")).toContainText("Cận cảnh");
  await expect(page.locator("#detail-meaning")).not.toBeEmpty();
  await page.locator("#detail-size").selectOption("large");
  await page.locator("#detail-color").selectOption("pink");
  await page.locator("#detail-card").fill("Chúc mừng sinh nhật mẹ!");
  await page.locator("#detail-note").fill("Gói giấy kraft");
  await page.locator("#detail-quantity").fill("2");
  const expected = catalog[0].price * 1.3 * 2;
  await expect(page.locator("#detail-selection-total")).toContainText(new Intl.NumberFormat("vi-VN").format(expected));
  await page.screenshot({ path: testInfo.outputPath("bouquet-detail.png"), fullPage: true });
  await page.locator("#detail-add-to-cart").click();
  await page.goto("/cart.html");
  await expect(page.locator("#product-container")).toContainText("Hồng pastel");
  await expect(page.locator("#product-container")).toContainText("Chúc mừng sinh nhật mẹ!");
  await page.goto("/checkout.html");
  await expect(page.locator(".checkout-submit")).toBeEnabled();
  await page.locator('[name="customerName"]').fill("Khách thử nghiệm");
  await page.locator('[name="phone"]').fill("0908123456");
  await page.locator('[name="address"]').fill("1 Lê Lợi");
  await page.locator('[name="deliveryDate"]').fill(new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 10));
  await page.locator('[name="deliveryTime"]').selectOption("08:00–12:00");
  await page.locator('[name="paymentMethod"][value="cod"]').check();
  await page.locator(".checkout-submit").click();
  await expect(page.locator(".placeorder > button").first()).toBeEnabled();
  await expect(page.locator("#product-container")).toContainText("Gói giấy kraft");
  await expect(page.locator("#order-review-totals")).toContainText(new Intl.NumberFormat("vi-VN").format(expected));
  expect(quoteRequests.at(-1).items[0]).toMatchObject({ productId: "1", size: "large", color: "pink",
    cardMessage: "Chúc mừng sinh nhật mẹ!", personalNote: "Gói giấy kraft", quantity: 2 });
  expect(errors).toEqual([]);
});
