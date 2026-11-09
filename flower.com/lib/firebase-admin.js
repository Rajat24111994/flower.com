const { getApps, initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");

function getAdminAuth() {
    const app = getAdminApp();
    return getAuth(app);
}

function getAdminFirestore() {
    return getFirestore(getAdminApp());
}

function getAdminApp() {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!serviceAccountJson) {
        const error = new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not configured.");
        error.code = "admin-api-not-configured";
        throw error;
    }

    let serviceAccount;
    try {
        serviceAccount = JSON.parse(serviceAccountJson);
    } catch {
        const error = new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.");
        error.code = "admin-api-not-configured";
        throw error;
    }

    return getApps().length
        ? getApps()[0]
        : initializeApp({
            credential: cert(serviceAccount),
            projectId: process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id
        });
}

function sendError(res, status, code, message) {
    return res.status(status).json({ code, error: message });
}

async function verifyRequest(req, res, adminAuth) {
    const authorization = req.headers.authorization || "";
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) {
        sendError(res, 401, "unauthenticated", "Cần mã xác thực Firebase để thực hiện thao tác này.");
        return null;
    }

    try {
        return await adminAuth.verifyIdToken(match[1], true);
    } catch (error) {
        console.error("Firebase ID token verification failed:", error.code || error.message);
        sendError(res, 401, "unauthenticated", "Mã xác thực Firebase không hợp lệ, đã hết hạn hoặc đã bị thu hồi.");
        return null;
    }
}

async function verifyRoleRequest(req, res, adminAuth, db, requiredRole) {
    const decodedToken = await verifyRequest(req, res, adminAuth);
    if (!decodedToken) return null;
    if (decodedToken.admin !== true) {
        sendError(res, 403, "permission-denied", "Bạn cần quyền quản trị viên để thực hiện thao tác này.");
        return null;
    }

    let role;
    try {
        role = await db.collection("adminRoles").doc(decodedToken.uid).get();
    } catch (error) {
        console.error("Firebase admin role verification failed:", error.code || error.message);
        sendError(res, 503, "authorization-service-unavailable", "Chưa thể xác minh quyền quản trị.");
        return null;
    }
    if (!role.exists || (requiredRole === "owner"
        && (decodedToken.role !== "owner" || role.data().role !== "owner"))) {
        sendError(res, 403, "permission-denied", "Quyền quản trị viên đã bị thu hồi.");
        return null;
    }
    return decodedToken;
}

function verifyAdminRequest(req, res, adminAuth, db) {
    return verifyRoleRequest(req, res, adminAuth, db, "admin");
}

function verifyOwnerRequest(req, res, adminAuth, db) {
    return verifyRoleRequest(req, res, adminAuth, db, "owner");
}

module.exports = {
    getAdminAuth,
    getAdminFirestore,
    sendError,
    verifyRequest,
    verifyAdminRequest,
    verifyOwnerRequest
};
