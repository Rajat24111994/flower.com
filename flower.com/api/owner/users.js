const { getAdminAuth, getAdminFirestore, sendError, verifyOwnerRequest } = require("../../lib/firebase-admin");
const { syncAdminRole, syncAdminRoles } = require("../../lib/admin-roles");
const { recordAdminAudit } = require("../../lib/admin-audit");

function getRole(user) {
    if (user.customClaims && user.customClaims.role === "owner") return "owner";
    return user.customClaims && user.customClaims.admin === true ? "admin" : "customer";
}

module.exports = async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return sendError(res, 405, "method-not-allowed", "API này chỉ chấp nhận phương thức POST.");
    }

    let adminAuth;
    let db;
    try {
        adminAuth = getAdminAuth();
        db = getAdminFirestore();
    } catch (error) {
        console.error("Firebase Admin API configuration error:", error.message);
        return sendError(
            res,
            503,
            "admin-api-not-configured",
            "API quản trị Firebase chưa được cấu hình."
        );
    }

    const decodedToken = await verifyOwnerRequest(req, res, adminAuth, db);
    if (!decodedToken) return;

    const body = req.body || {};
    if (body.action === "list") {
        if (body.pageToken !== undefined && body.pageToken !== null &&
            (typeof body.pageToken !== "string" || body.pageToken.length > 2048)) {
            return sendError(res, 400, "invalid-argument", "Mã phân trang không hợp lệ.");
        }

        try {
            const result = await adminAuth.listUsers(100, body.pageToken || undefined);
            // Backfill adminRoles for admins created before it existed (see lib/admin-roles.js).
            if (result.users.length) {
                try {
                    await syncAdminRoles(db, result.users);
                } catch (error) {
                    console.error("adminRoles backfill failed:", error.code || error.message);
                }
            }
            return res.status(200).json({
                users: result.users.map((user) => ({
                    uid: user.uid,
                    email: user.email || "",
                    displayName: user.displayName || "",
                    disabled: user.disabled,
                    role: getRole(user)
                })),
                nextPageToken: result.pageToken || null
            });
        } catch (error) {
            console.error("Owner user listing failed:", error.code || error.message);
            return sendError(res, 500, "user-list-failed", "Chưa thể tải danh sách tài khoản Firebase.");
        }
    }

    if (body.action !== "grant-admin" && body.action !== "remove-admin") {
        return sendError(res, 400, "invalid-argument", "Thao tác quản lý chủ cửa hàng không được hỗ trợ.");
    }
    if (typeof body.uid !== "string" || !body.uid.trim() || body.uid.length > 128) {
        return sendError(res, 400, "invalid-argument", "Cần mã UID tài khoản hợp lệ.");
    }
    if (body.uid === decodedToken.uid) {
        return sendError(res, 400, "invalid-argument", "Chủ cửa hàng không thể tự thay đổi quyền của mình.");
    }

    try {
        const user = await adminAuth.getUser(body.uid);
        if (getRole(user) === "owner") {
            return sendError(res, 403, "permission-denied", "Không thể thay đổi quyền của tài khoản chủ cửa hàng tại đây.");
        }

        const claims = { ...user.customClaims };
        if (body.action === "grant-admin") {
            claims.admin = true;
            claims.role = "admin";
        } else {
            if (getRole(user) !== "admin") {
                return sendError(res, 400, "invalid-argument", "Tài khoản này hiện không có quyền quản trị viên.");
            }
            delete claims.admin;
            delete claims.role;
        }

        await adminAuth.setCustomUserClaims(user.uid, claims);
        // Removing the adminRoles document cuts Firestore access immediately.
        await syncAdminRole(db, user, body.action === "grant-admin");
        try {
            await adminAuth.revokeRefreshTokens(user.uid);
        } catch (error) {
            console.error("Role changed but session revocation failed:", error.code || error.message);
            return sendError(
                res,
                500,
                "role-updated-session-revoke-failed",
                "Đã đổi quyền nhưng chưa thể thu hồi phiên đăng nhập cũ. Hãy thu hồi phiên này trong Firebase Console."
            );
        }
        try {
            await recordAdminAudit(db, decodedToken, `owner-user.${body.action}`, "user-role", user.uid, {
                previousRole: getRole({ customClaims: user.customClaims }),
                nextRole: body.action === "grant-admin" ? "admin" : "customer"
            });
        } catch (error) {
            console.error("Owner role changed but audit record failed:", error.code || error.message);
            return sendError(res, 500, "role-updated-audit-failed", "Đã đổi quyền và thu hồi phiên đăng nhập, nhưng chưa ghi được nhật ký kiểm tra.");
        }
        console.info("Owner changed account role.", { action: body.action });
        return res.status(200).json({
            uid: user.uid,
            role: body.action === "grant-admin" ? "admin" : "customer",
            message: "Role updated. The account must sign in again."
        });
    } catch (error) {
        console.error("Owner role update failed:", error.code || error.message);
        if (error.code === "auth/user-not-found") {
            return sendError(res, 404, "user-not-found", "Không tìm thấy tài khoản Firebase.");
        }
        return sendError(res, 500, "role-update-failed", "Chưa thể cập nhật quyền tài khoản.");
    }
};
