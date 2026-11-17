// Restores an encrypted backup made by backup-firestore.js.
//   BACKUP_PASSPHRASE=... npm run restore -- <file>             -> only shows what the file contains
//   BACKUP_PASSPHRASE=... npm run restore -- <file> --dong-y --project <id> -> writes to the confirmed project
// Every document in the file is created or overwritten; documents not in the file are kept.
const fs = require("fs");
const { Timestamp, GeoPoint } = require("firebase-admin/firestore");
const { importDatabase, summarizeDocuments, decryptBackup } = require("../lib/firestore-backup");
const { connectFirestore } = require("./firestore-client");

(async () => {
    const args = process.argv.slice(2); let file, target;
    for (let index = 0; index < args.length; index++) {
        if (args[index] === "--project") {
            target = args[++index];
            if (!target || target.startsWith("--")) throw new Error("Cần project ID sau --project.");
        } else if (args[index] === "--dong-y") continue;
        else if (args[index].startsWith("--") || file) throw new Error("Tham số khôi phục không hợp lệ.");
        else file = args[index];
    }
    if (!file) throw new Error("Cần đường dẫn file sao lưu: npm run restore -- backups/flowerflow-....json.enc");
    if (args.includes("--dong-y") && !target) throw new Error("Cần --project <project-id> để xác nhận project đích trước khi khôi phục.");
    const backup = decryptBackup(fs.readFileSync(file, "utf8"), process.env.BACKUP_PASSPHRASE);
    const counts = summarizeDocuments(backup);
    console.log(`Bản sao lưu lúc ${backup.createdAt}:`);
    if (backup.projectId) console.log(`Project nguồn: ${backup.projectId}`);
    console.log("Số document theo collection gốc (gồm collection con):");
    Object.entries(counts).forEach(([collection, count]) => console.log(`  ${collection}: ${count}`));

    if (!process.argv.includes("--dong-y")) {
        console.log("\nChưa ghi gì vào Firestore. Kiểm tra số liệu trên, rồi chạy lại kèm --dong-y --project <project-id> để khôi phục.");
        return;
    }
    const { db, projectId } = connectFirestore(target);
    console.log(`\nĐang khôi phục vào project ${projectId}...`);
    await importDatabase(db, backup, { Timestamp, GeoPoint });
    console.log("Xong. Mở trang admin và bấm Ctrl + F5 để xem dữ liệu.");
})().catch((error) => {
    console.error(`LỖI: ${error.message}`);
    process.exitCode = 1;
});
