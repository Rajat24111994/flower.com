// Free Firestore backup (no paid Blaze plan needed): export every collection to JSON, encrypt it
// with a passphrase, and restore it later. Used by scripts/backup-firestore.js,
// scripts/restore-firestore.js and the "Sao lưu Firestore" GitHub Actions workflow.
const { createCipheriv, createDecipheriv, randomBytes, scryptSync } = require("node:crypto");

const FORMAT = "flowerflow-backup-v1";
// Rate-limit counters only: nothing worth restoring.
const SKIPPED_COLLECTIONS = new Set(["orderLookupLimits"]);
const MIN_PASSPHRASE_LENGTH = 12;

// Firestore values that JSON cannot hold are written as { __type, value }.
function serializeValue(value) {
    if (value === null || value === undefined) return value ?? null;
    if (typeof value.toDate === "function") return { __type: "timestamp", value: value.toDate().toISOString() };
    if (typeof value.latitude === "number" && typeof value.longitude === "number" && typeof value.isEqual === "function") {
        return { __type: "geopoint", value: { latitude: value.latitude, longitude: value.longitude } };
    }
    if (typeof value.path === "string" && typeof value.firestore === "object") return { __type: "reference", value: value.path };
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) return { __type: "bytes", value: Buffer.from(value).toString("base64") };
    if (Array.isArray(value)) return value.map(serializeValue);
    if (typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serializeValue(item)]));
    }
    return value;
}

function deserializeValue(value, makeTimestamp, helpers = {}) {
    if (Array.isArray(value)) return value.map((item) => deserializeValue(item, makeTimestamp, helpers));
    if (!value || typeof value !== "object") return value;
    if (value.__type === "timestamp") return makeTimestamp(new Date(value.value));
    if (value.__type === "geopoint" && helpers.makeGeoPoint) return helpers.makeGeoPoint(value.value);
    if (value.__type === "reference" && helpers.makeReference) return helpers.makeReference(value.value);
    if (value.__type === "bytes") return Buffer.from(value.value, "base64");
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, deserializeValue(item, makeTimestamp, helpers)]));
}

async function exportDatabase(db) {
    const collections = new Map();
    async function visit(collection) {
        if (SKIPPED_COLLECTIONS.has(collection.path)) return;
        const snapshot = await collection.get();
        collections.set(collection.path, Object.fromEntries(snapshot.docs.map((doc) => [doc.id, serializeValue(doc.data())])));
        // listDocuments includes missing parent documents which still have children.
        for (const reference of await collection.listDocuments()) {
            for (const child of await reference.listCollections()) await visit(child);
        }
    }
    for (const collection of await db.listCollections()) await visit(collection);
    return { format: FORMAT, projectId: db.projectId, createdAt: new Date().toISOString(), collections: Object.fromEntries(collections) };
}

function validateBackup(backup) {
    const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
    const segment = value => value.length > 0 && value !== "." && value !== "..";
    if (backup?.format !== FORMAT || !record(backup.collections)) throw new Error("File không phải bản sao lưu FlowerFlow hợp lệ.");
    for (const [collectionPath, documents] of Object.entries(backup.collections)) {
        const parts = collectionPath.split("/");
        if (parts.length % 2 !== 1 || !parts.every(segment) || !record(documents))
            throw new Error("Đường dẫn collection hoặc dữ liệu sao lưu không hợp lệ.");
        for (const [id, data] of Object.entries(documents)) {
            if (!segment(id) || id.includes("/") || !record(data)) throw new Error("Document sao lưu không hợp lệ.");
        }
    }
}

// Writes every document of the backup back (creating or overwriting it). Documents that exist in
// the database but not in the backup are left alone.
async function importDatabase(db, backup, { Timestamp, GeoPoint } = {}) {
    validateBackup(backup);
    const helpers = {
        makeGeoPoint: GeoPoint ? ({ latitude, longitude }) => new GeoPoint(latitude, longitude) : undefined,
        makeReference: (documentPath) => db.doc(documentPath)
    };
    const writes = [];
    Object.entries(backup.collections).forEach(([collectionId, documents]) => {
        Object.entries(documents).forEach(([documentId, data]) => {
            writes.push([db.collection(collectionId).doc(documentId), deserializeValue(data, (date) => Timestamp.fromDate(date), helpers)]);
        });
    });
    for (let index = 0; index < writes.length; index += 400) {
        const batch = db.batch();
        writes.slice(index, index + 400).forEach(([reference, data]) => batch.set(reference, data));
        await batch.commit();
    }
    return countDocuments(backup);
}

function countDocuments(backup) {
    validateBackup(backup);
    return Object.fromEntries(Object.entries(backup.collections).map(([id, documents]) => [id, Object.keys(documents).length]));
}

// Public workflow logs must not expose parent document IDs from subcollection paths.
function summarizeDocuments(backup) {
    const totals = new Map();
    for (const [collectionPath, count] of Object.entries(countDocuments(backup))) {
        const root = collectionPath.split("/")[0];
        totals.set(root, (totals.get(root) || 0) + count);
    }
    return Object.fromEntries(totals);
}

function deriveKey(passphrase, salt) {
    return scryptSync(String(passphrase), salt, 32);
}

function checkPassphrase(passphrase) {
    if (String(passphrase || "").length < MIN_PASSPHRASE_LENGTH) {
        throw new Error(`Mật khẩu sao lưu (BACKUP_PASSPHRASE) cần ít nhất ${MIN_PASSPHRASE_LENGTH} ký tự.`);
    }
}

// AES-256-GCM: the file cannot be read, and any change to it is detected, without the passphrase.
function encryptBackup(backup, passphrase) {
    checkPassphrase(passphrase);
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(backup), "utf8"), cipher.final()]);
    return JSON.stringify({
        format: `${FORMAT}+aes-256-gcm`,
        salt: salt.toString("base64"),
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
        data: data.toString("base64")
    });
}

function decryptBackup(text, passphrase) {
    const file = JSON.parse(text);
    if (file.format !== `${FORMAT}+aes-256-gcm`) throw new Error("File không phải bản sao lưu FlowerFlow đã mã hóa.");
    try {
        const decipher = createDecipheriv("aes-256-gcm", deriveKey(passphrase, Buffer.from(file.salt, "base64")), Buffer.from(file.iv, "base64"));
        decipher.setAuthTag(Buffer.from(file.tag, "base64"));
        const data = Buffer.concat([decipher.update(Buffer.from(file.data, "base64")), decipher.final()]);
        return JSON.parse(data.toString("utf8"));
    } catch {
        throw new Error("Không giải mã được: sai mật khẩu sao lưu hoặc file đã bị sửa.");
    }
}

module.exports = {
    FORMAT,
    serializeValue,
    deserializeValue,
    exportDatabase,
    importDatabase,
    countDocuments,
    summarizeDocuments,
    encryptBackup,
    decryptBackup
};
