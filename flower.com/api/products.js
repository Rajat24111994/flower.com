const { getAdminAuth, getAdminFirestore, sendError, verifyRequest } = require("../backend/shared/firebase-admin");
const { withRoutes } = require("../backend/shared/api-routes");
const flowerPrices = require("../lib/routes/flower-prices");
const catalog = require("../flower.json").flower;
const catalogById = new Map(catalog.map((product) => [String(product.id), product]));

function isLegacyCatalogImage(value) {
    const image = String(value || "").trim();
    if (!image) return false;
    try {
        const pathname = new URL(image, "https://flowerflow.invalid").pathname;
        return /\/img\/p\/GEN\/lgwt\/\d+\.jpg$/i.test(pathname)
            || /^\/images\/flower-0[1-6]\.webp$/i.test(pathname);
    } catch {
        return false;
    }
}

// Server-side access to the product catalog, for browsers that cannot reach Firestore directly
// (blocked networks, offline Firestore client).
//   GET                                   list products (public)

function serializeProduct(doc) {
    const data = doc.data();
    const product = { ...data, id: data.id ?? doc.id };
    Object.keys(product).forEach((key) => {
        if (product[key] && typeof product[key].toDate === "function") product[key] = product[key].toDate().toISOString();
    });
    const catalogProduct = catalogById.get(String(product.id));
    if (catalogProduct && typeof product.title === "string" && product.title.includes("?")) {
        product.title = catalogProduct.title;
    }
    if (catalogProduct && isLegacyCatalogImage(product.image)) {
        product.image = catalogProduct.image;
        if (Array.isArray(product.images)) {
            product.images = product.images.filter((image) => !isLegacyCatalogImage(image));
        }
    }
    return product;
}

async function listProducts(req, res, db) {
    const manage = req.query?.manage === "1";
    if (manage) {
        const decodedToken = await verifyRequest(req, res, getAdminAuth());
        if (!decodedToken) return;
        const role = await db.collection("adminRoles").doc(decodedToken.uid).get();
        if (decodedToken.admin !== true || !role.exists) {
            return sendError(res, 403, "permission-denied", "Chỉ Admin hoặc Owner đang được cấp quyền mới xem được toàn bộ sản phẩm.");
        }
        const snapshot = await db.collection("products").get();
        res.setHeader("Cache-Control", "private, no-store");
        return res.status(200).json({ products: snapshot.docs.map(serializeProduct) });
    }

    const snapshot = await db.collection("products").get();
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=0, must-revalidate");
    const products = snapshot.docs.map(serializeProduct).filter((product) => product.status !== "hidden");
    return res.status(200).json({ products });
}

async function products(req, res) {
    if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        return sendError(res, 405, "method-not-allowed", "API này chỉ chấp nhận GET.");
    }

    let db;
    try {
        db = getAdminFirestore();
    } catch (error) {
        console.error("Firebase Admin API configuration error:", error.message);
        return sendError(res, 503, "admin-api-not-configured", "API quản trị Firebase chưa được cấu hình.");
    }

    try {
        return await listProducts(req, res, db);
    } catch (error) {
        console.error("Products API failed:", error.code || error.message);
        return sendError(res, 503, "product-service-unavailable", "Máy chủ chưa đọc được kho sản phẩm. Vui lòng thử lại sau.");
    }
}

// /api/flower-prices được vercel.json chuyển tới đây với ?route=flower-prices.
module.exports = withRoutes(products, { "flower-prices": flowerPrices });
