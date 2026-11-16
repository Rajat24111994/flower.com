const { FieldValue } = require("firebase-admin/firestore");

function makeAdminAuditEntry(actor, action, resourceType, resourceId, details = {}) {
    return {
        actorUid: String(actor?.uid || "").slice(0, 128),
        actorEmail: String(actor?.email || "").slice(0, 320),
        action: String(action).slice(0, 80),
        resourceType: String(resourceType).slice(0, 80),
        resourceId: String(resourceId || "").slice(0, 128),
        details,
        createdAt: FieldValue.serverTimestamp()
    };
}

function addAdminAudit(transaction, db, actor, action, resourceType, resourceId, details = {}) {
    const reference = db.collection("adminAudit").doc();
    transaction.create(reference, makeAdminAuditEntry(actor, action, resourceType, resourceId, details));
    return reference;
}

async function recordAdminAudit(db, actor, action, resourceType, resourceId, details = {}) {
    const reference = db.collection("adminAudit").doc();
    await reference.create(makeAdminAuditEntry(actor, action, resourceType, resourceId, details));
    return reference;
}

module.exports = { addAdminAudit, recordAdminAudit };
