// Runs the existing behavioral integration suite against ASP.NET over HTTP.
// Invoke inside Firebase emulators:exec; helpers enforce an offline demo project.
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
require("../tests/integration/helpers.js");
const root = path.resolve(__dirname, "..");
const url = "http://127.0.0.1:5181";
const server = spawn("dotnet", [path.join(__dirname, "Flower.Api/bin/Debug/net10.0/Flower.Api.dll"), "--urls", url], {
    cwd: root, env: { ...process.env, ASPNETCORE_ENVIRONMENT: "Development", Logging__LogLevel__Default: "Warning" },
    stdio: ["ignore", "inherit", "inherit"], windowsHide: true
});
async function main() {
    try {
        let ready = false;
        for (let i = 0; i < 100; i++) {
            if (server.exitCode !== null) throw new Error(`ASP.NET exited (${server.exitCode})`);
            try { await fetch(`${url}/api/products`, { method: "OPTIONS" }); ready = true; break; } catch {}
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (!ready) throw new Error("ASP.NET startup timed out");
        const selected = process.argv.slice(2);
        const tests = selected.length ? selected : fs.readdirSync(path.join(root, "tests/integration")).filter(name => name.endsWith(".test.js"));
        const child = spawn(process.execPath, ["--test", "--test-concurrency=1", ...tests.map(name => path.join(root, "tests/integration", name))], {
            cwd: root, env: { ...process.env, FLOWER_API_URL: url }, stdio: "inherit", windowsHide: true
        });
        process.exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
    } finally { server.kill(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; server.kill(); });
