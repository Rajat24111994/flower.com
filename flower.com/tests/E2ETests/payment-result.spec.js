import { expect, test } from "@playwright/test";
test("checkout defaults to QR and keeps COD available", async ({ page }) => {
 await page.route("**/api/delivery-zones*", route => route.fulfill({status:200, contentType:"application/json",body:JSON.stringify({ zones: [], configured: false })}));
 await page.goto("/checkout.html");
 const qr = page.locator('[name="paymentMethod"][value="qr"]');
 const cod = page.locator('[name="paymentMethod"][value="cod"]');
 const details = page.locator("#payment-online-panel");
 await expect(qr).toBeChecked();
 const image = page.locator("#checkout-payment-qr");
 await expect(image).toBeVisible();
 const imageUrl = new URL(await image.getAttribute("src"));
 expect(imageUrl.hostname).toBe("img.vietqr.io");
 expect(imageUrl.pathname).toBe("/image/VCB-1063118243-compact2.png");
 expect(imageUrl.searchParams.get("accountName")).toBe("DO BA THAI");
 await expect(page.locator("#checkout-payment-qr-link")).toHaveAttribute("href", imageUrl.toString());
 await expect(page.locator('[name="paymentMethod"][value="vnpay"]')).toHaveCount(0);
 await expect(page.getByText(/VNPay/)).toHaveCount(0);
 await cod.check(); await expect(details).toBeHidden();
 await qr.check(); await expect(details).toBeVisible();
});
test("old payment return links do not create a payment", async ({page}) => {
 const requests=[];
 page.on("request", request => {if(request.url().includes("/api/payments")) requests.push(request.url());});
 await page.goto("/payment-result.html?vnp_ResponseCode=00&vnp_TxnRef=old-order");
 await expect(page.getByRole("heading", {name:"Thanh toán chuyển khoản QR"})).toBeVisible();
 await expect(page.locator('a[href="./tracking.html"]')).toBeVisible();
 expect(requests).toEqual([]);
});
