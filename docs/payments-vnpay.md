# VNPay payment setup

The checkout supports cash on delivery and VNPay. Online orders are priced and reserved by
`/api/orders`; `/api/payments` creates a VNPay URL using the stored order total, and only the
signed `/api/vnpay-ipn` callback can mark the order paid. Browser redirects are display-only.

## Sandbox configuration

1. Register a merchant sandbox account at [VNPay's developer registration page](https://pay.vnpaytest.vn/dev-registration).
2. In Vercel Project Settings → Environment Variables, configure these for Preview/Production as
   appropriate. Do not put merchant secrets in source code or commit them.

   | Variable | Value |
   | --- | --- |
   | `VNPAY_TMN_CODE` | Merchant code issued by VNPay |
   | `VNPAY_HASH_SECRET` | Secret key issued by VNPay |
   | `VNPAY_ENV` | `sandbox` for sandbox; change to `production` only after live credentials are issued |
   | `PUBLIC_APP_URL` | Public HTTPS origin, for example `https://your-store.example` |
   | `CRON_SECRET` | Random secret used by the existing reservation-expiry cron |

3. Configure the VNPay merchant's IPN URL as `https://your-store.example/api/vnpay-ipn`.
   The signed browser return URL is generated as `https://your-store.example/payment-result.html`.
4. Deploy and test a successful sandbox payment. Verify the order changes to `da_thanh_toan`
   only after the signed IPN reaches the server. Also test a declined/cancelled payment, a
   duplicate IPN, a mismatched amount, and an expired order before enabling live credentials.

The sandbox payment endpoint is `https://sandbox.vnpayment.vn/paymentv2/vpcpay.html`; live mode
uses `https://pay.vnpay.vn/vpcpay.html`. Callback signatures use HMAC-SHA512, and all amounts
come from the persisted server-calculated order.

## Reservation expiry

VNPay orders reserve stock for 15 minutes. Expired reservations are released by the order
quote/create APIs every time a customer checks a price or places an order, so stock comes back as
soon as there is traffic. The Vercel cron in `../flower.com/vercel.json` is only a daily safety net
(`7 19 * * *` UTC, 02:07 Vietnam time), because Vercel Hobby allows daily cron jobs only: a
minute-level schedule makes every deployment fail. On a Pro plan the schedule can be tightened.

## Payment states

VNPay orders store `chua_thanh_toan`, `da_thanh_toan`, or `that_bai` in `paymentStatus`.
`paymentVerified` is set only by a valid successful IPN. A successful IPN received after an order
was cancelled is recorded as a late payment for manual review; the cancelled order is not silently
reopened.

## References

- [VNPay sandbox payment integration](https://sandbox.vnpayment.vn/apis/docs/thanh-toan-pay/pay.html)
- [Vercel Cron usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing)
