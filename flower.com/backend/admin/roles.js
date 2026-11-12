// Firestore mirror of who is an admin. firestore.rules require both the `admin` claim and a
// document in adminRoles/{uid}, so removing the document revokes database access at once,
// without waiting up to an hour for the user's ID token (and its claims) to expire.
const { FieldValue } = require("firebase-admin/firestore");

function isAdminUser(user) {
    return Boolean(user.customClaims && user.customClaims.admin === true);
}

async function syncAdminRole(db, user, isAdmin = isAdminUser(user)) {
    const reference = db.collection("adminRoles").doc(user.uid);
    if (isAdmin) {
        await reference.set({
            email: user.email || "",
            role: user.customClaims && user.customClaims.role === "owner" ? "owner" : "admin",
            updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
    } else {
        await reference.delete();
    }
}

// Makes adminRoles match the claims of the given users (used to backfill existing admins).
async function syncAdminRoles(db, users) {
    const existing = await db.getAll(...users.map((user) => db.collection("adminRoles").doc(user.uid)));
    const batch = db.batch();
    let writes = 0;
    users.forEach((user, index) => {
        const hasDocument = existing[index].exists;
        if (isAdminUser(user) && !hasDocument) {
            batch.set(existing[index].ref, {
                email: user.email || "",
                role: user.customClaims.role === "owner" ? "owner" : "admin",
                updatedAt: FieldValue.serverTimestamp()
            });
            writes += 1;
        } else if (!isAdminUser(user) && hasDocument) {
            batch.delete(existing[index].ref);
            writes += 1;
        }
    });
    if (writes) await batch.commit();
    return writes;
}

module.exports = { isAdminUser, syncAdminRole, syncAdminRoles };
