// Serialized transactions for fast policy tests. Real Firestore transactions and rules
// are also covered in integration/login-protection.test.js.
function memoryDb() {
    const records = new Map();
    let queue = Promise.resolve();
    const db = {
        records,
        collection: (collection) => ({ doc: (id) => ({ path: `${collection}/${id}` }) }),
        runTransaction(action) {
            const run = queue.then(async () => {
                const pending = new Map();
                const result = await action({
                    async get(ref) {
                        return { exists: records.has(ref.path), data: () => structuredClone(records.get(ref.path)) };
                    },
                    set(ref, value) { pending.set(ref.path, structuredClone(value)); },
                    delete(ref) { pending.set(ref.path, null); }
                });
                for (const [key, value] of pending) {
                    if (value === null) records.delete(key);
                    else records.set(key, value);
                }
                return result;
            });
            queue = run.catch(() => {});
            return run;
        }
    };
    return db;
}

module.exports = { memoryDb };
