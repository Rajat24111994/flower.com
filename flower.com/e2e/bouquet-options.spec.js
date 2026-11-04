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
    body: readFileSync(path.join(__dirname, "../js/order/order-store.js"), "utf8")
      + `\nwindow.FlowerOrderStore.getPromotions = async () => [];
        window.FlowerOrderStore.getDeliveryZones = async () => ({ configured: true, zones: [
          { id: "fixture-zone", province: "Test Province", district: "Test District", fee: 0, enabled: true }
        ] });
        window.FlowerOrderStore.create = async (order) => {
          sessionStorage.setItem("submittedCheckoutOrder", JSON.stringify(order));
          return "ORDER-PERSONALIZED";
        };` }));
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
    return route.fulfill({ json: {
      items,
      totals: { subtotal: total, savings: 0, tax: 0, shippingFee: 0, total },
      deliveryZone: { id: body.deliveryZoneId || "fixture-zone", province: "Test Province", district: "Test District", fee: 0 }
    } });
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
  await expect(page.locator(".checkout-submit")).toBeDisabled();
  await page.locator('[name="customerName"]').fill("Khách thử nghiệm");
  await page.locator('[name="phone"]').fill("0908123456");
  await page.locator('[name="address"]').fill("1 Lê Lợi");
  await page.locator("#customer-is-recipient").check();
  await expect(page.locator("#recipient-fields")).toBeHidden();
  await expect(page.locator('[name="recipientName"]')).toHaveValue("Khách thử nghiệm");
  await page.locator("#customer-is-recipient").uncheck();
  await page.locator('[name="recipientName"]').fill("Người nhận thử nghiệm");
  await page.locator('[name="recipientPhone"]').fill("0987654321");
  await page.locator("#greeting-template").selectOption({ label: "Chúc mừng sinh nhật" });
  await expect(page.locator("#greeting-card")).toHaveValue("Chúc mừng sinh nhật! Chúc bạn luôn rạng rỡ và hạnh phúc.");
  await page.locator("#greeting-card").fill("Chúc mừng bạn!");
  await expect(page.locator("#greeting-card-counter")).toHaveText("14/300 ký tự");
  await expect(page.locator("#greeting-template")).toHaveValue("");
  await page.locator('[name="giftWrap"]').selectOption("classic");
  await page.locator('[name="orderNote"]').fill("Gọi người nhận trước khi giao.");
  await page.locator("#anonymous-greeting-card").check();
  await page.locator('[name="deliveryProvince"]').selectOption("Test Province");
  await page.locator('[name="deliveryDistrict"]').selectOption("fixture-zone");
  await expect(page.locator(".checkout-submit")).toBeEnabled();
  const deliveryDate = new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 10);
  await page.locator('[name="deliveryDate"]').fill(deliveryDate);
  await page.locator('[name="deliveryTime"]').selectOption("08:00–11:00");
  await page.locator('[name="paymentMethod"][value="cod"]').check();
  await page.locator(".checkout-submit").click();
  await expect(page.locator(".placeorder > button").first()).toBeEnabled();
  await expect(page.locator("#product-container")).toContainText("Gói giấy kraft");
  await expect(page.locator("#order-review-details")).toContainText("Người nhận thử nghiệm");
  await expect(page.locator("#order-review-details")).toContainText("Ẩn tên người gửi trên thiệp");
  await expect(page.locator("#order-review-details")).toContainText("Chúc mừng bạn!");
  await expect(page.locator("#order-review-details")).toContainText("Kraft, ruy băng đỏ");
  await expect(page.locator("#order-review-details")).toContainText("Gọi người nhận trước khi giao.");
  await expect(page.locator("#order-review-details")).toContainText(deliveryDate);
  await expect(page.locator("#order-review-details")).toContainText("Test District, Test Province");
  await expect(page.locator("#order-review-totals")).toContainText(new Intl.NumberFormat("vi-VN").format(expected));
  expect(quoteRequests.at(-1).items[0]).toMatchObject({ productId: "1", size: "large", color: "pink",
    cardMessage: "Chúc mừng sinh nhật mẹ!", personalNote: "Gói giấy kraft", quantity: 2 });
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator(".placeorder > button").click();
  await expect(page).toHaveURL(/tracking\.html\?id=ORDER-PERSONALIZED/);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("submittedCheckoutOrder")))).toMatchObject({
    recipientName: "Người nhận thử nghiệm",
    recipientPhone: "0987654321",
    customerIsRecipient: false,
    deliveryDate,
    deliveryTime: "08:00–11:00",
    greetingCard: "Chúc mừng bạn!",
    anonymousGreetingCard: true,
    giftWrap: "classic",
    orderNote: "Gọi người nhận trước khi giao."
  });
  expect(errors).toEqual([]);
});
