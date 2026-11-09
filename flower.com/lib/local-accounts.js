const { DatabaseSync } = require("node:sqlite");
const { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { failureState, restriction } = require("./login-protection");

const SESSION_MS = 12 * 60 * 60_000;
const PASSWORD_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SECRET_OPTIONS = { ...PASSWORD_OPTIONS, p: 3 };
const digest = value => createHash("sha256").update(String(value)).digest("hex");
const passwordHash = (value, salt) => scryptSync(value, salt, 32, PASSWORD_OPTIONS);
const secretHash = (value, salt) => scryptSync(value, salt, 32, SECRET_OPTIONS);
const same = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const normalize = value => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const legacyHash = value => digest(String(value || "").replace(/[\s-]/g, "").toUpperCase());
function invalid(code, message, status = 400) { throw Object.assign(new Error(message), { code, status }); }
function username(value) {
    const result = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (result.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(result)) invalid("invalid-username", "Tên đăng nhập cần có @, ví dụ ban@demo.");
    return result;
}
function password(value, minimum = 6) {
    if (typeof value !== "string" || value.length < minimum || value.length > 4096) {
        invalid("invalid-password", minimum === 6 ? "Mật khẩu cần từ 6 đến 4096 ký tự." : "Vui lòng nhập mật khẩu.");
    }
    return value;
}
function pin(value, confirm) {
    if (typeof value !== "string" || !/^[0-9]{4,6}$/.test(value)) invalid("invalid-pin", "PIN chỉ được gồm 4 đến 6 chữ số (0–9).");
    if (confirm !== undefined && value !== confirm) invalid("pin-mismatch", "PIN xác nhận không khớp.");
    return value;
}
function newPin(input) {
    const value = pin(input.newPin ?? input.pin);
    if (value !== input.confirmPin) invalid("pin-mismatch", "PIN xác nhận không khớp.");
    if (value === input.password || value === input.newPassword) invalid("pin-matches-password", "Hãy đặt PIN khác mật khẩu.");
    return value;
}
function profile(input) {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    const phone = typeof input.phone === "string" ? input.phone.trim() : "";
    if (!name || name.length > 120 || !phone || phone.length > 30) invalid("invalid-profile", "Vui lòng nhập đầy đủ họ tên và số điện thoại (tối đa 120 và 30 ký tự).");
    return { name, phone };
}
function securityQuestions(input, account = {}) {
    if (!Array.isArray(input) || input.length !== 3) invalid("invalid-security-questions", "Hãy đặt 3 câu hỏi khác nhau và trả lời đủ cả 3 câu.");
    const titles = [], answers = [], normalizedAnswers = [];
    for (const item of input) {
        const title = typeof item?.question === "string" ? item.question.trim() : "";
        const answer = typeof item?.answer === "string" ? normalize(item.answer) : "";
        if (title.length < 5 || title.length > 160 || answer.length < 6 || answer.length > 200
            || titles.some(other => normalize(other) === normalize(title)) || normalizedAnswers.includes(answer)
            || [account.email, account.name, account.phone, account.password, account.pin, account.newPin].some(value => typeof value === "string" && normalize(value) === answer)
            || /^(.)\1+$|^(?:123456\d*|abcdef\w*|qwerty\w*|password\w*|mat khau|mật khẩu|khong biet|không biết|khong co|không có|\d+)$/u.test(answer)) {
            invalid("invalid-security-questions", "Đặt 3 câu hỏi khác nhau; đáp án cần 6–200 ký tự, khó đoán, không chỉ gồm số và không trùng nhau.");
        }
        titles.push(title);
        normalizedAnswers.push(answer);
    }
    for (const answer of normalizedAnswers) {
        const salt = randomBytes(16);
        answers.push({ salt: salt.toString("hex"), hash: secretHash(answer, salt).toString("hex") });
    }
    return { titles: JSON.stringify(titles), answers: JSON.stringify(answers) };
}
function publicAccount(row) {
    return { uid: row.id, email: row.username, name: row.name || "Khách hàng", phone: row.phone,
        role: "customer", authProvider: "local", securityConfigured: Boolean(row.pin_hash && row.security_answers),
        pinResetRequired: Boolean(row.pin_reset_required || (row.pin_hash && row.pin_format_version < 2)) };
}
function createLocalAccounts({ filename = ":memory:", now = Date.now } = {}) {
    if (filename !== ":memory:") fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(filename);
    db.exec(`PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS local_users (
            id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, phone TEXT NOT NULL,
            password_hash BLOB NOT NULL, salt BLOB NOT NULL, recovery_hash TEXT NOT NULL,
            failures INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0,
            reset_required INTEGER NOT NULL DEFAULT 0, recovery_failures INTEGER NOT NULL DEFAULT 0,
            recovery_locked_until INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS local_sessions (
            token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES local_users(id) ON DELETE CASCADE,
            expires_at INTEGER NOT NULL
        );`);
    // Add columns without replacing existing accounts, password hashes or lockout history.
    transaction(() => {
        const columns = new Set(db.prepare("PRAGMA table_info(local_users)").all().map(row => row.name));
        for (const [column, definition] of Object.entries({ pin_hash: "BLOB", pin_salt: "BLOB", security_questions: "TEXT",
            security_answers: "TEXT", answer_failures: "INTEGER NOT NULL DEFAULT 0", answer_locked_until: "INTEGER NOT NULL DEFAULT 0",
            pin_failures: "INTEGER NOT NULL DEFAULT 0", pin_reset_required: "INTEGER NOT NULL DEFAULT 0",
            pin_format_version: "INTEGER NOT NULL DEFAULT 1" })) {
            if (!columns.has(column)) db.exec(`ALTER TABLE local_users ADD COLUMN ${column} ${definition}`);
        }
        if (!columns.has("pin_failures")) {
            // Carry over the former shared PIN budget; a prior fifth failure now requires questions.
            db.exec(`UPDATE local_users SET pin_failures = MIN(5, recovery_failures),
                pin_reset_required = CASE WHEN recovery_failures >= 5 THEN 1 ELSE 0 END,
                recovery_failures = 0, recovery_locked_until = 0 WHERE pin_hash IS NOT NULL`);
        }
    });
    const userByName = db.prepare("SELECT * FROM local_users WHERE username = ?");
    const dummySalt = randomBytes(16), dummyHash = passwordHash(randomBytes(32).toString("hex"), dummySalt);
    function transaction(action) {
        db.exec("BEGIN IMMEDIATE");
        try { const result = action(); db.exec("COMMIT"); return result; }
        catch (error) { db.exec("ROLLBACK"); throw error; }
    }
    function newSession(user, time) {
        const token = randomBytes(32).toString("base64url");
        db.prepare("DELETE FROM local_sessions WHERE expires_at <= ?").run(time);
        db.prepare("INSERT INTO local_sessions VALUES (?, ?, ?)").run(digest(token), user.id, time + SESSION_MS);
        return token;
    }
    function sessionUser(token) {
        if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
        return db.prepare(`SELECT u.* FROM local_sessions s JOIN local_users u ON u.id = s.user_id
            WHERE s.token_hash = ? AND s.expires_at > ?`).get(digest(token), now());
    }
    function blocked(user, kind = "recovery") {
        const until = user[`${kind}_locked_until`];
        return until > now() ? { status: 429, code: kind === "answer" ? "answers-locked" : "recovery-locked",
            retryAfter: Math.ceil((until - now()) / 1000), attemptsRemaining: 0 } : null;
    }
    function failed(user, code, kind = "recovery") {
        const count = user[`${kind}_locked_until`] ? 1 : user[`${kind}_failures`] + 1;
        const until = count >= 5 ? now() + 15 * 60_000 : 0;
        db.prepare(`UPDATE local_users SET ${kind}_failures = ?, ${kind}_locked_until = ? WHERE id = ?`).run(count, until, user.id);
        return until ? { status: 429, code: kind === "answer" ? "answers-locked" : "recovery-locked", retryAfter: 900, attemptsRemaining: 0 }
            : { status: 401, code, attemptsRemaining: 5 - count };
    }
    function pinRestriction(user) {
        if (user.pin_hash && user.pin_format_version < 2) return { status: 403, code: "pin-format-update-required" };
        return user.pin_reset_required || user.pin_failures >= 5
            ? { status: 403, code: "pin-reset-required", attemptsRemaining: 0 } : null;
    }
    function failedPin(user, code) {
        const failures = Math.min(5, user.pin_failures + 1);
        db.prepare("UPDATE local_users SET pin_failures = ?, pin_reset_required = ? WHERE id = ?")
            .run(failures, Number(failures >= 5), user.id);
        return pinRestriction({ pin_failures: failures }) || { status: 401, code, attemptsRemaining: 5 - failures };
    }
    const verifyPin = (user, value) => same(secretHash(value, user.pin_salt), user.pin_hash);
    function rotateSession(user) {
        db.prepare("DELETE FROM local_sessions WHERE user_id = ?").run(user.id);
        return { status: 200, account: publicAccount(user), sessionToken: newSession(user, now()) };
    }
    function register(input = {}) {
        const email = username(input.email), secret = password(input.password), details = profile(input);
        if (userByName.get(email)) invalid("account-exists", "Tên đăng nhập này đã được sử dụng.", 409);
        const value = newPin(input), questions = securityQuestions(input.questions, input);
        return transaction(() => {
            if (userByName.get(email)) invalid("account-exists", "Tên đăng nhập này đã được sử dụng.", 409);
            const salt = randomBytes(16), pinSalt = randomBytes(16), id = `local-${randomUUID()}`;
            db.prepare(`INSERT INTO local_users (id, username, name, phone, password_hash, salt, recovery_hash,
                pin_hash, pin_salt, security_questions, security_answers, pin_format_version) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, 2)`)
                .run(id, email, details.name, details.phone, passwordHash(secret, salt), salt, secretHash(value, pinSalt), pinSalt, questions.titles, questions.answers);
            const user = userByName.get(email);
            return { account: publicAccount(user), sessionToken: newSession(user, now()) };
        });
    }
    function login(input = {}) {
        const email = username(input.email), secret = password(input.password, 1);
        return transaction(() => {
            const user = userByName.get(email);
            if (!user) { same(passwordHash(secret, dummySalt), dummyHash); return { status: 401, code: "invalid-credential" }; }
            const state = { failures: user.failures, lockedUntil: user.locked_until, resetRequired: Boolean(user.reset_required) };
            const stop = restriction(state, now());
            if (stop) return stop;
            if (!same(passwordHash(secret, user.salt), user.password_hash)) {
                const next = failureState(state, now());
                db.prepare("UPDATE local_users SET failures = ?, locked_until = ?, reset_required = ? WHERE id = ?")
                    .run(next.failures, next.lockedUntil, Number(next.resetRequired), user.id);
                return restriction(next, now()) || { status: 401, code: "invalid-credential" };
            }
            db.prepare("UPDATE local_users SET failures = 0, locked_until = 0, reset_required = 0 WHERE id = ?").run(user.id);
            return { status: 200, account: publicAccount(user), sessionToken: newSession(user, now()) };
        });
    }
    // A username alone must never reveal questions or consume another person's PIN budget.
    // Profile details are an extra barrier, not a replacement for the PIN/three answers.
    function recoveryUser(input) {
        const user = userByName.get(username(input.email));
        const name = typeof input.name === "string" && input.name.length <= 120 ? normalize(input.name) : "";
        const phone = typeof input.phone === "string" && input.phone.length <= 30 ? input.phone.trim() : "";
        return user && name && phone && name === normalize(user.name) && phone === user.phone ? user : null;
    }
    function reset(input = {}) {
        const email = username(input.email), secret = password(input.newPassword);
        const hasPin = input.pin !== undefined;
        if (hasPin) pin(input.pin);
        else if (typeof input.recoveryCode !== "string" || !input.recoveryCode || input.recoveryCode.length > 128) invalid("invalid-pin", "Vui lòng nhập PIN của tài khoản.");
        return transaction(() => {
            const user = recoveryUser(input);
            if (!user) return { status: 401, code: "invalid-recovery" };
            const pinStop = pinRestriction(user); if (pinStop) return pinStop;
            const stop = blocked(user); if (stop) return stop;
            // Legacy random codes are accepted only before PIN enrollment; never alongside an active PIN.
            const verified = user.pin_hash ? hasPin && verifyPin(user, input.pin)
                : !hasPin && Boolean(user.recovery_hash) && same(Buffer.from(legacyHash(input.recoveryCode), "hex"), Buffer.from(user.recovery_hash, "hex"));
            if (!verified) return user.pin_hash ? failedPin(user, "invalid-recovery") : failed(user, "invalid-recovery");
            if (same(passwordHash(secret, user.salt), user.password_hash)) invalid("password-unchanged", "Hãy chọn mật khẩu mới khác mật khẩu cũ.");
            if (user.pin_hash && verifyPin(user, secret)) invalid("pin-matches-password", "Hãy đặt mật khẩu khác PIN.");
            const salt = randomBytes(16);
            db.prepare(`UPDATE local_users SET password_hash = ?, salt = ?, recovery_hash = '', failures = 0,
                locked_until = 0, reset_required = 0, recovery_failures = 0, recovery_locked_until = 0, pin_failures = 0 WHERE id = ?`)
                .run(passwordHash(secret, salt), salt, user.id);
            db.prepare("DELETE FROM local_sessions WHERE user_id = ?").run(user.id);
            return { status: 200 };
        });
    }
    function questions(input = {}) {
        const user = recoveryUser(input);
        if (!user) return { status: 401, code: "invalid-recovery" };
        if (!user.security_questions) return { status: 409, code: "security-setup-required" };
        return blocked(user, "answer") || { status: 200, questions: JSON.parse(user.security_questions),
            ...(pinRestriction(user) ? { pinResetRequired: true, pinResetReason: pinRestriction(user).code } : {}) };
    }
    function recoverPin(input = {}) {
        const email = username(input.email), value = newPin(input);
        if (!Array.isArray(input.answers) || input.answers.length !== 3 || input.answers.some(answer => typeof answer !== "string" || normalize(answer).length < 2 || answer.length > 200)) {
            invalid("invalid-answers", "Vui lòng trả lời đủ cả 3 câu hỏi (2–200 ký tự mỗi câu).");
        }
        return transaction(() => {
            const user = recoveryUser(input);
            if (!user) return { status: 401, code: "invalid-recovery" };
            if (!user.security_answers) return { status: 409, code: "security-setup-required" };
            const stop = blocked(user, "answer"); if (stop) return stop;
            const proofs = JSON.parse(user.security_answers);
            let correct = 1;
            proofs.forEach((proof, index) => { correct &= Number(same(secretHash(normalize(input.answers[index]), Buffer.from(proof.salt, "hex")), Buffer.from(proof.hash, "hex"))); });
            if (!correct) return failed(user, "invalid-answers", "answer");
            if (verifyPin(user, value)) invalid("pin-unchanged", "Hãy chọn PIN mới khác PIN cũ.");
            if (same(passwordHash(value, user.salt), user.password_hash)) invalid("pin-matches-password", "Hãy đặt PIN khác mật khẩu.");
            const salt = randomBytes(16);
            db.prepare(`UPDATE local_users SET pin_hash = ?, pin_salt = ?, recovery_hash = '', recovery_failures = 0,
                recovery_locked_until = 0, answer_failures = 0, answer_locked_until = 0,
                pin_failures = 0, pin_reset_required = 0, pin_format_version = 2 WHERE id = ?`).run(secretHash(value, salt), salt, user.id);
            db.prepare("DELETE FROM local_sessions WHERE user_id = ?").run(user.id);
            return { status: 200 };
        });
    }
    function changePin(input = {}, token) {
        const email = username(input.email), details = profile(input), secret = password(input.password, 1), oldPin = pin(input.oldPin), value = newPin(input);
        return transaction(() => {
            const user = sessionUser(token);
            if (!user) return { status: 401, code: "session-required" };
            if (!user.pin_hash) return { status: 409, code: "security-setup-required" };
            const pinStop = pinRestriction(user); if (pinStop) return pinStop;
            const stop = blocked(user); if (stop) return stop;
            const passwordOk = same(passwordHash(secret, user.salt), user.password_hash), pinOk = verifyPin(user, oldPin);
            if (!pinOk) return failedPin(user, "invalid-security-proof");
            if (!passwordOk || user.username !== email || normalize(details.name) !== normalize(user.name) || details.phone !== user.phone) return failed(user, "invalid-security-proof");
            if (value === oldPin) invalid("pin-unchanged", "Hãy chọn PIN mới khác PIN cũ.");
            const salt = randomBytes(16);
            db.prepare("UPDATE local_users SET pin_hash = ?, pin_salt = ?, recovery_hash = '', recovery_failures = 0, recovery_locked_until = 0, pin_failures = 0 WHERE id = ?")
                .run(secretHash(value, salt), salt, user.id);
            return rotateSession(userByName.get(email));
        });
    }
    function setupSecurity(input = {}, token) {
        const details = profile(input), secret = password(input.password, 1), value = newPin(input);
        return transaction(() => {
            const user = sessionUser(token);
            if (!user) return { status: 401, code: "session-required" };
            if (user.pin_hash) return { status: 409, code: "security-already-configured" };
            const stop = blocked(user); if (stop) return stop;
            if (!same(passwordHash(secret, user.salt), user.password_hash)) return failed(user, "invalid-security-proof");
            const questions = securityQuestions(input.questions, input), salt = randomBytes(16);
            db.prepare(`UPDATE local_users SET name = ?, phone = ?, pin_hash = ?, pin_salt = ?, recovery_hash = '',
                security_questions = ?, security_answers = ?, recovery_failures = 0, recovery_locked_until = 0, pin_format_version = 2 WHERE id = ?`)
                .run(details.name, details.phone, secretHash(value, salt), salt, questions.titles, questions.answers, user.id);
            return rotateSession(userByName.get(user.username));
        });
    }
    function session(token) { const user = sessionUser(token); return user ? publicAccount(user) : null; }
    function logout(token) { db.prepare("DELETE FROM local_sessions WHERE token_hash = ?").run(digest(token || "")); }
    return { register, login, reset, questions, recoverPin, changePin, setupSecurity, session, logout, close: () => db.close() };
}
module.exports = { createLocalAccounts };
