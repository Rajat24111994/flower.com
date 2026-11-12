// Read-only deployment check. Uses a deliberately nonexistent probe account;
// never prints keys, passwords, tokens, upstream responses or user data.
const { getAdminAuth, getAdminFirestore } = require("../backend/shared/firebase-admin");
const { createPasswordAuth } = require("../lib/password-auth");
const { randomUUID } = require("node:crypto");

async function main() {
    if (process.env.FIREBASE_AUTH_EMULATOR_HOST) {
        throw new Error("Kiểm tra bảo vệ key cần chạy với cấu hình triển khai, không dùng emulator.");
    }
    const provider = createPasswordAuth(getAdminAuth());
    await provider.assertReady();
    console.log("Đạt: key công khai đúng cấu hình website và chặn cả API mật khẩu mới lẫn cũ.");
    const account = await provider.lookup("login-policy-probe@invalid.example");
    const valid = await provider.verifyPassword("login-policy-probe@invalid.example", randomUUID(), account);
    if (valid) throw new Error("Tài khoản kiểm tra không hợp lệ.");
    console.log("Đạt: máy chủ có thể đọc phiên bản mật khẩu và xác thực bằng key riêng.");
    await getAdminFirestore().doc("loginProtection/__configuration_check__").get();
    console.log("Đạt: máy chủ truy cập được kho trạng thái khóa đăng nhập.");
    console.log("Cần rà soát mọi key khác trong cùng project; kiểm tra này chỉ xác minh key công khai đang dùng.");
}

main().catch(() => {
    console.error("Chưa đạt cấu hình bảo vệ đăng nhập. Xem docs/login-protection.md; không chia sẻ thông tin xác thực.");
    process.exitCode = 1;
});
