const SESSION_SECONDS = 12 * 60 * 60;
const SESSION_MS = SESSION_SECONDS * 1000;
const SESSION_COOKIE = "flower_local_session";

function sessionCookies(req) {
    const cookies = String(req.headers.cookie || "").split(";").map(part => part.trim())
        .filter(part => part.startsWith(`${SESSION_COOKIE}=`)).map(part => part.slice(SESSION_COOKIE.length + 1));
    return cookies;
}
function sessionCookie(req) {
    const cookies = sessionCookies(req);
    // Reject ambiguous cookies rather than letting a second path/domain choose an identity.
    return cookies.length > 1 ? "" : cookies[0];
}

function setSessionCookie(req, res, token = "") {
    const secure = req.socket?.encrypted === true;
    const expires = token ? new Date(Date.now() + SESSION_MS) : new Date(0);
    res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token ? SESSION_SECONDS : 0}; Expires=${expires.toUTCString()}${secure ? "; Secure" : ""}`);
}

module.exports = { SESSION_SECONDS, SESSION_MS, SESSION_COOKIE, sessionCookies, sessionCookie, setSessionCookie };
