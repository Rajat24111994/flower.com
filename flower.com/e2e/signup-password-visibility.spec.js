import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("signup password fields toggle independently without submitting", async ({ page }) => {
  await page.route("https://www.gstatic.com/firebasejs/**", route => route.abort());
  await page.goto("/login.html");
  await expect(page.locator("#signUp [type=submit]")).toBeEnabled();
  await page.locator("#signup").click();

  const password = page.locator("#password");
  const confirmation = page.locator("#checkpassword");
  const passwordToggle = page.locator('#signUp button[aria-controls="password"]');
  const confirmationToggle = page.locator('#signUp button[aria-controls="checkpassword"]');
  const value = randomUUID();
  await page.locator("#name").fill("Khách");
  await page.locator("#lastName").fill("Thử nghiệm");
  await page.locator("#email").fill("visibility@example.test");
  await password.fill(value);
  await confirmation.fill(value);
  await page.evaluate(() => {
    window.visibilitySubmitCount = 0;
    document.getElementById("signUp").addEventListener("submit", event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      window.visibilitySubmitCount++;
    }, true);
  });

  await expect(passwordToggle).toHaveAttribute("type", "button");
  await expect(confirmationToggle).toHaveAttribute("type", "button");
  await expect(passwordToggle).toHaveAccessibleName("Hiện mật khẩu");
  await expect(confirmationToggle).toHaveAccessibleName("Hiện mật khẩu xác nhận");
  await passwordToggle.click();
  await expect(password).toHaveAttribute("type", "text");
  await expect(confirmation).toHaveAttribute("type", "password");
  await expect(passwordToggle).toHaveAccessibleName("Ẩn mật khẩu");
  await expect(confirmationToggle).toHaveAccessibleName("Hiện mật khẩu xác nhận");

  await confirmation.focus();
  await page.keyboard.press("Tab");
  await expect(confirmationToggle).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(confirmation).toHaveAttribute("type", "text");
  await expect(password).toHaveAttribute("type", "text");
  await expect(confirmationToggle).toHaveAccessibleName("Ẩn mật khẩu xác nhận");
  await expect(confirmationToggle).toHaveAttribute("title", "Ẩn mật khẩu xác nhận");
  await page.keyboard.press("Space");
  await expect(confirmation).toHaveAttribute("type", "password");
  await expect(password).toHaveAttribute("type", "text");
  await expect(confirmationToggle).toHaveAccessibleName("Hiện mật khẩu xác nhận");
  await expect(confirmationToggle).toHaveAttribute("title", "Hiện mật khẩu xác nhận");
  await passwordToggle.click();
  await expect(password).toHaveAttribute("type", "password");

  for (const field of [password, confirmation]) {
    await expect(field).toHaveValue(value);
    await expect(field).toHaveAttribute("required", "");
    await expect(field).toHaveAttribute("minlength", "8");
    await expect(field).toHaveAttribute("maxlength", "4096");
    await expect(field).toHaveAttribute("autocomplete", "new-password");
  }
  expect(await page.evaluate(() => window.visibilitySubmitCount)).toBe(0);
  await expect(page.locator("#password1")).toHaveAttribute("type", "password");
  await expect(page.locator("#toggle-login-password")).toHaveAttribute("aria-label", "Hiện mật khẩu");
});
