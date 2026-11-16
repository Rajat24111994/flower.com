import { test, expect, watchTypeWrites } from "./helpers/password-visibility-fixture.js";
import { randomUUID } from "node:crypto";

const fieldIds = ["password1", "password", "checkpassword"];

async function changeVisibility(page, hidden) {
  await page.evaluate(value => {
    Object.defineProperty(document, "hidden", { configurable: true, value });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

async function expectMasked(page) {
  for (const id of fieldIds) {
    const button = page.locator(`button[aria-controls="${id}"]`);
    const label = id === "checkpassword" ? "Hiện mật khẩu xác nhận" : "Hiện mật khẩu";
    await expect(page.locator(`#${id}`)).toHaveAttribute("type", "password");
    await expect(button).toHaveAttribute("aria-label", label);
    if (await button.isVisible()) await expect(button).toHaveAccessibleName(label);
    await expect(button).toHaveAttribute("title", label);
    await expect(button.locator(".eye-slash")).toHaveCSS("opacity", "1");
  }
}

for (const form of ["login", "signup"]) {
  test(`hiding the document conceals ${form} passwords immediately and cancels pending timers`, async ({ page }) => {
    if (form === "signup") await page.locator("#signup").click();
    const shownIds = form === "login" ? ["password1"] : ["password", "checkpassword"];
    for (const id of shownIds) {
      await page.locator(`#${id}`).fill(randomUUID());
      await page.locator(`button[aria-controls="${id}"]`).click();
    }
    await changeVisibility(page, false);
    for (const id of shownIds) await expect(page.locator(`#${id}`)).toHaveAttribute("type", "text");
    const snapshot = () => ({
      focus: document.activeElement.id,
      fields: Array.from(document.querySelectorAll(".password-field input"), input => ({
        value: input.value, selection: [input.selectionStart, input.selectionEnd, input.selectionDirection]
      }))
    });
    await page.evaluate(() => {
      document.querySelectorAll('.password-field input[type="text"]').forEach(input => {
        input.setSelectionRange(2, 8, "backward");
      });
    });
    const before = await page.evaluate(snapshot);
    await changeVisibility(page, true);
    await expectMasked(page);
    expect(await page.evaluate(snapshot)).toEqual(before);
    await watchTypeWrites(page);
    await page.clock.runFor(5000);
    expect(await page.evaluate(() => window.concealTypeWrites)).toBe(0);
    await changeVisibility(page, false);
    await expectMasked(page);

    // A new explicit reveal gets a fresh inactivity deadline.
    const id = shownIds[0];
    const button = page.locator(`button[aria-controls="${id}"]`);
    await button.click();
    await expect(button.locator(".eye-slash")).toHaveCSS("opacity", "0");
    await page.clock.runFor(2999);
    await expect(page.locator(`#${id}`)).toHaveAttribute("type", "text");
    await page.clock.runFor(1);
    await expectMasked(page);
  });
}

test("switching forms conceals all fields, clears timers and keeps them masked on return", async ({ page }) => {
  const values = Object.fromEntries(fieldIds.map(id => [id, randomUUID()]));
  await page.locator("#password1").fill(values.password1);
  await page.locator("#toggle-login-password").click();
  await page.clock.runFor(2000);
  await page.locator("#signup").click();
  await expectMasked(page);
  await expect(page.locator("#signUp")).toHaveJSProperty("inert", false);
  await expect(page.locator("#signIn")).toHaveJSProperty("inert", true);
  await watchTypeWrites(page);
  await page.clock.runFor(1500);
  expect(await page.evaluate(() => window.concealTypeWrites)).toBe(0);

  for (const id of ["password", "checkpassword"]) {
    await page.locator(`#${id}`).fill(values[id]);
    await page.locator(`button[aria-controls="${id}"]`).click();
  }
  await page.clock.runFor(1000);
  await page.locator("#signin").click();
  await expectMasked(page);
  await expect(page.locator("#signIn")).toHaveJSProperty("inert", false);
  await expect(page.locator("#signUp")).toHaveJSProperty("inert", true);
  await page.evaluate(() => { window.concealTypeWrites = 0; });
  await page.clock.runFor(4000);
  expect(await page.evaluate(() => window.concealTypeWrites)).toBe(0);
  await page.locator("#signup").click();
  await expectMasked(page);
  for (const id of fieldIds) await expect(page.locator(`#${id}`)).toHaveValue(values[id]);
});
