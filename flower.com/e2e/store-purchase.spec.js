import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

const FIRESTORE = "http://127.0.0.1:8080/v1/projects/web-ban-hoa-9fe0b/databases/(default)/documents";
const catalog = [{
  id: 1,
  title: "Bó hoa xuân dịu dàng",
  image: "./images/products/product-flower-01.webp",
  price: 250000,
  quantity: 10,
  status: "active",
  saleType: "ready_made"
}];

// Firestore REST values for plain JSON (strings, numbers, booleans, arrays, objects).
function toFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toFirestoreValue) } };
  if (typeof value === "object") return { mapValue: { fields: toFirestoreFields(value) } };
  return { stringValue: String(value) };
}

function toFirestoreFields(object) {
  return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, toFirestoreValue(value)]));
}

// The shop reads its products from Firestore, and the emulator starts empty: load the catalog
// first (the "Bearer owner" token lets the emulator skip Security Rules for this setup).
test.beforeAll(async ({ request }) => {
  const headers = { Authorization: "Bearer owner" };
  for (const product of catalog) {
    const response = await request.patch(`${FIRESTORE}/products/${product.id}`, {
      headers,
      data: { fields: toFirestoreFields({ ...product, quantity: product.quantity ?? 10 }) }
    });
    expect(response.ok(), `Không nạp được sản phẩm ${product.id} vào Firestore Emulator: ${await response.text()}`).toBeTruthy();
  }
  await request.patch(`${FIRESTORE}/metadata/productCatalog`, { headers, data: { fields: toFirestoreFields({ catalogSeeded: true }) } });
});

const email = `e2e-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
const password = "FlowerFlow-E2E-Password-1!";
const totals = { subtotal: 250000, savings: 0, tax: 0, shippingFee: 0, total: 250000 };

test("customer can browse, add a flower, sign in, and place an order", async ({ page, request }, testInfo) => {
  const consoleErrors = [];
  const failedRequests = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("requestfailed", (requestEvent) => {
    // Requests cancelled because the test moved to the next page are not failures.
    if (requestEvent.failure()?.errorText === "net::ERR_ABORTED") return;
    failedRequests.push(`${requestEvent.method()} ${requestEvent.url()}: ${requestEvent.failure()?.errorText}`);
  });
  await page.addInitScript(() => sessionStorage.setItem("flowerflowE2e", "true"));

  // The static test server has no API: answer the catalog request the way api/products.js does.
  await page.route("**/api/products", (route) => route.fulfill({
    json: { products: catalog.map((product) => ({ ...product, quantity: product.quantity ?? 10 })) }
  }));
  await page.route("**/api/orders", async (route) => {
    const body = route.request().postDataJSON();
    if (body.action === "quote") {
      await route.fulfill({ json: {
        items: [{ id: 1, title: "Bó hoa xuân dịu dàng", image: "./images/products/product-flower-01.webp", price: 250000, quantity: 1, stockQuantity: 10 }],
        totals,
        deliveryZone: { id: "fixture-zone", province: "Test Province", district: "Test District", fee: 0 }
      } });
      return;
    }
    await route.fulfill({ json: { order: { id: "E2E-ORDER-67" } } });
  });
  await page.route("**/api/delivery-zones", (route) => route.fulfill({ json: {
    configured: true,
    zones: [{ id: "fixture-zone", province: "Test Province", district: "Test District", fee: 0, enabled: true }]
  } }));

  await page.goto("/product.html?id=1&e2e=1");
  await expect(page.locator("#product-detail")).toBeVisible();
  await expect(page.locator("#detail-name")).not.toBeEmpty();
  await page.screenshot({ path: testInfo.outputPath("screenshots/01-product.png"), fullPage: true });

  await page.getByRole("button", { name: "Thêm vào giỏ" }).click();
  await page.goto("/cart.html");
  await expect(page.locator("#product-container")).toContainText("Bó hoa");
  await page.screenshot({ path: testInfo.outputPath("screenshots/02-cart.png"), fullPage: true });

  await page.goto("/login.html?e2e=1");
  await page.locator("#signup").click();
  await page.locator("#name").fill("Khách hàng");
  await page.locator("#lastName").fill("kiểm thử");
  await page.locator("#email").fill(email);
  await page.locator("#phone").fill("0912345678");
  await page.locator("#password").fill(password);
  await page.locator("#checkpassword").fill(password);
  await page.locator("#signUp .submit").click();
  await expect(page).toHaveURL(/product\.html/);
  const signupStorage = await page.evaluate((secret) => ({
    profile: JSON.parse(localStorage.getItem("loggedUser") || "null"),
    containsPassword: [localStorage, sessionStorage].some((storage) =>
      Array.from({ length: storage.length }, (_, index) => storage.getItem(storage.key(index)))
        .some((value) => value?.includes(secret))
    )
  }), password);
  expect(signupStorage.profile).not.toHaveProperty("password");
  expect(signupStorage.containsPassword).toBe(false);

  await page.goto("/login.html?e2e=1");
  await page.locator("#email1").fill(email);
  await page.locator("#password1").fill(password);
  await page.locator("#signIn .submit").click();
  await expect(page).toHaveURL(/product\.html/);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("loggedUser") || "null")?.email)).toBe(email);
  await page.screenshot({ path: testInfo.outputPath("screenshots/03-signed-in.png"), fullPage: true });

  await page.goto("/forgot-password.html");
  await page.locator("#recovery-email").fill(email);
  await page.locator("#recovery-submit").click();
  await expect(page.locator("#recovery-message")).toContainText("Nếu email này đã được đăng ký");

  await page.goto("/checkout.html");
  // The page loads delivery zones and promotions first; filling the form before that is done
  // would be undone when the province list is drawn.
  await expect(page.locator('#checkout-form[data-ready="true"]')).toHaveCount(1, { timeout: 15000 });
  await expect(page.locator("#checkout-message")).toContainText("đã được xác minh", { timeout: 15000 });
  await page.locator('[name="customerName"]').fill("Khách hàng kiểm thử");
  await page.locator('[name="phone"]').fill("0912345678");
  await page.locator('[name="address"]').fill("1 Đường Hoa, Quận 1, TP. Hồ Chí Minh");
  await page.locator('[name="deliveryProvince"]').selectOption("Test Province");
  // Picking the district asks the shop for a new quote with that zone; ordering before it is
  // back is refused on purpose ("Hãy chọn lại khu vực..."), so wait for it.
  const zoneQuote = page.waitForResponse((response) => response.url().includes("/api/orders")
    && response.request().postDataJSON()?.action === "quote"
    && response.request().postDataJSON()?.deliveryZoneId === "fixture-zone");
  await page.locator('[name="deliveryDistrict"]').selectOption("fixture-zone");
  await zoneQuote;
  await expect(page.getByRole("button", { name: "Đặt hàng" })).toBeEnabled();
  const deliveryDate = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  await page.locator('[name="deliveryDate"]').fill(deliveryDate);
  await page.locator('[name="deliveryTime"]').selectOption({ label: "08:00–11:00" });
  await page.locator('[name="paymentMethod"][value="cod"]').check();
  await page.screenshot({ path: testInfo.outputPath("screenshots/04-checkout.png"), fullPage: true });
  // On a phone the fixed "Chat Facebook / Zalo" bar covers the bottom of the screen: bring the
  // button to the middle first, as a customer scrolling to it would. The page scrolls smoothly,
  // so jump there at once: clicking while it is still moving would miss the button.
  const orderButton = page.getByRole("button", { name: "Đặt hàng" });
  await orderButton.evaluate((button) => button.scrollIntoView({ block: "center", behavior: "instant" }));
  await orderButton.click();
  await expect(page).toHaveURL(/placeorder\.html/);
  await expect(page.locator(".placeorder > button")).toBeEnabled({ timeout: 15000 });
  await page.screenshot({ path: testInfo.outputPath("screenshots/05-order-review.png"), fullPage: true });

  page.once("dialog", (dialog) => dialog.accept());
  await page.locator(".placeorder > button").click();
  await expect(page).toHaveURL(/tracking\.html\?id=E2E-ORDER-67/);

  expect(failedRequests, `Failed browser requests:\n${failedRequests.join("\n")}`).toEqual([]);
  expect(consoleErrors, `Browser console errors:\n${consoleErrors.join("\n")}`).toEqual([]);
});
