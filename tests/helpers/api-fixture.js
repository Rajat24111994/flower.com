const fs = require('node:fs');
const path = require('node:path');
const { Module, createRequire } = require('node:module');

// Isolate dependency faults without replacing global require or changing production source.
function loadModule(relative, dependencies = {}) {
    const filename = path.resolve(__dirname, '../..', relative);
    const loaded = new Module(filename);
    loaded.filename = filename;
    const realRequire = createRequire(filename);
    loaded.require = name => Object.hasOwn(dependencies, name) ? dependencies[name] : realRequire(name);
    loaded._compile(fs.readFileSync(filename, 'utf8'), filename);
    return loaded.exports;
}

function response() {
    return { statusCode: 200, headers: {}, setHeader(name, value) { this.headers[name] = value; },
        status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

// Only a transaction fixture for deterministic handler failure paths, not a Rules/concurrency emulator.
function memoryDatabase(seed = {}) {
    const records = new Map(Object.entries(seed));
    const writes = [];
    let sequence = 0;
    const snapshot = ref => ({ id: ref.id, exists: records.has(ref.path),
        data: () => records.get(ref.path), get: key => records.get(ref.path)?.[key] });
    const db = {
        records, writes,
        collection(name) {
            const query = { orderBy() { return query; }, limit() { return query; },
                async get() { return { docs: [...records.keys()].filter(key => key.startsWith(name + '/'))
                    .map(key => snapshot({ path: key, id: key.split('/').at(-1) })) }; },
                doc(id = 'generated-' + ++sequence) { const ref = { id, path: name + '/' + id };
                    ref.get = async () => snapshot(ref); return ref; } };
            return query;
        },
        async runTransaction(work) {
            const pending = [];
            const transaction = {
                get: async ref => snapshot(ref), getAll: async (...refs) => refs.map(snapshot),
                set: (ref, data) => pending.push({ type: 'set', ref, data }),
                create: (ref, data) => pending.push({ type: 'create', ref, data }),
                update: (ref, data) => pending.push({ type: 'update', ref, data })
            };
            const result = await work(transaction);
            for (const write of pending) {
                const previous = write.type === 'update' ? records.get(write.ref.path) : {};
                records.set(write.ref.path, { ...previous, ...write.data });
                writes.push(write);
            }
            return result;
        }
    };
    return db;
}

function adminDependency(db) {
    return { getAdminFirestore: () => db, getAdminAuth: () => ({ verifyIdToken: async () => ({ uid: 'buyer' }) }),
        sendError: (res, status, code, error) => res.status(status).json({ code, error }),
        async verifyAdminRequest(req, res) {
            if (req.headers.authorization === 'Bearer admin') return { uid: 'admin', admin: true };
            res.status(403).json({ code: 'permission-denied' }); return null;
        } };
}
async function call(handler, method = 'GET', body = {}, query = {}, authorization) {
    const res = response();
    await handler({ method, body, query, headers: { authorization } }, res);
    return res;
}
module.exports = { loadModule, response, memoryDatabase, adminDependency, call };
