const LOCAL_IDENTITY = Symbol("server-verified-local-identity");
const { sessionCookie } = require("../../lib/local-session");
async function optionalCustomer(req) {
    if (req[LOCAL_IDENTITY]) {
        const { account, presented } = req[LOCAL_IDENTITY];
        if (!account && presented) throw Object.assign(new Error("Invalid local session"), { code: "auth/invalid-session" });
        if (req.headers.authorization) throw Object.assign(new Error("Unexpected bearer token in local mode"), { code: "auth/invalid-session" });
        return account;
    }
    const authorization = String(req.headers.authorization || "");
    if (!authorization) return null;
    const match = authorization.match(/^Bearer\s+(\S+)$/i);
    if (!match) throw Object.assign(new Error("Invalid authorization"), { code: "auth/invalid-session" });
    return require("./firebase-admin").getAdminAuth().verifyIdToken(match[1], true);
}
module.exports = { LOCAL_IDENTITY, sessionCookie, optionalCustomer };
