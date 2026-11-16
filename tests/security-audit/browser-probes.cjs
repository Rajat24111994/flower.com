// Browser audit against an ephemeral local server. All catalog/order/SDK responses are fixtures.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "../../flower.com");
const { chromium } = require(require.resolve("@playwright/test", { paths: [root] }));
const { createLocalServer } = require(path.join(root, "lib/local-server"));
const payloads = [
    '<img data-audit-payload src=x onerror="window.__auditXss=1">',
    '\"><svg data-audit-payload onload="window.__auditXss=1">',
    '</script><script data-audit-payload>window.__auditXss=1</script>'
];
const results = [];

async function main() {
    const server = createLocalServer({ root, authMode: "firebase", resolveApi: async () => (_req, res) =>
        res.status(404).json({ error: "Audit fixture: no live API" }) });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    let browser;
    try {
        browser = await chromium.launch({ headless: true,
            executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
        for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
            for (const [payloadIndex, payload] of payloads.entries()) {
                const product = { id: "audit-product", title: payload, description: payload, image: "./images/products/product-flower-01.webp",
                    price: 250000, quantity: 10, stockQuantity: 10, status: "active", saleType: "ready_made", category: payload };
                const cart = [{ ...product, quantity: 1, cardMessage: payload, personalNote: payload }];
                const totals = { subtotal: 250000, savings: 0, tax: 0, wrappingFee: 0, shippingFee: 0, total: 250000 };
                const checkout = { customerName: payload, phone: "0908123456", address: payload, recipientName: payload,
                    recipientPhone: "0908123456", paymentMethod: "cod", idempotencyKey: "12345678-1234-4234-8234-123456789abc",
                    deliveryDate: "2030-01-01", deliveryTime: "08:00–11:00", deliveryZoneId: "audit-zone", greetingCard: payload,
                    orderNote: payload, quotedTotals: totals, quotedPrices: [{ id: product.id, price: product.price }] };
                const order = { ...checkout, id: "AUDIT-ORDER", uid: "audit-customer", status: "Chờ xác nhận", total: 250000,
                    createdAt: "2026-11-09T01:00:00Z", items: cart, trackingHistory: [], privacyLimited: false };
                const context = await browser.newContext({ viewport });
                await context.addInitScript(({ cart, checkout, payload }) => {
                    window.__auditXss = 0;
                    localStorage.setItem("cart", JSON.stringify(cart));
                    localStorage.setItem("loggedUser", JSON.stringify({ uid: "audit-customer", name: payload, email: "audit@demo", authProvider: "local" }));
                    sessionStorage.setItem("flowerCheckout", JSON.stringify(checkout));
                }, { cart, checkout, payload });
                await context.route("**/*", async route => {
                    const url = new URL(route.request().url());
                    if (url.hostname === "www.gstatic.com" && url.pathname.endsWith("firebase-app.js")) {
                        return route.fulfill({ contentType: "text/javascript", body: "export const initializeApp=()=>({}); export const getApps=()=>[]; export const getApp=()=>({});" });
                    }
                    if (url.hostname === "www.gstatic.com" && url.pathname.endsWith("firebase-auth.js")) {
                        return route.fulfill({ contentType: "text/javascript", body: "export const getAuth=()=>({currentUser:null,authStateReady:async()=>{}}); export const browserLocalPersistence={}; export const setPersistence=async()=>{}; export const getRedirectResult=async()=>null;" });
                    }
                    if (url.origin !== base) return route.abort();
                    if (url.pathname.endsWith("store-header.js")) {
                        return route.fulfill({ contentType: "text/javascript", body: fs.readFileSync(path.join(root, "js/core/store-header.js"), "utf8").replace("void verifyStoredSession();", "") });
                    }
                    if (url.pathname.endsWith("product-store.js")) {
                        return route.fulfill({ contentType: "text/javascript", body: `window.FlowerInventory={initialize:async()=>[${JSON.stringify(product)}],readProducts:()=>[${JSON.stringify(product)}],readCategories:()=>[${JSON.stringify(payload)}]};` });
                    }
                    if (url.pathname.endsWith("review-store.js")) {
                        return route.fulfill({ contentType: "text/javascript", body: "window.FlowerReviewStore={subscribe:(_id,callback)=>{callback([]);return ()=>{};}};" });
                    }
                    if (url.pathname.endsWith("order-store.js")) {
                        return route.fulfill({ contentType: "text/javascript", body: `window.FlowerOrderStore={
                            quote:async()=>({totals:${JSON.stringify(totals)},items:${JSON.stringify(cart)},deliveryZone:{id:'audit-zone',province:'Test',district:'Test',fee:0}}),
                            getDeliveryZones:async()=>({configured:true,zones:[{id:'audit-zone',province:'Test',district:'Test',fee:0,enabled:true}]}),
                            getPromotions:async()=>[],getPublicOrder:async()=>(${JSON.stringify(order)}),
                            subscribeAccount:async(_uid,callback)=>{callback([${JSON.stringify(order)}]);return ()=>{};},
                            getReview:async()=>null};` });
                    }
                    if (url.pathname === "/api/login") return route.fulfill({ status: 503, json: { code: "audit-message", error: payload } });
                    if (url.pathname === "/api/payments") return route.fulfill({ json: { status: "failed", orderId: payload, retryAllowed: true } });
                    return route.continue();
                });
                const page = await context.newPage();
                page.setDefaultTimeout(10000);
                const pageErrors = []; page.on("pageerror", error => pageErrors.push(error.message));
                const cases = [
                    { name: "login-error", url: "/login.html", target: "#display", run: async () => {
                        await page.locator("#email1").fill("audit@example.test"); await page.locator("#password1").fill("audit-password");
                        await page.locator("#signIn .submit").click(); } },
                    { name: "product-name-description-category", url: "/product.html?id=audit-product", target: "#detail-name" },
                    { name: "cart", url: "/cart.html", target: "#product-container" },
                    { name: "checkout", url: "/checkout.html", target: "#product-container" },
                    { name: "order-confirmation", url: "/placeorder.html", target: "#order-review-details" },
                    { name: "tracking-private-fields", url: "/tracking.html?id=AUDIT-ORDER", target: "#result-address" },
                    { name: "payment-result", url: "/payment-result.html?vnp_TxnRef=" + "a".repeat(32) + "&vnp_ResponseCode=00", target: "#payment-result-order" }
                ];
                for (const item of cases) {
                    const errorStart = pageErrors.length;
                    await page.goto(base + item.url, { waitUntil: "domcontentloaded" });
                    if (item.run) await item.run();
                    await page.waitForFunction(({ selector, payload }) => document.querySelector(selector)?.textContent.includes(payload), { selector: item.target, payload });
                    await page.waitForTimeout(75);
                    const state = await page.evaluate(() => ({ executed: window.__auditXss, injectedElements: document.querySelectorAll("[data-audit-payload]").length }));
                    assert.equal(state.executed, 0, item.name); assert.equal(state.injectedElements, 0, item.name);
                    assert.deepEqual(pageErrors.slice(errorStart), [], `${item.name}: fixture/page error`);
                    results.push({ page: item.name, viewport: viewport.width, payload: payloadIndex + 1, literalTextRendered: true, ...state });
                }
                await context.close();
            }
        }
        const config = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
        const csp = config.headers[0].headers.find(header => header.key === "Content-Security-Policy").value;
        const page = await browser.newPage();
        await page.route("https://audit.invalid/**", route => route.fulfill({ contentType: "text/html", headers: { "Content-Security-Policy": csp },
            body: "<!doctype html><script>window.__auditInlineAllowed=1</script><p>CSP audit fixture</p>" }));
        await page.goto("https://audit.invalid/fixture");
        const inlineAllowed = await page.evaluate(() => window.__auditInlineAllowed === 1);
        assert.equal(inlineAllowed, false, "CSP must block unapproved inline scripts after remediation");
        fs.mkdirSync(path.join(root, ".tools"), { recursive: true });
        fs.writeFileSync(path.join(root, ".tools/security-fixes-browser-results.json"), JSON.stringify({ checks: results.length, results, cspInlineAllowed: inlineAllowed }, null, 2));
        console.log(JSON.stringify({ xssChecks: results.length, executedPayloads: results.filter(row => row.executed).length, injectedElements: results.filter(row => row.injectedElements).length, cspInlineAllowed: inlineAllowed }));
    } finally {
        await browser?.close(); await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
