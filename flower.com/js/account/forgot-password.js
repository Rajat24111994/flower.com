import { firebaseConfig, isFirebaseConfigured, connectFirebaseEmulators } from "../core/firebase-config.js";
import { isLocalAuth, localAuthRequest } from "./local-auth-client.js";
import { recoveryError, restrictPinInputs } from "./recovery-security.js?v=2";

const form = document.getElementById("recovery-form");
const emailInput = document.getElementById("recovery-email");
const message = document.getElementById("recovery-message");
const submitButton = document.getElementById("recovery-submit");
let openRequiredPinRecovery;

function showMessage(text, isError = true) {
    message.textContent = text;
    message.classList.toggle("status-error", isError);
    message.classList.toggle("status-success", !isError);
}

if (!window.FlowerSafeStorage.remove("usersData")) {
    showMessage("Không xóa được mật khẩu cũ từng lưu trên trình duyệt. Hãy xóa dữ liệu trang web trong cài đặt trình duyệt.");
}

function getFirebaseErrorMessage(error) {
    const messages = {
        "auth/invalid-email": "Địa chỉ thư điện tử không hợp lệ.",
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
    connectFirebaseEmulators(app, auth, null, authSdk);
    await authSdk.sendPasswordResetEmail(auth, email);
}

if (isLocalAuth) {
    restrictPinInputs();
    document.getElementById("recovery-intro").textContent =
        "Nhập tên đăng nhập và PIN của bạn để đặt mật khẩu mới. Không cần email thật.";
    document.querySelector('label[for="recovery-email"]').textContent = "Tên đăng nhập";
    emailInput.placeholder = "Ví dụ ban@demo";
    emailInput.autocomplete = "username";
    document.getElementById("local-recovery-fields").hidden = false;
    for (const id of ["recovery-pin", "recovery-new-password", "recovery-confirm-password"]) {
        document.getElementById(id).required = true;
    }
    submitButton.textContent = "Đặt lại mật khẩu";
} else if (!isFirebaseConfigured) {
    document.getElementById("recovery-intro").textContent =
        "Chức năng đặt lại mật khẩu cần Firebase Authentication. Mật khẩu không được lưu trên trình duyệt này.";
}

const emailFromLogin = new URLSearchParams(window.location.search).get("email");
if (emailFromLogin) {
    emailInput.value = emailFromLogin.trim().toLowerCase();
}

form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = emailInput.value.trim().toLowerCase();

    if (!emailInput.validity.valid) {
        showMessage("Vui lòng nhập địa chỉ thư điện tử hợp lệ.");
        emailInput.focus();
        return;
    }
    if (isLocalAuth) {
        if (submitButton.disabled) return;
        const newPassword = document.getElementById("recovery-new-password").value;
        if (newPassword !== document.getElementById("recovery-confirm-password").value) {
            showMessage("Mật khẩu xác nhận không khớp.");
            return;
        }
        submitButton.disabled = true;
        try {
            const legacy = document.getElementById("use-legacy-code").checked;
            await localAuthRequest("reset", {
                email, newPassword, ...(legacy ? { recoveryCode: document.getElementById("recovery-code").value }
                    : { pin: document.getElementById("recovery-pin").value })
            });
            window.FlowerSafeStorage.remove("loggedUser");
            window.FlowerSafeStorage.remove("loggedAdmin");
            document.getElementById("local-reset-result").hidden = false;
            form.hidden = true;
        } catch (error) {
            if (["pin-reset-required", "pin-format-update-required"].includes(error.code)) await openRequiredPinRecovery(email);
            else showMessage(recoveryError(error));
        } finally {
            submitButton.disabled = false;
        }
        return;
    }
    if (!isFirebaseConfigured) {
        showMessage("Chưa thể khôi phục tài khoản. Cửa hàng cần cấu hình Firebase Authentication trước.");
        return;
    }

    submitButton.disabled = true;
    message.textContent = "";
    message.classList.remove("status-error", "status-success");
    try {
        await sendFirebaseResetEmail(email);
        showMessage("Nếu email này đã được đăng ký, bạn sẽ nhận được liên kết đặt lại mật khẩu. Hãy hoàn tất đặt lại mật khẩu để mở lại đăng nhập.", false);
    } catch (error) {
        if (error.code === "auth/user-not-found") {
            showMessage("Nếu email này đã được đăng ký, bạn sẽ nhận được liên kết đặt lại mật khẩu. Hãy hoàn tất đặt lại mật khẩu để mở lại đăng nhập.", false);
        } else showMessage(getFirebaseErrorMessage(error));
    } finally {
        submitButton.disabled = false;
    }
});

if (isLocalAuth) {
    const pinSection = document.getElementById("pin-recovery");
    const questionsForm = document.getElementById("pin-questions-form");
    const pinForm = document.getElementById("pin-recovery-form");
    const pinEmail = document.getElementById("pin-email");
    const pinMessage = document.getElementById("pin-message");
    const backButton = document.getElementById("back-to-password");
    const failedMessage = "Bạn đã nhập sai PIN 5 lần. Còn 0 lượt thử PIN cũ. Hãy trả lời đúng cả 3 câu hỏi và đặt PIN mới.";
    const formatMessage = "PIN hiện tại dùng độ dài cũ. Hãy trả lời đúng cả 3 câu hỏi để đặt PIN mới gồm 4–6 chữ số.";
    const genericMessage = "Hãy trả lời đúng cả 3 câu hỏi và đặt PIN mới gồm 4–6 chữ số để tiếp tục.";
    let requiredMessage = genericMessage;
    let recoveryEmail = "";
    let mandatory = false;
    function setMandatory(value) {
        mandatory = value;
        pinEmail.readOnly = value;
        backButton.hidden = value;
        document.getElementById("pin-recovery-title").textContent = value ? "Bắt buộc đặt PIN mới" : "Quên PIN";
    }
    function pinStatus(text, isError = true) {
        pinMessage.textContent = text;
        pinMessage.classList.toggle("status-error", isError);
        pinMessage.classList.toggle("status-success", !isError);
    }
    document.getElementById("use-legacy-code").addEventListener("change", event => {
        const legacy = event.target.checked;
        document.getElementById("recovery-pin").disabled = legacy;
        document.getElementById("recovery-pin").required = !legacy;
        document.getElementById("recovery-code").disabled = !legacy;
        document.getElementById("recovery-code").required = legacy;
    });
    document.getElementById("forgot-pin").addEventListener("click", () => {
        setMandatory(false);
        form.hidden = true;
        pinSection.hidden = false;
        pinForm.hidden = true;
        pinForm.reset();
        recoveryEmail = "";
        pinStatus("");
        pinEmail.value = emailInput.value;
        pinEmail.focus();
    });
    backButton.addEventListener("click", () => {
        pinSection.hidden = true;
        form.hidden = false;
        emailInput.value = pinEmail.value;
        pinForm.reset();
        emailInput.focus();
    });
    pinEmail.addEventListener("input", () => {
        pinForm.hidden = true;
        pinForm.reset();
        recoveryEmail = "";
        pinStatus("");
    });
    async function loadQuestions() {
        const button = questionsForm.querySelector("button");
        if (button.disabled) return;
        button.disabled = true;
        pinForm.hidden = true;
        pinForm.reset();
        try {
            const email = pinEmail.value.trim().toLowerCase();
            const result = await localAuthRequest("questions", { email });
            if (pinEmail.value.trim().toLowerCase() !== email) return;
            requiredMessage = result.pinResetReason === "pin-format-update-required" ? formatMessage : failedMessage;
            setMandatory(Boolean(result.pinResetRequired));
            recoveryEmail = email;
            document.getElementById("pin-recovery-account").textContent = `Đặt lại PIN cho ${email}`;
            const fields = document.getElementById("pin-answer-fields");
            fields.replaceChildren();
            result.questions.forEach((question, index) => {
                const label = document.createElement("label");
                label.htmlFor = `pin-answer-${index + 1}`;
                label.textContent = `${index + 1}. ${question}`;
                const input = document.createElement("input");
                Object.assign(input, { id: label.htmlFor, type: "password", required: true, minLength: 2, maxLength: 200, autocomplete: "off" });
                fields.append(label, input);
            });
            pinForm.hidden = false;
            pinStatus(mandatory ? requiredMessage : "");
        } catch (error) { pinStatus(`${mandatory ? requiredMessage + " " : ""}${recoveryError(error)}`); }
        finally { button.disabled = false; }
    }
    questionsForm.addEventListener("submit", async event => {
        event.preventDefault();
        await loadQuestions();
    });
    openRequiredPinRecovery = async email => {
        form.hidden = true;
        pinSection.hidden = false;
        pinForm.hidden = true;
        pinForm.reset();
        recoveryEmail = "";
        pinEmail.value = email;
        setMandatory(true);
        requiredMessage = genericMessage;
        pinStatus(requiredMessage);
        const url = new URL(window.location.href);
        url.searchParams.set("email", email);
        url.searchParams.set("recoverPin", "1");
        window.history.replaceState(null, "", url);
        await loadQuestions();
    };
    pinForm.addEventListener("submit", async event => {
        event.preventDefault();
        const button = pinForm.querySelector("button");
        if (button.disabled || !recoveryEmail) return;
        button.disabled = true;
        const email = recoveryEmail;
        const questionsButton = questionsForm.querySelector("button");
        questionsButton.disabled = true;
        try {
            await localAuthRequest("recover-pin", { email,
                answers: [1, 2, 3].map(index => document.getElementById(`pin-answer-${index}`).value),
                newPin: document.getElementById("forgot-new-pin").value,
                confirmPin: document.getElementById("forgot-confirm-pin").value });
            window.FlowerSafeStorage.remove("loggedUser");
            window.FlowerSafeStorage.remove("loggedAdmin");
            emailInput.value = email;
            pinEmail.value = email;
            setMandatory(false);
            document.getElementById("recovery-pin").value = "";
            showMessage("", false);
            const url = new URL(window.location.href);
            url.searchParams.delete("recoverPin");
            window.history.replaceState(null, "", url);
            pinForm.reset();
            pinForm.hidden = true;
            pinStatus("Đã đặt lại PIN. Bạn có thể quay lại đặt mật khẩu bằng PIN mới.", false);
        } catch (error) { pinStatus(recoveryError(error)); }
        finally { button.disabled = false; questionsButton.disabled = false; }
    });
    if (emailInput.value && new URLSearchParams(window.location.search).get("recoverPin") === "1") {
        await openRequiredPinRecovery(emailInput.value);
    }
}
