// Real order-store.js -> native ASP.NET HTTP -> real Firestore SDK/Emulator.
// Browser identity is an explicit fixture; Firebase token verification on the server is real.
const test = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");
const { chromium } = require(require.resolve("@playwright/test", { paths: [h.ROOT] }));
const options = { timeout: 60_000, skip: !process.env.FLOWER_API_URL && "Requires native C# HTTP host" };

for (const width of [1280, 390]) {
    test(`customer frontend module reaches C# checkout, replay, tracking and review at ${width}px`, options, async () => {
        await h.resetEmulators(); await h.seedProducts();
        const customer = await h.createUser();
        const browser = await chromium.launch({ headless: true });
        try {
            const page = await browser.newPage({ viewport: { width, height: 844 } });
            await page.route("**/customer-contract.html", route => route.fulfill({ contentType: "text/html",
                body: "<!doctype html><html><head></head><body>Customer module contract</body></html>" }));
            await page.route("https://www.gstatic.com/firebasejs/**", route => {
                const file = new URL(route.request().url()).pathname.split("/").pop();
                const body = file === "firebase-app.js" ? "export const getApps=()=>[]; export const initializeApp=()=>({});"
                    : file === "firebase-auth.js" ? `export const getAuth=()=>({authStateReady:async()=>{},currentUser:{uid:${JSON.stringify(customer.uid)},getIdToken:async()=>${JSON.stringify(customer.token)}}});`
                    : "export const getFirestore=()=>({});";
                return route.fulfill({ contentType: "text/javascript", headers: { "Access-Control-Allow-Origin": "*" }, body });
            });
            await page.goto(`${process.env.FLOWER_API_URL}/customer-contract.html`);
            await page.addScriptTag({ url: "/js/core/safe-storage.js" });
            await page.evaluate(uid => localStorage.setItem("loggedUser", JSON.stringify({ uid, authProvider: "password" })), customer.uid);
            await page.addScriptTag({ url: "/js/order/order-store.js" });
            const createResponse = page.waitForResponse(response => response.url().endsWith("/api/orders") && response.status() === 201);
            const result = await page.evaluate(async deliveryDate => {
                const api = window.FlowerOrderStore;
                const catalog = await (await fetch("/api/products")).json();
                const items = [{ id: "1", quantity: 1 }];
                const quote = await api.quote(items, "", "test-zone");
                const input = { customerName: "Khách trình duyệt", phone: "0908123456", address: "1 Lê Lợi",
                    deliveryDate, deliveryTime: "11:00–14:00", deliveryZoneId: "test-zone",
                    paymentMethod: "vnpay", idempotencyKey: crypto.randomUUID(), items };
                const id = await api.create(input, quote.totals);
                const replay = await api.create(input, quote.totals);
                const order = await api.getPublicOrder(id, input.phone);
                return { catalogCount: catalog.products.length, quote, id, replay, order };
            }, h.deliveryDate());
            const created = (await (await createResponse).json()).order;
            const payment = await page.evaluate(({ id, paymentReference }) =>
                window.FlowerOrderStore.createPaymentLink(id, paymentReference), created);
            assert.equal(result.catalogCount, h.catalog.length);
            assert.equal(result.quote.totals.total, h.catalog[0].price);
            assert.equal(result.id, result.replay); assert.equal(result.order.id, result.id);
            assert.equal(result.order.uid, customer.uid);
            assert.match(payment.paymentUrl, /^https:\/\/sandbox\.vnpayment\.vn\//);
            assert.equal(await h.stockOf("1"), 9);
            assert.equal((await h.db().collection("orders").get()).size, 1);
            const ref = h.db().doc(`orders/${result.id}`);
            assert.equal((await ref.get()).data().paymentVerified, false, "A payment link is not a provider confirmation");
            // Back-office fixture: delivery itself is covered by the admin lifecycle suites.
            await ref.update({ status: "Đã giao", inventoryState: "sold", inventoryReserved: false });
            const review = await page.evaluate(async ({ id, token }) => {
                const submit = () => fetch("/api/orders", { method: "POST", headers: {
                    "Content-Type": "application/json", Authorization: `Bearer ${token}`
                }, body: JSON.stringify({ action: "review", orderId: id, rating: 5, comment: "Hoa đẹp" }) });
                const response = await submit(); const body = await response.json();
                return { status: response.status, body, duplicateStatus: (await submit()).status };
            }, { id: result.id, token: customer.token });
            assert.equal(review.status, 201, JSON.stringify(review.body));
            assert.equal(review.duplicateStatus, 409);
            assert.equal((await h.db().collection("reviews").get()).size, 1);
        } finally { await browser.close(); }
    });
}
