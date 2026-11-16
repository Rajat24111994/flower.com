// Restores an encrypted backup made by backup-firestore.js.
//   BACKUP_PASSPHRASE=... npm run restore -- <file>             -> only shows what the file contains
//   BACKUP_PASSPHRASE=... npm run restore -- <file> --dong-y    -> writes it into Firestore
// Every document in the file is created or overwritten; documents not in the file are kept.
const fs = require("fs");
const { Timestamp, GeoPoint } = require("firebase-admin/firestore");
const { importDatabase, countDocuments, decryptBackup } = require("../lib/firestore-backup");
const { connectFirestore } = require("./firestore-client");

(async () => {
    const file = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
    if (!file) throw new Error("Cần đường dẫn file sao lưu: npm run restore -- backups/flowerflow-....json.enc");
    const backup = decryptBackup(fs.readFileSync(file, "utf8"), process.env.BACKUP_PASSPHRASE);
    const counts = countDocuments(backup);
    console.log(`Bản sao lưu lúc ${backup.createdAt}:`);
    Object.entries(counts).forEach(([collection, count]) => console.log(`  ${collection}: ${count}`));

    if (!process.argv.includes("--dong-y")) {
        console.log("\nChưa ghi gì vào Firestore. Kiểm tra số liệu trên, rồi chạy lại kèm --dong-y để khôi phục.");
        return;
    }
    const { db, projectId } = connectFirestore();
    console.log(`\nĐang khôi phục vào project ${projectId}...`);
    await importDatabase(db, backup, { Timestamp, GeoPoint });
    console.log("Xong. Mở trang admin và bấm Ctrl + F5 để xem dữ liệu.");
})().catch((error) => {
    console.error(`LỖI: ${error.message}`);
    process.exitCode = 1;
});
