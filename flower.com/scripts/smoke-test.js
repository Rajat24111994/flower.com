// Smoke test for a deployed site: checks that pages load and the API answers, without creating
// orders or changing any data. Run it right after each deploy:
//   SMOKE_URL=https://your-site.vercel.app npm run smoke
const baseUrl = String(process.env.SMOKE_URL || process.argv[2] || "").replace(/\/+$/, "");
if (!/^https?:\/\//.test(baseUrl)) {
    console.error("Cần địa chỉ trang: SMOKE_URL=https://... npm run smoke");
    process.exit(2);
}

const PAGES = ["/", "/product.html", "/cart.html", "/checkout.html", "/placeorder.html", "/tracking.html",
    "/wish.html", "/login.html", "/account.html", "/admin.html", "/owner.html"];
const results = [];

async function check(name, action) {
    const started = Date.now();
    try {
        await action();
        results.push({ name, ok: true, ms: Date.now() - started });
    } catch (error) {
        results.push({ name, ok: false, ms: Date.now() - started, error: error.message });
    }
}

function expect(condition, message) {
    if (!condition) throw new Error(message);
}

async function request(path, options = {}) {
    const response = await fetch(baseUrl + path, {
        ...options,
        headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
        signal: AbortSignal.timeout(20000)
    });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* HTML page */ }
    return { status: response.status, text, json };
}

(async () => {
    console.log(`Smoke test: ${baseUrl}\n`);

    for (const page of PAGES) {
        await check(`Trang ${page} tải được`, async () => {
            const { status, text } = await request(page, { headers: { Accept: "text/html" } });
            expect(status === 200, `HTTP ${status}`);
            expect(/<title>[^<]+<\/title>/i.test(text), "không có <title>");
        });
    }

    let products = [];
    await check("API sản phẩm trả danh sách hợp lệ", async () => {
        const { status, json } = await request("/api/products");
        expect(status === 200, `HTTP ${status}`);
        products = json?.products || [];
        expect(products.length > 0, "danh sách sản phẩm trống");
        const broken = products.filter((item) => item.id === undefined || !(Number(item.price) > 0) || !Number.isInteger(item.quantity) || item.quantity < 0);
        expect(!broken.length, `${broken.length} sản phẩm thiếu giá hoặc tồn kho sai (ví dụ id ${broken[0]?.id})`);
    });

    await check("Báo giá đơn hàng hoạt động (không tạo đơn)", async () => {
        const product = products.find((item) => item.quantity > 0);
        expect(product, "không còn sản phẩm nào còn hàng để thử");
        const { status, json } = await request("/api/orders", { method: "POST", body: JSON.stringify({ action: "quote", items: [{ id: String(product.id), quantity: 1 }] }) });
        expect(status === 200, `HTTP ${status}: ${json?.error || ""}`);
        expect(json.totals.total > 0, "tổng tiền không hợp lệ");
    });

    await check("Tra cứu đơn không có thật trả 'không tìm thấy'", async () => {
        const { status } = await request("/api/orders", { method: "POST", body: JSON.stringify({ action: "lookup", id: "smoke-test-khong-co", phone: "0900000000" }) });
        expect(status === 404 || status === 429, `HTTP ${status} (mong đợi 404)`);
    });

    await check("Dọn đơn hết hạn bị chặn khi không có khóa cron", async () => {
        const { status } = await request("/api/orders?action=expire");
        expect(status === 401, `HTTP ${status} (mong đợi 401)`);
    });

    for (const path of ["/api/admin/users", "/api/owner/users"]) {
        await check(`${path} bị chặn khi chưa đăng nhập`, async () => {
            const { status } = await request(path, { method: "POST", body: JSON.stringify({ action: "list" }) });
            expect(status === 401, `HTTP ${status} (mong đợi 401)`);
        });
    }

    for (const result of results) {
        console.log(`${result.ok ? "✔" : "✖"} ${result.name} (${result.ms} ms)${result.ok ? "" : ` – ${result.error}`}`);
    }
    const failed = results.filter((result) => !result.ok).length;
    console.log(`\n${results.length - failed}/${results.length} kiểm tra đạt.`);
    process.exitCode = failed ? 1 : 0;
})();
