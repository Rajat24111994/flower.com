const firebaseAuthErrorMessages = {
    "auth/email-already-in-use": "Địa chỉ thư điện tử này đã được đăng ký. Hãy chuyển sang Đăng nhập.",
    "auth/invalid-credential": "Địa chỉ thư điện tử hoặc mật khẩu không chính xác. Nếu đăng ký bằng Google, hãy chọn Đăng nhập bằng Google.",
    "auth/invalid-login-credentials": "Địa chỉ thư điện tử hoặc mật khẩu không chính xác. Nếu đăng ký bằng Google, hãy chọn Đăng nhập bằng Google.",
    "auth/invalid-email": "Địa chỉ thư điện tử không hợp lệ.",
    "auth/invalid-api-key": "Cấu hình Firebase không hợp lệ. Kiểm tra firebase-config.js.",
    "auth/network-request-failed": "Không kết nối được Firebase. Kiểm tra mạng rồi thử lại.",
    "auth/operation-not-allowed": "Firebase chưa bật đăng nhập bằng thư điện tử và mật khẩu. Nếu tài khoản dùng Google, hãy chọn nút Đăng nhập bằng Google. Để bật: Firebase Console → Xác thực → Phương thức đăng nhập → Thư điện tử/Mật khẩu → Bật.",
    "auth/popup-closed-by-user": "Bạn đã đóng cửa sổ đăng nhập Google.",
    "auth/popup-blocked": "Trình duyệt đã chặn cửa sổ đăng nhập. Hãy cho phép cửa sổ bật lên rồi thử lại.",
    "auth/too-many-requests": "Hệ thống tạm thời giới hạn đăng nhập do có quá nhiều lần thử. Vui lòng đợi một lúc rồi thử lại.",
    "auth/unauthorized-domain": "Tên miền trang web chưa được cấp phép. Trong Firebase Console, vào Xác thực → Cài đặt → Tên miền được phép và thêm tên miền hiện tại (ví dụ: localhost hoặc tên miền triển khai; không nhập http:// hay đường dẫn).",
    "auth/password-does-not-meet-requirements": "Mật khẩu cần ít nhất 8 ký tự, có chữ thường (a–z) và số (0–9).",
    "auth/weak-password": "Mật khẩu cần ít nhất 8 ký tự, có chữ thường (a–z) và số (0–9)."
};

export function getFirebaseErrorMessage(error) {
    const code = error?.code;
    return Object.hasOwn(firebaseAuthErrorMessages, code)
        ? firebaseAuthErrorMessages[code]
        : "Đăng nhập chưa thành công. Vui lòng thử lại.";
}
