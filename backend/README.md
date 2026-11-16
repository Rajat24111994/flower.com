# FlowerFlow ASP.NET Core backend — issue #141

The application backend is implemented in C# on ASP.NET Core 10. Firebase Authentication and the existing Firestore database remain the identity and persistence services. The published application has no Node.js runtime dependency and serves the original frontend files together with the API on the same origin.

## Run

Install the .NET 10 SDK. Set server environment variables using the names in [.env.example](.env.example). The .NET process reads environment variables; it does not automatically load a `.env` file.

```powershell
dotnet restore backend/Flower.Api/Flower.Api.csproj --locked-mode
dotnet run --project backend/Flower.Api/Flower.Api.csproj --no-launch-profile -- --urls http://localhost:5181
```

Open `http://localhost:5181/`. `FIREBASE_SERVICE_ACCOUNT_JSON` contains the existing service-account JSON and `FIREBASE_PROJECT_ID` optionally overrides its project ID. Keep them in a server secret store. No credentials, database initialization, collection creation, or seed writes occur at startup. Missing/invalid credentials produce the existing API error format, never SDK error details.

ID tokens are verified with `VerifyIdTokenAsync(token, checkRevoked: true)`, preserving expiration, disabled-account and session-revocation checks. See the [Firebase Admin .NET reference](https://firebase.google.com/docs/reference/admin/dotnet/class/firebase-admin/auth/abstract-firebase-auth).

## Existing API contract

No frontend files or API URLs need to change. Request fields, successful response shapes, collection names and stored business fields are preserved.

| URL | Methods | C# implementation |
| --- | --- | --- |
| `/api/admin/users` | POST | `UserEndpoints` |
| `/api/owner/users` | POST | `UserEndpoints` |
| `/api/products` | GET | `ProductEndpoints` |
| `/api/product-images` | GET, POST | `ImageEndpoints` |
| `/api/review-images` | GET | `ImageEndpoints` |
| `/api/flower-prices` | GET, PATCH | `CatalogEndpoints` |
| `/api/bouquet-wrapping` | GET, POST | `CatalogEndpoints` |
| `/api/delivery-zones` | GET, POST | `CatalogEndpoints` |
| `/api/design-requests` | GET, POST | `DesignEndpoints` |
| `/api/orders` | GET, POST | `OrderEndpoints`, `OrderRules` |
| `/api/payments` | GET, POST | `PaymentEndpoints`, `Vnpay` |
| `/api/vnpay-ipn` | GET | `PaymentEndpoints`, `Vnpay` |

The migration preserves these rules:

- Firebase custom claims and the endpoint-specific `adminRoles` checks, Owner-only price administration, role backfill, claim preservation and refresh-token revocation.
- Server-side whole-VND pricing including legacy USD conversion, promotion eligibility and rounding, delivery fees and bouquet wrapping tiers.
- Transactional inventory reservation and expiration (QR 30 minutes, VNPay 15 minutes, COD 24 hours), aggregated demand across configured lines, idempotency conflicts and concurrent orders.
- Public order lookup privacy and rate limiting, authenticated account ownership, QR reconciliation, late payments, refunds and immutable payment audit records.
- VNPay form encoding and HMAC-SHA512, signed IPN verification, matching merchant/currency/amount, duplicate callbacks, payment retries and late/duplicate successful transactions.
- Design validation, reference images, price estimates, bearer access tokens stored as SHA256 hashes, quotations and customer responses.
- Verified-purchase reviews, moderation, JPEG validation, deduplicated product photos and private review-image access.
- The existing Firestore document/collection schema and integer, timestamp and byte field types. Explicit timestamps use JavaScript-compatible millisecond precision.

Original JS handlers and shared rule modules remain in `flower.com/api` and `flower.com/lib` as regression references. They are **not included in the ASP.NET deployment**. Existing offline maintenance tools (seed, roles, encrypted backup/restore) and their workflows remain available, unchanged; they are not HTTP handlers. The frontend still accesses Firebase directly where it did before, under the existing Firestore rules.

## Validate

```powershell
npm ci --prefix flower.com
npm ci --prefix tests
dotnet build backend/Flower.ContractTests/Flower.ContractTests.csproj
node backend/test-contracts.cjs
node flower.com/node_modules/firebase-tools/lib/bin/firebase.js emulators:exec --only auth,firestore --project demo-flowerflow --config flower.com/firebase.json "node backend/test-api.cjs"
dotnet publish backend/Flower.Api/Flower.Api.csproj --no-restore -c Release -o backend/publish
node backend/test-publish.cjs
```

Java 21 must be on PATH for Firebase Emulator. The integration runner launches ASP.NET and runs the existing test suite over real HTTP instead of invoking the JS handlers. Tests require both emulators and a `demo-` project; they never use production Firebase. `node backend/test-api.cjs feature-orders.test.js` selects one suite when run inside `emulators:exec`.

The differential harness compares C# against the original JS validation, pricing, schedule, wrapping, design, privacy and encoding rules. Additional migration tests check JS→C# idempotency, integer storage, empty request bodies, pagination and forwarding-header spoofing. CI runs contracts, emulator integration and published-artifact smoke checks.

## Publish and cut over

```powershell
docker build -f backend/Dockerfile -t flowerflow-api .
docker run --rm -p 8080:8080 --env-file backend/.env flowerflow-api
```

Alternatively deploy `backend/publish` to a .NET 10 host. Configure HTTPS at the ingress. The build copies only public HTML/CSS/JS/images/catalog files into `wwwroot`; APIs, libraries, operational scripts and credentials are not served. The existing CSP, HSTS and security headers are read from `flower.com/vercel.json` during build and applied by ASP.NET.

If behind a reverse proxy, set `TRUSTED_PROXY_IPS` to its exact IP addresses, separated by commas. Forwarded headers are processed only from these proxies with a one-hop limit; otherwise lookup rate limiting and VNPay use the socket peer. The ingress must overwrite forwarding headers. See [Microsoft's proxy guidance](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/proxy-load-balancer?view=aspnetcore-10.0).

Retain the scheduled authenticated `GET /api/orders?action=expire` request at **19:07 UTC daily** (the existing Vercel schedule), with `Authorization: Bearer <CRON_SECRET>`, on the new host's scheduler. Quote/order/payment requests also perform the same opportunistic cleanup as before. Configure the VNPay merchant IPN URL to the unchanged `/api/vnpay-ipn` route on the public domain; payment returns still use `/payment-result.html`.

This commit prepares the implementation and deployment artifact. It does not deploy, change DNS, update Firebase settings, alter production data or switch the existing Vercel project. Vercel's current Node function configuration cannot execute this .NET application: deploy the C# artifact on a .NET-capable host and route the current domain to it. Keep the previous deployment available for rollback; the shared database schema is unchanged. Re-run staging checkout, QR reconciliation and VNPay sandbox callbacks before changing production traffic.
