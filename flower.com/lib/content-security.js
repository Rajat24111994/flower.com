const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

// Static HTML uses exact hashes; injected markup cannot obtain a script allowance.
function inlineScriptHashes(root) {
    const hashes = new Set();
    for (const filename of fs.readdirSync(root).filter(name => name.endsWith(".html")).sort()) {
        const html = fs.readFileSync(path.join(root, filename), "utf8").replace(/\r\n?/g, "\n");
        for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
            if (/\bsrc\s*=|\btype\s*=\s*["']application\/(?:ld\+)?json/i.test(match[1]) || !match[2].trim()) continue;
            hashes.add(`'sha256-${createHash("sha256").update(match[2]).digest("base64")}'`);
        }
    }
    return [...hashes].sort();
}
function withScriptHashes(policy, root) {
    return setDirective(policy, "script-src", ["'self'", "https://www.gstatic.com", "https://apis.google.com", ...inlineScriptHashes(root)]);
}
function setDirective(policy, name, sources) {
    const value = `${name} ${sources.join(" ")}`;
    const rules = policy.split(";").map(rule => rule.trim()).filter(Boolean);
    const other = rules.filter(rule => rule.split(/\s+/)[0] !== name);
    const index = rules.findIndex(rule => rule.split(/\s+/)[0] === name);
    other.splice(index < 0 ? other.length : index, 0, value);
    return other.join("; ");
}
function withSecurityPolicy(policy, root) {
    policy = withScriptHashes(policy, root);
    policy = setDirective(policy, "script-src-attr", ["'none'"]);
    policy = setDirective(policy, "style-src", ["'self'", "https://fonts.googleapis.com"]);
    policy = setDirective(policy, "style-src-attr", ["'none'"]);
    return setDirective(policy, "img-src", ["'self'", "data:", "blob:",
        "https://firebasestorage.googleapis.com", "https://storage.googleapis.com",
        "https://*.googleusercontent.com", "https://img.vietqr.io"]);
}
module.exports = { inlineScriptHashes, withScriptHashes, withSecurityPolicy };
