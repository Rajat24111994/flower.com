const { getAdminAuth, getAdminFirestore } = require("../lib/firebase-admin");
const { createLoginProtection } = require("../lib/login-protection");
const { createPasswordAuth } = require("../lib/password-auth");

const MESSAGES = {
    "invalid-credential": "Email hoặc mật khẩu không chính xác.",
    "account-locked": "Đăng nhập tạm thời bị khóa do nhiều lần thất bại.",
    "password-reset-required": "Để bảo vệ tài khoản, vui lòng dùng Quên mật khẩu để đặt lại mật khẩu trước khi đăng nhập.",
    "login-in-progress": "Một yêu cầu đăng nhập đang được xử lý. Vui lòng đợi rồi thử lại.",
    "auth-service-unavailable": "Chưa thể đăng nhập lúc này. Vui lòng thử lại sau."
};

// Dependencies are injected for deterministic tests; production always uses Admin SDK
// storage and the real Firebase provider, with no client-selected bypass mode.
function createLoginHandler({ auth, db, provider, protection } = {}) {
    return async (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        const respond = (result) => {
            if (result.retryAfter) res.setHeader("Retry-After", String(result.retryAfter));
            return res.status(result.status).json({ code: result.code, error: MESSAGES[result.code],
                ...(result.retryAfter ? { retryAfter: result.retryAfter } : {}) });
        };
        if (req.method !== "POST") {
            res.setHeader("Allow", "POST");
            return res.status(405).json({ code: "method-not-allowed", error: "Phương thức không được hỗ trợ." });
        }
        const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
        const password = req.body?.password;
        if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
            || typeof password !== "string" || !password || password.length > 4096) {
            return res.status(400).json({ code: "invalid-argument", error: "Vui lòng nhập email và mật khẩu hợp lệ." });
        }
        let attempt;
        let guard;
        try {
            const adminAuth = auth || getAdminAuth();
            const passwordAuth = provider || createPasswordAuth(adminAuth);
            guard = protection || createLoginProtection(db || getAdminFirestore());
            await passwordAuth.assertReady();
            const account = await passwordAuth.lookup(email);
            attempt = await guard.acquire(account.key, account.passwordUpdatedAt);
            if (attempt.code) return respond(attempt);
            const valid = await passwordAuth.verifyPassword(email, password, account);
            const result = await guard.finish(attempt, valid ? "success" : "invalid");
            attempt = null;
            if (result.status !== 200) return respond(result);
            // No upstream ID/refresh token is exposed. A session can only be created
            // after the password check and the serialized policy check both succeed.
            const customToken = await adminAuth.createCustomToken(account.uid);
            return res.status(200).json({ customToken });
        } catch {
            if (attempt?.leaseId && guard) {
                try { await guard.finish(attempt, "unavailable"); } catch { /* lease expires safely */ }
            }
            // Do not log request bodies, passwords, tokens, or upstream responses.
            return respond({ status: 503, code: "auth-service-unavailable" });
        }
    };
}

module.exports = createLoginHandler();
module.exports.createLoginHandler = createLoginHandler;
