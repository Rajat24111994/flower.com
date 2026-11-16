const { sendError } = require("./firebase-admin");

/*
 * Gói Vercel Hobby chỉ cho tối đa 12 hàm trong api/. Một số API nhỏ được gộp
 * vào chung một hàm: vercel.json `rewrites` chuyển URL cũ (vd /api/admin/audit)
 * sang hàm gộp kèm ?route=<tên>, và hàm gộp gọi đúng handler theo danh sách
 * cho phép dưới đây. Không có ?route thì chạy handler mặc định.
 */
function withRoutes(defaultHandler, routes) {
    const handler = async function routedHandler(req, res) {
        const route = req.query ? req.query.route : undefined;
        if (route === undefined) return defaultHandler(req, res);
        if (typeof route !== "string" || !Object.hasOwn(routes, route)) {
            res.setHeader("Cache-Control", "no-store");
            return sendError(res, 404, "api-not-found", "Không tìm thấy API.");
        }
        return routes[route](req, res);
    };
    handler.routes = Object.freeze({ ...routes });
    return handler;
}

module.exports = { withRoutes };
