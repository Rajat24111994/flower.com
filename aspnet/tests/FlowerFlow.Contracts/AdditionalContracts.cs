using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;
using FlowerFlow.Application.Catalog;
using FlowerFlow.Infrastructure.Http;
using Microsoft.AspNetCore.Http;
using FlowerFlow.Infrastructure.Firebase;
using FlowerFlow.Application.Payments;
using FlowerFlow.Application.Orders;
using FlowerFlow.Application.Compatibility;
using FlowerFlow.Infrastructure.Orders;
using Google.Cloud.Firestore;
using FlowerFlow.Infrastructure.DesignRequests;
using FlowerFlow.Infrastructure.Local;

static class AdditionalContracts
{
    public static async Task ContentSecurityAsync(string root)
    {
        using var expected = await OracleAsync(root, "content-security-oracle.cjs");
        var htmlRoot = Path.Combine(root, "flower.com");
        Require(JsonNode.DeepEquals(JsonSerializer.SerializeToNode(ContentSecurity.InlineScriptHashes(htmlRoot)), JsonNode.Parse(expected.RootElement.GetProperty("hashes").GetRawText())), "Inline CSP hashes differ from actual Node HTML scan");
        Require(ContentSecurity.WithSecurityPolicy("default-src 'none'; script-src old; connect-src test; script-src duplicate", htmlRoot) == expected.RootElement.GetProperty("policy").GetString(), "CSP directive replacement differs from Node");
        Console.WriteLine("PASS: exact inline script hashes and CSP directive ordering match Node across the unchanged frontend.");
    }
    public static async Task LocalRateLimitAsync(string root)
    {
        using var cases = await OracleAsync(root, "local-rate-limit-oracle.cjs");
        long now = 0; var limit = new LocalRateLimit(() => now, 2);
        foreach (var test in cases.RootElement.EnumerateArray())
        {
            now = test.GetProperty("now").GetInt64();
            Require(limit.Check(test.GetProperty("key").GetString()!, test.GetProperty("maximum").GetInt32(), test.GetProperty("duration").GetInt64())
                == test.GetProperty("expected").GetInt32(), "Local rate limit differs from Node");
        }
        var concurrent = new LocalRateLimit(); var allowed = 0;
        Parallel.For(0, 100, _ => { if (concurrent.Check("same", 5, 60_000) == 0) Interlocked.Increment(ref allowed); });
        Require(allowed == 5, "Concurrent local rate limit exceeded its budget");
        Require(FirestoreWrites.Normalize(-0d) is double, "Negative zero lost its Firestore double type");
        Console.WriteLine("PASS: local rate limit matches Node expiry/rounding/capacity and concurrent calls remain bounded.");
    }
    public static void LocalSessionCookies()
    {
        var context = new DefaultHttpContext(); context.Request.Headers.Cookie = new Microsoft.Extensions.Primitives.StringValues(
            new[] { "flower_local_session=one", "flower_local_session=two" });
        Require(LocalSession.SessionCookie(context) == "" && LocalSession.SessionCookies(context).Count == 2, "Repeated Cookie headers selected an identity");
        context.Request.Headers.Cookie = "other=1; flower_local_session=token";
        Require(LocalSession.SessionCookie(context) == "token", "Local session cookie parsing changed");
        context.Request.Scheme = "https"; LocalSession.SetSessionCookie(context, "token", DateTimeOffset.Parse("2026-11-15T00:00:00Z"));
        Require(context.Response.Headers.SetCookie == "flower_local_session=token; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200; Expires=Sun, 15 Nov 2026 12:00:00 GMT; Secure", "Session cookie policy changed");
        LocalSession.SetSessionCookie(context);
        Require(context.Response.Headers.SetCookie.ToString().Contains("Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT"), "Session logout cookie not expired");
        Console.WriteLine("PASS: local session cookie ambiguity, HTTP-only strict policy, 12-hour expiry and secure/logout attributes.");
    }

    public static async Task CheckoutFingerprintsAsync(string root)
    {
        using var cases = await OracleAsync(root, "checkout-fingerprint-oracle.cjs");
        foreach (var test in cases.RootElement.GetProperty("fingerprints").EnumerateArray())
        {
            var body = test.GetProperty("body"); var normalized = OrderValidation.ValidateCheckout(body)!;
            Require(Checkout.RequestHash(normalized, Js.StringOrEmpty(Js.Get(body, "orderNote")).Trim(), "user-a") == test.GetProperty("expected").GetString(),
                "Checkout SHA-256 request fingerprint differs from Node");
        }
        foreach (var test in cases.RootElement.GetProperty("raw").EnumerateArray())
        {
            using var input = JsonDocument.Parse(test.GetProperty("input").GetString()!);
            Require(JsJson.Stringify(input.RootElement) == test.GetProperty("expected").GetString(), "JSON.stringify compatibility changed");
        }
        Console.WriteLine("PASS: checkout fingerprint and JSON.stringify parity including Unicode/control escapes, integer keys and duplicate keys.");
    }

    public static async Task DesignValidationAsync(string root)
    {
        using var cases = await OracleAsync(root, "design-validation-oracle.cjs"); var count = 0;
        foreach (var test in cases.RootElement.EnumerateArray())
        {
            var input = test.GetProperty("input"); object? result = null; var failed = false;
            try
            {
                result = test.GetProperty("method").GetString() switch
                {
                    "design" => DesignValidation.ParseDesign(input), "stems" => DesignValidation.NormalizeStems(input),
                    "image" => DesignValidation.ValidImage(input), "token" => DesignValidation.ValidAccessToken(Js.Get(input, "token"), Js.Get(input, "hash")),
                    _ => throw new Exception("Unknown design test")
                };
            }
            catch (InvalidOperationException) { failed = true; }
            if (test.TryGetProperty("exception", out _)) Require(failed, "Design null behavior differs from JS");
            else Require(!failed && JsonNode.DeepEquals(JsonSerializer.SerializeToNode(result), JsonNode.Parse(test.GetProperty("expected").GetRawText())),
                $"Design validation case {count} differs from JS: {input}"); count++;
        }
        Console.WriteLine($"PASS: {count} design choices, stems, image signatures and access token scenarios matched JS.");
    }

    public static async Task TrackingAsync(string root)
    {
        using var cases = await OracleAsync(root, "tracking-oracle.cjs"); var count = 0;
        static object? Hydrate(JsonElement value)
        {
            if (value.ValueKind == JsonValueKind.Object && value.TryGetProperty("_seconds", out var seconds)
                && value.TryGetProperty("_nanoseconds", out var nanos))
                return Timestamp.FromProto(new Google.Protobuf.WellKnownTypes.Timestamp { Seconds = seconds.GetInt64(), Nanos = nanos.GetInt32() });
            return value.ValueKind switch
            {
                JsonValueKind.Object => value.EnumerateObject().ToDictionary(property => property.Name, property => Hydrate(property.Value)!),
                JsonValueKind.Array => value.EnumerateArray().Select(Hydrate).ToList(), _ => Js.Object(value)
            };
        }
        foreach (var test in cases.RootElement.EnumerateArray())
        {
            var data = (Dictionary<string, object>)Hydrate(test.GetProperty("data"))!;
            var actual = test.GetProperty("type").GetString() == "public" ? OrderTracking.PublicTrackingOrder("order-a", data) : OrderTracking.AccountTrackingOrder("order-a", data);
            Require(JsonNode.DeepEquals(JsonSerializer.SerializeToNode(FirestoreValues.JsonCompatible(actual)), JsonNode.Parse(test.GetProperty("expected").GetRawText())),
                "Tracking privacy/timestamp format differs from JS"); count++;
        }
        Console.WriteLine($"PASS: {count} public/account tracking, payment/refund privacy and rounded timestamp cases matched JS.");
    }

    public static async Task PricingAsync(string root)
    {
        using var cases = await OracleAsync(root, "order-pricing-oracle.cjs"); var count = 0;
        foreach (var test in cases.RootElement.EnumerateArray())
        {
            var input = test.GetProperty("input"); object? result = null; BackendException? error = null;
            List<Dictionary<string, object>> Items() => (Js.Object(Js.Get(input, "items")) as List<object?> ?? [])
                .Select(item => (Dictionary<string, object>)item!).ToList();
            try
            {
                result = test.GetProperty("method").GetString() switch
                {
                    "price" => OrderPricing.GetProductPrice(input),
                    "cart" => OrderPricing.PriceCart(Items(), Js.Object(Js.Get(input, "promotion")) as Dictionary<string, object>),
                    "promotion" => OrderPricing.FindPromotion(Js.Get(input, "promotions"), Js.Get(input, "id").GetString(), DateTimeOffset.Parse("2026-11-15T12:00:00Z")),
                    "aggregate" => OrderPricing.AggregateItems(Js.Get(input, "items")),
                    "bouquets" => OrderPricing.CalculateCustomBouquets(Items(), Js.Get(input, "tiers")),
                    _ => throw new Exception("Unknown pricing test")
                };
            }
            catch (BackendException failure) { error = failure; }
            if (test.TryGetProperty("code", out var code))
                Require(error is not null && error.Code == code.GetString() && error.Message == test.GetProperty("message").GetString(), "Pricing business error differs from JS");
            else Require(error is null && JsonNode.DeepEquals(JsonSerializer.SerializeToNode(result), JsonNode.Parse(test.GetProperty("expected").GetRawText())),
                $"Pricing case {count} differs from JS: {input}");
            count++;
        }
        Console.WriteLine($"PASS: {count} VND pricing, promotion, rounding, inventory aggregation and custom bouquet cases matched JS.");
    }

    public static async Task OrderValidationAsync(string root)
    {
        using var cases = await OracleAsync(root, "order-validation-oracle.cjs"); var count = 0;
        foreach (var test in cases.RootElement.GetProperty("results").EnumerateArray())
        {
            var body = test.GetProperty("body");
            var actual = test.GetProperty("type").GetString() == "checkout" ? OrderValidation.ValidateCheckout(body) : OrderValidation.ValidateQuote(body);
            Require(JsonNode.DeepEquals(JsonSerializer.SerializeToNode(actual), JsonNode.Parse(test.GetProperty("expected").GetRawText())),
                $"Order validation case {count} differs from JS: {body}"); count++;
        }
        foreach (var test in cases.RootElement.GetProperty("schedules").EnumerateArray())
        {
            Require(OrderValidation.DeliveryScheduleError(test.GetProperty("date").GetString()!, test.GetProperty("time").GetString()!,
                DateTimeOffset.Parse(test.GetProperty("now").GetString()!)) == test.GetProperty("expected").GetString(), "Delivery schedule differs from JS"); count++;
        }
        Console.WriteLine($"PASS: {count} order normalization, checkout/quote validation and Vietnam delivery schedule cases matched JS.");
    }

    public static async Task VnpayAsync(string root)
    {
        using var cases = await OracleAsync(root, "vnpay-oracle.cjs");
        foreach (var test in cases.RootElement.GetProperty("queries").EnumerateArray())
        {
            var input = JsonNode.Parse(test.GetProperty("input").GetRawText())!.AsObject();
            Require(Vnpay.CanonicalQuery(input) == test.GetProperty("expected").GetString(), "VNPay canonical query differs from JS");
            Require(Vnpay.VerifySignature(input, "test-secret") == test.GetProperty("valid").GetBoolean(), "VNPay signature differs from JS");
        }
        var config = new VnpayConfig("TEST", "test-secret", Vnpay.SandboxPaymentUrl, "https://example.invalid/payment-result.html");
        var created = DateTimeOffset.Parse(cases.RootElement.GetProperty("now").GetString()!);
        var expires = DateTimeOffset.Parse(cases.RootElement.GetProperty("expires").GetString()!);
        foreach (var test in cases.RootElement.GetProperty("urls").EnumerateArray())
            Require(Vnpay.CreatePaymentUrl("FFabc123", 123456, test.GetProperty("ipAddress").GetString(), created, expires, config)
                == test.GetProperty("expected").GetString(), "VNPay signed URL differs from JS");
        foreach (var amount in new[] { 0d, -1, 1.5, 10_000_000_000, double.NaN })
        {
            try { Vnpay.CreatePaymentUrl("FFabc123", amount, "127.0.0.1", created, expires, config); throw new Exception("Invalid payment accepted"); }
            catch (VnpayException error) { Require(error.Code == "invalid-payment", "Wrong payment error"); }
        }
        try { Vnpay.GetSecrets(_ => null); throw new Exception("Missing VNPay config accepted"); }
        catch (VnpayException error) { Require(error.Code == "vnpay-not-configured", "Wrong configuration error"); }
        Console.WriteLine("PASS: VNPay form encoding, signatures, exact signed URLs, IP fallback and payment amount limits.");
    }

    public static void AdminAuditEntry()
    {
        var actor = new FirebaseIdentity(new string('u', 200), new Dictionary<string, object> { ["email"] = new string('e', 400) });
        var details = new Dictionary<string, object> { ["before"] = 1, ["after"] = 2 };
        var entry = AdminAudit.MakeEntry(actor, new string('a', 100), new string('r', 100), new string('i', 200), details);
        Require(((string)entry["actorUid"]).Length == 128 && ((string)entry["actorEmail"]).Length == 320
            && ((string)entry["action"]).Length == 80 && ((string)entry["resourceType"]).Length == 80
            && ((string)entry["resourceId"]).Length == 128, "Audit field bounds changed");
        Require(ReferenceEquals(entry["details"], details), "Audit details altered");
        Require(ReferenceEquals(entry["createdAt"], Google.Cloud.Firestore.FieldValue.ServerTimestamp), "Audit must use server timestamp");
        Require(AdminAudit.MakeEntry(null, "action", "resource", null)["details"] is Dictionary<string, object>, "Missing details default changed");
        Require(AdminAudit.MakeEntry(null, "action", "resource", null, null)["details"] is null, "Explicit null details changed");
        Console.WriteLine("PASS: audit entry limits, original details, explicit null, defaults and server timestamp.");
    }

    public static async Task IdentityAsync()
    {
        using var scenario = JsonDocument.Parse("{\"claims\":{\"uid\":\"user-a\"}}");
        var backend = new FakeBackend(scenario.RootElement);
        var service = new RequestIdentity(backend);
        Require(await service.OptionalCustomerAsync(new DefaultHttpContext()) is null, "Guest must stay anonymous");
        foreach (var header in new[] { "Basic token", "Bearer ", "Bearer token extra" })
        {
            var context = new DefaultHttpContext(); context.Request.Headers.Authorization = header;
            try { await service.OptionalCustomerAsync(context); throw new Exception("Invalid bearer accepted"); }
            catch (RequestIdentityException error) { Require(error.Code == "auth/invalid-session", "Wrong invalid-session code"); }
        }
        var authenticated = new DefaultHttpContext(); authenticated.Request.Headers.Authorization = "bEaReR\ttoken";
        Require((await service.OptionalCustomerAsync(authenticated))?.Uid == "user-a" && backend.CheckRevoked == true,
            "Customer bearer must check revocation");
        var identity = new FirebaseIdentity("local-user", new Dictionary<string, object>());
        var local = new DefaultHttpContext(); RequestIdentity.SetLocalIdentity(local, identity, true);
        Require(ReferenceEquals(await service.OptionalCustomerAsync(local), identity), "Trusted local identity lost");
        local.Request.Headers.Authorization = "Bearer token";
        try { await service.OptionalCustomerAsync(local); throw new Exception("Mixed local and bearer accepted"); }
        catch (RequestIdentityException) { }
        var invalid = new DefaultHttpContext(); RequestIdentity.SetLocalIdentity(invalid, null, true);
        try { await service.OptionalCustomerAsync(invalid); throw new Exception("Invalid local session accepted"); }
        catch (RequestIdentityException) { }
        var guest = new DefaultHttpContext(); RequestIdentity.SetLocalIdentity(guest, null, false);
        Require(await service.OptionalCustomerAsync(guest) is null, "Local guest rejected");
        var cookies = new DefaultHttpContext(); Require(RequestIdentity.SessionCookie(cookies) is null, "Missing cookie changed");
        cookies.Request.Headers.Cookie = "other=1; flower_local_session=one";
        Require(RequestIdentity.SessionCookie(cookies) == "one", "Session cookie not read");
        cookies.Request.Headers.Cookie = "flower_local_session=one; flower_local_session=two";
        Require(RequestIdentity.SessionCookie(cookies) == "", "Ambiguous cookies must fail closed");
        Console.WriteLine("PASS: customer identity, revoked-check flag, trusted local boundary and ambiguous cookies.");
    }

    public static async Task<int> ApiRoutesAsync(string root)
    {
        using var cases = await OracleAsync(root, "api-routes-oracle.cjs");
        var count = 0;
        static RequestDelegate Handler(string name) => context => context.Response.WriteAsJsonAsync(new { handler = name });
        var routes = new ApiRoutes(Handler("default"), new Dictionary<string, RequestDelegate>
        {
            ["audit"] = Handler("audit"), ["bouquet-wrapping"] = Handler("bouquet-wrapping")
        });
        foreach (var scenario in cases.RootElement.EnumerateArray())
        {
            var context = new DefaultHttpContext();
            if (scenario.GetProperty("query").TryGetProperty("route", out var route))
            {
                var values = route.ValueKind == JsonValueKind.Array ? route.EnumerateArray().Select(x => x.GetString()!) : [route.GetString()!];
                context.Request.QueryString = new QueryString("?" + string.Join("&", values.Select(x => "route=" + Uri.EscapeDataString(x))));
            }
            using var stream = new MemoryStream();
            context.Response.Body = stream;
            await routes.InvokeAsync(context);
            stream.Position = 0;
            var body = JsonNode.Parse(await new StreamReader(stream).ReadToEndAsync());
            var actual = JsonSerializer.SerializeToNode(new { status = context.Response.StatusCode, body,
                cache = context.Response.Headers.CacheControl.Count == 0 ? null : context.Response.Headers.CacheControl.ToString() });
            Require(JsonNode.DeepEquals(actual, JsonNode.Parse(scenario.GetProperty("expected").GetRawText())), "API route differs from JS");
            count++;
        }
        Console.WriteLine($"PASS: {count} API route scenarios matched JavaScript.");
        return count;
    }

    public static async Task<int> ImageRulesAsync(string root)
    {
        using var cases = await OracleAsync(root, "image-rules-oracle.cjs");
        var count = 0;
        foreach (var scenario in cases.RootElement.EnumerateArray())
        {
            var input = scenario.TryGetProperty("input", out var value) ? value : default;
            var actual = ImageRules.ValidateReviewPhotos(input)?.Select(Convert.ToBase64String).ToArray();
            Require(JsonNode.DeepEquals(JsonSerializer.SerializeToNode(actual),
                JsonNode.Parse(scenario.GetProperty("expected").GetRawText())), $"Image rules case {count} differs from JS");
            count++;
        }
        Console.WriteLine($"PASS: {count} image rule scenarios matched JavaScript.");
        return count;
    }

    public static async Task<JsonDocument> OracleAsync(string root, string name)
    {
        var start = new ProcessStartInfo("node") { RedirectStandardOutput = true, RedirectStandardError = true };
        start.ArgumentList.Add(Path.Combine(root, "aspnet/tests/FlowerFlow.Contracts", name));
        using var process = Process.Start(start) ?? throw new Exception("Cannot start Node.js oracle.");
        var output = process.StandardOutput.ReadToEndAsync();
        var errors = process.StandardError.ReadToEndAsync();
        await process.WaitForExitAsync();
        Require(process.ExitCode == 0, "Oracle failed: " + await errors);
        return JsonDocument.Parse(await output);
    }

    public static void Require(bool condition, string message)
    {
        if (!condition) throw new Exception(message);
    }
}
