import { expect, test } from "@playwright/test";

const txnRef = "a".repeat(32);

test("checkout defaults to VNPay and keeps COD available", async ({ page }) => {
  await page.route("**/api/delivery-zones*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ zones: [], configured: false })
    });
  });
  await page.goto("/checkout.html");

  const vnpay = page.locator('[name="paymentMethod"][value="vnpay"]');
  const cod = page.locator('[name="paymentMethod"][value="cod"]');
  const details = page.locator("#payment-online-panel");
  await expect(vnpay).toBeChecked();
  await expect(cod).toBeAttached();
  await cod.check();
  await expect(details).toBeHidden();
  await vnpay.check();
  await expect(details).toBeVisible();
});

test("payment result trusts server IPN status instead of VNPay redirect parameters", async ({ page }) => {
  await page.route("**/api/payments?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "failed", orderId: "order-1", retryAllowed: true })
    });
  });

  await page.goto(`/payment-result.html?vnp_TxnRef=${txnRef}&vnp_ResponseCode=00`);
  await expect(page.getByRole("heading", { name: "Thanh toán chưa thành công" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Thanh toán lại" })).toBeVisible();
});

test("a successful server status is shown even if redirect parameters report cancellation", async ({ page }) => {
  await page.route("**/api/payments?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "success", orderId: "order-2", retryAllowed: false })
    });
  });

  await page.goto(`/payment-result.html?vnp_TxnRef=${txnRef}&vnp_ResponseCode=24`);
  await expect(page.getByRole("heading", { name: "Thanh toán thành công" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Thanh toán lại" })).toBeHidden();
});

test("a cancelled redirect is presented as cancellation without changing a pending server status", async ({ page }) => {
  await page.route("**/api/payments?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "pending", orderId: "order-3", retryAllowed: true })
    });
  });

  await page.goto(`/payment-result.html?vnp_TxnRef=${txnRef}&vnp_ResponseCode=24`);
  await expect(page.getByRole("heading", { name: "Bạn đã hủy giao dịch" })).toBeVisible();
  await expect(page.getByText(/máy chủ vẫn đang chờ IPN/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Thanh toán lại" })).toBeHidden();
});
