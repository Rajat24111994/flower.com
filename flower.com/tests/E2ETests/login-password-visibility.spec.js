import { test, expect } from "./helpers/password-visibility-fixture.js";
import { randomUUID } from "node:crypto";

test("login password toggles with mouse, Enter and Space without submitting", async ({ page }) => {
  const password = page.locator("#password1");
  const toggle = page.locator("#toggle-login-password");
  const value = randomUUID();
  await page.locator("#email1").fill("visibility@example.test");
  await password.fill(value);
  expect(await page.locator("#signIn").evaluate(form => form.checkValidity())).toBe(true);

  await expect(toggle).toHaveAttribute("type", "button");
  await expect(toggle).toHaveAttribute("aria-controls", "password1");
  await expect(password).toHaveAttribute("type", "password");
  await expect(toggle).not.toHaveClass(/is-visible/);
  const slash = toggle.locator(".eye-slash");
  await expect(slash).toHaveCSS("opacity", "1");
  expect(await slash.evaluate(element => getComputedStyle(element).transitionDuration)).not.toBe("0s");
  const icon = await toggle.locator("svg").evaluate(svg => svg.outerHTML);
  const fieldBox = await password.boundingBox();
  const buttonBox = await toggle.boundingBox();
  expect(buttonBox.x).toBeGreaterThan(fieldBox.x + fieldBox.width / 2);
  expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(fieldBox.x + fieldBox.width);
  expect(buttonBox.y).toBeGreaterThanOrEqual(fieldBox.y);
  expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(fieldBox.y + fieldBox.height);

  await toggle.click();
  await expect(password).toHaveAttribute("type", "text");
  await expect(password).toHaveValue(value);
  await expect(toggle).toHaveAccessibleName("Ẩn mật khẩu");
  await expect(toggle).toHaveAttribute("title", "Ẩn mật khẩu");
  await expect(toggle).toHaveClass(/is-visible/);
  await expect(slash).toHaveCSS("opacity", "0");

  // Reach the native button in tab order, then activate it with both keys.
  await password.focus();
  await page.keyboard.press("Tab");
  await expect(toggle).toBeFocused();
  expect(await toggle.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe("none");
  await page.keyboard.press("Enter");
  await expect(password).toHaveAttribute("type", "password");
  await expect(toggle).toHaveAccessibleName("Hiện mật khẩu");
  await expect(toggle).toHaveAttribute("title", "Hiện mật khẩu");
  await expect(toggle).not.toHaveClass(/is-visible/);
  await expect(slash).toHaveCSS("opacity", "1");
  await page.keyboard.press("Space");
  await expect(password).toHaveAttribute("type", "text");
  await expect(toggle).toHaveAccessibleName("Ẩn mật khẩu");
  await expect(toggle).toHaveAttribute("title", "Ẩn mật khẩu");
  await expect(password).toHaveValue(value);
  await expect(password).toHaveAttribute("autocomplete", "current-password");
  await expect(password).toHaveAttribute("required", "");
  expect(await toggle.locator("svg").evaluate(svg => svg.outerHTML)).toBe(icon);
  expect(await page.evaluate(() => window.visibilitySubmits)).toEqual({ signIn: 0, signUp: 0 });
  await expect(page.locator("#password")).toHaveAttribute("type", "password");
  await expect(page.locator("#checkpassword")).toHaveAttribute("type", "password");
});
