// Run inside Firebase emulators:exec. Reuse JS behavioral tests over the current C# host.
const { spawn } = require("node:child_process");
const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");
require("../tests/integration/helpers.js"); // Refuses non-demo projects or absent emulators.
const root = path.resolve(__dirname, "..");
async function main() {
    const listener = net.createServer();
    await new Promise(resolve => listener.listen(0, "127.0.0.1", resolve));
    const port = listener.address().port;
    await new Promise(resolve => listener.close(resolve));
    const url = `http://127.0.0.1:${port}`;
    const env = { ...process.env, ASPNETCORE_ENVIRONMENT: "Development", AUTH_MODE: "firebase",
        FLOWER_FRONTEND_ROOT: path.join(root, "flower.com"), Logging__LogLevel__Default: "Warning" };
    // A restricted Windows test process cannot write the OS Event Log. Keep Console logging;
    // a logging-provider permission failure must not mask the HTTP authentication assertion.
    if (process.platform === "win32") env.Logging__EventLog__LogLevel__Default = "None";
    delete env.PORT;
    const server = spawn("dotnet", [path.join(__dirname, "src/FlowerFlow.Api/bin/Release/net10.0/FlowerFlow.Api.dll"), "--urls", url], {
        cwd: root, env, stdio: ["ignore", "inherit", "inherit"], windowsHide: true
    });
    let startupError;
    server.once("error", error => { startupError = error; });
    try {
        let ready = false;
        for (let attempt = 0; attempt < 150; attempt++) {
            if (startupError) throw startupError;
            if (server.exitCode !== null) throw new Error(`ASP.NET exited (${server.exitCode})`);
            try { const response = await fetch(`${url}/health`); ready = response.ok; if (ready) break; } catch {}
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (!ready) throw new Error("ASP.NET startup timed out; build the solution in Release first.");
        const selected = process.argv.slice(2);
        // These three suites exercise the JS local host/password provider directly. Their
        // C# equivalents are covered by FlowerFlow.Contracts, not this HTTP transport bridge.
        const localOrProvider = new Set(["local-server.test.js", "login-protection.test.js", "security-remediation.test.js"]);
        const suites = selected.length ? selected : fs.readdirSync(path.join(root, "tests/integration"))
            .filter(name => name.endsWith(".test.js") && !localOrProvider.has(name));
        if (suites.some(name => path.basename(name) !== name || !name.endsWith(".test.js"))) throw new Error("Expected integration test filenames.");
        const child = spawn(process.execPath, ["--test", "--test-concurrency=1", ...suites.map(name => path.join(root, "tests/integration", name))], {
            cwd: root, env: { ...process.env, FLOWER_API_URL: url }, stdio: "inherit", windowsHide: true
        });
        process.exitCode = await new Promise((resolve, reject) => {
            child.once("error", reject); child.once("exit", code => resolve(code ?? 1));
        });
    } finally { server.kill(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
