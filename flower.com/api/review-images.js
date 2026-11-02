const { getAdminFirestore, getAdminAuth, sendError } = require("../lib/firebase-admin");

module.exports = async function handler(req, res) {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.method !== "GET") { res.setHeader("Allow", "GET"); return sendError(res, 405, "method-not-allowed", "Chỉ hỗ trợ xem ảnh."); }
    const id = String(req.query?.id || "");
    if (!/^[a-f0-9]{40}_[0-2]$/.test(id)) return sendError(res, 404, "photo-not-found", "Không tìm thấy ảnh.");
    try {
        const db = getAdminFirestore();
        const review = await db.collection("reviews").doc(id.slice(0, 40)).get();
        if (!review.exists) return sendError(res, 404, "photo-not-found", "Không tìm thấy ảnh.");
        const data = review.data();
        let allowed = data.moderationStatus === "approved";
        if (!allowed) {
            const token = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i)?.[1];
            if (token) {
                let user;
                try { user = await getAdminAuth().verifyIdToken(token, true); }
                catch { return sendError(res, 401, "unauthenticated", "Phiên đăng nhập hết hạn."); }
                allowed = user.uid === data.authorUid;
                if (!allowed && user.admin === true) allowed = (await db.collection("adminRoles").doc(user.uid).get()).exists;
            }
        }
        if (!allowed || !Array.isArray(data.photoIds) || !data.photoIds.includes(id)) return sendError(res, 404, "photo-not-found", "Không tìm thấy ảnh.");
        const photo = await db.collection("reviewImages").doc(id).get();
        if (!photo.exists || photo.data().reviewId !== review.id) return sendError(res, 404, "photo-not-found", "Không tìm thấy ảnh.");
        const bytes = photo.data().bytes;
        res.setHeader("Content-Type", "image/jpeg");
        res.setHeader("Content-Length", String(bytes.length));
        return res.status(200).end(Buffer.from(bytes));
    } catch (error) {
        console.error("Review photo failed:", error.code || error.message);
        return sendError(res, 503, "photo-unavailable", "Chưa tải được ảnh. Hãy thử lại.");
    }
};
