import { test as base, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createLocalAccountWorker } from "../lib/local-account-worker";
import { createLocalServer } from "../lib/local-server";

// Each test gets a real account worker and its own rate budgets/database.
const test = base.extend({ baseURL: async ({}, use) => {
  const accounts = createLocalAccountWorker();
  const server = createLocalServer({ root: process.cwd(), localAccounts: accounts });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try { await use(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); await accounts.close(); }
} });

async function fillRecoveryProfile(page, input) {
  await page.locator("#recovery-name").fill(input.name);
  await page.locator("#recovery-phone").fill(input.phone);
}

const pin = "938405";
const questions = [
  { question: "Tên con vật trong truyện tôi thích?", answer: "Cáo xanh" },
  { question: "Món ăn tôi tự nấu lần đầu?", answer: "Canh bí" },
  { question: "Tên nhân vật tôi từng tự vẽ?", answer: "Mây tím" }
];
const profile = (overrides = {}) => ({ email: `ban-${randomUUID()}@demo`, password: "Tai-khoan-tu-tao-123",
  name: "Khách thử nghiệm", phone: "0900000000", pin, confirmPin: pin, questions, ...overrides });
async function register(page, input) {
  const response = await page.request.post("/api/local-auth/register", { data: input });
  expect(response.ok()).toBeTruthy();
  return response.json();
}
test.beforeEach(async ({ page }) => {
  await page.route("https://www.gstatic.com/firebasejs/**", route => route.abort());
});

test("register with a custom PIN and questions, keep session, then sign out and back in", async ({ page }, testInfo) => {
  const input = profile();
  await page.goto("/login.html");
  await expect(page.locator("[data-google-auth]").first()).toBeHidden();
  await page.locator("#signup").click();
  for (const [id, value] of Object.entries({ name: "Khách", lastName: "thử nghiệm", email: input.email,
    phone: input.phone, password: input.password, checkpassword: input.password,
    "signup-pin": "123", "signup-confirm-pin": "123" })) await page.locator(`#${id}`).fill(value);
  for (let i = 0; i < 3; i++) {
    await page.locator(`#signup-question-${i + 1}`).fill(questions[i].question);
    await page.locator(`#signup-answer-${i + 1}`).fill(questions[i].answer);
  }
  expect(await page.locator("#signup-pin").evaluate(input => input.checkValidity())).toBe(false);
  await page.locator("#signup-pin").fill("12");
  await page.locator("#signup-pin").pressSequentially("a!b-3 4");
  await expect(page.locator("#signup-pin")).toHaveValue("1234");
  await page.locator("#signup-pin").fill("123456");
  await page.locator("#signup-pin").pressSequentially("7");
  await expect(page.locator("#signup-pin")).toHaveValue("123456");
  await page.locator("#signup-pin").fill(pin);
  await page.locator("#signup-confirm-pin").fill(pin);
  await page.screenshot({ path: `.tools/pin-signup-${testInfo.project.name}.png`, fullPage: true, animations: "disabled" });
  await page.locator("#signUp .submit").click();
  await expect(page).toHaveURL(/product\.html/, { timeout: 15_000 });
  await page.goto("/account.html");
  await expect(page.locator("#account-email")).toHaveText(input.email);
  await expect(page.locator("#account-phone")).toHaveText(input.phone);
  await expect(page.locator("#security-title")).toHaveText("Đổi PIN khôi phục");
  await page.reload();
  await expect(page.locator("#account-email")).toHaveText(input.email);
  expect(await page.evaluate(() => document.cookie)).not.toContain("flower_local_session");
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  expect(storage).not.toContain(pin);
  expect(storage).not.toContain(questions[0].answer);
  await page.locator("#logout-button").click();
  await expect(page).toHaveURL(/login\.html/);
  await page.locator("#email1").fill(input.email);
  await page.locator("#password1").fill(input.password);
  await page.locator("#signIn .submit").click();
  await expect(page).toHaveURL(/product\.html/);
});

test("five wrong passwords survive reload and a valid PIN resets the password lock", async ({ page }) => {
  const input = profile(), newPassword = "New-test-password-456";
  await register(page, input);
  await page.request.post("/api/local-auth/logout");
  await page.goto("/login.html");
  await page.locator("#email1").fill(input.email);
  await page.locator("#password1").fill("wrong-password");
  const submit = page.locator("#signIn .submit");
  for (let i = 0; i < 4; i++) {
    await submit.click();
    await expect(page.locator("#display")).toContainText("không chính xác");
    await expect(submit).toBeEnabled();
  }
  await submit.click();
  await expect(submit).toBeDisabled();
  await expect(page.locator("#display")).toContainText("15 phút");
  await page.reload();
  await page.locator("#email1").fill(input.email);
  await page.locator("#password1").fill(input.password);
  await submit.click();
  await expect(submit).toBeDisabled();
  await page.locator("#forgotPassword").click();
  await expect(page.locator("#recovery-email")).toHaveValue(input.email);
  await fillRecoveryProfile(page, input);
  await page.locator("#recovery-pin").fill("123456");
  await page.locator("#recovery-new-password").fill(newPassword);
  await page.locator("#recovery-confirm-password").fill(newPassword);
  await page.locator("#recovery-submit").click();
  await expect(page.locator("#recovery-message")).toContainText("không chính xác");
  await expect(page.locator("#recovery-message")).toContainText("Bạn còn 4 lượt thử");
  await page.locator("#recovery-pin").fill(pin);
  await page.locator("#recovery-submit").click();
  await expect(page.locator("#local-reset-result")).toBeVisible();
  await page.locator("#local-reset-result a").click();
  await page.locator("#email1").fill(input.email);
  await page.locator("#password1").fill(input.password);
  await page.locator("#signIn .submit").click();
  await expect(page.locator("#display")).toContainText("không chính xác");
  await page.locator("#password1").fill(newPassword);
  await page.locator("#signIn .submit").click();
  await expect(page).toHaveURL(/product\.html/);
});

test("change PIN verifies full account information, current password and old PIN", async ({ page }) => {
  const input = profile(), nextPin = "84710";
  await register(page, input);
  await page.goto("/account.html");
  await expect(page.locator("#security-email")).toHaveValue(input.email);
  await page.locator("#security-name").fill("Sai họ tên");
  await page.locator("#security-password").fill(input.password);
  await page.locator("#security-old-pin").fill(pin);
  await page.locator("#security-new-pin").fill(nextPin);
  await page.locator("#security-confirm-pin").fill(nextPin);
  await page.locator("#security-submit").click();
  await expect(page.locator("#security-message")).toContainText("không chính xác");
  await page.locator("#security-name").fill(input.name);
  await page.locator("#security-old-pin").fill("123456");
  await page.locator("#security-submit").click();
  await expect(page.locator("#security-message")).toContainText("không chính xác");
  await expect(page.locator("#security-submit")).toBeEnabled();
  await page.locator("#security-old-pin").fill(pin);
  await page.locator("#security-submit").click();
  await expect(page.locator("#security-message")).toContainText("Đã đổi PIN");
  await expect(page.locator("#security-new-pin")).toHaveValue("");
  await page.goto(`/forgot-password.html?email=${encodeURIComponent(input.email)}`);
  await fillRecoveryProfile(page, input);
  await page.locator("#recovery-new-password").fill("New-password-789");
  await page.locator("#recovery-confirm-password").fill("New-password-789");
  await page.locator("#recovery-pin").fill(input.pin);
  await page.locator("#recovery-submit").click();
  await expect(page.locator("#recovery-message")).toContainText("không chính xác");
  await page.locator("#recovery-pin").fill(nextPin);
  await page.locator("#recovery-submit").click();
  await expect(page.locator("#local-reset-result")).toBeVisible();
});

test("forgotten PIN requires all three custom answers before a new PIN can reset the password", async ({ page }) => {
  const input = profile(), nextPin = "6273";
  await register(page, input);
  await page.request.post("/api/local-auth/logout");
  await page.goto(`/forgot-password.html?email=${encodeURIComponent(input.email)}`);
  await fillRecoveryProfile(page, input);
  await page.locator("#forgot-pin").click();
  await expect(page.locator("#pin-email")).toHaveValue(input.email);
  await page.locator("#pin-questions-form button").click();
  await expect(page.locator("#pin-recovery-form")).toBeVisible();
  await page.locator("#back-to-password").click();
  await page.locator("#forgot-pin").click();
  await expect(page.locator("#pin-recovery-form")).toBeHidden();
  await page.locator("#pin-questions-form button").click();
  await expect(page.locator("#pin-recovery-form")).toBeVisible();
  for (let i = 0; i < 3; i++) {
    await expect(page.locator(`label[for="pin-answer-${i + 1}"]`)).toContainText(questions[i].question);
    await page.locator(`#pin-answer-${i + 1}`).fill(questions[i].answer);
  }
  await page.locator("#pin-answer-3").fill("Câu trả lời sai");
  await page.locator("#forgot-new-pin").fill(nextPin);
  await page.locator("#forgot-confirm-pin").fill(nextPin);
  await page.locator("#pin-recovery-form button").click();
  await expect(page.locator("#pin-message")).toContainText("đúng cả 3");
  await expect(page.locator("#pin-message")).toContainText("Bạn còn 4 lượt thử");
  await page.locator("#pin-answer-3").fill(questions[2].answer);
  await page.locator("#pin-recovery-form button").click();
  await expect(page.locator("#pin-message")).toContainText("Đã đặt lại PIN");
  await page.locator("#back-to-password").click();
  await page.locator("#recovery-pin").fill(nextPin);
  await page.locator("#recovery-new-password").fill("New-password-789");
  await page.locator("#recovery-confirm-password").fill("New-password-789");
  await page.locator("#recovery-submit").click();
  await expect(page.locator("#local-reset-result")).toBeVisible();
});

test("fifth wrong PIN shows questions automatically, survives reload and requires a new PIN", async ({ page }) => {
  const input = profile(), nextPin = "6273";
  await register(page, input);
  await page.goto(`/forgot-password.html?email=${encodeURIComponent(input.email)}`);
  await page.locator("#recovery-pin").fill("123456");
  await page.locator("#recovery-new-password").fill("New-password-789");
  await page.locator("#recovery-confirm-password").fill("New-password-789");
  for (let remaining = 4; remaining >= 1; remaining--) {
    await page.locator("#recovery-submit").click();
    await expect(page.locator("#recovery-message")).toContainText(`Bạn còn ${remaining} lượt thử`);
    await expect(page.locator("#recovery-submit")).toBeEnabled();
  }
  await page.locator("#recovery-submit").click();
  await expect(page.locator("#pin-recovery-form")).toBeVisible();
  await expect(page.locator("#pin-recovery-title")).toHaveText("Bắt buộc đặt PIN mới");
  await expect(page.locator("#pin-message")).toContainText("Còn 0 lượt thử PIN cũ");
  await expect(page.locator("#back-to-password")).toBeHidden();
  await expect(page.locator("#pin-email")).toHaveJSProperty("readOnly", true);
  await page.reload();
  await expect(page.locator("#pin-recovery-form")).toBeVisible();
  await expect(page.locator("#pin-message")).toContainText("Còn 0 lượt thử PIN cũ");
  for (let i = 0; i < 3; i++) {
    await expect(page.locator(`label[for="pin-answer-${i + 1}"]`)).toContainText(questions[i].question);
    await page.locator(`#pin-answer-${i + 1}`).fill(questions[i].answer);
  }
  await page.locator("#forgot-new-pin").fill(nextPin);
  await page.locator("#forgot-confirm-pin").fill(nextPin);
  await page.locator("#pin-recovery-form button").click();
  await expect(page.locator("#pin-message")).toContainText("Đã đặt lại PIN");
  await page.locator("#back-to-password").click();
  await page.locator("#recovery-pin").fill(nextPin);
  await page.locator("#recovery-new-password").fill("New-password-789");
  await page.locator("#recovery-confirm-password").fill("New-password-789");
  await page.locator("#recovery-submit").click();
  await expect(page.locator("#local-reset-result")).toBeVisible();
});

test("fifth wrong old PIN on the profile opens mandatory questions and cannot be bypassed by revisiting the profile", async ({ page }) => {
  const input = profile();
  await register(page, input);
  await page.goto("/account.html");
  await page.locator("#security-password").fill(input.password);
  await page.locator("#security-old-pin").fill("123456");
  await page.locator("#security-new-pin").fill("84710");
  await page.locator("#security-confirm-pin").fill("84710");
  for (let remaining = 4; remaining >= 1; remaining--) {
    await page.locator("#security-submit").click();
    await expect(page.locator("#security-message")).toContainText(`Bạn còn ${remaining} lượt thử`);
    await expect(page.locator("#security-submit")).toBeEnabled();
  }
  await page.locator("#security-submit").click();
  await expect(page).toHaveURL(/forgot-password\.html\?.*recoverPin=1/);
  await expect(page.locator("#pin-recovery-form")).toBeVisible();
  await expect(page.locator("#pin-message")).toContainText("Còn 0 lượt thử PIN cũ");
  await page.goto("/account.html");
  await expect(page).toHaveURL(/forgot-password\.html\?.*recoverPin=1/);
  await expect(page.locator("#pin-recovery-form")).toBeVisible();
});

test("profile comes from the server even if localStorage is forged", async ({ page }) => {
  const input = profile({ role: "owner" });
  const { account } = await register(page, input);
  await page.goto("/login.html");
  await page.evaluate(value => localStorage.setItem("loggedUser", JSON.stringify({ ...value, role: "owner", name: "Forged" })), account);
  await page.goto("/account.html");
  await expect(page.locator("#account-name")).toHaveText(input.name);
  await expect(page.locator("#account-email")).toHaveText(input.email);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("loggedUser")).role)).toBe("customer");
});
