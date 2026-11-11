import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("login password toggles with mouse, Enter and Space without submitting", async ({ page }) => {
  // This UI check does not need Firebase or a real account.
  await page.route("https://www.gstatic.com/firebasejs/**", route => route.abort());
  await page.goto("/login.html");
  await expect(page.locator("#signIn [type=submit]")).toBeEnabled();

  const password = page.locator("#password1");
  const toggle = page.getByRole("button", { name: "Hiện mật khẩu", exact: true });
  const value = randomUUID();
  await page.locator("#email1").fill("visibility@example.test");
  await password.fill(value);
  await page.evaluate(() => {
    window.visibilitySubmitCount = 0;
    document.getElementById("signIn").addEventListener("submit", event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      window.visibilitySubmitCount++;
    }, true);
  });

  await expect(toggle).toHaveAttribute("type", "button");
  await expect(toggle).toHaveAttribute("aria-controls", "password1");
  await expect(password).toHaveAttribute("type", "password");
  const icon = await toggle.locator("svg").evaluate(svg => svg.outerHTML);
  const fieldBox = await password.boundingBox();
  const buttonBox = await toggle.boundingBox();
  expect(buttonBox.x).toBeGreaterThan(fieldBox.x + fieldBox.width / 2);
  expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(fieldBox.x + fieldBox.width);
  expect(buttonBox.y).toBeGreaterThanOrEqual(fieldBox.y);
  expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(fieldBox.y + fieldBox.height);

  await toggle.click();
  const button = page.locator("#toggle-login-password");
  await expect(password).toHaveAttribute("type", "text");
  await expect(password).toHaveValue(value);
  await expect(button).toHaveAccessibleName("Ẩn mật khẩu");
  await expect(button).toHaveAttribute("title", "Ẩn mật khẩu");

  // Reach the native button in tab order, then activate it with both keys.
  await password.focus();
  await page.keyboard.press("Tab");
  await expect(button).toBeFocused();
  expect(await button.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe("none");
  await page.keyboard.press("Enter");
  await expect(password).toHaveAttribute("type", "password");
  await expect(button).toHaveAccessibleName("Hiện mật khẩu");
  await expect(button).toHaveAttribute("title", "Hiện mật khẩu");
  await page.keyboard.press("Space");
  await expect(password).toHaveAttribute("type", "text");
  await expect(button).toHaveAccessibleName("Ẩn mật khẩu");
  await expect(button).toHaveAttribute("title", "Ẩn mật khẩu");
  await expect(password).toHaveValue(value);
  await expect(password).toHaveAttribute("autocomplete", "current-password");
  await expect(password).toHaveAttribute("required", "");
  expect(await button.locator("svg").evaluate(svg => svg.outerHTML)).toBe(icon);
  expect(await page.evaluate(() => window.visibilitySubmitCount)).toBe(0);
  await expect(page.locator("#password")).toHaveAttribute("type", "password");
  await expect(page.locator("#checkpassword")).toHaveAttribute("type", "password");
});
