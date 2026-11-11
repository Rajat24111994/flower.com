import { test, expect } from "./helpers/password-visibility-fixture.js";
import { randomUUID } from "node:crypto";

test("signup password fields toggle independently without submitting", async ({ page }) => {
  await page.locator("#signup").click();

  const password = page.locator("#password");
  const confirmation = page.locator("#checkpassword");
  const passwordToggle = page.locator('#signUp button[aria-controls="password"]');
  const confirmationToggle = page.locator('#signUp button[aria-controls="checkpassword"]');
  const value = `a${randomUUID()}`;
  await page.locator("#name").fill("Khách");
  await page.locator("#lastName").fill("Thử nghiệm");
  await page.locator("#email").fill("visibility@example.test");
  await password.fill(value);
  await confirmation.fill(value);
  expect(await page.locator("#signUp").evaluate(form => form.checkValidity())).toBe(true);
  const constraintsOf = input => ({ id: input.id, name: input.name, required: input.required,
    minLength: input.minLength, maxLength: input.maxLength, autocomplete: input.autocomplete, pattern: input.pattern });
  const constraints = await Promise.all([password, confirmation].map(field => field.evaluate(constraintsOf)));

  await expect(passwordToggle).toHaveAttribute("type", "button");
  await expect(confirmationToggle).toHaveAttribute("type", "button");
  await expect(passwordToggle).toHaveAccessibleName("Hiện mật khẩu");
  await expect(confirmationToggle).toHaveAccessibleName("Hiện mật khẩu xác nhận");
  await expect(passwordToggle.locator(".eye-slash")).toHaveCSS("opacity", "1");
  await expect(confirmationToggle.locator(".eye-slash")).toHaveCSS("opacity", "1");
  await passwordToggle.click();
  await expect(password).toHaveAttribute("type", "text");
  await expect(confirmation).toHaveAttribute("type", "password");
  await expect(passwordToggle).toHaveAccessibleName("Ẩn mật khẩu");
  await expect(passwordToggle.locator(".eye-slash")).toHaveCSS("opacity", "0");
  await expect(confirmationToggle).toHaveAccessibleName("Hiện mật khẩu xác nhận");

  await confirmation.focus();
  await page.keyboard.press("Tab");
  await expect(confirmationToggle).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(confirmation).toHaveAttribute("type", "text");
  await expect(password).toHaveAttribute("type", "text");
  await expect(confirmationToggle).toHaveAccessibleName("Ẩn mật khẩu xác nhận");
  await expect(confirmationToggle.locator(".eye-slash")).toHaveCSS("opacity", "0");
  await expect(confirmationToggle).toHaveAttribute("title", "Ẩn mật khẩu xác nhận");
  await expect(confirmationToggle).toBeFocused();
  await page.keyboard.press("Space");
  await expect(confirmation).toHaveAttribute("type", "password");
  await expect(password).toHaveAttribute("type", "text");
  await expect(confirmationToggle).toHaveAccessibleName("Hiện mật khẩu xác nhận");
  await expect(confirmationToggle).toHaveAttribute("title", "Hiện mật khẩu xác nhận");
  await expect(confirmationToggle).toBeFocused();
  await expect(confirmationToggle.locator(".eye-slash")).toHaveCSS("opacity", "1");
  await passwordToggle.click();
  await expect(password).toHaveAttribute("type", "password");

  for (const [index, field] of [password, confirmation].entries()) {
    await expect(field).toHaveValue(value);
    expect(await field.evaluate(constraintsOf)).toEqual(constraints[index]);
    await expect(field).toHaveAttribute("required", "");
    await expect(field).toHaveAttribute("minlength", "8");
    await expect(field).toHaveAttribute("autocomplete", "new-password");
  }
  expect(await page.locator("#signUp").evaluate(form => form.checkValidity())).toBe(true);
  expect(await page.evaluate(() => window.visibilitySubmits)).toEqual({ signIn: 0, signUp: 0 });
  await expect(page.locator("#password1")).toHaveAttribute("type", "password");
  await expect(page.locator("#toggle-login-password")).toHaveAttribute("aria-label", "Hiện mật khẩu");
});
