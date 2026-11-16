const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const packageJson = require("../flower.com/package.json");

test("CSP blocks inline scripts/styles and restricts image hosts", () => {
    const config = require("../flower.com/vercel.json");
    const policy = config.headers[0].headers.find(header => header.key === "Content-Security-Policy").value;
    const directives = new Map(policy.split(";").map(rule => rule.trim().split(/\s+/)).map(([name, ...sources]) => [name, sources]));
    for (const name of ["script-src", "style-src"]) {
        assert.ok(!directives.get(name).includes("'unsafe-inline'"), name);
        assert.ok(!directives.get(name).includes("'unsafe-eval'"), name);
    }
    assert.deepEqual(directives.get("script-src-attr"), ["'none'"]);
    assert.deepEqual(directives.get("style-src-attr"), ["'none'"]);
    assert.deepEqual(directives.get("img-src"), ["'self'", "data:", "blob:",
        "https://firebasestorage.googleapis.com", "https://storage.googleapis.com",
        "https://*.googleusercontent.com", "https://img.vietqr.io"]);
});

test("HTML uses external executable scripts and styles without inline handlers", () => {
    const site = path.join(root, "flower.com");
    for (const file of fs.readdirSync(site).filter(file => file.endsWith(".html"))) {
        const html = fs.readFileSync(path.join(site, file), "utf8");
        assert.doesNotMatch(html, /<style\b|\sstyle\s*=|\son\w+\s*=/i, file);
        for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
            if (/application\/(?:ld\+)?json/i.test(match[1])) continue;
            assert.match(match[1], /\bsrc\s*=/, file);
            assert.equal(match[2].trim(), "", file);
        }
    }
});

test("CSP generation removes broad legacy allowances and is deterministic", () => {
    const { withSecurityPolicy } = require("../flower.com/lib/content-security");
    const old = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src https:; script-src-attr 'unsafe-inline'";
    const updated = withSecurityPolicy(old, path.join(root, "flower.com"));
    assert.doesNotMatch(updated, /'unsafe-inline'|img-src https:/);
    assert.equal(withSecurityPolicy(updated, path.join(root, "flower.com")), updated);
    const config = require("../flower.com/vercel.json");
    const current = config.headers[0].headers.find(header => header.key === "Content-Security-Policy").value;
    assert.equal(withSecurityPolicy(current, path.join(root, "flower.com")), current, "regenerate vercel.json with npm run update:csp");
});

test("local environment secrets are ignored and scripts load the local env file", () => {
    const localEnv = spawnSync("git", ["check-ignore", "--quiet", "flower.com/.env"], { cwd: root });
    const envTemplate = spawnSync("git", ["check-ignore", "--quiet", "flower.com/.env.example"], { cwd: root });

    assert.equal(localEnv.status, 0, "flower.com/.env must be ignored");
    assert.equal(envTemplate.status, 1, "flower.com/.env.example must remain trackable");

    for (const script of ["dev", "set-admin", "set-owner", "sync-admin-roles", "setup-firestore", "smoke", "backup", "restore"]) {
        assert.match(packageJson.scripts[script], /^node --env-file-if-exists=\.env /, `${script} must load local environment values`);
    }

    const template = fs.readFileSync(path.join(root, "flower.com/.env.example"), "utf8");
    const values = new Map(
        template.split(/\r?\n/)
            .filter((line) => /^[A-Z_]+=/.test(line))
            .map((line) => {
                const separator = line.indexOf("=");
                return [line.slice(0, separator), line.slice(separator + 1)];
            })
    );
    for (const secret of ["FIREBASE_SERVICE_ACCOUNT_JSON", "VNPAY_TMN_CODE", "VNPAY_HASH_SECRET", "CRON_SECRET"]) {
        assert.equal(values.get(secret), "", `${secret} must not contain a real credential`);
    }
    assert.equal(values.has("BACKUP_PASSPHRASE"), false, "backup passphrases must not be stored in the env file");
});
