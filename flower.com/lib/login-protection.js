const { randomUUID } = require("node:crypto");

const INITIAL_ATTEMPTS = 5;
const LOCK_MINUTES = [15, 30, 60, 120, 240];
const LEASE_MS = 60_000;

function emptyState(passwordUpdatedAt = 0) {
    return { failures: 0, lockedUntil: 0, resetRequired: false, passwordUpdatedAt };
}

function failureState(state, now) {
    const failures = state.failures + 1;
    const cycle = failures - INITIAL_ATTEMPTS;
    return {
        ...state,
        failures,
        lockedUntil: cycle >= 0 && cycle < LOCK_MINUTES.length
            ? now + LOCK_MINUTES[cycle] * 60_000 : 0,
        resetRequired: cycle >= LOCK_MINUTES.length
    };
}

function restriction(state, now) {
    if (state.resetRequired) return { code: "password-reset-required", status: 403 };
    if (state.lockedUntil > now) {
        return { code: "account-locked", status: 429,
            retryAfter: Math.ceil((state.lockedUntil - now) / 1000) };
    }
    return null;
}

// The transaction serializes password checks across tabs, devices, IPs and server instances.
// A lease recovers after a crashed request. External calls never run inside a transaction.
function createLoginProtection(db, { now = Date.now, uuid = randomUUID } = {}) {
    async function acquire(accountKey, passwordUpdatedAt) {
        const ref = db.collection("loginProtection").doc(accountKey);
        const leaseId = uuid();
        return db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(ref);
            const record = snapshot.exists ? snapshot.data() : emptyState(passwordUpdatedAt);
            const time = now();
            if (record.leaseUntil > time) {
                return { code: "login-in-progress", status: 409, retryAfter: 1 };
            }
            // Only Firebase's server-side password version can clear a lock. Sending a reset
            // email, changing IP, refreshing a page or a client-supplied timestamp cannot.
            const state = passwordUpdatedAt > (record.passwordUpdatedAt || 0)
                ? emptyState(passwordUpdatedAt) : record;
            const blocked = restriction(state, time);
            if (blocked) return blocked;
            transaction.set(ref, {
                ...state, passwordUpdatedAt: Math.max(passwordUpdatedAt, state.passwordUpdatedAt || 0),
                leaseId, leaseUntil: time + LEASE_MS,
                updatedAt: time
            });
            return { ref, leaseId };
        });
    }

    async function finish(attempt, outcome) {
        return db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(attempt.ref);
            const record = snapshot.exists ? snapshot.data() : null;
            const time = now();
            if (!record || record.leaseId !== attempt.leaseId || record.leaseUntil <= time) {
                return { code: "auth-service-unavailable", status: 503 };
            }
            if (outcome === "success") {
                transaction.delete(attempt.ref);
                return { status: 200 };
            }
            const state = outcome === "invalid" ? failureState(record, time) : record;
            transaction.set(attempt.ref, {
                ...state, leaseId: "", leaseUntil: 0, updatedAt: time
            });
            return restriction(state, time) || { code: "invalid-credential", status: 401 };
        });
    }

    return { acquire, finish };
}

module.exports = { createLoginProtection, INITIAL_ATTEMPTS, LOCK_MINUTES, emptyState, failureState, restriction };
