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
    return policy.replace(/script-src\s+[^;]+/, `script-src 'self' https://www.gstatic.com https://apis.google.com ${inlineScriptHashes(root).join(" ")}`);
}
module.exports = { inlineScriptHashes, withScriptHashes };
