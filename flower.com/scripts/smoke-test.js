// Smoke test for a deployed site: verifies HTTPS/TLS, page loads and API responses, without
// creating orders or changing data. Run it right after each deploy:
//   SMOKE_URL=https://your-site.vercel.app npm run smoke
const tls = require("node:tls");
const baseUrl = String(process.env.SMOKE_URL || process.argv[2] || "").replace(/\/+$/, "");
let site;
try {
    site = new URL(baseUrl);
    if (site.protocol !== "https:" || site.username || site.password || site.port) throw new Error("invalid URL");
} catch {
    console.error("SMOKE_URL phải là địa chỉ HTTPS công khai cổng mặc định, ví dụ: SMOKE_URL=https://your-site.vercel.app npm run smoke");
    process.exit(2);
}
const secureBaseUrl = site.origin;
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
    const response = await fetch(secureBaseUrl + path, {
        ...options,
        headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
        signal: AbortSignal.timeout(20000)
    });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* HTML page */ }
    return { status: response.status, text, json, url: response.url, headers: response.headers };
}

function verifyTlsCertificate(hostname) {
    return new Promise((resolve, reject) => {
        const socket = tls.connect({
            host: hostname,
            port: 443,
            servername: hostname,
            rejectUnauthorized: true
        });
        const timeout = setTimeout(() => socket.destroy(new Error("Kết nối TLS quá thời gian chờ.")), 10000);
        socket.once("secureConnect", () => {
            clearTimeout(timeout);
            const certificate = socket.getPeerCertificate();
            const validFrom = Date.parse(certificate.valid_from);
            const validTo = Date.parse(certificate.valid_to);
            socket.end();
            if (!socket.authorized || !Number.isFinite(validFrom) || !Number.isFinite(validTo)
                || validFrom > Date.now() || validTo <= Date.now()) {
                reject(new Error("Chứng chỉ TLS không hợp lệ, chưa có hiệu lực hoặc đã hết hạn."));
                return;
            }
            resolve();
        });
        socket.once("error", (error) => {
            clearTimeout(timeout);
            reject(new Error(`Không xác minh được chứng chỉ TLS: ${error.message}`));
        });
    });
}

(async () => {
    console.log(`Smoke test HTTPS: ${secureBaseUrl}\n`);

    await check("Chứng chỉ TLS hợp lệ, đúng hostname và còn hạn", () => verifyTlsCertificate(site.hostname));
    await check("HTTP tự chuyển hướng sang HTTPS", async () => {
        const insecureUrl = new URL(secureBaseUrl);
        insecureUrl.protocol = "http:";
        const response = await fetch(insecureUrl, { redirect: "manual", signal: AbortSignal.timeout(20000) });
        const destination = new URL(response.headers.get("location") || "", insecureUrl);
        expect([301, 302, 307, 308].includes(response.status), `HTTP ${response.status}, mong đợi redirect sang HTTPS`);
        expect(destination.protocol === "https:", `Location không dùng HTTPS: ${destination.href || "(trống)"}`);
        expect(destination.hostname === site.hostname, `HTTP redirect sang hostname ngoài dự kiến: ${destination.hostname}`);
    });

    await check("Header HSTS và CSP bắt buộc HTTPS", async () => {
        const { status, url, headers } = await request("/");
        expect(status === 200, `HTTP ${status}`);
        expect(new URL(url).protocol === "https:", `Trang cuối không dùng HTTPS: ${url}`);
        const hsts = headers.get("strict-transport-security") || "";
        expect(/(?:^|;)\s*max-age=(\d+)/i.test(hsts) && Number(hsts.match(/(?:^|;)\s*max-age=(\d+)/i)[1]) >= 31536000,
            `HSTS max-age phải ít nhất một năm: ${hsts || "(thiếu)"}`);
        expect(/(?:^|;)\s*includesubdomains(?:;|$)/i.test(hsts), "HSTS phải bao gồm includeSubDomains");
        const csp = headers.get("content-security-policy") || "";
        expect(/(?:^|;)\s*upgrade-insecure-requests(?:;|$)/i.test(csp), "CSP phải bật upgrade-insecure-requests");
    });

    for (const page of PAGES) {
        await check(`Trang ${page} tải được`, async () => {
            const { status, text, url } = await request(page, { headers: { Accept: "text/html" } });
            expect(status === 200, `HTTP ${status}`);
            expect(new URL(url).protocol === "https:", `Trang cuối không dùng HTTPS: ${url}`);
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
    await check("API giá hoa bị chặn khi chưa đăng nhập", async () => {
        const { status } = await request("/api/flower-prices");
        expect(status === 401, `HTTP ${status} (mong đợi 401)`);
    });

    for (const result of results) {
        console.log(`${result.ok ? "✔" : "✖"} ${result.name} (${result.ms} ms)${result.ok ? "" : ` – ${result.error}`}`);
    }
    const failed = results.filter((result) => !result.ok).length;
    console.log(`\n${results.length - failed}/${results.length} kiểm tra đạt.`);
    process.exitCode = failed ? 1 : 0;
})();
