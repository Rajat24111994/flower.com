import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

test.describe("recovery form", () => {
  test.beforeEach(async ({ page }) => {
    // Controlled SDK responses test the form without sending any real email.
    await page.route("https://www.gstatic.com/firebasejs/**/firebase-app.js", (route) => route.fulfill({
      contentType: "text/javascript", body: `
        export const getApps = () => [];
        export const getApp = () => ({});
        export const initializeApp = () => ({});
      `
    }));
    await page.route("https://www.gstatic.com/firebasejs/**/firebase-auth.js", (route) => route.fulfill({
      contentType: "text/javascript", body: `
        export const getAuth = () => ({});
        export const connectAuthEmulator = () => {};
        export async function sendPasswordResetEmail(auth, email) {
          (window.__recoveryRequests ||= []).push(email);
          if (window.__recoveryError) {
            const error = new Error("Controlled recovery error");
            error.code = window.__recoveryError;
            throw error;
          }
          if (window.__recoveryHold) await new Promise(resolve => window.__releaseRecovery = resolve);
        }
      `
    }));
  });

  test("prefills normalized email and refuses malformed input", async ({ page }) => {
    await page.goto("/forgot-password.html?email=%20CUSTOMER%40EXAMPLE.TEST%20");
    const input = page.getByLabel("Địa chỉ thư điện tử");
    await expect(input).toHaveValue("customer@example.test");
    await input.fill("not-an-email");
    await page.locator("#recovery-submit").click();
    expect(await input.evaluate((element) => element.validity.valid)).toBe(false);
    expect(await page.evaluate(() => window.__recoveryRequests || [])).toEqual([]);
    await input.fill(" CUSTOMER@EXAMPLE.TEST ");
    await page.locator("#recovery-submit").click();
    await expect(page.locator("#recovery-message")).toHaveClass(/status-success/);
    expect(await page.evaluate(() => window.__recoveryRequests)).toEqual(["customer@example.test"]);
  });

  test("existing and nonexistent accounts receive the same public response", async ({ page }) => {
    await page.goto("/forgot-password.html");
    await page.getByLabel("Địa chỉ thư điện tử").fill("customer@example.test");
    await page.locator("#recovery-submit").click();
    const message = page.locator("#recovery-message");
    await expect(message).toHaveClass(/status-success/);
    const successText = await message.textContent();
    await page.evaluate(() => { window.__recoveryError = "auth/user-not-found"; });
    await page.getByLabel("Địa chỉ thư điện tử").fill("missing@example.test");
    await page.locator("#recovery-submit").click();
    await expect(message).toHaveText(successText);
    await expect(message).toHaveClass(/status-success/);
    await expect(page.locator("#recovery-submit")).toBeEnabled();
  });

  test("disables submission while sending and recovers after network or throttling errors", async ({ page }) => {
    await page.goto("/forgot-password.html");
    await page.evaluate(() => { window.__recoveryHold = true; });
    await page.getByLabel("Địa chỉ thư điện tử").fill("customer@example.test");
    const submit = page.locator("#recovery-submit");
    await submit.click();
    await expect(submit).toBeDisabled();
    await expect.poll(() => page.evaluate(() => Boolean(window.__releaseRecovery))).toBe(true);
    await page.evaluate(() => window.__releaseRecovery());
    await expect(submit).toBeEnabled();
    await page.evaluate(() => { window.__recoveryError = "auth/network-request-failed"; });
    await submit.click();
    await expect(page.locator("#recovery-message")).toContainText("Không kết nối được Firebase");
    await expect(submit).toBeEnabled();
    await page.evaluate(() => { window.__recoveryError = "auth/too-many-requests"; });
    await submit.click();
    await expect(page.locator("#recovery-message")).toContainText("thử quá nhiều lần");
    await expect(submit).toBeEnabled();
  });
});

test("locked customer can request recovery, reset the password and sign in again", async ({ page, request }) => {
  test.skip(!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST,
    "Run with Firebase Auth and Firestore emulators.");
  const project = process.env.GCLOUD_PROJECT || "web-ban-hoa-9fe0b";
  const authOrigin = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;
  const authApi = `${authOrigin}/identitytoolkit.googleapis.com/v1`;
  const email = `recovery-${randomUUID()}@example.test`;
  const originalPassword = "Original-Recovery-Test-123!";
  const newPassword = "Changed-Recovery-Test-456!";
  const signup = await request.post(`${authApi}/accounts:signUp?key=emulator-key`, {
    data: { email, password: originalPassword, returnSecureToken: true }
  });
  expect(signup.ok()).toBeTruthy();
  const { localId: uid } = await signup.json();
  const metadata = await request.post(`${authApi}/projects/${project}/accounts:lookup`, {
    headers: { Authorization: "Bearer owner" }, data: { email: [email] }
  });
  expect(metadata.ok()).toBeTruthy();
  const user = (await metadata.json()).users[0];
  const lockUrl = `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${project}/databases/(default)/documents/loginProtection/${uid}`;
  const headers = { Authorization: "Bearer owner" };
  const locked = await request.patch(lockUrl, { headers, data: { fields: {
    failures: { integerValue: "10" }, lockedUntil: { integerValue: "0" },
    resetRequired: { booleanValue: true },
    passwordUpdatedAt: { doubleValue: Number(user.passwordUpdatedAt) }
  } } });
  expect(locked.ok()).toBeTruthy();
  await page.addInitScript(() => sessionStorage.setItem("flowerflowE2e", "true"));
  await page.goto("/login.html?e2e=1");
  await page.locator("#email1").fill(email);
  await page.locator("#password1").fill(originalPassword);
  await page.locator("#signIn .submit").click();
  await expect(page.locator("#display")).toContainText("Quên mật khẩu");
  await page.locator("#forgotPassword").click();
  await expect(page).toHaveURL(/forgot-password\.html/);
  await expect(page.getByLabel("Địa chỉ thư điện tử")).toHaveValue(email);
  await page.locator("#recovery-submit").click();
  await expect(page.locator("#recovery-message")).toHaveClass(/status-success/);
  // Sending the email alone must leave the forced reset in place.
  const state = await (await request.get(lockUrl, { headers })).json();
  expect(state.fields.resetRequired.booleanValue).toBe(true);
  const codes = await (await request.get(`${authOrigin}/emulator/v1/projects/${project}/oobCodes`)).json();
  const code = codes.oobCodes.find((item) => item.email === email && item.requestType === "PASSWORD_RESET");
  expect(code).toBeTruthy();
  const reset = await request.post(`${authApi}/accounts:resetPassword?key=emulator-key`, {
    data: { oobCode: code.oobCode, newPassword }
  });
  expect(reset.ok()).toBeTruthy();
  await page.getByRole("link", { name: "Quay lại đăng nhập", exact: false }).click();
  await page.locator("#email1").fill(email);
  await page.locator("#password1").fill(originalPassword);
  await page.locator("#signIn .submit").click();
  await expect(page.locator("#display")).toContainText("Email hoặc mật khẩu không chính xác");
  await page.locator("#password1").fill(newPassword);
  await page.locator("#signIn .submit").click();
  await expect(page).toHaveURL(/product\.html/);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("loggedUser") || "null")?.uid)).toBe(uid);
  expect((await request.get(lockUrl, { headers })).status()).toBe(404);
});
