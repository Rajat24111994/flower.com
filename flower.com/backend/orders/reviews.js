// Đánh giá theo đơn: chỉ chủ đơn đã giao mới được đánh giá; mỗi đơn một đánh giá.
const { validateReviewPhotos } = require("../catalog/image-rules");
const { createHash } = require("node:crypto");
const { FieldValue } = require("firebase-admin/firestore");
const { getAdminAuth, getAdminFirestore, sendError } = require("../shared/firebase-admin");
const { aggregateItems } = require("./pricing");
const { serializeTimestamp, optionalAuthenticatedUser } = require("./tracking");

// One public review per order. The id is derived from the order id so a second review of the same
// order collides, without listing order ids in the public reviews collection.
function reviewIdForOrder(orderId) {
    return createHash("sha256").update(`review:${orderId}`).digest("hex").slice(0, 40);
}

async function getOwnReview(req, res) {
    const orderId = String(req.body?.orderId || "").trim();
    if (!orderId || orderId.length > 128 || orderId.includes("/")) return sendError(res, 400, "invalid-argument", "Mã đơn không hợp lệ.");
    try {
        const user = await optionalAuthenticatedUser(req);
        if (!user) return sendError(res, 401, "unauthenticated", "Đăng nhập để xem đánh giá của bạn.");
        const db = getAdminFirestore();
        const order = await db.collection("orders").doc(orderId).get();
        if (!order.exists || order.data().uid !== user.uid) return sendError(res, 404, "order-not-found", "Không tìm thấy đơn trong tài khoản.");
        const review = await db.collection("reviews").doc(reviewIdForOrder(orderId)).get();
        return res.status(200).json({ review: review.exists ? { ...review.data(), id: review.id,
            createdAt: serializeTimestamp(review.data().createdAt), orderId } : null });
    } catch (error) {
        if (String(error.code || "").startsWith("auth/")) return sendError(res, 401, "unauthenticated", "Phiên đăng nhập hết hạn.");
        return sendError(res, 503, "review-unavailable", "Chưa tải được đánh giá. Hãy thử lại.");
    }
}

// Only the signed-in owner of a delivered order may review it. Products and the shown name come
// from the order, never from the browser.
async function submitReview(req, res) {
    const match = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
    if (!match) return sendError(res, 401, "unauthenticated", "Đăng nhập tài khoản đã đặt đơn để gửi đánh giá.");
    const orderId = String(req.body?.orderId || "").trim();
    const rating = Number(req.body?.rating);
    const comment = String(req.body?.comment || "").trim();
    const photos = validateReviewPhotos(req.body?.photos);
    if (!photos) return sendError(res, 400, "invalid-photos", "Tối đa 3 ảnh JPEG đã tối ưu, mỗi ảnh không quá 120 KB và 1600px.");
    if (!orderId || orderId.length > 128 || orderId.includes("/")
        || !Number.isInteger(rating) || rating < 1 || rating > 5
        || !comment || comment.length > 1000) {
        return sendError(res, 400, "invalid-argument", "Hãy chọn số sao và nhập nhận xét (tối đa 1000 ký tự).");
    }

    let user;
    try {
        user = await getAdminAuth().verifyIdToken(match[1], true);
    } catch {
        return sendError(res, 401, "unauthenticated", "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.");
    }

    try {
        const db = getAdminFirestore();
        const orderRef = db.collection("orders").doc(orderId);
        const reviewRef = db.collection("reviews").doc(reviewIdForOrder(orderId));
        const review = await db.runTransaction(async (transaction) => {
            const [orderSnapshot, reviewSnapshot] = await Promise.all([transaction.get(orderRef), transaction.get(reviewRef)]);
            const order = orderSnapshot.exists ? orderSnapshot.data() : null;
            if (!order || !order.uid || order.uid !== user.uid) {
                const error = new Error("Không tìm thấy đơn hàng này trong tài khoản của bạn.");
                error.code = "order-not-found";
                throw error;
            }
            if (order.status !== "Đã giao") {
                const error = new Error("Chỉ có thể đánh giá đơn hàng đã giao.");
                error.code = "order-not-delivered";
                throw error;
            }
            if (reviewSnapshot.exists) {
                const error = new Error("Bạn đã đánh giá đơn hàng này rồi.");
                error.code = "already-reviewed";
                throw error;
            }
            const items = Array.isArray(order.items) ? order.items : [];
            const productIds = aggregateItems(items).map((item) => item.id).filter(Boolean).slice(0, 10);
            if (!productIds.length) {
                const error = new Error("Đơn hàng không có thông tin sản phẩm để gắn đánh giá.");
                error.code = "invalid-argument";
                throw error;
            }
            const name = String(order.customerName || "").trim().slice(0, 80);
            const data = {
                authorUid: user.uid,
                verifiedPurchase: true,
                moderationStatus: "pending",
                photoIds: photos.map((_, index) => `${reviewRef.id}_${index}`),
                productIds,
                productName: items.map((item) => String(item?.title || "")).filter(Boolean).join(", ").slice(0, 500) || "Sản phẩm hoa",
                // Customers cannot post under the shop's name.
                customerName: !name || /flower\s*flow|cửa hàng|quản trị|admin/i.test(name) ? "Khách hàng" : name,
                rating,
                comment,
                createdAt: FieldValue.serverTimestamp()
            };
            transaction.create(reviewRef, data);
            photos.forEach((bytes, index) => transaction.create(db.collection("reviewImages").doc(`${reviewRef.id}_${index}`), {
                reviewId: reviewRef.id, bytes, createdAt: FieldValue.serverTimestamp()
            }));
            return data;
        });
        return res.status(201).json({ review: { ...review, id: reviewRef.id, createdAt: new Date().toISOString() } });
    } catch (error) {
        if (["order-not-found", "order-not-delivered", "already-reviewed", "invalid-argument"].includes(error.code)) {
            const status = { "order-not-found": 404, "invalid-argument": 400 }[error.code] || 409;
            return sendError(res, status, error.code, error.message);
        }
        console.error("Review submission failed:", error.code || "unknown");
        return sendError(res, 503, "review-service-unavailable", "Chưa thể gửi đánh giá. Vui lòng thử lại sau.");
    }
}

module.exports = { reviewIdForOrder, getOwnReview, submitReview };
