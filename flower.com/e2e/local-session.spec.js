import { test as base, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createLocalAccounts } from "../lib/local-accounts";
import { createLocalServer } from "../lib/local-server";
import { SESSION_MS } from "../lib/local-session";

// A server clock is controlled by the test process, never by a public test-only endpoint.
const test = base.extend({
  sessionHarness: async ({}, use) => {
    let time = Date.now();
    const accounts = createLocalAccounts({ now: () => time });
    const server = createLocalServer({ root: process.cwd(), localAccounts: accounts });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    try { await use({ accounts, url: `http://127.0.0.1:${server.address().port}`, now: () => time, advance: ms => { time += ms; } }); }
    finally { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); accounts.close(); }
  },
  baseURL: async ({ sessionHarness }, use) => use(sessionHarness.url)
});

test.beforeEach(async ({ page }) => {
  await page.route("https://www.gstatic.com/firebasejs/**", route => route.abort());
});

async function signedIn(page) {
  const input = { email: `session-${randomUUID()}@demo`, password: "Session-test-password-123", name: "Khách kiểm thử phiên", phone: "0900000000",
    pin: "938405", confirmPin: "938405", questions: [
      { question: "Tên con vật trong truyện tôi thích?", answer: "Cáo xanh" },
      { question: "Món ăn tôi tự nấu lần đầu?", answer: "Canh bí" },
      { question: "Tên nhân vật tôi từng tự vẽ?", answer: "Mây tím" }
    ] };
  const response = await page.request.post("/api/local-auth/register", { data: input });
  expect(response.status()).toBe(200);
  const { account } = await response.json();
  const cookie = (await page.context().cookies()).find(item => item.name === "flower_local_session");
  expect(cookie.httpOnly).toBe(true); expect(cookie.sameSite).toBe("Strict");
  await page.goto("/login.html");
  await page.evaluate(value => localStorage.setItem("loggedUser", JSON.stringify(value)), account);
  return { account, input, cookie: `${cookie.name}=${cookie.value}` };
}

test("12-hour expiry clears the protected page and copied cookies cannot use account APIs", async ({ page, sessionHarness }) => {
  const { account, cookie } = await signedIn(page);
  await page.clock.install({ time: new Date(sessionHarness.now()) });
  await page.goto("/account.html");
  await expect(page.locator("#account-email")).toHaveText(account.email);
  expect(await page.evaluate(() => document.cookie)).not.toContain("flower_local_session");
  sessionHarness.advance(SESSION_MS);
  await page.clock.fastForward(SESSION_MS);
  await expect(page).toHaveURL(/login\.html\?session=expired/);
  expect(await page.evaluate(() => localStorage.getItem("loggedUser"))).toBeNull();
  expect((await page.request.get("/api/local-auth/session", { headers: { Cookie: cookie } })).status()).toBe(401);
  expect((await page.request.get("/api/orders?action=mine", { headers: { Cookie: cookie } })).status()).toBe(401);
  await page.goto("/account.html");
  await expect(page).toHaveURL(/login\.html/);
});

test("logout clears both tabs, revokes a copied cookie and back navigation cannot restore the profile", async ({ page, context }) => {
  const { account, cookie } = await signedIn(page);
  await page.goto("/account.html");
  await expect(page.locator("#account-email")).toHaveText(account.email);
  const second = await context.newPage();
  await second.goto("/account.html");
  await expect(second.locator("#account-email")).toHaveText(account.email);
  await page.locator("#logout-button").click();
  await expect(page).toHaveURL(/login\.html/);
  await expect(second).toHaveURL(/login\.html/);
  expect((await context.cookies()).some(item => item.name === "flower_local_session")).toBe(false);
  expect((await page.request.get("/api/orders?action=mine", { headers: { Cookie: cookie } })).status()).toBe(401);
  await page.goBack();
  await expect(page).toHaveURL(/login\.html/);
  expect(await page.evaluate(() => localStorage.getItem("loggedUser"))).toBeNull();
});

test("an unavailable session endpoint cannot display a cached profile", async ({ page }) => {
  await signedIn(page);
  await page.route("**/api/local-auth/session", route => route.fulfill({ status: 503, json: { error: "Session service unavailable" } }));
  await page.goto("/account.html");
  await expect(page).toHaveURL(/login\.html\?session=unavailable/);
  await expect(page.locator("#display")).toContainText("Không thể xác minh phiên");
  expect(await page.evaluate(() => localStorage.getItem("loggedUser"))).toBeNull();
});

test("logout failure is shown without pretending the server session was revoked", async ({ page }) => {
  const { account, cookie } = await signedIn(page);
  await page.goto("/account.html");
  await expect(page.locator("#account-email")).toHaveText(account.email);
  await page.route("**/api/local-auth/logout", route => route.fulfill({ status: 503, json: { error: "Chưa thể đăng xuất. Vui lòng thử lại." } }));
  await page.locator("#logout-button").click();
  await expect(page.locator("#account-message")).toContainText("Chưa thể đăng xuất");
  await expect(page.locator("#logout-button")).toBeEnabled();
  expect((await page.request.get("/api/local-auth/session", { headers: { Cookie: cookie } })).status()).toBe(200);
});

test("returning to a cached page rechecks server revocation before displaying account details", async ({ page, sessionHarness }) => {
  const { account, cookie } = await signedIn(page);
  await page.goto("/account.html");
  await expect(page.locator("#account-email")).toHaveText(account.email);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
  await expect(page.locator(".account-details")).toBeHidden();
  sessionHarness.accounts.logout(cookie.split("=")[1]);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await expect(page).toHaveURL(/login\.html\?session=expired/);
});
