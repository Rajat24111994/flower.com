const { getAdminAuth, sendError, verifyRequest } = require("../../lib/firebase-admin");

function getRole(user) {
    if (user.customClaims && user.customClaims.role === "owner") return "owner";
    return user.customClaims && user.customClaims.admin === true ? "admin" : "customer";
}

module.exports = async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return sendError(res, 405, "method-not-allowed", "Use POST for this endpoint.");
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
            "The Firebase Admin API is not configured."
        );
    }

    const decodedToken = await verifyRequest(req, res, adminAuth);
    if (!decodedToken) return;

    if (decodedToken.role !== "owner") {
        return sendError(res, 403, "permission-denied", "Owner access is required.");
    }

    const body = req.body || {};
    if (body.action === "list") {
        if (body.pageToken !== undefined && body.pageToken !== null &&
            (typeof body.pageToken !== "string" || body.pageToken.length > 2048)) {
            return sendError(res, 400, "invalid-argument", "Invalid pagination token.");
        }

        try {
            const result = await adminAuth.listUsers(100, body.pageToken || undefined);
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
            return sendError(res, 500, "user-list-failed", "Could not load Firebase users.");
        }
    }

    if (body.action !== "grant-admin" && body.action !== "remove-admin") {
        return sendError(res, 400, "invalid-argument", "Unsupported owner action.");
    }
    if (typeof body.uid !== "string" || !body.uid.trim() || body.uid.length > 128) {
        return sendError(res, 400, "invalid-argument", "A valid user UID is required.");
    }
    if (body.uid === decodedToken.uid) {
        return sendError(res, 400, "invalid-argument", "Owners cannot change their own role.");
    }

    try {
        const user = await adminAuth.getUser(body.uid);
        if (getRole(user) === "owner") {
            return sendError(res, 403, "permission-denied", "Owner accounts cannot be changed here.");
        }

        const claims = { ...user.customClaims };
        if (body.action === "grant-admin") {
            claims.admin = true;
            claims.role = "admin";
        } else {
            if (getRole(user) !== "admin") {
                return sendError(res, 400, "invalid-argument", "This account is not an admin.");
            }
            delete claims.admin;
            delete claims.role;
        }

        await adminAuth.setCustomUserClaims(user.uid, claims);
        try {
            await adminAuth.revokeRefreshTokens(user.uid);
        } catch (error) {
            console.error("Role changed but session revocation failed:", error.code || error.message);
            return sendError(
                res,
                500,
                "role-updated-session-revoke-failed",
                "The role changed, but existing sessions could not be revoked. Revoke them in Firebase Console."
            );
        }
        console.info("Owner changed account role:", {
            actorUid: decodedToken.uid,
            targetUid: user.uid,
            action: body.action
        });
        return res.status(200).json({
            uid: user.uid,
            role: body.action === "grant-admin" ? "admin" : "customer",
            message: "Role updated. The account must sign in again."
        });
    } catch (error) {
        console.error("Owner role update failed:", error.code || error.message);
        if (error.code === "auth/user-not-found") {
            return sendError(res, 404, "user-not-found", "Firebase user was not found.");
        }
        return sendError(res, 500, "role-update-failed", "Could not update the account role.");
    }
};
