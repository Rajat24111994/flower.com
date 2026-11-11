const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp",
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
    ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2",
    ".xml": "application/xml; charset=utf-8", ".txt": "text/plain; charset=utf-8"
};

function isPublicFile(pathname) {
    if (pathname.includes("\\") || pathname.split("/").some((part) => part.startsWith("."))) return false;
    if (/^\/(?:js|css|images)\//.test(pathname)) {
        return /\.(?:js|css|svg|png|webp|jpe?g|gif|ico|woff2?)$/i.test(pathname);
    }
    return /^\/[a-z0-9-]+\.html$/i.test(pathname)
        || ["/flower.json", "/favicon.svg", "/robots.txt", "/sitemap.xml"].includes(pathname);
}

function queryParameters(searchParams) {
    const result = Object.create(null);
    for (const [key, value] of searchParams) {
        if (!Object.hasOwn(result, key)) result[key] = value;
        else result[key] = [...(Array.isArray(result[key]) ? result[key] : [result[key]]), value];
    }
    return result;
}

async function jsonBody(req, limit) {
    let size = 0;
    let oversized = false;
    let chunks = [];
    for await (const chunk of req) {
        size += chunk.length;
        if (size > limit) { oversized = true; chunks = []; }
        else if (!oversized) chunks.push(chunk);
    }
    if (oversized) throw { status: 413, code: "payload-too-large", message: "Dữ liệu gửi lên vượt giới hạn." };
    if (!size) return {};
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] || "")) {
        throw { status: 415, code: "unsupported-media-type", message: "API yêu cầu dữ liệu JSON." };
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw { status: 400, code: "invalid-json", message: "Dữ liệu JSON không hợp lệ." }; }
}

function createLocalServer({ root, resolveApi, missingLoginConfiguration = [], localAccounts = null, authMode = null } = {}) {
    const directory = path.resolve(root || path.join(__dirname, ".."));
    const realRoot = fs.realpath(directory);
    const vercelConfig = require("../vercel.json");
    const policy = vercelConfig.headers[0].headers.find(header => header.key === "Content-Security-Policy").value;
    // Giống Vercel: URL API cũ được chuyển sang hàm đã gộp (xem lib/api-routes.js).
    const apiRewrites = new Map((vercelConfig.rewrites || [])
        .filter(rule => rule.source.startsWith("/api/") && !/[:*(]/.test(rule.source))
        .map(rule => [rule.source, new URL(rule.destination, "http://local.invalid")]));
    const contentSecurityPolicy = require("./content-security").withSecurityPolicy(policy, directory);
    const localAuth = localAccounts ? require("./local-auth-http").createLocalAuthHandler(localAccounts) : null;
    const runtimeMode = localAuth ? "local" : authMode === "firebase" ? "firebase" : null;
    const findApi = resolveApi || (async (route) => {
        const filename = path.join(directory, "api", `${route}.js`);
        try { if (!(await fs.stat(filename)).isFile()) return null; }
        catch (error) { if (error.code === "ENOENT") return null; throw error; }
        return require(filename);
    });

    const server = http.createServer(async (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("X-Frame-Options", "DENY");
        res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
        res.setHeader("Content-Security-Policy", contentSecurityPolicy.replace(/;?\s*upgrade-insecure-requests/g, "")
            .replace("connect-src 'self'", "connect-src 'self' http://127.0.0.1:8080 http://127.0.0.1:9099 http://localhost:8080 http://localhost:9099")
            .replace("frame-src ", "frame-src http://127.0.0.1:9099 http://localhost:9099 "));
        res.status = (status) => { res.statusCode = status; return res; };
        res.json = (data) => {
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            return res.end(JSON.stringify(data));
        };
        const fail = (status, code, error) => res.status(status).json({ code, error });
        try {
            // This credential-bearing development server is loopback-only. Reject
            // DNS rebinding and cross-origin requests instead of enabling broad CORS.
            const host = req.headers.host || "";
            if (!/^(?:localhost|127\.0\.0\.1):\d+$/.test(host)) {
                return fail(403, "local-host-required", "Máy chủ này chỉ hỗ trợ địa chỉ localhost.");
            }
            const url = new URL(req.url, `http://${host}`);
            const rewrite = apiRewrites.get(url.pathname);
            if (rewrite) {
                url.pathname = rewrite.pathname;
                for (const [key, value] of rewrite.searchParams) url.searchParams.set(key, value);
            }
            const pathname = decodeURIComponent(url.pathname);
            if (pathname.includes("\\") || pathname.includes("\0")) {
                return fail(404, "not-found", "Không tìm thấy nội dung.");
            }
            if (runtimeMode && pathname === "/__local/auth-runtime.js" && ["GET", "HEAD"].includes(req.method)) {
                res.setHeader("Content-Type", "text/javascript; charset=utf-8");
                return res.end(req.method === "HEAD" ? undefined : `window.FlowerAuthMode = ${JSON.stringify(runtimeMode)};`);
            }
            if (pathname.startsWith("/api/")) {
                if (req.headers.origin && req.headers.origin !== `http://${host}`) {
                    return fail(403, "same-origin-required", "Hãy mở giao diện từ cùng địa chỉ máy chủ API.");
                }
                const route = pathname.slice(5);
                if (!/^(?:[a-z0-9-]+\/)*[a-z0-9-]+$/.test(route)) {
                    return fail(404, "api-not-found", "Không tìm thấy API.");
                }
                const handler = localAuth && route.startsWith("local-auth/")
                    ? (request, response) => localAuth(route.slice("local-auth/".length), request, response)
                    : await findApi(route);
                if (typeof handler !== "function") return fail(404, "api-not-found", "Không tìm thấy API.");
                req.query = queryParameters(url.searchParams);
                req.body = await jsonBody(req, route === "login" || route.startsWith("local-auth/") ? 32 * 1024 : 4 * 1024 * 1024);
                if (route === "login" && req.method === "POST" && missingLoginConfiguration.length) {
                    return fail(503, "login-not-configured",
                        `Đăng nhập Firebase thật chưa được cấu hình: thiếu ${missingLoginConfiguration.join(", ")} trong .env. Hoàn tất cấu hình rồi khởi động lại máy chủ.`);
                }
                // Local requests have no trusted reverse proxy.
                req.headers["x-forwarded-for"] = req.socket.remoteAddress;
                if (localAccounts && !route.startsWith("local-auth/") && route !== "login") {
                    const { LOCAL_IDENTITY, sessionCookie } = require("./request-identity");
                    const token = sessionCookie(req);
                    req[LOCAL_IDENTITY] = { account: token ? await localAccounts.session(token) : null, presented: token !== undefined };
                }
                await handler(req, res);
                return;
            }
            if (!["GET", "HEAD"].includes(req.method)) {
                res.setHeader("Allow", "GET, HEAD");
                return fail(405, "method-not-allowed", "Phương thức không được hỗ trợ.");
            }
            const publicPath = pathname === "/" ? "/index.html" : pathname;
            if (!isPublicFile(publicPath)) return fail(404, "not-found", "Không tìm thấy nội dung.");
            let filename;
            try { filename = await fs.realpath(path.join(directory, publicPath)); }
            catch (error) { if (error.code === "ENOENT") return fail(404, "not-found", "Không tìm thấy nội dung."); throw error; }
            const actualRoot = await realRoot;
            const relative = path.relative(actualRoot, filename);
            if (relative.startsWith("..") || path.isAbsolute(relative)
                || !isPublicFile("/" + relative.split(path.sep).join("/"))) {
                return fail(404, "not-found", "Không tìm thấy nội dung.");
            }
            let bytes = await fs.readFile(filename);
            if (runtimeMode && path.extname(filename).toLowerCase() === ".html") {
                bytes = Buffer.from(bytes.toString("utf8").replace(/<head(?:\s[^>]*)?>/i,
                    '$&\n<script src="/__local/auth-runtime.js"></script>'), "utf8");
            }
            res.setHeader("Content-Type", CONTENT_TYPES[path.extname(filename).toLowerCase()] || "application/octet-stream");
            res.setHeader("Content-Length", bytes.length);
            res.end(req.method === "HEAD" ? undefined : bytes);
        } catch (error) {
            if (res.headersSent) { res.destroy(); return; }
            if ([400, 413, 415].includes(error.status)) return fail(error.status, error.code, error.message);
            if (error instanceof URIError) return fail(400, "invalid-url", "Địa chỉ không hợp lệ.");
            if (error.status === 429) { res.setHeader("Retry-After", "5"); return fail(429, "local-auth-busy", "Máy chủ bận. Vui lòng thử lại sau."); }
            // Never expose exception text: it can contain credentials or request data.
            return fail(500, "local-server-error", "Máy chủ chưa xử lý được yêu cầu. Vui lòng thử lại.");
        }
    });
    server.requestTimeout = 30_000;
    return server;
}

module.exports = { createLocalServer };
