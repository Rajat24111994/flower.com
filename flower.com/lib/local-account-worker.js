// Crypto and synchronous SQLite run off the HTTP event loop, in one serialized worker.
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");

if (!isMainThread) {
    const accounts = require("./local-accounts").createLocalAccounts(workerData);
    parentPort.on("message", ({ id, method, args }) => {
        try { parentPort.postMessage({ id, result: accounts[method](...args) }); }
        catch (error) { parentPort.postMessage({ id, error: { message: error.message, status: error.status, code: error.code } }); }
    });
} else {
    module.exports.createLocalAccountWorker = (options = {}) => {
        const worker = new Worker(__filename, { workerData: options });
        const pending = new Map();
        let nextId = 0, stopped = false;
        const fail = () => {
            stopped = true;
            for (const { reject } of pending.values()) reject(new Error("Local account worker unavailable"));
            pending.clear();
        };
        worker.on("error", fail);
        worker.on("exit", fail);
        worker.on("message", ({ id, result, error }) => {
            const request = pending.get(id);
            if (!request) return;
            pending.delete(id);
            if (error) request.reject(Object.assign(new Error(error.message), error));
            else request.resolve(result);
        });
        const call = (method, ...args) => {
            if (stopped) return Promise.reject(new Error("Local account worker unavailable"));
            if (pending.size >= 16) return Promise.reject(Object.assign(new Error("Máy chủ bận. Vui lòng thử lại sau."), { status: 429, code: "local-auth-busy" }));
            return new Promise((resolve, reject) => {
                const id = ++nextId;
                pending.set(id, { resolve, reject });
                worker.postMessage({ id, method, args });
            });
        };
        const service = {};
        for (const method of ["register", "login", "reset", "questions", "recoverPin", "changePin", "setupSecurity", "session", "logout"]) {
            service[method] = (...args) => call(method, ...args);
        }
        service.close = async () => { fail(); await worker.terminate(); };
        return service;
    };
}
