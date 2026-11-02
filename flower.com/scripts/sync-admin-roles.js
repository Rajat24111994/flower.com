// One-time (and safe to repeat) backfill of adminRoles/{uid} from Firebase Auth custom claims.
// Run it BEFORE deploying the firestore.rules that check adminRoles, otherwise existing
// admins lose Firestore access until the Owner page is opened.
const { applicationDefault, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");
const { syncAdminRoles } = require("../lib/admin-roles");

const projectId = process.env.GOOGLE_CLOUD_PROJECT || "web-ban-hoa-9fe0b";
initializeApp({ credential: applicationDefault(), projectId });

(async () => {
    const auth = getAuth();
    const db = getFirestore();
    let pageToken;
    let changed = 0;
    do {
        const result = await auth.listUsers(1000, pageToken);
        if (result.users.length) changed += await syncAdminRoles(db, result.users);
        pageToken = result.pageToken;
    } while (pageToken);
    console.log(`adminRoles synchronized (${changed} document(s) changed).`);
})().catch((error) => {
    console.error("Could not synchronize adminRoles:", error.code || error.message);
    process.exitCode = 1;
});
