// Development launcher only. HTTP, authentication and business logic run in ASP.NET Core.
const path = require('node:path');
const { spawn } = require('node:child_process');
const port = Number(process.env.PORT || 3000);
const mode = process.env.AUTH_MODE || 'local';
if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('PORT phải là số nguyên từ 1 đến 65535.'); process.exitCode = 1;
} else if (!['local', 'firebase'].includes(mode)) {
    console.error('AUTH_MODE phải là local hoặc firebase.'); process.exitCode = 1;
} else {
    const root = path.resolve(__dirname, '..');
    const project = path.resolve(root, 'backend/FlowerFlow.Api');
    const child = spawn('dotnet', ['run', '--project', project, '--no-launch-profile'], {
        stdio: 'inherit', windowsHide: true,
        env: { ...process.env, ASPNETCORE_ENVIRONMENT: 'Development', AUTH_MODE: mode, PORT: String(port),
            FLOWER_FRONTEND_ROOT: root, LOCAL_ACCOUNTS_FILE: path.join(root, '.tools/local-auth/accounts.sqlite') }
    });
    child.once('error', () => { console.error('Không thể khởi động ASP.NET Core. Cần cài .NET 10 SDK.'); process.exitCode = 1; });
    child.once('exit', code => { process.exitCode = code ?? 1; });
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
}