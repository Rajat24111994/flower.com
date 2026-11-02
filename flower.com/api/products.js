const { getAdminAuth, getAdminFirestore, sendError, verifyRequest } = require("../lib/firebase-admin");
const catalog = require("../flower.json").flower;

// Server-side access to the product catalog, for browsers that cannot reach Firestore directly
// (blocked networks, offline Firestore client).
//   GET                                   list products (public)
//   POST { action: "restore-catalog" }    admin: add flower.json products missing from Firestore

function serializeProduct(doc) {
    const data = doc.data();
    const product = { ...data, id: data.id ?? doc.id };
    Object.keys(product).forEach((key) => {
        if (product[key] && typeof product[key].toDate === "function") product[key] = product[key].toDate().toISOString();
    });
    return product;
}

async function listProducts(res, db) {
    const snapshot = await db.collection("products").get();
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=15, stale-while-revalidate=60");
    return res.status(200).json({ products: snapshot.docs.map(serializeProduct) });
}

async function restoreCatalog(req, res, db) {
    const decodedToken = await verifyRequest(req, res, getAdminAuth());
    if (!decodedToken) return;
    if (decodedToken.admin !== true) {
        return sendError(res, 403, "permission-denied", "Chỉ quản trị viên mới được khôi phục sản phẩm.");
    }

    const snapshot = await db.collection("products").get();
    const existingIds = new Set(snapshot.docs.map((doc) => doc.id));
    const missing = catalog.filter((product) => !existingIds.has(String(product.id)));
    const batch = db.batch();
    missing.forEach((product) => {
        batch.set(db.collection("products").doc(String(product.id)), { ...product, quantity: product.quantity ?? 10 });
    });
    batch.set(db.collection("metadata").doc("productCatalog"), { catalogSeeded: true }, { merge: true });
    await batch.commit();
    console.info("Catalog restored:", { actorUid: decodedToken.uid, restored: missing.length });
    return res.status(200).json({ restored: missing.length });
}

module.exports = async function handler(req, res) {
    if (!["GET", "POST"].includes(req.method)) {
        res.setHeader("Allow", "GET, POST");
        return sendError(res, 405, "method-not-allowed", "API này chỉ chấp nhận GET hoặc POST.");
    }

    let db;
    try {
        db = getAdminFirestore();
    } catch (error) {
        console.error("Firebase Admin API configuration error:", error.message);
        return sendError(res, 503, "admin-api-not-configured", "API quản trị Firebase chưa được cấu hình.");
    }

    try {
        if (req.method === "GET") return await listProducts(res, db);
        res.setHeader("Cache-Control", "no-store");
        if (req.body?.action === "restore-catalog") return await restoreCatalog(req, res, db);
        return sendError(res, 400, "invalid-argument", "Thao tác không được hỗ trợ.");
    } catch (error) {
        console.error("Products API failed:", error.code || error.message);
        return sendError(res, 503, "product-service-unavailable", "Máy chủ chưa đọc được kho sản phẩm. Vui lòng thử lại sau.");
    }
};
