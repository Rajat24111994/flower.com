import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  // Test error handling and timers without contacting production Firebase.
  await page.route("https://www.gstatic.com/firebasejs/**/firebase-app.js", (route) => route.fulfill({
    contentType: "text/javascript", body: "export const initializeApp = () => ({});"
  }));
  await page.route("https://www.gstatic.com/firebasejs/**/firebase-auth.js", (route) => route.fulfill({
    contentType: "text/javascript", body: `
      export const getAuth = () => ({});
      export const browserLocalPersistence = {};
      export const setPersistence = async () => {};
      export const getRedirectResult = async () => null;
    `
  }));
});

test("wrong passwords, countdown, doubled lockout and mandatory recovery", async ({ page }) => {
  let attempts = 0;
  await page.route("**/api/login", async (route) => {
    attempts++;
    const response = attempts < 5
      ? { status: 401, code: "invalid-credential", error: "Email hoặc mật khẩu không chính xác." }
      : attempts === 5 || attempts === 6
        ? { status: 429, code: "account-locked", retryAfter: attempts === 5 ? 900 : 1800 }
        : { status: 403, code: "password-reset-required", error: "Để bảo vệ tài khoản, vui lòng dùng Quên mật khẩu để đặt lại mật khẩu trước khi đăng nhập." };
    await route.fulfill({ status: response.status, json: response });
  });
  await page.clock.install();
  await page.goto("/login.html");
  await page.locator("#email1").fill("customer@example.test");
  await page.locator("#password1").fill("wrong-test-password");
  const submit = page.locator("#signIn .submit");
  for (let i = 0; i < 4; i++) {
    await submit.click();
    await expect(page.locator("#display")).toHaveText("Email hoặc mật khẩu không chính xác.");
    await expect(submit).toBeEnabled();
  }
  await submit.click();
  await expect(submit).toBeDisabled();
  await expect(submit).toHaveValue(/Thử lại sau 15:00/);
  await page.locator("#signIn").dispatchEvent("submit");
  expect(attempts).toBe(5);
  await page.clock.fastForward(900_000);
  await expect(submit).toBeEnabled();
  await expect(page.locator("#display")).toContainText("một lần");
  await submit.click();
  await expect(submit).toHaveValue(/Thử lại sau 30:00/);
  await page.clock.fastForward(1_800_000);
  await submit.click();
  await expect(page.locator("#display")).toContainText("Quên mật khẩu");
  await expect(page.locator("#forgotPassword")).toBeVisible();
});

test("another email can sign in during a lockout; service errors do not start a timer", async ({ page }) => {
  await page.route("**/api/login", (route) => {
    const { email } = route.request().postDataJSON();
    return route.fulfill(email === "locked@example.test"
      ? { status: 429, json: { code: "account-locked", retryAfter: 900 } }
      : { status: 503, json: { code: "auth-service-unavailable", error: "Chưa thể đăng nhập lúc này. Vui lòng thử lại sau." } });
  });
  await page.goto("/login.html");
  await page.locator("#email1").fill("locked@example.test");
  await page.locator("#password1").fill("wrong-test-password");
  const submit = page.locator("#signIn .submit");
  await submit.click();
  await expect(submit).toBeDisabled();
  await page.locator("#email1").fill("other@example.test");
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.locator("#display")).toContainText("Chưa thể đăng nhập");
  await expect(submit).toBeEnabled();
  await expect(submit).toHaveValue("Đăng nhập");
});

test("a static server without the login API shows an actionable local setup message", async ({ page }) => {
  await page.route("**/api/login", (route) => route.fulfill({
    status: 404, contentType: "text/html", body: "<!doctype html><title>Not Found</title>"
  }));
  await page.goto("/login.html");
  await page.locator("#email1").fill("customer@example.test");
  await page.locator("#password1").fill("wrong-test-password");
  await page.locator("#signIn .submit").click();
  await expect(page.locator("#display")).toContainText("npm run dev");
  await expect(page.locator("#display")).toContainText("Live Server");
  await expect(page.locator("#signIn .submit")).toBeEnabled();
});
