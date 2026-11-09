import { firebaseConfig } from "../core/firebase-config.js";
import { isLocalAuth, localAuthRequest, persistLocalAccount } from "./local-auth-client.js";
import { addQuestionFields, readQuestions, recoveryError, restrictPinInputs } from "./recovery-security.js?v=3";

function getStoredAccount() {
    try {
        const account = window.FlowerSafeStorage.readJson("loggedUser", {
            fallback: null,
            validate: (value) => value !== null && typeof value === "object" && !Array.isArray(value)
        });
        return account && typeof account === "object" ? account : null;
    } catch (error) {
        console.error("Không thể đọc phiên tài khoản:", error);
        return null;
    }
}

async function restoreFirebaseAccount() {
    if (isLocalAuth) {
        try { return (await localAuthRequest("session")).account; }
        catch (error) { if (error.status === 401) return null; throw error; }
    }
    const [appSdk, authSdk] = await Promise.all([
        import("https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js"),
        import("https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js")
    ]);
    const app = appSdk.getApps().length ? appSdk.getApp() : appSdk.initializeApp(firebaseConfig);
    const auth = authSdk.getAuth(app);
    await auth.authStateReady();

    const user = auth.currentUser;
    if (!user) return null;

    const provider = user.providerData.some((item) => item.providerId === "google.com")
        ? "google"
        : "password";
    return {
        name: user.displayName || "Khách hàng",
        email: user.email || "",
        phone: user.phoneNumber || "",
        uid: user.uid,
        authProvider: provider,
        role: "customer"
    };
}

let account = getStoredAccount();
if (account) {
    // The stored copy can outlive the Firebase session (password reset, disabled account).
    try {
        const firebaseAccount = await restoreFirebaseAccount();
        if (isLocalAuth && firebaseAccount) {
            account = firebaseAccount;
            persistLocalAccount(account);
        }
        if (!firebaseAccount || (account.uid && firebaseAccount.uid !== account.uid)) {
            window.FlowerSafeStorage.remove("loggedUser");
            window.FlowerSafeStorage.remove("loggedAdmin");
            account = null;
        }
    } catch (error) {
        console.warn("Chưa kiểm tra được phiên đăng nhập:", error);
    }
}
if (!account) {
    try {
        account = await restoreFirebaseAccount();
        if (account) {
            window.FlowerSafeStorage.writeJson("loggedUser", account);
        }
    } catch (error) {
        console.error("Không thể khôi phục phiên Firebase:", error);
        document.getElementById("account-message").textContent =
            "Không thể xác minh phiên đăng nhập. Vui lòng đăng nhập lại.";
    }
}

if (!account || account.role === "admin" || account.role === "owner") {
    window.location.replace(account?.role === "owner"
        ? "./owner.html"
        : account?.role === "admin" ? "./admin.html" : "./login.html");
} else {
    document.getElementById("account-name").textContent = account.name || "Chưa cập nhật";
    document.getElementById("account-email").textContent = account.email || "Chưa cập nhật";
    document.getElementById("account-phone").textContent = account.phone || "Chưa cập nhật";
    document.getElementById("account-provider").textContent = account.authProvider === "google"
        ? "Google"
        : account.authProvider === "password"
        ? "Thư điện tử và mật khẩu"
            : "Tài khoản tự tạo trên máy";
    if (isLocalAuth) {
        document.getElementById("account-email").closest("div").querySelector("dt").textContent = "Tên đăng nhập";
    }
}

function requirePinRecovery() {
    window.location.assign(`./forgot-password.html?email=${encodeURIComponent(account.email)}&recoverPin=1`);
}

if (isLocalAuth && account?.pinResetRequired) requirePinRecovery();

if (isLocalAuth && account && !account.pinResetRequired) {
    restrictPinInputs();
    const form = document.getElementById("security-form");
    const submit = document.getElementById("security-submit");
    const status = document.getElementById("security-message");
    const questions = document.getElementById("security-setup-questions");
    const setup = !account.securityConfigured;
    document.getElementById("local-security").hidden = false;
    document.getElementById("security-email").value = account.email;
    document.getElementById("security-name").value = account.name === "Khách hàng" ? "" : account.name;
    document.getElementById("security-phone").value = account.phone || "";
    document.querySelector(".security-recovery-link").href = `./forgot-password.html?email=${encodeURIComponent(account.email)}`;
    document.getElementById("old-pin-field").hidden = setup;
    document.getElementById("security-old-pin").required = !setup;
    document.getElementById("security-old-pin").disabled = setup;
    if (setup) {
        document.getElementById("security-title").textContent = "Thiết lập PIN khôi phục";
        document.getElementById("security-intro").textContent = "Tài khoản cũ của bạn vẫn được giữ nguyên. Xác nhận mật khẩu, bổ sung họ tên, số điện thoại rồi đặt PIN và 3 câu hỏi để khôi phục sau này.";
        submit.textContent = "Lưu PIN và câu hỏi";
        questions.hidden = false;
        questions.disabled = false;
        addQuestionFields(questions, "security");
    }
    form.addEventListener("submit", async event => {
        event.preventDefault();
        if (submit.disabled) return;
        submit.disabled = true;
        status.textContent = "Đang xác minh...";
        status.classList.remove("status-success");
        try {
            const result = await localAuthRequest(setup ? "setup-security" : "change-pin", {
                email: document.getElementById("security-email").value,
                name: document.getElementById("security-name").value,
                phone: document.getElementById("security-phone").value,
                password: document.getElementById("security-password").value,
                oldPin: document.getElementById("security-old-pin").value,
                newPin: document.getElementById("security-new-pin").value,
                confirmPin: document.getElementById("security-confirm-pin").value,
                ...(setup ? { questions: readQuestions("security") } : {})
            });
            account = result.account;
            persistLocalAccount(account);
            form.querySelectorAll('input[type="password"]').forEach(input => { input.value = ""; });
            if (setup) {
                window.location.reload();
                return;
            }
            status.textContent = "Đã đổi PIN. Các phiên đăng nhập khác đã kết thúc.";
            status.classList.add("status-success");
        } catch (error) {
            status.textContent = recoveryError(error);
            if (["pin-reset-required", "pin-format-update-required"].includes(error.code)) requirePinRecovery();
        }
        finally { submit.disabled = false; }
    });
}

document.getElementById("logout-button").addEventListener("click", async () => {
    const message = document.getElementById("account-message");
    if (isLocalAuth) {
        try { await localAuthRequest("logout"); }
        catch (error) { message.textContent = error.message; return; }
    }

    if (account?.authProvider === "google" || account?.authProvider === "password") {
        try {
            const [appSdk, authSdk] = await Promise.all([
                import("https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js"),
                import("https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js")
            ]);
            const app = appSdk.getApps().length ? appSdk.getApp() : appSdk.initializeApp(firebaseConfig);
            await authSdk.signOut(authSdk.getAuth(app));
        } catch (error) {
            console.error("Không thể đăng xuất khỏi Firebase:", error);
            message.textContent = "Chưa thể đăng xuất do lỗi kết nối. Vui lòng thử lại.";
            return;
        }
    }

    try {
        window.FlowerSafeStorage.remove("loggedUser", { required: true });
        window.FlowerSafeStorage.remove("loggedAdmin");
    } catch (error) {
        console.error("Không thể xóa phiên tài khoản trên trình duyệt:", error);
        message.textContent = "Chưa thể xóa phiên đăng nhập trên trình duyệt này. Hãy thử lại trước khi rời trang.";
        return;
    }
    window.location.assign("./login.html");
});
