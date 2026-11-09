import { isLocalAuth, localAuthRequest, persistLocalAccount } from "./local-auth-client.js?v=2";

const subscribers = new Set();
let started = false, expired = false, generation = 0, inFlight, deadlineTimer;
let verifiedUid = "";

function storedAccount() {
    return window.FlowerSafeStorage.readJson("loggedUser", { fallback: null });
}

export function invalidateLocalSession(reason = "expired") {
    if (!isLocalAuth) return;
    const hadAccount = Boolean(verifiedUid || storedAccount());
    generation++;
    expired = true;
    verifiedUid = "";
    clearTimeout(deadlineTimer);
    window.FlowerSafeStorage.remove("loggedUser");
    window.FlowerSafeStorage.remove("loggedAdmin");
    window.FlowerSafeStorage.syncShoppingOwner?.();
    for (const key of ["flowerCheckout", "flowerPendingOrder"]) window.FlowerSafeStorage.remove(key, { storage: "session" });
    if (hadAccount) {
        window.dispatchEvent(new CustomEvent("flowersessionexpired", { detail: { reason } }));
        for (const subscriber of subscribers) subscriber.onExpired?.(reason);
    }
}

function accept(account) {
    if (!account?.uid || account.authProvider !== "local" || !Number.isSafeInteger(account.sessionExpiresAt)) {
        invalidateLocalSession();
        return;
    }
    expired = false;
    verifiedUid = account.uid;
    persistLocalAccount(account);
    clearTimeout(deadlineTimer);
    deadlineTimer = setTimeout(() => invalidateLocalSession(), Math.max(0, Math.min(2147483647, account.sessionExpiresAt - Date.now())));
    for (const subscriber of subscribers) subscriber.onVerified?.(account);
}

async function check(force = false) {
    if (expired) return null;
    if (force) { generation++; inFlight = null; }
    if (inFlight) return inFlight;
    const requestedGeneration = generation;
    const pending = (async () => {
        try {
            const result = await localAuthRequest("session");
            if (requestedGeneration !== generation || expired) return null;
            accept(result.account);
            return result.account;
        } catch (error) {
            if (requestedGeneration === generation && !expired) invalidateLocalSession(error.status === 401 ? "expired" : "unavailable");
            return null;
        } finally {
            if (inFlight === pending) inFlight = null;
        }
    })();
    inFlight = pending;
    return pending;
}

export function monitorLocalSession(subscriber = {}) {
    if (!isLocalAuth) return null;
    subscribers.add(subscriber);
    if (subscriber.initialAccount) accept(subscriber.initialAccount);
    if (!started) {
        started = true;
        window.FlowerLocalSession = { check, expire: invalidateLocalSession };
        setInterval(() => { if (!document.hidden) void check(); }, 60000);
        window.addEventListener("focus", () => { void check(true); });
        window.addEventListener("pageshow", event => { if (event.persisted) void check(true); });
        document.addEventListener("visibilitychange", () => { if (!document.hidden) void check(true); });
        window.addEventListener("flowerlocalauthinvalid", () => invalidateLocalSession());
        window.addEventListener("storage", event => {
            if (event.key !== "loggedUser" && event.key !== null) return;
            if (!storedAccount()) { invalidateLocalSession(); return; }
            // Discard any response started before another tab changed accounts.
            expired = false;
            void check(true);
        });
    }
    if (!subscriber.initialAccount) void check();
    return window.FlowerLocalSession;
}
