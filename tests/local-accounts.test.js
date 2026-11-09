const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { randomUUID } = require("node:crypto");
const { createLocalAccounts } = require("../flower.com/lib/local-accounts");
const profile = () => ({ email: "ban@demo", password: "Mat-khau-thu-123", name: "Người thử", phone: "0900000000", pin: "938405", confirmPin: "938405", questions: [
    { question: "Tên con vật trong truyện tôi thích?", answer: "Cáo xanh" },
    { question: "Món ăn tôi tự nấu lần đầu?", answer: "Canh bí" },
    { question: "Tên nhân vật tôi từng tự vẽ?", answer: "Mây tím" }
] });
function fixture(t) {
    let time = 1_800_000_000_000;
    const accounts = createLocalAccounts({ now: () => time });
    t.after(() => accounts.close());
    const input = profile();
    return { accounts, input, user: accounts.register(input), advance(ms) { time += ms; } };
}
test("stored passwords are salted hashes and reset verifies only the replacement password", (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), `flowerflow-password-${randomUUID()}-`));
    const filename = path.join(directory, "accounts.sqlite");
    const accounts = createLocalAccounts({ filename });
    const inspector = new DatabaseSync(filename);
    t.after(() => {
        inspector.close();
        accounts.close();
        fs.rmSync(directory, { recursive: true, force: true });
    });

    const input = profile();
    const user = accounts.register(input);
    const readStoredHash = () => inspector.prepare("SELECT password_hash, salt FROM local_users WHERE username = ?").get(input.email);
    const original = readStoredHash();
    assert.equal(original.password_hash.length, 32);
    assert.equal(original.salt.length, 16);
    assert.notEqual(original.password_hash.toString("utf8"), input.password);
    assert.equal(accounts.login(input).status, 200);

    const replacement = "Mat-khau-moi-456";
    assert.equal(accounts.reset({
        name: input.name,
        phone: input.phone,
        email: input.email,
        pin: input.pin,
        newPassword: replacement
    }).status, 200);
    const updated = readStoredHash();
    assert.notDeepEqual(updated.password_hash, original.password_hash);
    assert.notEqual(updated.password_hash.toString("utf8"), replacement);
    assert.equal(accounts.session(user.sessionToken), null);
    assert.equal(accounts.login(input).status, 401);
    assert.equal(accounts.login({ ...input, password: replacement }).status, 200);
});
test("registration accepts only four to six ASCII digits and three distinct questions", (t) => {
    const accounts = createLocalAccounts(); t.after(() => accounts.close());
    for (const pin of ["", "123", "1234567", "9384051726", "12a4", "12 4", "12-4", "1e03", "1.23", "１２３４", "١٢٣٤", "1234\n", 1234]) {
        assert.throws(() => accounts.register({ ...profile(), pin, confirmPin: pin }), { code: "invalid-pin" });
    }
    assert.throws(() => accounts.register({ ...profile(), confirmPin: "123456" }), { code: "pin-mismatch" });
    assert.throws(() => accounts.register({ ...profile(), questions: [] }), { code: "invalid-security-questions" });
    assert.throws(() => accounts.register({ ...profile(), questions: Array(3).fill({ question: "Câu hỏi giống nhau?", answer: "Bí mật" }) }), { code: "invalid-security-questions" });
    const user = accounts.register(profile());
    assert.equal(user.account.securityConfigured, true);
    assert.ok(!Object.hasOwn(user, "recoveryCode"));
    assert.throws(() => accounts.register({ ...profile(), email: "BAN@DEMO" }), { code: "account-exists" });
    assert.throws(() => accounts.register({ ...profile(), email: "missing-at" }), { code: "invalid-username" });
    const withZero = { ...profile(), email: "zero@demo", pin: "0123", confirmPin: "0123" };
    accounts.register(withZero);
    assert.equal(accounts.reset({ name: withZero.name, phone: withZero.phone, email: withZero.email, pin: "0123", newPassword: "Another-password" }).status, 200);
});
test("five failures, five increasing lockouts, then mandatory password recovery", (t) => {
    const { accounts, input, advance } = fixture(t);
    const login = (password = "wrong") => accounts.login({ name: input.name, phone: input.phone, email: input.email, password });
    for (let i = 0; i < 4; i++) assert.equal(login().status, 401);
    for (const minutes of [15, 30, 60, 120, 240]) {
        assert.equal(login().retryAfter, minutes * 60); advance(minutes * 60_000 - 1);
        assert.equal(login(input.password).retryAfter, 1); advance(1);
    }
    assert.equal(login().code, "password-reset-required"); advance(365 * 24 * 60 * 60_000);
    assert.equal(login(input.password).code, "password-reset-required");
});
test("successful login clears failure history and client roles are ignored", (t) => {
    const { accounts, input, advance } = fixture(t);
    for (let i = 0; i < 5; i++) accounts.login({ ...input, password: "wrong" });
    advance(15 * 60_000); assert.equal(accounts.login(input).status, 200);
    for (let i = 0; i < 4; i++) assert.equal(accounts.login({ ...input, password: "wrong" }).status, 401);
    assert.equal(accounts.login({ ...input, password: "wrong" }).retryAfter, 900);
    assert.equal(accounts.register({ ...profile(), email: "admin@demo", role: "owner" }).account.role, "customer");
});
test("password reset verifies the PIN, revokes sessions and preserves the PIN", (t) => {
    const { accounts, input, user } = fixture(t);
    const reset = (pin, newPassword = "Mat-khau-moi-456") => accounts.reset({ name: input.name, phone: input.phone, email: input.email, pin, newPassword });
    const wrong = reset("123456");
    assert.equal(wrong.status, 401); assert.equal(wrong.attemptsRemaining, 4);
    assert.equal(reset(input.pin).status, 200);
    assert.equal(accounts.session(user.sessionToken), null);
    assert.equal(accounts.login(input).status, 401);
    assert.equal(accounts.login({ ...input, password: "Mat-khau-moi-456" }).status, 200);
    assert.equal(reset("123456", "Another-password").attemptsRemaining, 4);
    assert.equal(reset(input.pin, "Another-password").status, 200);
});
test("five incorrect PINs require a new PIN and never unlock with time or the correct old PIN", (t) => {
    const { accounts, input, advance } = fixture(t);
    const reset = (pin) => accounts.reset({ name: input.name, phone: input.phone, email: input.email, pin, newPassword: "New-password" });
    for (let remaining = 4; remaining >= 1; remaining--) {
        const result = reset("123456");
        assert.equal(result.status, 401); assert.equal(result.attemptsRemaining, remaining);
    }
    assert.deepEqual(reset("123456"), { status: 403, code: "pin-reset-required", attemptsRemaining: 0 });
    assert.equal(reset(input.pin).code, "pin-reset-required");
    advance(365 * 24 * 60 * 60_000);
    assert.equal(reset(input.pin).code, "pin-reset-required");
    assert.equal(accounts.questions(input).pinResetRequired, true);
    const recovered = accounts.recoverPin({ name: input.name, phone: input.phone, email: input.email, answers: input.questions.map(item => item.answer), newPin: "6273", confirmPin: "6273" });
    assert.equal(recovered.status, 200);
    assert.equal(reset(input.pin).attemptsRemaining, 4);
    assert.equal(reset("6273").status, 200);
});

test("PIN attempts share one budget across password reset and PIN change", t => {
    const { accounts, input, user } = fixture(t);
    const change = { ...input, oldPin: "123456", newPin: "84710", confirmPin: "84710" };
    for (let remaining = 4; remaining >= 1; remaining--) {
        const result = remaining % 2 ? accounts.changePin(change, user.sessionToken)
            : accounts.reset({ name: input.name, phone: input.phone, email: input.email, pin: "123456", newPassword: "New-password" });
        assert.equal(result.attemptsRemaining, remaining);
    }
    assert.equal(accounts.changePin(change, user.sessionToken).code, "pin-reset-required");
    assert.equal(accounts.changePin({ ...change, oldPin: input.pin }, user.sessionToken).code, "pin-reset-required");
    assert.equal(accounts.setupSecurity(input, user.sessionToken).code, "security-already-configured");
    assert.equal(accounts.session(user.sessionToken).pinResetRequired, true);
    assert.throws(() => accounts.recoverPin({ name: input.name, phone: input.phone, email: input.email, answers: input.questions.map(item => item.answer), newPin: input.pin, confirmPin: input.pin }), { code: "pin-unchanged" });
    assert.equal(accounts.session(user.sessionToken).pinResetRequired, true);
});
test("PIN changes require session, full profile, password and old PIN", (t) => {
    const { accounts, input, user } = fixture(t);
    const body = { ...input, oldPin: input.pin, newPin: "84710", confirmPin: "84710" };
    assert.equal(accounts.changePin(body, "forged-session").status, 401);
    for (const change of [{ name: "Sai tên" }, { phone: "000" }, { password: "wrong" }, { oldPin: "123456" }]) {
        const result = accounts.changePin({ ...body, ...change }, user.sessionToken);
        assert.equal(result.status, 401);
        if (change.oldPin) assert.equal(result.attemptsRemaining, 4);
    }
    const changed = accounts.changePin(body, user.sessionToken);
    assert.equal(changed.status, 200); assert.equal(accounts.session(user.sessionToken), null);
    assert.equal(accounts.session(changed.sessionToken).uid, user.account.uid);
    assert.equal(accounts.setupSecurity(input, changed.sessionToken).code, "security-already-configured");
    assert.equal(accounts.reset({ name: input.name, phone: input.phone, email: input.email, pin: input.pin, newPassword: "New-password" }).status, 401);
    assert.equal(accounts.reset({ name: input.name, phone: input.phone, email: input.email, pin: body.newPin, newPassword: "New-password" }).status, 200);
});
test("forgotten PIN requires all three answers and does not bypass password locks", (t) => {
    const { accounts, input, user } = fixture(t);
    assert.deepEqual(accounts.questions({ name: input.name, phone: input.phone, email: input.email }).questions, input.questions.map(item => item.question));
    const answers = input.questions.map(item => item.answer);
    const body = { name: input.name, phone: input.phone, email: input.email, answers, newPin: "6273", confirmPin: "6273" };
    assert.equal(accounts.recoverPin({ ...body, answers: [answers[0], "Sai", answers[2]] }).status, 401);
    for (let i = 0; i < 5; i++) accounts.login({ name: input.name, phone: input.phone, email: input.email, password: "wrong" });
    assert.equal(accounts.recoverPin({ ...body, answers: answers.map(answer => "  " + answer.toUpperCase() + "  ") }).status, 200);
    assert.equal(accounts.session(user.sessionToken), null); assert.equal(accounts.login(input).code, "account-locked");
    assert.equal(accounts.reset({ name: input.name, phone: input.phone, email: input.email, pin: body.newPin, newPassword: "New-password" }).status, 200);
    assert.equal(accounts.login({ name: input.name, phone: input.phone, email: input.email, password: "New-password" }).status, 200);
});
test("five wrong sets of answers lock PIN recovery for fifteen minutes", (t) => {
    const { accounts, input, advance } = fixture(t);
    const body = { name: input.name, phone: input.phone, email: input.email, answers: ["Sai một", "Sai hai", "Sai ba"], newPin: "6273", confirmPin: "6273" };
    for (let remaining = 4; remaining >= 1; remaining--) {
        const result = accounts.recoverPin(body);
        assert.equal(result.status, 401); assert.equal(result.attemptsRemaining, remaining);
    }
    const blocked = accounts.recoverPin(body);
    assert.equal(blocked.status, 429); assert.equal(blocked.attemptsRemaining, 0);
    const valid = { ...body, answers: input.questions.map(item => item.answer) };
    assert.equal(accounts.recoverPin(valid).status, 429); advance(15 * 60_000);
    assert.equal(accounts.recoverPin(valid).status, 200);
});
test("logout and session expiry invalidate sessions", (t) => {
    const { accounts, input, user, advance } = fixture(t);
    accounts.logout(user.sessionToken); assert.equal(accounts.session(user.sessionToken), null);
    const logged = accounts.login(input); advance(13 * 60 * 60_000);
    assert.equal(accounts.session(logged.sessionToken), null);
});
test("accounts, secret hashes and lockouts persist across restarts", (t) => {
    const folder = path.join(__dirname, "../flower.com/.tools/local-account-tests"); fs.mkdirSync(folder, { recursive: true });
    const filename = path.join(folder, "pins-" + require("node:crypto").randomUUID() + ".sqlite");
    const first = createLocalAccounts({ filename }); const input = profile(); const user = first.register(input);
    for (let i = 0; i < 5; i++) {
        first.login({ ...input, password: "wrong" });
        first.reset({ name: input.name, phone: input.phone, email: input.email, pin: "123456", newPassword: "New-password" });
    }
    first.close();
    const bytes = fs.readFileSync(filename).toString("utf8");
    for (const secret of [input.password, input.pin, ...input.questions.map(item => item.answer)]) assert.ok(!bytes.includes(secret));
    const reopened = createLocalAccounts({ filename }); t.after(() => reopened.close());
    assert.equal(reopened.login(input).code, "account-locked");
    assert.equal(reopened.session(user.sessionToken).securityConfigured, true);
    assert.equal(reopened.session(user.sessionToken).pinResetRequired, true);
    assert.equal(reopened.reset({ name: input.name, phone: input.phone, email: input.email, pin: input.pin, newPassword: "New-password" }).code, "pin-reset-required");
});

test("legacy schema preserves accounts and locks; enrolling a PIN disables the old recovery code", t => {
    const { DatabaseSync } = require("node:sqlite");
    const { randomBytes, scryptSync, createHash, randomUUID } = require("node:crypto");
    const folder = path.join(__dirname, "../flower.com/.tools/local-account-tests"); fs.mkdirSync(folder, { recursive: true });
    const filename = path.join(folder, "legacy-" + randomUUID() + ".sqlite");
    const input = profile(), salt = randomBytes(16), code = "ABCD-1234-ABCD-1234", time = 1_800_000_000_000;
    const hash = value => createHash("sha256").update(value).digest("hex");
    const legacy = new DatabaseSync(filename);
    legacy.exec(`CREATE TABLE local_users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, phone TEXT NOT NULL,
        password_hash BLOB NOT NULL, salt BLOB NOT NULL, recovery_hash TEXT NOT NULL, failures INTEGER NOT NULL DEFAULT 0,
        locked_until INTEGER NOT NULL DEFAULT 0, reset_required INTEGER NOT NULL DEFAULT 0,
        recovery_failures INTEGER NOT NULL DEFAULT 0, recovery_locked_until INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE local_sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL);`);
    const secret = scryptSync(input.password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    legacy.prepare("INSERT INTO local_users (id, username, name, phone, password_hash, salt, recovery_hash, failures, locked_until) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run("legacy", input.email, input.name, input.phone, secret, salt, hash(code.replace(/-/g, "")), 5, time + 900_000);
    const token = randomBytes(32).toString("base64url");
    legacy.prepare("INSERT INTO local_sessions VALUES (?, ?, ?)").run(hash(token), "legacy", time + 3_600_000);
    legacy.prepare("INSERT INTO local_users (id, username, name, phone, password_hash, salt, recovery_hash) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run("legacy-code", "oldcode@demo", input.name, input.phone, secret, salt, hash(code.replace(/-/g, "")));
    legacy.close();
    const accounts = createLocalAccounts({ filename, now: () => time }); t.after(() => accounts.close());
    assert.equal(accounts.session(token).securityConfigured, false);
    assert.equal(accounts.login(input).code, "account-locked");
    assert.equal(accounts.questions(input).code, "security-setup-required");
    assert.equal(accounts.setupSecurity({ ...input, password: "wrong" }, token).status, 401);
    const enrolled = accounts.setupSecurity(input, token);
    assert.equal(enrolled.account.securityConfigured, true);
    assert.equal(accounts.session(token), null);
    assert.equal(accounts.login(input).code, "account-locked");
    assert.equal(accounts.reset({ name: input.name, phone: input.phone, email: input.email, recoveryCode: code, newPassword: "New-password" }).status, 401);
    assert.equal(accounts.reset({ name: input.name, phone: input.phone, email: input.email, pin: input.pin, newPassword: "New-password" }).status, 200);
    const legacyReset = { name: input.name, phone: input.phone, email: "oldcode@demo", recoveryCode: code, newPassword: "New-password" };
    assert.equal(accounts.reset(legacyReset).status, 200);
    assert.equal(accounts.reset({ ...legacyReset, newPassword: "Next-password" }).status, 401);
    const recovered = accounts.login({ email: legacyReset.email, password: legacyReset.newPassword });
    assert.equal(recovered.account.securityConfigured, false);
    assert.equal(accounts.setupSecurity({ ...input, password: legacyReset.newPassword }, recovered.sessionToken).account.securityConfigured, true);
});

test("migration preserves previous PIN failure budgets and promotes prior fifth failures to mandatory recovery", t => {
    const { DatabaseSync } = require("node:sqlite");
    const filename = path.join(__dirname, "../flower.com/.tools/local-account-tests", "pin-budget-" + require("node:crypto").randomUUID() + ".sqlite");
    const input = profile();
    const original = createLocalAccounts({ filename });
    const user = original.register(input);
    const other = original.register({ ...input, email: "blocked@demo" });
    original.close();
    const db = new DatabaseSync(filename);
    // Reproduce the schema and shared counters used before mandatory PIN recovery.
    db.exec("ALTER TABLE local_users DROP COLUMN pin_failures; ALTER TABLE local_users DROP COLUMN pin_reset_required;");
    db.prepare("UPDATE local_users SET recovery_failures = 4 WHERE id = ?").run(user.account.uid);
    db.prepare("UPDATE local_users SET recovery_failures = 5, recovery_locked_until = ? WHERE id = ?").run(Date.now() + 900_000, other.account.uid);
    db.close();
    const migrated = createLocalAccounts({ filename }); t.after(() => migrated.close());
    assert.equal(migrated.reset({ name: input.name, phone: input.phone, email: input.email, pin: "123456", newPassword: "New-password" }).code, "pin-reset-required");
    assert.equal(migrated.reset({ name: input.name, phone: input.phone, email: "blocked@demo", pin: input.pin, newPassword: "New-password" }).code, "pin-reset-required");
    assert.equal(migrated.session(user.sessionToken).pinResetRequired, true);
    const logged = migrated.login(input);
    assert.equal(logged.status, 200); assert.equal(logged.account.pinResetRequired, true);
});

test("accounts with an old long PIN must answer their questions to adopt a numeric four-to-six-digit PIN", t => {
    const { DatabaseSync } = require("node:sqlite");
    const { randomBytes, randomUUID, scryptSync } = require("node:crypto");
    const filename = path.join(__dirname, "../flower.com/.tools/local-account-tests", "short-pin-" + randomUUID() + ".sqlite");
    const input = profile(), original = createLocalAccounts({ filename });
    const user = original.register(input); original.close();
    const db = new DatabaseSync(filename), salt = randomBytes(16);
    const oldHash = scryptSync("9384051726", salt, 32, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 });
    db.prepare("UPDATE local_users SET pin_hash = ?, pin_salt = ? WHERE id = ?").run(oldHash, salt, user.account.uid);
    db.exec("ALTER TABLE local_users DROP COLUMN pin_format_version"); db.close();
    const migrated = createLocalAccounts({ filename }); t.after(() => migrated.close());
    assert.equal(migrated.session(user.sessionToken).pinResetRequired, true);
    assert.equal(migrated.questions(input).pinResetReason, "pin-format-update-required");
    assert.equal(migrated.reset({ name: input.name, phone: input.phone, email: input.email, pin: "1234", newPassword: "New-password" }).code, "pin-format-update-required");
    assert.equal(migrated.changePin({ ...input, oldPin: "1234", newPin: "84710", confirmPin: "84710" }, user.sessionToken).code, "pin-format-update-required");
    const answers = input.questions.map(item => item.answer);
    assert.equal(migrated.recoverPin({ name: input.name, phone: input.phone, email: input.email, answers: ["Sai một", "Sai hai", "Sai ba"], newPin: "0123", confirmPin: "0123" }).status, 401);
    assert.equal(migrated.recoverPin({ name: input.name, phone: input.phone, email: input.email, answers, newPin: "0123", confirmPin: "0123" }).status, 200);
    assert.equal(migrated.session(user.sessionToken), null);
    assert.equal(migrated.login(input).account.pinResetRequired, false);
    assert.equal(migrated.reset({ name: input.name, phone: input.phone, email: input.email, pin: "0123", newPassword: "New-password" }).status, 200);
});
