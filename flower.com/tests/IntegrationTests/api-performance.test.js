// Small repeatable latency baseline, not a production capacity/load certification.
const test = require("node:test");
const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");
const fs = require("node:fs");
const path = require("node:path");
const h = require("./helpers");
const options = { timeout: 60_000, skip: !process.env.FLOWER_API_URL && "Requires native C# HTTP host" };

test("native C# catalog and quote latency baseline includes HTTP and Firestore SDK", options, async t => {
    await h.resetEmulators(); await h.seedProducts();
    const metrics = [];
    for (const concurrency of [1, 4]) {
        for (const [name, request] of [
            ["products", { method: "GET" }],
            ["orders", { body: { action: "quote", items: [{ id: "1", quantity: 1 }], deliveryZoneId: "test-zone" } }]
        ]) {
            for (let warm = 0; warm < 3; warm++) assert.equal((await h.callApi(name, request)).status, 200);
            const times = []; let next = 0;
            const start = performance.now();
            await Promise.all(Array.from({ length: concurrency }, async () => {
                while (next++ < 24) {
                    const began = performance.now();
                    const response = await h.callApi(name, request);
                    times.push(performance.now() - began);
                    assert.equal(response.status, 200, JSON.stringify(response.body));
                }
            }));
            const elapsed = performance.now() - start;
            times.sort((a, b) => a - b);
            const percentile = p => Math.round(times[Math.ceil(times.length * p) - 1] * 100) / 100;
            assert.equal(times.length, 24);
            metrics.push({ endpoint: name === "products" ? "GET /api/products" : "POST /api/orders quote",
                concurrency, samples: times.length, p50Ms: percentile(0.5), p95Ms: percentile(0.95),
                maxMs: percentile(1), requestsPerSecond: Math.round(24000 / elapsed * 100) / 100, errors: 0 });
        }
    }
    assert.equal((await h.db().collection("orders").get()).size, 0);
    assert.equal(await h.stockOf("1"), 10);
    const report = path.join(h.ROOT, "../artifacts/ff-09/http-latency.json");
    fs.mkdirSync(path.dirname(report), { recursive: true });
    fs.writeFileSync(report, JSON.stringify({ checkedAt: new Date().toISOString(), metrics,
        environment: "local HTTP, native C# host, demo Firestore Emulator; warm-up excluded" }, null, 2));
    t.diagnostic("LOCAL_HTTP_LATENCY " + JSON.stringify(metrics));
});
