const { applicationDefault, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const projectId = process.env.GOOGLE_CLOUD_PROJECT || "web-ban-hoa-9fe0b";

if (!email) {
    console.error("Set ADMIN_EMAIL to the email of an existing Firebase Authentication user.");
    process.exitCode = 1;
} else {
    initializeApp({
        credential: applicationDefault(),
        projectId
    });
    getAuth().getUserByEmail(email)
        .then((user) => getAuth().setCustomUserClaims(user.uid, {
            ...user.customClaims,
            admin: true
        }))
        .then(() => {
            console.log(`Granted admin access to ${email}. Sign out and sign in again to refresh the token.`);
        })
        .catch((error) => {
            console.error("Could not grant admin access:", error.code || error.message);
            process.exitCode = 1;
        });
}
