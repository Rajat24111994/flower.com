import { test, expect, watchTypeWrites } from "./helpers/password-visibility-fixture.js";
import { randomUUID } from "node:crypto";

const fieldIds = ["password1", "password", "checkpassword"];
const selectionOf = input => [input.selectionStart, input.selectionEnd, input.selectionDirection];

test("auto-hide occurs at three seconds and preserves the current selection, value and input focus", async ({ page }) => {
  for (const id of fieldIds) {
    if (id === "password") await page.locator("#signup").click();
    const field = page.locator(`#${id}`);
    const button = page.locator(`button[aria-controls="${id}"]`);
    const value = randomUUID();
    await field.fill(value);
    await button.click();
    await page.clock.runFor(2999);
    await expect(field).toHaveAttribute("type", "text");
    // Moving the selection without editing must not extend the deadline.
    await field.evaluate(input => input.setSelectionRange(2, 8, "backward"));
    const selection = await field.evaluate(selectionOf);
    await page.clock.runFor(1);
    await expect(field).toHaveAttribute("type", "password");
    await expect(field).toHaveValue(value);
    await expect(field).toBeFocused();
    expect(await field.evaluate(selectionOf)).toEqual(selection);
    const label = id === "checkpassword" ? "Hiện mật khẩu xác nhận" : "Hiện mật khẩu";
    await expect(button).toHaveAccessibleName(label);
    await expect(button).toHaveAttribute("title", label);
    await page.keyboard.insertText("x");
    await expect(field).toHaveValue(value.slice(0, 2) + "x" + value.slice(8));
  }
});

test("typing, deleting and replacing text each restart the full three seconds", async ({ page }) => {
  for (const id of fieldIds) {
    if (id === "password") await page.locator("#signup").click();
    const field = page.locator(`#${id}`);
    await field.fill(randomUUID());
    await page.locator(`button[aria-controls="${id}"]`).click();
    await page.clock.runFor(2000);
    await page.keyboard.insertText("x");
    await page.clock.runFor(2000);
    await expect(field).toHaveAttribute("type", "text");
    await field.press("Backspace");
    await page.clock.runFor(2000);
    await expect(field).toHaveAttribute("type", "text");
    await field.evaluate(input => input.setSelectionRange(2, 8));
    await page.keyboard.insertText("y");
    const value = await field.inputValue();
    await page.clock.runFor(2999);
    await expect(field).toHaveAttribute("type", "text");
    await page.clock.runFor(1);
    await expect(field).toHaveAttribute("type", "password");
    await expect(field).toHaveValue(value);
  }
});

test("paste, cut, undo and redo input events restart the inactivity deadline", async ({ page }) => {
  const field = page.locator("#password1");
  const button = page.locator("#toggle-login-password");
  for (const inputType of ["insertFromPaste", "deleteByCut", "historyUndo", "historyRedo"]) {
    await field.fill(randomUUID());
    await button.click();
    await page.clock.runFor(2000);
    await field.evaluate((input, edit) => {
      if (edit.inputType === "deleteByCut") input.setRangeText("", 0, 3, "end");
      else input.setRangeText(edit.text, 0, 3, "end");
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: edit.inputType }));
    }, { inputType, text: randomUUID() });
    const value = await field.inputValue();
    await page.clock.runFor(1000);
    await expect(field).toHaveAttribute("type", "text");
    await page.clock.runFor(1999);
    await expect(field).toHaveAttribute("type", "text");
    await page.clock.runFor(1);
    await expect(field).toHaveAttribute("type", "password");
    await expect(field).toHaveValue(value);
  }
});

test("manual hiding cancels pending work and editing a masked field does not start a timer", async ({ page }) => {
  const field = page.locator("#password1");
  const button = page.locator("#toggle-login-password");
  await field.fill(randomUUID());
  await button.click();
  await page.clock.runFor(1000);
  await button.click();
  await expect(field).toHaveAttribute("type", "password");
  await watchTypeWrites(page);
  await page.clock.runFor(4000);
  expect(await page.evaluate(() => window.concealTypeWrites)).toBe(0);
  const value = randomUUID();
  await field.fill(value);
  await page.clock.runFor(4000);
  expect(await page.evaluate(() => window.concealTypeWrites)).toBe(0);
  await expect(field).toHaveAttribute("type", "password");
  await expect(field).toHaveValue(value);
  await expect(field).toBeFocused();
});

test("signup fields have independent deadlines and hiding another field does not steal focus", async ({ page }) => {
  await page.locator("#signup").click();
  const password = page.locator("#password");
  const confirmation = page.locator("#checkpassword");
  const passwordValue = randomUUID();
  await password.fill(passwordValue);
  await confirmation.fill(randomUUID());
  await page.locator('button[aria-controls="password"]').click();
  await page.clock.runFor(1000);
  await page.locator('button[aria-controls="checkpassword"]').click();
  await page.clock.runFor(1000);
  await password.press("End");
  await password.press("Backspace");
  await expect(password).toHaveValue(passwordValue.slice(0, -1));
  const value = await password.inputValue();
  await page.clock.runFor(1999);
  await expect(password).toHaveAttribute("type", "text");
  await expect(confirmation).toHaveAttribute("type", "text");
  await page.clock.runFor(1);
  await expect(confirmation).toHaveAttribute("type", "password");
  await expect(password).toHaveAttribute("type", "text");
  await expect(password).toBeFocused();
  await page.clock.runFor(1000);
  await expect(password).toHaveAttribute("type", "password");
  await expect(password).toBeFocused();
  await expect(password).toHaveValue(value);
});

test("manual hiding cancels the previous deadline and reopening starts fresh without stealing keyboard focus", async ({ page }) => {
  const field = page.locator("#password1");
  const button = page.locator("#toggle-login-password");
  const value = randomUUID();
  await field.fill(value);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await page.clock.runFor(2000);
  await page.keyboard.press("Enter");
  await expect(field).toHaveAttribute("type", "password");
  await page.clock.runFor(500);
  await page.keyboard.press("Space");
  await page.clock.runFor(500);
  await expect(field).toHaveAttribute("type", "text");
  await page.clock.runFor(2499);
  await expect(field).toHaveAttribute("type", "text");
  await field.evaluate(input => input.setSelectionRange(5, 5));
  const selection = await field.evaluate(selectionOf);
  await page.clock.runFor(1);
  await expect(field).toHaveAttribute("type", "password");
  await expect(field).toHaveValue(value);
  await expect(button).toBeFocused();
  expect(await field.evaluate(selectionOf)).toEqual(selection);
});
