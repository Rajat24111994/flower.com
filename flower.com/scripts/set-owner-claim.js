const { applicationDefault, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
const uid = process.env.OWNER_UID?.trim();
const projectId = process.env.GOOGLE_CLOUD_PROJECT || "web-ban-hoa-9fe0b";

if ((!email && !uid) || (email && uid)) {
    console.error("Set exactly one of OWNER_EMAIL or OWNER_UID for an existing Firebase user.");
    process.exitCode = 1;
} else {
    initializeApp({
        credential: applicationDefault(),
        projectId
    });
    const auth = getAuth();
    const findUser = uid ? auth.getUser(uid) : auth.getUserByEmail(email);
    findUser
        .then(async (user) => {
            await auth.setCustomUserClaims(user.uid, {
                ...user.customClaims,
                admin: true,
                role: "owner"
            });
            try {
                await auth.revokeRefreshTokens(user.uid);
            } catch (error) {
                console.error("Owner claim was set but existing sessions could not be revoked:", error.code || error.message);
                throw new Error("Owner claim was set; revoke the user's sessions in Firebase Console.");
            }
            console.log(`Granted Owner access to ${uid ? user.uid : email}. Sign in again to refresh the token.`);
        })
        .catch((error) => {
            console.error("Could not grant Owner access:", error.code || error.message);
            process.exitCode = 1;
        });
}
