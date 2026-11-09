const { createHmac, randomUUID } = require("node:crypto");

const INVALID_PASSWORD_CODES = new Set(["INVALID_LOGIN_CREDENTIALS", "INVALID_PASSWORD", "EMAIL_NOT_FOUND"]);
const IDENTITY_URL = "https://identitytoolkit.googleapis.com/v1";
let protectionCheck;

function unavailable() {
    const error = new Error("Password authentication is unavailable.");
    error.code = "auth-service-unavailable";
    return error;
}

async function postJson(url, body, headers = {}) {
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
        redirect: "error"
    });
    return { response, data: await response.json() };
}

function configuration() {
    // Emulator flags must never turn off checks on a deployed server.
    const emulator = process.env.FIREBASE_AUTH_EMULATOR_HOST;
    if (emulator && (process.env.VERCEL || process.env.NODE_ENV === "production")) throw unavailable();
    if (emulator && !/^(localhost|127\.0\.0\.1):\d+$/.test(emulator)) throw unavailable();
    const publicKey = process.env.FIREBASE_AUTH_PUBLIC_API_KEY;
    const serverKey = process.env.FIREBASE_AUTH_SERVER_API_KEY;
    if (!emulator && (!publicKey || !serverKey || serverKey === publicKey)) throw unavailable();
    return { emulator, publicKey, serverKey: emulator ? "emulator-key" : serverKey };
}

async function assertPublicPasswordSignInBlocked() {
    const config = configuration();
    if (config.emulator) return;
    const { firebaseConfig } = await import("../js/core/firebase-config.js");
    if (config.publicKey !== firebaseConfig.apiKey) throw unavailable();
    const cacheKey = config.publicKey;
    if (protectionCheck?.key === cacheKey && protectionCheck.expiresAt > Date.now()) {
        return protectionCheck.promise;
    }
    const promise = (async () => {
        // Check both current and legacy entry points. Only an explicit API-method
        // restriction counts; a referrer error, network error or Firebase throttling does not.
        const endpoints = [
            `${IDENTITY_URL}/accounts:signInWithPassword`,
            "https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword"
        ];
        for (const endpoint of endpoints) {
            const { response, data } = await postJson(`${endpoint}?key=${encodeURIComponent(config.publicKey)}`, {
                email: "login-policy-probe@invalid.example", password: randomUUID(), returnSecureToken: true
            });
            const blocked = response.status === 403 && data.error?.details?.some((detail) =>
                detail.reason === "API_KEY_SERVICE_BLOCKED"
                && /(?:SignInWithPassword|VerifyPassword|verifyPassword)$/.test(detail.metadata?.method || ""));
            if (!blocked) throw unavailable();
        }
    })();
    protectionCheck = { key: cacheKey, expiresAt: Date.now() + 60_000, promise };
    try { await promise; }
    catch (error) { protectionCheck = undefined; throw error; }
}

function createPasswordAuth(adminAuth) {
    const config = configuration();
    const base = config.emulator
        ? `http://${config.emulator}/identitytoolkit.googleapis.com/v1` : IDENTITY_URL;

    async function lookup(email) {
        const app = adminAuth.app;
        const token = config.emulator ? "owner" : (await app.options.credential.getAccessToken()).access_token;
        const { response, data } = await postJson(
            `${base}/projects/${encodeURIComponent(app.options.projectId)}/accounts:lookup`,
            { email: [email] }, { Authorization: `Bearer ${token}` }
        );
        if (!response.ok || !Array.isArray(data.users || [])) throw unavailable();
        const user = data.users?.[0];
        if (user) {
            if (!user.localId || !Number.isFinite(Number(user.passwordUpdatedAt || 0))) throw unavailable();
            return { key: user.localId, uid: user.localId,
                passwordUpdatedAt: Number(user.passwordUpdatedAt || 0), disabled: user.disabled === true };
        }
        const secret = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
        if (!secret) throw unavailable();
        return { key: "unknown-" + createHmac("sha256", secret).update(email).digest("hex"), passwordUpdatedAt: 0 };
    }

    async function verifyPassword(email, password, account) {
        const { response, data } = await postJson(
            `${base}/accounts:signInWithPassword?key=${encodeURIComponent(config.serverKey)}`,
            { email, password, returnSecureToken: true }
        );
        if (!response.ok) {
            const code = String(data.error?.message || "").split(" : ")[0];
            if (INVALID_PASSWORD_CODES.has(code)) return false;
            // Outages, quota errors, disabled users and invalid configuration never
            // count as a wrong password. Never expose upstream bodies or credentials.
            throw unavailable();
        }
        if (!account.uid || account.disabled || data.localId !== account.uid || !data.idToken) throw unavailable();
        return true;
    }

    return { lookup, verifyPassword, assertReady: assertPublicPasswordSignInBlocked };
}

module.exports = { createPasswordAuth, assertPublicPasswordSignInBlocked };
