// Firestore giả trong bộ nhớ cho unit test các handler API (không cần emulator).
// Hỗ trợ đủ phần mà api/*.js dùng: doc get/set/update/create/delete, collection
// add/where/orderBy/limit/get, runTransaction (get, getAll, set, update, create, delete).
// Hành vi thật của Firestore (rules, index, transaction đồng thời) vẫn do
// tests/integration chạy trên Firebase Emulator kiểm tra.
const path = require("node:path");
const { createRequire } = require("node:module");
// firebase-admin được cài trong flower.com/, nạp từ đó để dùng cùng một bản với API.
const siteRequire = createRequire(path.join(__dirname, "../../flower.com/package.json"));
const { Timestamp } = siteRequire("firebase-admin/firestore");

function resolveValue(value, previous) {
    if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Timestamp)
        && !(value instanceof Date) && value.constructor && value.constructor.name !== "Object") {
        const name = value.constructor.name;
        if (/ServerTimestamp/i.test(name)) return Timestamp.now();
        if (/Increment|NumericIncrement/i.test(name)) return (Number(previous) || 0) + Number(value.operand ?? value._operand ?? 0);
        if (/Delete/i.test(name)) return undefined;
        return value;
    }
    if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Timestamp) && !(value instanceof Date)) {
        const result = {};
        for (const [key, child] of Object.entries(value)) {
            const next = resolveValue(child, previous?.[key]);
            if (next !== undefined) result[key] = next;
        }
        return result;
    }
    return value;
}

function clone(value) {
    if (value instanceof Timestamp || value instanceof Date) return value;
    if (Array.isArray(value)) return value.map(clone);
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)]));
    }
    return value;
}

function compare(a, b) {
    const value = (item) => item instanceof Timestamp ? item.toMillis() : item instanceof Date ? item.getTime() : item;
    const left = value(a), right = value(b);
    if (left === right) return 0;
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    return left < right ? -1 : 1;
}

function fakeFirestore(initial = {}) {
    const records = new Map(Object.entries(initial).map(([path, data]) => [path, clone(data)]));
    let autoId = 0;
    const db = { records };

    const snapshot = (ref) => {
        const data = records.get(ref.path);
        return {
            id: ref.id, ref, exists: data !== undefined,
            data: () => (data === undefined ? undefined : clone(data)),
            get: (field) => field.split(".").reduce((value, key) => value?.[key], data === undefined ? undefined : clone(data))
        };
    };

    function docRef(path) {
        const parts = path.split("/");
        return {
            id: parts.at(-1),
            path,
            collection: (name) => collectionRef(`${path}/${name}`),
            get: async () => snapshot(docRef(path)),
            set: async (data, options) => writeSet(path, data, options),
            update: async (data) => writeUpdate(path, data),
            create: async (data) => writeCreate(path, data),
            delete: async () => { records.delete(path); }
        };
    }

    function query(collectionPath, filters = [], order = [], max = Infinity) {
        const run = () => {
            let docs = [...records.keys()]
                .filter((key) => key.startsWith(`${collectionPath}/`) && !key.slice(collectionPath.length + 1).includes("/"))
                .map((key) => snapshot(docRef(key)));
            for (const [field, op, expected] of filters) {
                docs = docs.filter((doc) => {
                    const actual = field.split(".").reduce((value, key) => value?.[key], doc.data());
                    if (op === "==") return compare(actual, expected) === 0;
                    if (op === "!=") return compare(actual, expected) !== 0;
                    if (op === "<") return actual !== undefined && compare(actual, expected) < 0;
                    if (op === "<=") return actual !== undefined && compare(actual, expected) <= 0;
                    if (op === ">") return actual !== undefined && compare(actual, expected) > 0;
                    if (op === ">=") return actual !== undefined && compare(actual, expected) >= 0;
                    if (op === "in") return expected.some((item) => compare(actual, item) === 0);
                    if (op === "array-contains") return Array.isArray(actual) && actual.includes(expected);
                    throw new Error(`fakeFirestore: toán tử ${op} chưa hỗ trợ`);
                });
            }
            for (const [field, direction] of [...order].reverse()) {
                docs.sort((a, b) => compare(a.data()[field], b.data()[field]) * (direction === "desc" ? -1 : 1));
            }
            docs = docs.slice(0, max);
            return { docs, empty: docs.length === 0, size: docs.length, forEach: (fn) => docs.forEach(fn) };
        };
        return {
            where: (field, op, value) => query(collectionPath, [...filters, [field, op, value]], order, max),
            orderBy: (field, direction = "asc") => query(collectionPath, filters, [...order, [field, direction]], max),
            limit: (count) => query(collectionPath, filters, order, count),
            get: async () => run(),
            _run: run
        };
    }

    function collectionRef(path) {
        return {
            id: path.split("/").at(-1),
            path,
            doc: (id) => docRef(`${path}/${id || `auto-${++autoId}`}`),
            add: async (data) => { const ref = docRef(`${path}/auto-${++autoId}`); writeSet(ref.path, data); return ref; },
            ...query(path)
        };
    }

    function writeSet(path, data, options = {}) {
        const previous = records.get(path);
        const resolved = resolveValue(data, previous);
        records.set(path, options.merge ? { ...(previous || {}), ...resolved } : resolved);
    }
    function writeUpdate(path, data) {
        const previous = records.get(path);
        if (previous === undefined) {
            const error = new Error(`NOT_FOUND: ${path}`);
            error.code = 5;
            throw error;
        }
        const next = clone(previous);
        for (const [key, value] of Object.entries(data)) {
            const keys = key.split(".");
            let target = next;
            for (const part of keys.slice(0, -1)) target = target[part] ??= {};
            const resolved = resolveValue(value, target[keys.at(-1)]);
            if (resolved === undefined) delete target[keys.at(-1)];
            else target[keys.at(-1)] = resolved;
        }
        records.set(path, next);
    }
    function writeCreate(path, data) {
        if (records.has(path)) {
            const error = new Error(`ALREADY_EXISTS: ${path}`);
            error.code = 6;
            throw error;
        }
        writeSet(path, data);
    }

    db.collection = collectionRef;
    db.doc = docRef;
    db.getAll = async (...refs) => refs.map((ref) => snapshot(ref));
    db.runTransaction = async (action) => {
        const writes = [];
        const transaction = {
            get: async (target) => (target._run ? target._run() : snapshot(target)),
            getAll: async (...refs) => refs.map((ref) => snapshot(ref)),
            set: (ref, data, options) => { writes.push(() => writeSet(ref.path, data, options)); return transaction; },
            update: (ref, data) => { writes.push(() => writeUpdate(ref.path, data)); return transaction; },
            create: (ref, data) => { writes.push(() => writeCreate(ref.path, data)); return transaction; },
            delete: (ref) => { writes.push(() => records.delete(ref.path)); return transaction; }
        };
        const result = await action(transaction);
        const backup = new Map([...records].map(([key, value]) => [key, clone(value)]));
        try {
            for (const write of writes) write();
        } catch (error) {
            records.clear();
            for (const [key, value] of backup) records.set(key, value);
            throw error;
        }
        return result;
    };
    db.data = (path) => clone(records.get(path));
    return db;
}

// Auth giả: token "admin-token", "owner-token", "user-token" hoặc token tùy chỉnh.
function fakeAuth(tokens = {}) {
    const known = {
        "admin-token": { uid: "admin-uid", email: "admin@example.test", admin: true },
        "owner-token": { uid: "owner-uid", email: "owner@example.test", admin: true, role: "owner" },
        "user-token": { uid: "user-uid", email: "khach@example.test" },
        ...tokens
    };
    return {
        verifyIdToken: async (token) => {
            if (!known[token]) {
                const error = new Error("invalid token");
                error.code = "auth/argument-error";
                throw error;
            }
            return { ...known[token] };
        }
    };
}

// Thay getAdminAuth/getAdminFirestore trong lib/firebase-admin rồi nạp lại handler.
function loadHandler(relativePath, { db, auth = fakeAuth(), firestoreError, authError } = {}) {
    const root = path.join(__dirname, "../../flower.com");
    const adminLib = require(path.join(root, "lib/firebase-admin.js"));
    adminLib.getAdminFirestore = () => { if (firestoreError) throw firestoreError; return db; };
    adminLib.getAdminAuth = () => { if (authError) throw authError; return auth; };
    for (const key of Object.keys(require.cache)) {
        if (key.startsWith(path.join(root, "api")) || key.startsWith(path.join(root, "lib/routes"))) delete require.cache[key];
    }
    return require(path.join(root, relativePath));
}

async function call(handler, { method = "GET", query = {}, body, token, headers = {} } = {}) {
    const response = { statusCode: 200, headers: {}, body: undefined };
    const res = {
        setHeader(key, value) { response.headers[key.toLowerCase()] = value; },
        getHeader(key) { return response.headers[key.toLowerCase()]; },
        status(code) { response.statusCode = code; return res; },
        json(data) { response.body = JSON.parse(JSON.stringify(data)); return res; },
        send(data) { response.body = data; return res; },
        end(data) { if (data !== undefined) response.body = data; return res; },
        redirect(status, url) { response.statusCode = status; response.headers.location = url; return res; }
    };
    const req = {
        method, query, body,
        headers: { "x-forwarded-for": "203.0.113.9", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
        socket: { remoteAddress: "203.0.113.9" }
    };
    await handler(req, res);
    return { status: response.statusCode, body: response.body, headers: response.headers };
}

// Hồ sơ quyền như trên Firestore thật (adminRoles được kiểm tra cùng claim).
const adminRoles = {
    "adminRoles/admin-uid": { role: "admin" },
    "adminRoles/owner-uid": { role: "owner" }
};

module.exports = { fakeFirestore, fakeAuth, loadHandler, call, adminRoles };
