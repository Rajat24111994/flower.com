const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const packageJson = require("../flower.com/package.json");

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
