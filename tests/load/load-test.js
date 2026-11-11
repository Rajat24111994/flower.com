// Kiểm thử tải (#126, NF-02, NF-08) chạy trên Firebase Emulator, KHÔNG chạm dữ liệu thật.
// Chạy: cd tests && npm ci && npm run load
// Tùy chọn: LOAD_DURATION=20 (giây mỗi kịch bản), LOAD_CONCURRENCY=20, LOAD_BUYERS=200, LOAD_STOCK=10
//
// Handler API được gọi trong cùng tiến trình (như test tích hợp) để mỗi "khách" có IP và số
// điện thoại riêng, không bị giới hạn theo IP của máy chạy chặn lại. Số đo vì vậy gồm logic API
// và Firestore Emulator, không gồm mạng và khởi động lạnh của Vercel.
const { generateKeyPairSync, randomUUID } = require("node:crypto");
const { performance } = require("node:perf_hooks");
const path = require("node:path");

const PROJECT_ID = process.env.GCLOUD_PROJECT || "demo-flowerflow";
if (!process.env.FIRESTORE_EMULATOR_HOST || !PROJECT_ID.startsWith("demo-")) {
    throw new Error("Chạy bằng `npm run load` trong thư mục tests (cần Firebase Emulator, project demo-).");
}
const ROOT = path.join(__dirname, "../../flower.com");
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
Object.assign(process.env, {
    FIREBASE_PROJECT_ID: PROJECT_ID,
    // Khóa dùng một lần cho emulator (emulator không kiểm tra chữ ký).
    FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
        type: "service_account", project_id: PROJECT_ID,
        client_email: `load@${PROJECT_ID}.iam.gserviceaccount.com`,
        private_key: privateKey.export({ type: "pkcs8", format: "pem" })
    })
});

const DURATION = Number(process.env.LOAD_DURATION || 20) * 1000;
const CONCURRENCY = Number(process.env.LOAD_CONCURRENCY || 20);
const BUYERS = Number(process.env.LOAD_BUYERS || 200);
const STOCK = Number(process.env.LOAD_STOCK || 10);

const { getAdminFirestore } = require(path.join(ROOT, "lib/firebase-admin.js"));
const orders = require(path.join(ROOT, "api/orders.js"));
const products = require(path.join(ROOT, "api/products.js"));

let clientNumber = 0;
async function callApi(handler, { method = "POST", body, query = {} } = {}) {
    const ip = `198.51.${Math.floor(clientNumber / 250) % 250}.${(clientNumber++ % 250) + 1}`;
    const response = { statusCode: 200, body: undefined };
    const res = {
        setHeader() {}, getHeader() {},
        status(code) { response.statusCode = code; return res; },
        json(data) { response.body = data; return res; },
        end(data) { response.body = data; return res; }
    };
    await handler({ method, query, body, headers: { "x-forwarded-for": ip }, socket: { remoteAddress: ip } }, res);
    return response;
}

async function seed() {
    const host = process.env.FIRESTORE_EMULATOR_HOST;
    await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
    const db = getAdminFirestore();
    const batch = db.batch();
    for (let id = 1; id <= 30; id++) {
        batch.set(db.doc(`products/${id}`), {
            id, title: `Bó hoa tải ${id}`, price: 200000 + id * 1000, quantity: id === 1 ? STOCK : 100000,
            status: "active", saleType: "ready_made", image: "./images/products/product-flower-01.webp", category: "Hoa tươi"
        });
    }
    batch.set(db.doc("metadata/deliveryZones"), { zones: [{ id: "z1", province: "Hà Nội", district: "Cầu Giấy", fee: 30000, enabled: true }] });
    batch.set(db.doc("metadata/activePromotions"), { items: [{ id: "p10", name: "Giảm 10%", discountPercent: 10, productIds: ["2", "3"], active: true }] });
    await batch.commit();
}

function percentile(sorted, p) {
    if (!sorted.length) return 0;
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
}

async function runFor(name, task) {
    const latencies = [];
    let errors = 0;
    const statuses = {};
    const end = performance.now() + DURATION;
    const worker = async () => {
        while (performance.now() < end) {
            const start = performance.now();
            try {
                const status = await task();
                statuses[status] = (statuses[status] || 0) + 1;
                if (status >= 500) errors++;
            } catch {
                errors++;
            }
            latencies.push(performance.now() - start);
        }
    };
    const started = performance.now();
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    const seconds = (performance.now() - started) / 1000;
    latencies.sort((a, b) => a - b);
    return {
        name, requests: latencies.length, rps: +(latencies.length / seconds).toFixed(1),
        p50: +percentile(latencies, 0.5).toFixed(1), p95: +percentile(latencies, 0.95).toFixed(1),
        p99: +percentile(latencies, 0.99).toFixed(1), max: +(latencies.at(-1) || 0).toFixed(1),
        errorRate: +((errors / Math.max(1, latencies.length)) * 100).toFixed(2), statuses
    };
}

async function stockContention() {
    // BUYERS khách cùng lúc tranh STOCK bó cuối của sản phẩm 1, mỗi người 1 bó.
    const quote = await callApi(orders, { body: { action: "quote", items: [{ id: "1", quantity: 1 }], deliveryZoneId: "z1" } });
    const deliveryDate = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    const started = performance.now();
    const results = await Promise.all(Array.from({ length: BUYERS }, (_, index) => callApi(orders, { body: {
        customerName: `Khách ${index}`, phone: `09${String(10000000 + index).padStart(8, "0")}`, address: "1 Xuân Thủy",
        deliveryDate, deliveryTime: "08:00–11:00", deliveryZoneId: "z1", paymentMethod: "cod", promotionId: "",
        idempotencyKey: randomUUID(), expectedTotals: quote.body.totals, items: [{ id: "1", quantity: 1 }]
    } })));
    const seconds = (performance.now() - started) / 1000;
    const statuses = {};
    for (const result of results) statuses[result.statusCode] = (statuses[result.statusCode] || 0) + 1;
    const finalStock = (await getAdminFirestore().doc("products/1").get()).data().quantity;
    const created = statuses[201] || 0;
    return { buyers: BUYERS, stock: STOCK, created, finalStock, seconds: +seconds.toFixed(2), statuses,
        oversold: created > STOCK || finalStock < 0,
        // Khách bị lỗi 503 trong khi kho vẫn còn hàng: transaction bị hủy do tranh chấp.
        rejectedWhileInStock: finalStock > 0 ? (statuses[503] || 0) : 0 };
}

(async () => {
    await seed();
    const ids = Array.from({ length: 30 }, (_, index) => String(index + 1)).filter((id) => id !== "1");
    const randomCart = () => Array.from({ length: 1 + Math.floor(Math.random() * 3) }, () => ({
        id: ids[Math.floor(Math.random() * ids.length)], quantity: 1 + Math.floor(Math.random() * 2)
    })).filter((item, index, list) => list.findIndex((other) => other.id === item.id) === index);

    const scenarios = [];
    scenarios.push(await runFor("Xem danh mục (GET /api/products)", async () => (await callApi(products, { method: "GET" })).statusCode));
    scenarios.push(await runFor("Báo giá giỏ hàng (POST /api/orders quote)", async () => (await callApi(orders, {
        body: { action: "quote", items: randomCart(), deliveryZoneId: "z1", promotionId: Math.random() < 0.5 ? "p10" : "" }
    })).statusCode));
    const contention = await stockContention();

    const report = { date: new Date().toISOString(), node: process.version, durationSeconds: DURATION / 1000,
        concurrency: CONCURRENCY, scenarios, contention };
    console.log("\nKẾT QUẢ KIỂM THỬ TẢI");
    console.table(scenarios.map(({ statuses, ...row }) => row));
    console.log("Tranh mua hàng cuối:", contention);
    console.log(`\nLOAD_TEST_JSON ${JSON.stringify(report)}`);
    if (contention.rejectedWhileInStock) {
        console.warn(`CẢNH BÁO: ${contention.rejectedWhileInStock} khách nhận lỗi 503 khi kho vẫn còn ${contention.finalStock} sản phẩm `
            + "(transaction Firestore bị hủy do nhiều người cùng mua một sản phẩm).");
    }
    if (contention.oversold || scenarios.some((scenario) => scenario.errorRate > 1)) {
        console.error("THẤT BẠI: bán vượt kho hoặc tỉ lệ lỗi 5xx > 1%.");
        process.exit(1);
    }
    process.exit(0);
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
