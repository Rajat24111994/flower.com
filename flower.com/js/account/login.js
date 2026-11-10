import { firebaseConfig, isFirebaseConfigured, connectFirebaseEmulators } from "../core/firebase-config.js";
import { getFirebaseErrorMessage } from "./login-errors.js";
import { isLocalAuth, localAuthRequest, persistLocalAccount } from "./local-auth-client.js?v=2";
import { addQuestionFields, readQuestions, restrictPinInputs } from "./recovery-security.js?v=3";

const signUpButton = document.getElementById("signup");
const signInButton = document.getElementById("signin");
const container = document.getElementById("container");
const display = document.getElementById("display");
const signupDisplay = document.getElementById("signup-display");
const signIn = document.querySelector("#signIn");
const signUp = document.querySelector("#signUp");
const loginSubmit = signIn.querySelector('[type="submit"]');
const loginEmail = document.getElementById("email1");
signUp.inert = true;

const loginPassword = document.getElementById("password1");
const toggleLoginPassword = document.getElementById("toggle-login-password");

toggleLoginPassword.addEventListener("click", () => {
    const showPassword = loginPassword.type === "password";
    loginPassword.type = showPassword ? "text" : "password";
    const label = showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu";
    toggleLoginPassword.setAttribute("aria-label", label);
    toggleLoginPassword.title = label;
});

let firebaseAuthApiPromise;
let loginPending = false;
let lockedEmail = "";
let lockedUntil = 0;
let lockTimer;
let localSignupPending = false;

if (isLocalAuth) {
    restrictPinInputs();
    signUp.querySelector(".form-intro").textContent = "Tên đăng nhập cần có @, ví dụ ban@demo. Không cần email thật.";
    signIn.querySelector(".form-intro").textContent = "Đăng nhập bằng tài khoản bạn đã tạo trên website chạy thử.";
    for (const id of ["email", "email1"]) {
        const input = document.getElementById(id);
        input.placeholder = "Tên đăng nhập, ví dụ ban@demo";
        input.setAttribute("aria-label", "Tên đăng nhập");
        input.autocomplete = "username";
    }
    document.querySelectorAll("[data-google-auth], .auth-divider").forEach((element) => { element.hidden = true; });
    container.classList.add("local-accounts");
    document.getElementById("phone").required = true;
    const security = document.getElementById("signup-security");
    security.hidden = false;
    security.disabled = false;
    addQuestionFields(document.getElementById("signup-questions"), "signup");
}

function updateLoginWait() {
    const active = lockedEmail === loginEmail.value.trim().toLowerCase();
    const seconds = active ? Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000)) : 0;
    loginSubmit.disabled = loginPending || seconds > 0;
    loginSubmit.value = loginPending ? "Đang đăng nhập..." : seconds > 0
        ? `Thử lại sau ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : "Đăng nhập";
    if (!seconds && lockTimer) {
        clearInterval(lockTimer);
        lockTimer = undefined;
        if (active && lockedUntil) {
            showMessage("Đã hết thời gian chờ. Bạn có thể thử đăng nhập lại một lần.", false);
        }
        lockedUntil = 0;
    }
}

function showLoginError(error, email) {
    if (error.code === "account-locked") {
        const seconds = Number(error.retryAfter);
        if (Number.isFinite(seconds) && seconds > 0) {
            lockedEmail = email;
            lockedUntil = Date.now() + seconds * 1000;
            if (lockTimer) clearInterval(lockTimer);
            lockTimer = setInterval(updateLoginWait, 1000);
            showMessage(`Đăng nhập tạm thời bị khóa do nhiều lần thất bại. Vui lòng thử lại sau ${Math.ceil(seconds / 60)} phút.`);
            updateLoginWait();
            return;
        }
    }
    showMessage(error.message || "Chưa thể đăng nhập lúc này. Vui lòng thử lại sau.");
}

loginEmail.addEventListener("input", () => {
    if (lockedEmail && lockedEmail !== loginEmail.value.trim().toLowerCase()) {
        if (lockTimer) clearInterval(lockTimer);
        lockTimer = undefined;
        lockedEmail = "";
        lockedUntil = 0;
        showMessage("", false);
    }
    updateLoginWait();
});

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
    if (isLocalAuth || !isFirebaseConfigured) {
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
    if (isLocalAuth) return;
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
    if (isLocalAuth || !isFirebaseConfigured) return;

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
        signUp.inert = false;
        signIn.inert = true;
    });
}

if (signInButton) {
    signInButton.addEventListener("click", () => {
        container.classList.remove("right-panel-active");
        signIn.inert = false;
        signUp.inert = true;
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

    if (isLocalAuth) {
        if (localSignupPending) return;
        localSignupPending = true;
        const submit = signUp.querySelector('[type="submit"]');
        submit.disabled = true;
        try {
            const result = await localAuthRequest("register", { email, password, name, phone,
                pin: document.getElementById("signup-pin").value,
                confirmPin: document.getElementById("signup-confirm-pin").value, questions: readQuestions("signup") });
            persistLocalAccount(result.account);
            window.location.assign("./product.html");
        } catch (error) {
            showFormMessage(signupDisplay, error.message);
        } finally {
            localSignupPending = false;
            submit.disabled = false;
        }
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
    if (loginPending) return;
    if (lockedEmail === loginEmail.value.trim().toLowerCase() && lockedUntil > Date.now()) return;

    const email = loginEmail.value.trim().toLowerCase();
    const password = document.getElementById("password1").value;

    if (isLocalAuth) {
        loginPending = true;
        updateLoginWait();
        showMessage("Đang đăng nhập...", false);
        try {
            const result = await localAuthRequest("login", { email, password });
            persistLocalAccount(result.account);
            window.location.assign("./product.html");
        } catch (error) {
            showLoginError(error, email);
        } finally {
            loginPending = false;
            updateLoginWait();
        }
        return;
    }

    if (isFirebaseConfigured) {
        loginPending = true;
        updateLoginWait();
        showMessage("Đang đăng nhập...", false);
        try {
            const authApi = await getFirebaseAuthApi();
            const response = await fetch("./api/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                cache: "no-store",
                body: JSON.stringify({ email, password })
            });
            if (response.status === 404 || !response.headers.get("Content-Type")?.includes("application/json")) {
                const local = ["localhost", "127.0.0.1"].includes(window.location.hostname);
                const error = new Error(local
                    ? "Máy chủ hiện tại chưa hỗ trợ API đăng nhập. Hãy chạy npm run dev và mở địa chỉ máy chủ cung cấp thay cho Live Server."
                    : "Dịch vụ đăng nhập chưa sẵn sàng. Vui lòng thử lại sau.");
                error.code = "login-api-unavailable";
                throw error;
            }
            const result = await response.json();
            if (!response.ok) {
                const error = new Error(result.error || "Chưa thể đăng nhập lúc này. Vui lòng thử lại sau.");
                error.code = result.code;
                error.retryAfter = result.retryAfter;
                throw error;
            }
            if (!result.customToken) throw new Error("Chưa thể đăng nhập lúc này. Vui lòng thử lại sau.");
            const credential = await authApi.signInWithCustomToken(authApi.auth, result.customToken);
            await saveAuthenticatedSession(credential.user, "password");
        } catch (error) {
            // Do not print request bodies or authentication tokens to the console.
            if (error.code?.startsWith("auth/")) showMessage(getFirebaseErrorMessage(error));
            else if (error instanceof TypeError || error instanceof SyntaxError) {
                showMessage("Không kết nối được dịch vụ đăng nhập. Vui lòng thử lại sau.");
            } else showLoginError(error, email);
        } finally {
            loginPending = false;
            updateLoginWait();
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

// Keep native form submission disabled until the async module and handlers are ready.
signUp.querySelector('[type="submit"]').disabled = false;
updateLoginWait();
const sessionNotice = new URLSearchParams(window.location.search).get("session");
if (sessionNotice === "expired") showMessage("Phiên đăng nhập đã hết hạn hoặc đã đăng xuất. Vui lòng đăng nhập lại.");
if (sessionNotice === "unavailable") showMessage("Không thể xác minh phiên đăng nhập. Vui lòng kiểm tra kết nối và đăng nhập lại.");
completeGoogleRedirect();
