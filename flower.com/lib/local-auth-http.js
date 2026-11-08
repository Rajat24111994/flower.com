const COOKIE = "flower_local_session";
const MESSAGES = {
    "invalid-credential": "Tên đăng nhập hoặc mật khẩu không chính xác.",
    "account-locked": "Bạn đã đăng nhập sai nhiều lần. Vui lòng chờ hết thời gian khóa.",
    "password-reset-required": "Tài khoản cần đặt lại mật khẩu. Chọn Quên mật khẩu và nhập PIN của bạn.",
    "invalid-recovery": "Tên đăng nhập hoặc PIN không chính xác.",
    "pin-reset-required": "Bạn đã nhập sai PIN 5 lần. Còn 0 lượt thử PIN cũ. Hãy trả lời đúng 3 câu hỏi và đặt PIN mới để tiếp tục.",
    "pin-format-update-required": "PIN hiện tại dùng độ dài cũ. Hãy trả lời đúng 3 câu hỏi để đặt PIN mới gồm 4–6 chữ số.",
    "invalid-answers": "Thông tin trả lời chưa chính xác. Cần trả lời đúng cả 3 câu hỏi.",
    "invalid-security-proof": "Thông tin tài khoản, mật khẩu hoặc PIN cũ không chính xác.",
    "session-required": "Vui lòng đăng nhập lại trước khi đổi PIN.",
    "security-setup-required": "Tài khoản chưa thiết lập PIN và câu hỏi. Hãy đăng nhập và mở trang Tài khoản để thiết lập.",
    "security-already-configured": "Tài khoản đã có PIN. Hãy dùng chức năng đổi PIN với PIN cũ.",
    "answers-locked": "Bạn đã trả lời sai quá nhiều lần. Vui lòng thử lại sau.",
    "invalid-recovery-code": "Tên đăng nhập hoặc mã khôi phục không chính xác.",
    "recovery-locked": "Bạn đã nhập sai thông tin xác minh quá nhiều lần. Vui lòng thử lại sau."
};

function createLocalAuthHandler(accounts) {
    return (action, req, res) => {
        res.setHeader("Cache-Control", "no-store");
        const cookie = String(req.headers.cookie || "").split(";").map((part) => part.trim())
            .find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
        const setSession = (token = "") => res.setHeader("Set-Cookie",
            `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${token ? 43200 : 0}`);
        const sendResult = (result) => {
            if (result.retryAfter) res.setHeader("Retry-After", String(result.retryAfter));
            if (result.status !== 200) return res.status(result.status).json({ code: result.code,
                error: MESSAGES[result.code] || "Chưa xử lý được yêu cầu.",
                ...(Number.isInteger(result.attemptsRemaining) ? { attemptsRemaining: result.attemptsRemaining } : {}),
                ...(result.retryAfter ? { retryAfter: result.retryAfter } : {}) });
            if (result.sessionToken) setSession(result.sessionToken);
            return res.status(200).json({ ...(result.account ? { account: result.account } : {}),
                ...(result.questions ? { questions: result.questions } : {}),
                ...(result.pinResetRequired ? { pinResetRequired: true, pinResetReason: result.pinResetReason } : {}) });
        };
        if (!["register", "login", "reset", "session", "logout", "questions", "recover-pin", "change-pin", "setup-security"].includes(action)) {
            return res.status(404).json({ code: "not-found", error: "Không tìm thấy chức năng tài khoản." });
        }
        const method = action === "session" ? "GET" : "POST";
        if (req.method !== method) {
            res.setHeader("Allow", method);
            return res.status(405).json({ code: "method-not-allowed", error: "Phương thức không được hỗ trợ." });
        }
        try {
            if (action === "register") return sendResult({ status: 200, ...accounts.register(req.body) });
            if (action === "login") return sendResult(accounts.login(req.body));
            if (action === "questions") return sendResult(accounts.questions(req.body));
            if (action === "change-pin") return sendResult(accounts.changePin(req.body, cookie));
            if (action === "setup-security") return sendResult(accounts.setupSecurity(req.body, cookie));
            if (action === "recover-pin") {
                const result = accounts.recoverPin(req.body);
                if (result.status === 200) setSession();
                return sendResult(result);
            }
            if (action === "reset") {
                const result = accounts.reset(req.body);
                if (result.status === 200) setSession();
                return sendResult(result);
            }
            if (action === "logout") {
                accounts.logout(cookie);
                setSession();
                return res.status(200).json({ ok: true });
            }
            const account = accounts.session(cookie);
            return account ? res.status(200).json({ account })
                : res.status(401).json({ code: "session-required", error: "Vui lòng đăng nhập lại." });
        } catch (error) {
            if ([400, 409].includes(error.status)) return res.status(error.status).json({ code: error.code, error: error.message });
            return res.status(503).json({ code: "local-auth-unavailable", error: "Chưa xử lý được tài khoản. Vui lòng thử lại." });
        }
    };
}

module.exports = { createLocalAuthHandler };
