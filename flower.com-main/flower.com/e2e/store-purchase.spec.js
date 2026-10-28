import { test, expect } from "@playwright/test";

const email = `e2e-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
const password = "FlowerFlow-E2E-Password-1!";
const totals = { subtotal: 250000, savings: 0, tax: 0, total: 250000 };

test("customer can browse, add a flower, sign in, and place an order", async ({ page, request }, testInfo) => {
  const consoleErrors = [];
  const failedRequests = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("requestfailed", (requestEvent) => {
    failedRequests.push(`${requestEvent.method()} ${requestEvent.url()}: ${requestEvent.failure()?.errorText}`);
  });
  await page.addInitScript(() => sessionStorage.setItem("flowerflowE2e", "true"));

  const signup = await request.post(
    "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key",
    { data: { email, password, returnSecureToken: true } }
  );
  expect(signup.ok(), `Firebase Auth Emulator account setup failed: ${await signup.text()}`).toBeTruthy();

  await page.route("**/api/orders", async (route) => {
    const body = route.request().postDataJSON();
    if (body.action === "quote") {
      await route.fulfill({ json: {
        items: [{ id: 1, title: "Bó hoa xuân dịu dàng", image: "./images/flower-01.webp", price: 250000, quantity: 1, stockQuantity: 10 }],
        totals
      } });
      return;
    }
    await route.fulfill({ json: { order: { id: "E2E-ORDER-67" } } });
  });

  await page.goto("/product.html?id=1&e2e=1");
  await expect(page.locator("#product-detail")).toBeVisible();
  await expect(page.locator("#detail-name")).not.toBeEmpty();
  await page.screenshot({ path: testInfo.outputPath("screenshots/01-product.png"), fullPage: true });

  await page.getByRole("button", { name: "Thêm vào giỏ" }).click();
  await page.goto("/cart.html");
  await expect(page.locator("#product-container")).toContainText("Bó hoa");
  await page.screenshot({ path: testInfo.outputPath("screenshots/02-cart.png"), fullPage: true });

  await page.goto("/login.html?e2e=1");
  await page.locator("#email1").fill(email);
  await page.locator("#password1").fill(password);
  await page.locator("#signIn .submit").click();
  await expect(page).toHaveURL(/product\.html/);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("loggedUser") || "null")?.email)).toBe(email);
  await page.screenshot({ path: testInfo.outputPath("screenshots/03-signed-in.png"), fullPage: true });

  await page.goto("/checkout.html");
  await expect(page.locator("#checkout-message")).toContainText("đã được xác minh", { timeout: 15000 });
  await page.locator('[name="customerName"]').fill("Khách hàng kiểm thử");
  await page.locator('[name="phone"]').fill("0912345678");
  await page.locator('[name="address"]').fill("1 Đường Hoa, Quận 1, TP. Hồ Chí Minh");
  const deliveryDate = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  await page.locator('[name="deliveryDate"]').fill(deliveryDate);
  await page.locator('[name="deliveryTime"]').selectOption({ label: "08:00–12:00" });
  await page.locator('[name="paymentMethod"][value="cod"]').check();
  await page.screenshot({ path: testInfo.outputPath("screenshots/04-checkout.png"), fullPage: true });
  await page.getByRole("button", { name: "Đặt hàng" }).click();
  await expect(page).toHaveURL(/placeorder\.html/);
  await expect(page.locator(".placeorder > button")).toBeEnabled({ timeout: 15000 });
  await page.screenshot({ path: testInfo.outputPath("screenshots/05-order-review.png"), fullPage: true });

  page.once("dialog", (dialog) => dialog.accept());
  await page.locator(".placeorder > button").click();
  await expect(page).toHaveURL(/tracking\.html\?id=E2E-ORDER-67/);

  expect(failedRequests, `Failed browser requests:\n${failedRequests.join("\n")}`).toEqual([]);
  expect(consoleErrors, `Browser console errors:\n${consoleErrors.join("\n")}`).toEqual([]);
});
