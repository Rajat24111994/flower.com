// Firestore Admin client for the command-line scripts. Uses FIREBASE_SERVICE_ACCOUNT_JSON when
// set (GitHub Actions, the same value as on Vercel), otherwise the Application Default
// Credentials of whoever runs the script (`gcloud auth application-default login`).
const { applicationDefault, cert, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

function connectFirestore() {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const serviceAccount = serviceAccountJson ? JSON.parse(serviceAccountJson) : null;
    const projectId = process.env.FIREBASE_PROJECT_ID || serviceAccount?.project_id || process.env.GOOGLE_CLOUD_PROJECT || "web-ban-hoa-9fe0b";
    initializeApp({ credential: serviceAccount ? cert(serviceAccount) : applicationDefault(), projectId });
    return { db: getFirestore(), projectId };
}

module.exports = { connectFirestore };
