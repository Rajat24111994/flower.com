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

module.exports = { getAdminAuth, getAdminFirestore, sendError, verifyRequest };
