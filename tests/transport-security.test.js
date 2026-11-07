const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const vercelConfig = require("../flower.com/vercel.json");

const smokeScript = path.join(__dirname, "../flower.com/scripts/smoke-test.js");

test("smoke test refuses insecure and nonstandard-port deployment URLs", () => {
    for (const url of ["http://flowerflow.example", "https://flowerflow.example:8443"]) {
        const result = spawnSync(process.execPath, [smokeScript], {
            env: { ...process.env, SMOKE_URL: url },
            encoding: "utf8"
        });

        assert.equal(result.status, 2, url);
        assert.match(result.stderr, /HTTPS/, url);
    }
});

test("Vercel responses require HTTPS and protect credentials in the browser", () => {
    const headers = vercelConfig.headers.find((rule) => rule.source === "/(.*)").headers;
    const getHeader = (name) => headers.find((header) => header.key.toLowerCase() === name.toLowerCase())?.value || "";
    const hsts = getHeader("Strict-Transport-Security");
    const csp = getHeader("Content-Security-Policy");

    assert.match(hsts, /max-age=31536000/);
    assert.match(hsts, /includeSubDomains/i);
    assert.match(csp, /upgrade-insecure-requests/);
    assert.match(csp, /form-action 'self'/);
});
