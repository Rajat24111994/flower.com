import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js";

const accountStorageKey = "usersData";
const form = document.getElementById("recovery-form");
const emailInput = document.getElementById("recovery-email");
const localPasswordFields = document.getElementById("local-password-fields");
const newPasswordInput = document.getElementById("new-password");
const confirmPasswordInput = document.getElementById("confirm-password");
const message = document.getElementById("recovery-message");
const submitButton = document.getElementById("recovery-submit");

function showMessage(text, isError = true) {
    message.textContent = text;
    message.classList.toggle("status-error", isError);
    message.classList.toggle("status-success", !isError);
}

function getSavedAccounts() {
    try {
        const accounts = JSON.parse(localStorage.getItem(accountStorageKey) || "[]");
        if (!Array.isArray(accounts)) {
            throw new TypeError("Danh sách tài khoản không hợp lệ.");
        }
        return accounts;
    } catch (error) {
        console.error("Không thể đọc danh sách tài khoản đã lưu:", error);
        showMessage("Không thể đọc danh sách tài khoản đã lưu trên trình duyệt.");
        return null;
    }
}

function saveAccounts(accounts) {
    try {
        localStorage.setItem(accountStorageKey, JSON.stringify(accounts));
        return true;
    } catch (error) {
        console.error("Không thể lưu danh sách tài khoản:", error);
        showMessage("Không thể lưu tài khoản trên trình duyệt này.");
        return false;
    }
}

function getFirebaseErrorMessage(error) {
    const messages = {
        "auth/invalid-email": "Địa chỉ email không hợp lệ.",
        "auth/invalid-api-key": "Cấu hình Firebase không hợp lệ. Kiểm tra firebase-config.js.",
        "auth/network-request-failed": "Không kết nối được Firebase. Kiểm tra mạng rồi thử lại.",
        "auth/too-many-requests": "Bạn đã thử quá nhiều lần. Vui lòng thử lại sau.",
        "auth/unauthorized-domain": "Tên miền trang web chưa được cấp phép trong Firebase Authentication."
    };
    return messages[error.code] || "Chưa thể gửi liên kết đặt lại mật khẩu. Vui lòng thử lại.";
}

async function sendFirebaseResetEmail(email) {
    const [appSdk, authSdk] = await Promise.all([
        import("https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js"),
        import("https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js")
    ]);
    const app = appSdk.getApps().length ? appSdk.getApp() : appSdk.initializeApp(firebaseConfig);
    const auth = authSdk.getAuth(app);
    await authSdk.sendPasswordResetEmail(auth, email);
}

if (!isFirebaseConfigured) {
    localPasswordFields.hidden = false;
    submitButton.textContent = "Cập nhật mật khẩu";
    document.getElementById("recovery-intro").textContent =
        "Nhập email tài khoản và tạo mật khẩu mới. Tài khoản lưu trên trình duyệt này không đồng bộ sang thiết bị khác.";
}

const emailFromLogin = new URLSearchParams(window.location.search).get("email");
if (emailFromLogin) {
    emailInput.value = emailFromLogin.trim().toLowerCase();
}

form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = emailInput.value.trim().toLowerCase();

    if (!emailInput.validity.valid) {
        showMessage("Vui lòng nhập địa chỉ email hợp lệ.");
        emailInput.focus();
        return;
    }

    submitButton.disabled = true;
    message.textContent = "";
    message.classList.remove("status-error", "status-success");

    if (isFirebaseConfigured) {
        try {
            await sendFirebaseResetEmail(email);
            showMessage("Đã gửi liên kết đặt lại mật khẩu vào email của bạn.", false);
        } catch (error) {
            console.error("Gửi email khôi phục mật khẩu thất bại:", error);
            showMessage(getFirebaseErrorMessage(error));
        } finally {
            submitButton.disabled = false;
        }
        return;
    }

    const newPassword = newPasswordInput.value;
    const confirmPassword = confirmPasswordInput.value;
    if (newPassword.length < 6) {
        showMessage("Mật khẩu mới cần có ít nhất 6 ký tự.");
        newPasswordInput.focus();
        submitButton.disabled = false;
        return;
    }
    if (newPassword !== confirmPassword) {
        showMessage("Mật khẩu xác nhận không khớp.");
        confirmPasswordInput.focus();
        submitButton.disabled = false;
        return;
    }

    const accounts = getSavedAccounts();
    if (!accounts) {
        submitButton.disabled = false;
        return;
    }
    const account = accounts.find((item) => (item.email || "").toLowerCase() === email);
    if (!account) {
        showMessage("Email chưa đăng ký trên trình duyệt này.");
        submitButton.disabled = false;
        return;
    }

    account.password = newPassword;
    if (saveAccounts(accounts)) {
        showMessage("Mật khẩu đã được cập nhật. Bạn có thể đăng nhập ngay.", false);
        form.reset();
    }
    submitButton.disabled = false;
});
