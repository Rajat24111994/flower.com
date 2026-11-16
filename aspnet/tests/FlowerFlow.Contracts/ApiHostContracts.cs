using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Net.Sockets;
using System.Text.Json;

static class ApiHostContracts
{
    public static async Task RunAsync(string root, bool production = false)
    {
        var dll = Path.Combine(root,"aspnet/src/FlowerFlow.Api/bin/Release/net10.0/FlowerFlow.Api.dll");
        AdditionalContracts.Require(File.Exists(dll), "Build the solution in Release before the API host check");
        using var listener = new TcpListener(IPAddress.Loopback, 0); listener.Start(); var port = ((IPEndPoint)listener.LocalEndpoint).Port; listener.Stop();
        var directory = Path.Combine(Path.GetTempPath(), "flowerflow-host-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(directory);
        var start = new ProcessStartInfo("dotnet") { WorkingDirectory = root, RedirectStandardOutput = true, RedirectStandardError = true };
        start.ArgumentList.Add(dll);
        if (!production) { start.ArgumentList.Add("--urls"); start.ArgumentList.Add($"http://127.0.0.1:{port}"); }
        start.Environment["ASPNETCORE_ENVIRONMENT"] = production ? "Production" : "Development"; start.Environment["AUTH_MODE"] = production ? "firebase" : "local";
        start.Environment["LOCAL_ACCOUNTS_FILE"] = Path.Combine(directory,"accounts.sqlite");
        foreach (var key in new[] { "PORT", "FLOWER_FRONTEND_ROOT", "RENDER_EXTERNAL_URL", "PUBLIC_APP_URL", "FIREBASE_SERVICE_ACCOUNT_JSON", "FIREBASE_SERVICE_ACCOUNT_FILE", "FIREBASE_PROJECT_ID", "FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_PUBLIC_API_KEY", "FIREBASE_AUTH_SERVER_API_KEY" }) start.Environment.Remove(key);
        if (production) { start.Environment["PORT"] = port.ToString(); start.Environment["RENDER_EXTERNAL_URL"] = "https://flowerflow-contract.onrender.com"; }
        using var process = Process.Start(start)!; var output = process.StandardOutput.ReadToEndAsync(); var errors = process.StandardError.ReadToEndAsync();
        try
        {
            using var client = new HttpClient(new HttpClientHandler { UseCookies = false }) { BaseAddress = new Uri($"http://127.0.0.1:{port}"), Timeout = TimeSpan.FromSeconds(30) };
            var ready = false;
            for (var attempt = 0; attempt < 150; attempt++)
            {
                if (process.HasExited) break;
                try { using var response = await client.GetAsync("/health"); ready = response.IsSuccessStatusCode; if (ready) break; } catch (HttpRequestException) { }
                await Task.Delay(100);
            }
            AdditionalContracts.Require(ready, "Actual ASP.NET host did not start: " + (process.HasExited ? await errors : "timeout"));
            AdditionalContracts.Require((await client.GetStringAsync("/login.html")).Contains("id=\"signIn\""), "Packaged frontend was not copied correctly");
            if (production)
            {
                using var unavailable = await client.GetAsync("/api/local-auth/session");
                AdditionalContracts.Require(unavailable.StatusCode == HttpStatusCode.NotFound, "Production enabled local account APIs");
                AdditionalContracts.Require(!(await client.GetStringAsync("/login.html")).Contains("/__local/auth-runtime.js"), "Production injected local authentication mode");
                using var request = new HttpRequestMessage(HttpMethod.Post, "/api/login") { Content = JsonContent.Create(new { }) };
                request.Headers.Add("Origin", "https://flowerflow-contract.onrender.com");
                using var result = await client.SendAsync(request); var diagnosticBody = await result.Content.ReadFromJsonAsync<JsonElement>();
                AdditionalContracts.Require(result.StatusCode == HttpStatusCode.BadRequest && diagnosticBody.GetProperty("code").GetString() == "invalid-argument", "Render HTTPS origin was rejected behind its HTTP proxy");
                using var forged = new HttpRequestMessage(HttpMethod.Post, "/api/login") { Content = JsonContent.Create(new { }) };
                forged.Headers.Add("Origin", "https://attacker.invalid"); forged.Headers.Add("X-Forwarded-Proto", "https"); forged.Headers.Add("X-Forwarded-Host", "attacker.invalid");
                using var blocked = await client.SendAsync(forged);
                AdditionalContracts.Require(blocked.StatusCode == HttpStatusCode.Forbidden, "Forwarded headers bypassed production origin validation");
                Console.WriteLine("PASS: production host honors platform PORT, serves packaged frontend and keeps local account APIs disabled; no Firebase connection claimed.");
                return;
            }
            using (var privateQuery = await client.GetAsync("/api/login?token=contract-private-query-do-not-log"))
                AdditionalContracts.Require(privateQuery.StatusCode == HttpStatusCode.MethodNotAllowed, "Login HTTP method contract changed");
            var body = new { email = "host@demo", password = "matkhau123", name = "Khách kiểm tra", phone = "0901234567", pin = "1234", confirmPin = "1234", questions = new[] {
                new { question = "Kỷ niệm đầu tiên?", answer = "hoa phuong do" }, new { question = "Nơi yêu thích nhất?", answer = "doi thong xanh" }, new { question = "Món ăn yêu thích?", answer = "banh cuon nong" } } };
            using var register = await client.PostAsJsonAsync("/api/local-auth/register", body);
            var registered = await register.Content.ReadFromJsonAsync<JsonElement>();
            AdditionalContracts.Require(register.IsSuccessStatusCode && registered.GetProperty("account").GetProperty("authProvider").GetString() == "local", "Actual ASP.NET registration/DI failed: " + registered);
            var cookie = register.Headers.GetValues("Set-Cookie").Single().Split(';')[0];
            using var sessionRequest = new HttpRequestMessage(HttpMethod.Get,"/api/local-auth/session"); sessionRequest.Headers.Add("Cookie",cookie);
            using var session = await client.SendAsync(sessionRequest);
            AdditionalContracts.Require(session.IsSuccessStatusCode, "Actual local session was not persisted");
            foreach (var path in new[] { "orders", "login", "payments", "vnpay-ipn", "products", "design-requests", "product-images", "review-images", "admin/users", "owner/users", "admin/audit", "bouquet-wrapping", "delivery-zones", "flower-prices" })
            {
                using var request = new HttpRequestMessage(HttpMethod.Put, "/api/" + path); request.Headers.Add("Cookie",cookie);
                using var response = await client.SendAsync(request);
                AdditionalContracts.Require((int)response.StatusCode != 500 && response.Content.Headers.ContentType?.MediaType == "application/json", "API dependency graph/routing failed: " + path);
            }
            using var logoutRequest = new HttpRequestMessage(HttpMethod.Post,"/api/local-auth/logout"); logoutRequest.Headers.Add("Cookie",cookie);
            using var logout = await client.SendAsync(logoutRequest); AdditionalContracts.Require(logout.IsSuccessStatusCode, "Actual logout failed");
            using var expiredRequest = new HttpRequestMessage(HttpMethod.Get,"/api/local-auth/session"); expiredRequest.Headers.Add("Cookie",cookie);
            using var expired = await client.SendAsync(expiredRequest); AdditionalContracts.Require(expired.StatusCode == HttpStatusCode.Unauthorized, "Logout retained a valid server-side session");
            Console.WriteLine("PASS: actual API executable starts with packaged frontend, real SQLite registration/session/logout and all migrated endpoint dependency graphs.");
        }
        finally
        {
            if (!process.HasExited) process.Kill(true); await process.WaitForExitAsync(); var logs = await output; var errorLogs = await errors;
            foreach (var file in Directory.EnumerateFiles(directory)) File.Delete(file); Directory.Delete(directory);
            AdditionalContracts.Require(!logs.Contains("contract-private-query-do-not-log") && !errorLogs.Contains("contract-private-query-do-not-log"), "Private query token leaked through ASP.NET request logging");
        }
    }
}
