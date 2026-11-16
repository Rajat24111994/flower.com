// Saves an encrypted copy of the whole Firestore database (no paid plan needed).
//   BACKUP_PASSPHRASE=... npm run backup                 -> backups/flowerflow-<thời gian>.json.enc
//   BACKUP_PASSPHRASE=... npm run backup -- --out file   -> a chosen file
// Keep the passphrase somewhere safe: without it the backup cannot be opened.
const fs = require("fs");
const path = require("path");
const { exportDatabase, countDocuments, encryptBackup } = require("../lib/firestore-backup");
const { connectFirestore } = require("./firestore-client");

(async () => {
    const passphrase = process.env.BACKUP_PASSPHRASE;
    if (!passphrase) throw new Error("Thiếu BACKUP_PASSPHRASE (mật khẩu dùng để mã hóa bản sao lưu).");
    const outIndex = process.argv.indexOf("--out");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const out = outIndex > -1 ? process.argv[outIndex + 1] : path.join(__dirname, "..", "backups", `flowerflow-${stamp}.json.enc`);

    const { db, projectId } = connectFirestore();
    console.log(`Sao lưu Firestore của project ${projectId}...`);
    const backup = await exportDatabase(db);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, encryptBackup(backup, passphrase));
    const counts = countDocuments(backup);
    Object.entries(counts).forEach(([collection, count]) => console.log(`  ${collection}: ${count}`));
    console.log(`Xong: ${out} (đã mã hóa, ${Object.values(counts).reduce((sum, count) => sum + count, 0)} bản ghi).`);
})().catch((error) => {
    console.error(`LỖI: ${error.message}`);
    process.exitCode = 1;
});
