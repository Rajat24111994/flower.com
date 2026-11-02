import { firebaseConfig, isFirebaseConfigured, connectFirebaseEmulators } from "./firebase-config.js";

const signUpButton = document.getElementById("signup");
const signInButton = document.getElementById("signin");
const container = document.getElementById("container");
const display = document.getElementById("display");
const signupDisplay = document.getElementById("signup-display");
const signIn = document.querySelector("#signIn");
const signUp = document.querySelector("#signUp");

let firebaseAuthApiPromise;

function showMessage(message, isError = true) {
    showFormMessage(display, message, isError);
}

function showFormMessage(target, message, isError = true) {
    target.textContent = message;
    target.classList.toggle("status-error", isError);
    target.classList.toggle("status-success", !isError);
}

if (!window.FlowerSafeStorage.remove("usersData")) {
    showMessage("Không xóa được mật khẩu cũ từng lưu trên trình duyệt. Hãy xóa dữ liệu trang web trong cài đặt trình duyệt.");
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
            connectFirebaseEmulators(app, auth, null, authSdk);
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
        "auth/email-already-in-use": "Địa chỉ thư điện tử này đã được đăng ký. Hãy chuyển sang Đăng nhập.",
        "auth/invalid-credential": "Địa chỉ thư điện tử hoặc mật khẩu không chính xác. Nếu đăng ký bằng Google, hãy chọn Đăng nhập bằng Google.",
        "auth/invalid-login-credentials": "Địa chỉ thư điện tử hoặc mật khẩu không chính xác. Nếu đăng ký bằng Google, hãy chọn Đăng nhập bằng Google.",
        "auth/invalid-email": "Địa chỉ thư điện tử không hợp lệ.",
        "auth/invalid-api-key": "Cấu hình Firebase không hợp lệ. Kiểm tra firebase-config.js.",
        "auth/network-request-failed": "Không kết nối được Firebase. Kiểm tra mạng rồi thử lại.",
        "auth/operation-not-allowed": "Firebase chưa bật đăng nhập bằng thư điện tử và mật khẩu. Nếu tài khoản dùng Google, hãy chọn nút Đăng nhập bằng Google. Để bật: Firebase Console → Xác thực → Phương thức đăng nhập → Thư điện tử/Mật khẩu → Bật.",
        "auth/popup-closed-by-user": "Bạn đã đóng cửa sổ đăng nhập Google.",
        "auth/popup-blocked": "Trình duyệt đã chặn cửa sổ đăng nhập. Hãy cho phép cửa sổ bật lên rồi thử lại.",
        "auth/too-many-requests": "Bạn đã thử quá nhiều lần. Vui lòng thử lại sau.",
        "auth/unauthorized-domain": "Tên miền trang web chưa được cấp phép. Trong Firebase Console, vào Xác thực → Cài đặt → Tên miền được phép và thêm tên miền hiện tại (ví dụ: localhost hoặc tên miền triển khai; không nhập http:// hay đường dẫn).",
        "auth/weak-password": "Mật khẩu cần có ít nhất 6 ký tự."
    };
    return messages[error.code] || "Đăng nhập chưa thành công. Vui lòng thử lại.";
}

function saveCustomerSession(user, provider) {
    try {
        window.FlowerSafeStorage.writeJson("loggedUser", {
            name: user.displayName || user.name || "Khách hàng",
            email: user.email || "",
            phone: user.phoneNumber || user.phone || "",
            uid: user.uid || "",
            authProvider: provider,
            role: "customer"
        }, { required: true });
        window.FlowerSafeStorage.remove("loggedAdmin");
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
            window.FlowerSafeStorage.writeJson("loggedUser", {
                name: user.displayName || "Chủ cửa hàng",
                email: user.email || "",
                uid: user.uid || "",
                authProvider: provider,
                role: "owner"
            }, { required: true });
            window.FlowerSafeStorage.remove("loggedAdmin");
            window.location.assign("./owner.html");
        } catch (error) {
            console.error("Không thể lưu phiên chủ cửa hàng:", error);
            showMessage("Đăng nhập được nhưng không thể lưu phiên trên trình duyệt này.");
        }
        return;
    }

    if (token.claims.admin === true) {
        try {
            window.FlowerSafeStorage.writeJson("loggedUser", {
                name: user.displayName || "Quản trị viên",
                email: user.email || "",
                uid: user.uid || "",
                authProvider: provider,
                role: "admin"
            }, { required: true });
            window.FlowerSafeStorage.remove("loggedAdmin");
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
            showFormMessage(signupDisplay, getFirebaseErrorMessage(error));
        }
        return;
    }
    showFormMessage(signupDisplay, "Đăng ký chưa sẵn sàng. Cửa hàng cần cấu hình Firebase Authentication trước.");
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
            showMessage(getFirebaseErrorMessage(error));
        }
        return;
    }
    showMessage("Đăng nhập chưa sẵn sàng. Cửa hàng cần cấu hình Firebase Authentication trước.");
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
