const { createHash } = require("node:crypto");
const { FieldValue } = require("firebase-admin/firestore");
const { getAdminAuth, getAdminFirestore, sendError, verifyRequest } = require("../lib/firebase-admin");
const { validateReviewPhotos } = require("../lib/review-images");

// Product photos uploaded from the admin page, stored in Firestore (free plan, no Cloud Storage).
//   POST { photo: "data:image/jpeg;base64,..." }  admin: save the photo, answer { url }
//   GET  ?id=<sha1>                               public: the photo itself
// The browser shrinks the photo first (same limits as review photos: JPEG, ≤ 120 KB, ≤ 1600 px).
// The id is the SHA-1 of the bytes, so the same photo is stored once and its URL never changes.

async function uploadPhoto(req, res) {
    const decodedToken = await verifyRequest(req, res, getAdminAuth());
    if (!decodedToken) return;
    const db = getAdminFirestore();
    const role = await db.collection("adminRoles").doc(decodedToken.uid).get();
    if (decodedToken.admin !== true || !role.exists) {
        return sendError(res, 403, "permission-denied", "Chỉ Admin hoặc Owner đang được cấp quyền mới tải được ảnh sản phẩm.");
    }
    const bytes = validateReviewPhotos([req.body?.photo])?.[0];
    if (!bytes) return sendError(res, 400, "invalid-photo", "Ảnh không hợp lệ. Hãy chọn ảnh JPG, PNG hoặc WebP khác.");

    const id = createHash("sha1").update(bytes).digest("hex");
    try {
        await db.collection("productImages").doc(id).create({
            bytes,
            size: bytes.length,
            uploadedBy: decodedToken.uid,
            createdAt: FieldValue.serverTimestamp()
        });
    } catch (error) {
        if (error.code !== 6) throw error; // ALREADY_EXISTS: same photo uploaded before
    }
    return res.status(201).json({ url: `/api/product-images?id=${id}` });
}

async function showPhoto(req, res) {
    const id = String(req.query?.id || "");
    if (!/^[a-f0-9]{40}$/.test(id)) return sendError(res, 404, "photo-not-found", "Không tìm thấy ảnh.");
    const photo = await getAdminFirestore().collection("productImages").doc(id).get();
    if (!photo.exists) return sendError(res, 404, "photo-not-found", "Không tìm thấy ảnh.");
    const bytes = Buffer.from(photo.data().bytes);
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Content-Length", String(bytes.length));
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    return res.status(200).end(bytes);
}

module.exports = async function handler(req, res) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    try {
        if (req.method === "GET") return await showPhoto(req, res);
        if (req.method === "POST") return await uploadPhoto(req, res);
        res.setHeader("Allow", "GET, POST");
        return sendError(res, 405, "method-not-allowed", "Chỉ hỗ trợ xem hoặc tải ảnh lên.");
    } catch (error) {
        console.error("Product photo failed:", error.code || error.message);
        return sendError(res, 503, "photo-unavailable", "Chưa xử lý được ảnh. Hãy thử lại.");
    }
};
