import { test, expect } from "@playwright/test";

test("catalog becomes usable within the documented five-second local test budget", async ({ page }, testInfo) => {
    const products = Array.from({ length: 12 }, (_, index) => ({ id: `perf-${index}`, title: `Bó hoa ${index}`,
        description: "Hoa kiểm thử", quantity: 10, price: 250000, image: "./images/products/product-flower-01.webp",
        category: "Hoa tươi", status: "active", saleType: "ready_made" }));
    await page.route("**/product-store.js*", route => route.fulfill({ contentType: "text/javascript", body: `
        const fixture=${JSON.stringify(products)};
        window.FlowerInventory={initialize:async()=>fixture,readProducts:()=>fixture,
        readCategories:()=>[],getCategories:async()=>[],subscribeCategories:()=>()=>{}};` }));
    await page.route("**/review-store.js*", route => route.fulfill({ contentType: "text/javascript", body:
        "window.FlowerReviewStore={subscribe:(_id,callback)=>{callback([]);return()=>{};}};" }));
    const samples = [];
    for (let attempt = 0; attempt < 5; attempt++) {
        const start = Date.now();
        await page.goto("/product.html", { waitUntil: "domcontentloaded" });
        await expect(page.locator("#container .product-card")).toHaveCount(12);
        const readyMs = Date.now() - start;
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        const navigation = await page.evaluate(() => {
            const entry = performance.getEntriesByType("navigation")[0];
            return { ttfbMs: entry.responseStart - entry.requestStart,
                domContentLoadedMs: entry.domContentLoadedEventEnd,
                sameOriginTransferBytes: performance.getEntriesByType("resource")
                    .filter(resource => resource.name.startsWith(location.origin)).reduce((total, resource) => total + resource.transferSize, 0) };
        });
        samples.push({ readyMs, ...navigation });
        expect(readyMs, "Local fixture catalog readiness; not a production Lighthouse score").toBeLessThanOrEqual(5000);
    }
    const sorted = samples.map(sample => sample.readyMs).sort((a, b) => a - b);
    const result = { project: testInfo.project.name, viewport: page.viewportSize(), samples,
        p50ReadyMs: sorted[2], p95ReadyMs: sorted[4], environment: "local Chromium, unthrottled, fixture product data" };
    console.log("LOCAL_CATALOG_PERFORMANCE " + JSON.stringify(result));
    await testInfo.attach("catalog-performance.json", { body: JSON.stringify(result, null, 2), contentType: "application/json" });
    await page.screenshot({ path: testInfo.outputPath("catalog.png"), fullPage: true });
});
