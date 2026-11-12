const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { createLocalServer } = require("../flower.com/lib/local-server");

const SITE = path.join(__dirname, "../flower.com");
const HOBBY_FUNCTION_LIMIT = 12;
const vercelConfig = JSON.parse(fs.readFileSync(path.join(SITE, "vercel.json"), "utf8"));

function apiFunctionFiles(directory = path.join(SITE, "api")) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) return apiFunctionFiles(full);
        return entry.name.endsWith(".js") ? [path.relative(SITE, full).split(path.sep).join("/")] : [];
    });
}

test("api/ stays within the Vercel Hobby limit of 12 functions per deployment", () => {
    const files = apiFunctionFiles();
    assert.ok(files.length <= HOBBY_FUNCTION_LIMIT,
        `api/ có ${files.length} hàm (${files.join(", ")}); gói Hobby chỉ cho ${HOBBY_FUNCTION_LIMIT}. `
        + "Hãy gộp API mới vào một hàm có sẵn bằng backend/shared/api-routes.js và rewrites trong vercel.json.");
});

test("every API rewrite targets an existing function and a route that function registers", () => {
    const rewrites = (vercelConfig.rewrites || []).filter((rule) => rule.source.startsWith("/api/"));
    assert.ok(rewrites.length > 0);
    for (const rule of rewrites) {
        const destination = new URL(rule.destination, "https://flowerflow.invalid");
        const file = path.join(SITE, `${destination.pathname.slice(1)}.js`);
        assert.ok(fs.existsSync(file), `${rule.source} → ${destination.pathname} không có file hàm`);
        assert.ok(!fs.existsSync(path.join(SITE, `${rule.source.slice(1)}.js`)),
            `${rule.source} vẫn còn file riêng nên rewrite không bao giờ chạy`);
        const route = destination.searchParams.get("route");
        const handler = require(file);
        assert.equal(typeof handler.routes?.[route], "function", `${destination.pathname} chưa đăng ký route "${route}"`);
    }
});

test("routed handlers reject unknown or repeated route values", async () => {
    const { withRoutes } = require("../flower.com/backend/shared/api-routes");
    const calls = [];
    const handler = withRoutes(async () => calls.push("default"), { audit: async () => calls.push("audit") });
    const res = {
        headers: {},
        setHeader(key, value) { this.headers[key] = value; },
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
    };
    await handler({ query: {} }, res);
    await handler({ query: { route: "audit" } }, res);
    assert.deepEqual(calls, ["default", "audit"]);
    for (const route of ["users", "__proto__", "constructor", ["audit", "audit"]]) {
        res.statusCode = undefined;
        await handler({ query: { route } }, res);
        assert.equal(res.statusCode, 404, `route ${JSON.stringify(route)} phải trả 404`);
    }
    assert.deepEqual(calls, ["default", "audit"]);
});

test("local dev server follows the same API rewrites as Vercel", async (t) => {
    const seen = [];
    const server = createLocalServer({
        root: SITE,
        resolveApi: async (route) => async (req, res) => {
            seen.push({ route, query: { ...req.query } });
            res.status(200).json({ ok: true });
        }
    });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
    const port = server.address().port;
    for (const rule of vercelConfig.rewrites.filter((item) => item.source.startsWith("/api/"))) {
        const status = await new Promise((resolve, reject) => {
            http.get({ hostname: "127.0.0.1", port, path: `${rule.source}?manage=1` }, (response) => {
                response.resume();
                response.on("end", () => resolve(response.statusCode));
            }).on("error", reject);
        });
        assert.equal(status, 200);
        const destination = new URL(rule.destination, "https://flowerflow.invalid");
        assert.deepEqual(seen.at(-1), {
            route: destination.pathname.slice("/api/".length),
            query: { manage: "1", route: destination.searchParams.get("route") }
        });
    }
});

test("package.json has no build script, so Vercel keeps serving the static site from the project root", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(SITE, "package.json"), "utf8"));
    assert.equal(pkg.scripts.build, undefined,
        "Vercel chạy lệnh build rồi đòi thư mục public; dùng npm run check:generated thay thế.");
    assert.equal(vercelConfig.outputDirectory, undefined);
});
