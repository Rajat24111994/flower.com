const { getAdminAuth, sendError, verifyRequest } = require("../../lib/firebase-admin");

module.exports = async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return sendError(res, 405, "method-not-allowed", "API này chỉ chấp nhận phương thức POST.");
    }

    let adminAuth;
    try {
        adminAuth = getAdminAuth();
    } catch (error) {
        console.error("Firebase Admin API configuration error:", error.message);
        return sendError(
            res,
            503,
            "admin-api-not-configured",
            "API quản trị Firebase chưa được cấu hình."
        );
    }

    const decodedToken = await verifyRequest(req, res, adminAuth);
    if (!decodedToken) return;

    if (decodedToken.admin !== true) {
        return sendError(res, 403, "permission-denied", "Bạn cần quyền quản trị viên để xem danh sách tài khoản.");
    }

    const pageToken = req.body && req.body.pageToken;
    if (pageToken !== undefined && pageToken !== null &&
        (typeof pageToken !== "string" || pageToken.length > 2048)) {
        return sendError(res, 400, "invalid-argument", "Mã phân trang không hợp lệ.");
    }

    try {
        const result = await adminAuth.listUsers(100, pageToken || undefined);
        return res.status(200).json({
            users: result.users.map((user) => ({
                uid: user.uid,
                email: user.email || "",
                displayName: user.displayName || "",
                providers: user.providerData.map((provider) => provider.providerId),
                creationTime: user.metadata.creationTime || "",
                lastSignInTime: user.metadata.lastSignInTime || "",
                disabled: user.disabled,
                role: user.customClaims && user.customClaims.role === "owner"
                    ? "owner"
                    : user.customClaims && user.customClaims.admin === true
                        ? "admin"
                        : "customer"
            })),
            nextPageToken: result.pageToken || null
        });
    } catch (error) {
        console.error("Firebase user listing failed:", error.code || error.message);
        return sendError(res, 500, "user-list-failed", "Chưa thể tải danh sách tài khoản Firebase.");
    }
};
