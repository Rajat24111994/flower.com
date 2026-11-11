import { test, expect } from "./helpers/password-visibility-fixture.js";
import { randomUUID } from "node:crypto";

const fieldIds = ["password1", "password", "checkpassword"];
const selectionOf = input => [input.selectionStart, input.selectionEnd, input.selectionDirection];

test("mouse and touch preserve selection and let typing resume in every password field", async ({ page, isMobile }) => {
  for (const id of fieldIds) {
    if (id === "password") await page.locator("#signup").click();
    const field = page.locator(`#${id}`);
    const button = page.locator(`button[aria-controls="${id}"]`);
    const activate = () => isMobile ? button.tap() : button.click();
    const value = randomUUID();
    const ranges = [[0, 0, "none"], [5, 5, "none"], [value.length, value.length, "none"],
      [3, 9, "forward"], [2, 8, "backward"]];

    for (const range of ranges) {
      await field.fill(value);
      await field.evaluate((input, selection) => input.setSelectionRange(...selection), range);
      const selection = await field.evaluate(selectionOf);
      const originalType = await field.getAttribute("type");
      for (const type of [originalType === "password" ? "text" : "password", originalType]) {
        await activate();
        await expect(field).toHaveAttribute("type", type);
        await expect(field).toBeFocused();
        expect(await field.evaluate(selectionOf)).toEqual(selection);
        await expect(field).toHaveValue(value);
      }
      await page.keyboard.insertText("x");
      await expect(field).toHaveValue(value.slice(0, range[0]) + "x" + value.slice(range[1]));
    }
  }
});

test("Tab, Enter and Space preserve the range and keep keyboard focus on the button", async ({ page }) => {
  for (const id of fieldIds) {
    if (id === "password") await page.locator("#signup").click();
    const field = page.locator(`#${id}`);
    const button = page.locator(`button[aria-controls="${id}"]`);
    const value = randomUUID();
    await field.fill(value);
    await field.evaluate(input => input.setSelectionRange(2, 8, "backward"));
    const selection = await field.evaluate(selectionOf);
    await page.keyboard.press("Tab");
    await expect(button).toBeFocused();
    for (const [key, type] of [["Enter", "text"], ["Space", "password"]]) {
      await page.keyboard.press(key);
      await expect(button).toBeFocused();
      await expect(field).toHaveAttribute("type", type);
      expect(await field.evaluate(selectionOf)).toEqual(selection);
      await expect(field).toHaveValue(value);
    }
    await page.keyboard.press("Tab");
    const next = id === "password1" ? "#forgotPassword" : id === "password"
      ? "#checkpassword" : "#signUp [type=submit]";
    await expect(page.locator(next)).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(button).toBeFocused();
  }
});

test("unavailable selection APIs do not break toggling or focus handling", async ({ page, isMobile }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const field = page.locator("#password1");
  const button = page.locator("#toggle-login-password");
  const value = randomUUID();
  for (const failure of ["read", "write", "null"]) {
    await field.fill(value);
    await field.evaluate((input, mode) => {
      if (mode === "write") {
        input.setSelectionRange = () => { throw new DOMException("Selection unsupported", "InvalidStateError"); };
      } else {
        Object.defineProperty(input, "selectionStart", { configurable: true,
          get() {
            if (mode === "read") throw new DOMException("Selection unsupported", "InvalidStateError");
            return null;
          } });
      }
    }, failure);
    if (isMobile) await button.tap();
    else await button.click();
    await expect(field).toHaveAttribute("type", "text");
    await expect(field).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(button).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(field).toHaveAttribute("type", "password");
    await expect(button).toBeFocused();
    await expect(field).toHaveValue(value);
    await field.evaluate(input => {
      delete input.selectionStart;
      delete input.setSelectionRange;
    });
  }
  expect(errors).toEqual([]);
});
