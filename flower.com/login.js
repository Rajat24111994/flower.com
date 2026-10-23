import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js";

const signUpButton = document.getElementById("signup");
const signInButton = document.getElementById("signin");
const container = document.getElementById("container");
const display = document.getElementById("display");
const signupDisplay = document.getElementById("signup-display");
const signIn = document.querySelector("#signIn");
const signUp = document.querySelector("#signUp");
const accountStorageKey = "usersData";

let firebaseAuthApiPromise;

function showMessage(message, isError = true) {
    showFormMessage(display, message, isError);
}

function showFormMessage(target, message, isError = true) {
    target.textContent = message;
    target.classList.toggle("status-error", isError);
    target.classList.toggle("status-success", !isError);
}

function getSavedAccounts() {
    try {
        const savedAccounts = JSON.parse(localStorage.getItem(accountStorageKey) || "[]");
        return Array.isArray(savedAccounts) ? savedAccounts : [];
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

function saveLocalAccount({ name, email, password, phone }) {
    const users = getSavedAccounts();
    if (!users) return false;

    if (users.some((user) => (user.email || "").toLowerCase() === email)) {
        showFormMessage(signupDisplay, "Email này đã được đăng ký trên trình duyệt này. Hãy chuyển sang Đăng nhập.");
        return false;
    }

    users.push({ name, email, password, phone });
    if (!saveAccounts(users)) return false;

    showFormMessage(
        signupDisplay,
        "Đã tạo tài khoản trên trình duyệt này. Tài khoản không đồng bộ sang thiết bị khác.",
        false
    );
    signUp.reset();
    return true;
}

async function getFirebaseAuthApi() {
    if (!isFirebaseConfigured) {
        return null;
    }

    if (!firebaseAuthApiPromise) {
        firebaseAuthApiPromise = Promise.all([
            import("https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js"),
            import("https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js")
        ]).then(([appSdk, authSdk]) => {
            const app = appSdk.initializeApp(firebaseConfig);
            const auth = authSdk.getAuth(app);
            return authSdk.setPersistence(auth, authSdk.browserLocalPersistence).then(() => ({
                auth,
                ...authSdk
            }));
        }).catch((error) => {
            firebaseAuthApiPromise = null;
            throw error;
        });
    }

    return firebaseAuthApiPromise;
}

function getFirebaseErrorMessage(error) {
    const messages = {
        "auth/email-already-in-use": "Email này đã được đăng ký. Hãy chuyển sang Đăng nhập.",
        "auth/invalid-credential": "Email hoặc mật khẩu không chính xác. Nếu đăng ký bằng Google, hãy chọn Đăng nhập bằng Google.",
        "auth/invalid-login-credentials": "Email hoặc mật khẩu không chính xác. Nếu đăng ký bằng Google, hãy chọn Đăng nhập bằng Google.",
        "auth/invalid-email": "Địa chỉ email không hợp lệ.",
        "auth/invalid-api-key": "Cấu hình Firebase không hợp lệ. Kiểm tra firebase-config.js.",
        "auth/network-request-failed": "Không kết nối được Firebase. Kiểm tra mạng rồi thử lại.",
        "auth/operation-not-allowed": "Firebase chưa bật đăng nhập bằng email và mật khẩu. Nếu tài khoản dùng Google, hãy chọn nút Đăng nhập bằng Google. Muốn bật email/mật khẩu: Firebase Console → Authentication → Sign-in method → Email/Password → Enable.",
        "auth/popup-closed-by-user": "Bạn đã đóng cửa sổ đăng nhập Google.",
        "auth/popup-blocked": "Trình duyệt đã chặn cửa sổ đăng nhập. Hãy cho phép cửa sổ bật lên rồi thử lại.",
        "auth/too-many-requests": "Bạn đã thử quá nhiều lần. Vui lòng thử lại sau.",
        "auth/unauthorized-domain": "Tên miền trang web chưa được cấp phép. Trong Firebase Console, vào Authentication → Settings → Authorized domains và thêm tên miền hiện tại (ví dụ: localhost hoặc domain triển khai; không nhập http:// hay đường dẫn).",
        "auth/weak-password": "Mật khẩu cần có ít nhất 6 ký tự."
    };
    return messages[error.code] || "Đăng nhập chưa thành công. Vui lòng thử lại.";
}

function saveCustomerSession(user, provider) {
    try {
        localStorage.setItem("loggedUser", JSON.stringify({
            name: user.displayName || user.name || "Khách hàng",
            email: user.email || "",
            phone: user.phoneNumber || user.phone || "",
            uid: user.uid || "",
            authProvider: provider,
            role: "customer"
        }));
        localStorage.removeItem("loggedAdmin");
        window.location.assign("./product.html");
    } catch (error) {
        console.error("Không thể lưu phiên đăng nhập:", error);
        showMessage("Đăng nhập được nhưng không thể lưu phiên trên trình duyệt này.");
    }
}

async function saveAuthenticatedSession(user, provider) {
    const token = await user.getIdTokenResult();
    if (token.claims.role === "owner") {
        try {
            localStorage.setItem("loggedUser", JSON.stringify({
                name: user.displayName || "Owner",
                email: user.email || "",
                uid: user.uid || "",
                authProvider: provider,
                role: "owner"
            }));
            localStorage.setItem("loggedAdmin", "true");
            window.location.assign("./owner.html");
        } catch (error) {
            console.error("Không thể lưu phiên Owner:", error);
            showMessage("Đăng nhập được nhưng không thể lưu phiên trên trình duyệt này.");
        }
        return;
    }

    if (token.claims.admin === true) {
        try {
            localStorage.setItem("loggedUser", JSON.stringify({
                name: user.displayName || "Admin",
                email: user.email || "",
                uid: user.uid || "",
                authProvider: provider,
                role: "admin"
            }));
            localStorage.setItem("loggedAdmin", "true");
            window.location.assign("./admin.html");
        } catch (error) {
            console.error("Không thể lưu phiên quản trị:", error);
            showMessage("Đăng nhập được nhưng không thể lưu phiên trên trình duyệt này.");
        }
        return;
    }

    saveCustomerSession(user, provider);
}

async function signInWithGoogle(event) {
    const button = event.currentTarget;
    if (!isFirebaseConfigured) {
        showFormMessage(button.closest("form")?.querySelector('[role="status"]') || display,
            "Đăng nhập Google chưa sẵn sàng. Cần điền cấu hình Firebase trong firebase-config.js.");
        return;
    }

    const buttons = document.querySelectorAll("[data-google-auth]");
    buttons.forEach((button) => {
        button.disabled = true;
    });

    try {
        const authApi = await getFirebaseAuthApi();
        const provider = new authApi.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: "select_account" });
        showFormMessage(button.closest("form")?.querySelector('[role="status"]') || display,
            "Đang mở cửa sổ đăng nhập Google...", false);
        const result = await authApi.signInWithPopup(authApi.auth, provider);
        await saveAuthenticatedSession(result.user, "google");
    } catch (error) {
        console.error("Đăng nhập Google thất bại:", error);
        showFormMessage(button.closest("form")?.querySelector('[role="status"]') || display,
            getFirebaseErrorMessage(error));
    } finally {
        buttons.forEach((button) => {
            button.disabled = false;
        });
    }
}

async function completeGoogleRedirect() {
    if (!isFirebaseConfigured) return;

    try {
        const authApi = await getFirebaseAuthApi();
        const result = await authApi.getRedirectResult(authApi.auth);
        if (result?.user) {
            await saveAuthenticatedSession(result.user, "google");
        }
    } catch (error) {
        console.error("Không thể hoàn tất đăng nhập Google:", error);
        showMessage(getFirebaseErrorMessage(error));
    }
}

if (signUpButton) {
    signUpButton.addEventListener("click", () => {
        container.classList.add("right-panel-active");
    });
}

if (signInButton) {
    signInButton.addEventListener("click", () => {
        container.classList.remove("right-panel-active");
    });
}

document.querySelectorAll("[data-google-auth]").forEach((button) => {
    button.addEventListener("click", signInWithGoogle);
});

signUp.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = document.getElementById("email").value.trim().toLowerCase();
    const password = document.getElementById("password").value;
    const confirmPassword = document.getElementById("checkpassword").value;
    const name = `${document.getElementById("name").value.trim()} ${document.getElementById("lastName").value.trim()}`.trim();
    const phone = document.getElementById("phone").value.trim();

    if (password !== confirmPassword) {
        showFormMessage(signupDisplay, "Mật khẩu xác nhận không khớp!");
        return;
    }

    if (isFirebaseConfigured) {
        try {
            const authApi = await getFirebaseAuthApi();
            const credential = await authApi.createUserWithEmailAndPassword(authApi.auth, email, password);
            await authApi.updateProfile(credential.user, { displayName: name });
            showFormMessage(signupDisplay, "Tạo tài khoản thành công. Đang chuyển vào cửa hàng...", false);
            saveCustomerSession({ ...credential.user, displayName: name, phoneNumber: phone }, "password");
        } catch (error) {
            console.error("Tạo tài khoản Firebase thất bại:", error);
            if (error.code === "auth/operation-not-allowed") {
                saveLocalAccount({ name, email, password, phone });
                return;
            }
            showFormMessage(signupDisplay, getFirebaseErrorMessage(error));
        }
        return;
    }

    saveLocalAccount({ name, email, password, phone });
});

signIn.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = document.getElementById("email1").value.trim().toLowerCase();
    const password = document.getElementById("password1").value;

    if (isFirebaseConfigured) {
        try {
            const authApi = await getFirebaseAuthApi();
            const credential = await authApi.signInWithEmailAndPassword(authApi.auth, email, password);
            await saveAuthenticatedSession(credential.user, "password");
        } catch (error) {
            console.error("Đăng nhập Firebase thất bại:", error);

            const savedAccounts = getSavedAccounts();
            if (!savedAccounts) return;

            const savedAccount = savedAccounts.find(
                (account) => (account.email || "").toLowerCase() === email
            );
            if (savedAccount && savedAccount.password === password) {
                saveCustomerSession(savedAccount, "local");
                return;
            }

            showMessage(getFirebaseErrorMessage(error));
        }
        return;
    }

    const users = getSavedAccounts();
    if (!users) return;
    const user = users.find((account) => (account.email || "").toLowerCase() === email);

    if (!user) {
        showMessage("Tài khoản chưa đăng ký.");
    } else if (user.password !== password) {
        showMessage("Sai thông tin đăng nhập.");
    } else {
        saveCustomerSession(user, "local");
    }
});

document.getElementById("forgotPassword").addEventListener("click", (event) => {
    const email = document.getElementById("email1").value.trim().toLowerCase();
    if (!email) return;

    event.preventDefault();
    const recoveryUrl = new URL(event.currentTarget.href);
    recoveryUrl.searchParams.set("email", email);
    window.location.assign(recoveryUrl.href);
});

completeGoogleRedirect();
