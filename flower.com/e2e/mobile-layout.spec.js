import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

const product = { id: "mobile", title: "Bó hoa " + "Hoa".repeat(28), description: "Hoa hồng dịu dàng", price: 100000,
  image: "./images/flower-01.webp", quantity: 8 };
const cart = [{ ...product, id: "line-mobile", productId: "mobile", size: "large", color: "pink",
  quantity: 2, stockQuantity: 8, price: 130000, cardMessage: "Chúc mừng sinh nhật!", personalNote: "Lưuý".repeat(100) }];

async function noOverflow(page) {
  const layout = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - innerWidth,
    elements: [...document.querySelectorAll("body *")].filter((element) => {
      const rect = element.getBoundingClientRect(); return rect.width > 0 && (rect.right > innerWidth + 1 || rect.left < -1);
    }).slice(0, 12).map((element) => `${element.tagName}.${element.className} ${Math.round(element.getBoundingClientRect().width)}`) }));
  expect(layout.overflow, `${page.url()} ${JSON.stringify(layout.elements)}`).toBeLessThanOrEqual(1);
}
async function touchTarget(locator) {
  const box = await locator.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(44);
  expect(box?.height).toBeGreaterThanOrEqual(44);
}

for (const width of [320, 390, 768]) {
  test(`menu, product, cart and checkout fit ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript((items) => {
      if (!localStorage.getItem("cart")) localStorage.setItem("cart", JSON.stringify(items));
    }, cart);
    await page.route("**/product-store.js*", (route) => route.fulfill({ contentType: "text/javascript", body: `
      const fixture = [${JSON.stringify(product)}];
      window.FlowerInventory = { initialize: async () => fixture, readProducts: () => fixture,
        readCategories: () => [], getCategories: async () => [], subscribeCategories: () => () => {} };` }));
    await page.route("**/review-store.js*", (route) => route.fulfill({ contentType: "text/javascript",
      body: "window.FlowerReviewStore = { subscribe: (_id, callback) => { callback([]); return () => {}; } };" }));
    await page.route("**/order-store.js*", (route) => route.fulfill({ contentType: "text/javascript",
      body: readFileSync(path.join(__dirname, "../js/order/order-store.js"), "utf8") + "\nwindow.FlowerOrderStore.getPromotions = async () => [];" }));
    await page.route("**/api/products", (route) => route.fulfill({ json: { products: [product] } }));
    await page.route("**/api/orders", (route) => {
      const body = route.request().postDataJSON();
      if (body.action === "quote") {
        const items = body.items.map((item) => ({ ...product, ...item, price: 130000, stock: 8 }));
        const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
        return route.fulfill({ json: {
          items,
          totals: { subtotal: total, savings: 0, tax: 0, shippingFee: 0, total },
          deliveryZone: { id: "fixture-zone", province: "Test Province", district: "Test District", fee: 0 }
        } });
      }
      return route.fulfill({ json: { order: { id: "E2E-MOBILE-ORDER" } } });
    });
    await page.route("**/api/delivery-zones", (route) => route.fulfill({ json: {
      configured: true,
      zones: [{ id: "fixture-zone", province: "Test Province", district: "Test District", fee: 0, enabled: true }]
    } }));

    await page.goto("/product.html");
    await expect(page.locator("#container .product-card")).toHaveCount(1);
    await noOverflow(page);
    const toggle = page.locator(".menu-toggle");
    await touchTarget(toggle);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await touchTarget(page.locator("#primary-nav a").first());
    await page.keyboard.press("Escape");
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await page.locator("#catalog-title").click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(toggle).toBeHidden();
    await noOverflow(page);
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/product.html?id=mobile");
    await expect(page.locator("#product-detail")).toBeVisible();
    await noOverflow(page);
    await touchTarget(page.locator("#detail-add-to-cart"));
    await page.screenshot({ path: testInfo.outputPath(`detail-${width}.png`), fullPage: true });

    await page.goto("/cart.html");
    await expect(page.locator(".cart-item")).toHaveCount(1);
    await noOverflow(page);
    const increase = page.getByRole("button", { name: /Tăng số lượng/ });
    await touchTarget(increase);
    await increase.click();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("cart"))[0].quantity)).toBe(3);
    await touchTarget(page.locator(".cart-remove"));
    await page.screenshot({ path: testInfo.outputPath(`cart-${width}.png`), fullPage: true });

    await page.goto("/checkout.html");
    await expect(page.locator(".checkout-submit")).toBeDisabled();
    await noOverflow(page);
    await touchTarget(page.locator(".quantity-button").first());
    const name = page.locator('[name="customerName"]');
    await name.fill("Khách hàng điện thoại");
    expect(await name.evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
    await expect(page.locator(".contact-dock")).toBeHidden();
    await page.locator('[name="phone"]').fill("0908123456");
    await page.locator('[name="address"]').fill("1 Đường Hoa, phường Bến Nghé, TP. Hồ Chí Minh");
    await page.locator('[name="deliveryProvince"]').selectOption("Test Province");
    await page.locator('[name="deliveryDistrict"]').selectOption("fixture-zone");
    await expect(page.locator(".checkout-submit")).toBeEnabled();
    await page.locator('[name="deliveryDate"]').fill(new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10));
    await page.locator('[name="deliveryTime"]').selectOption("08:00–11:00");
    await page.locator('[value="cod"]').check();
    await noOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`checkout-${width}.png`), fullPage: true });
    await page.locator(".checkout-submit").click();
    await expect(page.locator(".placeorder > button")).toBeEnabled();
    await noOverflow(page);
    await touchTarget(page.locator(".placeorder > button"));
    expect(errors).toEqual([]);
  });
}
