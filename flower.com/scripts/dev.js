const path = require("node:path");
const { createLocalServer } = require("../lib/local-server");

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error("PORT phải là số nguyên từ 1 đến 65535.");
    process.exitCode = 1;
} else {
    const mode = process.env.AUTH_MODE || "local";
    if (!["local", "firebase"].includes(mode)) {
        console.error("AUTH_MODE phải là local hoặc firebase.");
        process.exit(1);
    }
    const localAccounts = mode === "local" ? require("../lib/local-accounts").createLocalAccounts({
        filename: path.join(__dirname, "../.tools/local-auth/accounts.sqlite")
    }) : null;
    const missing = mode === "firebase" ? ["FIREBASE_SERVICE_ACCOUNT_JSON", "FIREBASE_AUTH_PUBLIC_API_KEY", "FIREBASE_AUTH_SERVER_API_KEY"]
        .filter((key) => !process.env[key]?.trim()) : [];
    const server = createLocalServer({ root: path.join(__dirname, ".."), missingLoginConfiguration: missing, localAccounts, authMode: mode });
    server.once("close", () => localAccounts?.close());
    server.once("error", (error) => {
        console.error(error.code === "EADDRINUSE"
            ? `Cổng ${port} đang được sử dụng. Đổi PORT trong .env rồi chạy lại.`
            : "Không thể khởi động máy chủ local.");
        process.exitCode = 1;
    });
    server.listen(port, "127.0.0.1", () => {
        console.log(`Flowerflow: http://127.0.0.1:${port}/`);
        console.log(`Đăng nhập: http://127.0.0.1:${port}/login.html`);
        console.log("Giao diện và API chạy cùng địa chỉ. Dừng bằng Ctrl+C.");
        if (mode === "local") console.log("Tài khoản tự tạo trên máy: không cần Firebase hoặc email thật. Đặt PIN và 3 câu hỏi khi đăng ký.");
        if (missing.length) {
            console.log("Đăng nhập Firebase thật chưa sẵn sàng. Cần điền trong .env:");
            missing.forEach((key) => console.log(`  ${key}`));
            console.log("Xem docs/login-protection.md. Sau khi điền, khởi động lại máy chủ.");
        }
    });
}
