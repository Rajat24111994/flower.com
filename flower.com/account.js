import { firebaseConfig } from "./firebase-config.js";

function getStoredAccount() {
    try {
        const account = JSON.parse(localStorage.getItem("loggedUser") || "null");
        return account && typeof account === "object" ? account : null;
    } catch (error) {
        console.error("Không thể đọc phiên tài khoản:", error);
        return null;
    }
}

async function restoreFirebaseAccount() {
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
if (!account) {
    try {
        account = await restoreFirebaseAccount();
        if (account) {
            localStorage.setItem("loggedUser", JSON.stringify(account));
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
            ? "Email và mật khẩu"
            : "Tài khoản trình duyệt";
}

document.getElementById("logout-button").addEventListener("click", async () => {
    const message = document.getElementById("account-message");

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

    localStorage.removeItem("loggedUser");
    localStorage.removeItem("loggedAdmin");
    window.location.assign("./login.html");
});
