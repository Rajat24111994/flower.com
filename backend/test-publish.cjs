const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const directory = path.resolve(process.argv[2] || path.join(__dirname, "publish"));
const base = "http://127.0.0.1:5182";
const server = spawn("dotnet", [path.join(directory, "Flower.Api.dll"), "--urls", base], {
    cwd: directory, env: { ...process.env, ASPNETCORE_ENVIRONMENT: "Production", FIREBASE_SERVICE_ACCOUNT_JSON: "", Logging__LogLevel__Default: "Warning" },
    stdio: ["ignore", "inherit", "inherit"], windowsHide: true
});
async function main() {
    try {
        for (let attempt = 0; ; attempt++) {
            try { await fetch(base); break; }
            catch { if (attempt >= 100 || server.exitCode !== null) throw new Error("Published app failed to start"); await new Promise(resolve => setTimeout(resolve, 100)); }
        }
        for (const file of ["index.html", "admin.html", "checkout.html", "js/core/firebase-config.js", "css/style.css", "flower.json"]) {
            if (!fs.existsSync(path.join(root, "flower.com", file))) continue;
            const response = await fetch(`${base}/${file}`);
            assert.equal(response.status, 200, file);
            assert.deepEqual(Buffer.from(await response.arrayBuffer()), fs.readFileSync(path.join(root, "flower.com", file)), file);
            assert.equal(response.headers.get("x-content-type-options"), "nosniff");
            assert.ok(response.headers.get("content-security-policy").includes("frame-ancestors 'none'"));
            assert.equal(response.headers.get("strict-transport-security"), "max-age=31536000; includeSubDomains");
        }
        assert.equal((await fetch(base)).status, 200);
        for (const privatePath of ["/.env", "/lib/firebase-admin.js", "/api/orders.js", "/scripts/set-admin-claim.js", "/serviceAccountKey.json", "/Flower.Api.dll", "/security-headers.json", "/package.json"]) {
            assert.equal((await fetch(base + privatePath)).status, 404, privatePath);
        }
        for (const [route, method, body, code] of [
            ["products", "GET", null, "admin-api-not-configured"],
            ["admin/users", "POST", {}, "admin-api-not-configured"],
            ["orders", "POST", { action: "quote", items: [{ id: "1", quantity: 1 }] }, "order-service-unavailable"],
            ["product-images", "POST", {}, "photo-unavailable"]
        ]) {
            const response = await fetch(`${base}/api/${route}`, { method, ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
            assert.equal(response.status, 503, route);
            assert.equal((await response.json()).code, code, route);
        }
        console.log("Published app: unchanged frontend, security headers, private-file isolation and configuration failures passed");
    } finally { server.kill(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; server.kill(); });
