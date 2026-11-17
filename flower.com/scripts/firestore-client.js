// Firestore Admin client for the command-line scripts. Uses FIREBASE_SERVICE_ACCOUNT_JSON when
// set (GitHub Actions, the same value as on Vercel), otherwise the Application Default
// Credentials of whoever runs the script (`gcloud auth application-default login`).
const { applicationDefault, cert, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

function connectFirestore(expectedProjectId) {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    let serviceAccount = null;
    if (serviceAccountJson) {
        try {
            serviceAccount = JSON.parse(serviceAccountJson);
            if (!serviceAccount || typeof serviceAccount !== "object" || Array.isArray(serviceAccount)
                || typeof serviceAccount.project_id !== "string" || typeof serviceAccount.client_email !== "string"
                || typeof serviceAccount.private_key !== "string") throw new Error();
        } catch { throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON không phải cấu hình service account hợp lệ."); }
    }
    const projectId = process.env.FIREBASE_PROJECT_ID || serviceAccount?.project_id || process.env.GOOGLE_CLOUD_PROJECT || "web-ban-hoa-9fe0b";
    if (expectedProjectId && expectedProjectId !== projectId) throw new Error("Project đích --project không khớp cấu hình Firestore. Chưa ghi dữ liệu.");
    try { initializeApp({ credential: serviceAccount ? cert(serviceAccount) : applicationDefault(), projectId }); }
    catch { throw new Error("Không thể khởi tạo Firestore; hãy kiểm tra cấu hình credential."); }
    return { db: getFirestore(), projectId };
}

module.exports = { connectFirestore };
