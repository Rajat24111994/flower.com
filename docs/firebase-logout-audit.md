# Firebase logout audit — 2026-11-16

Audit baseline: `3842b36` on `origin/main`. This audit was completed before changing
logout behavior. Newer main changes through `bb8406b` (Render hosting and current
admin modules) were integrated during implementation.

## Runtime and existing behavior

The current API host is ASP.NET Core/.NET 10 (`flower.com/backend/FlowerFlow.Api/Program.cs`).
`npm run dev` launches this host. Current main identifies Render as production;
this task does not deploy it. `flower.com/backend` and `api` retain the earlier
JavaScript implementation for comparison and the existing Node/Vercel path.
The new logout endpoint is implemented in C#, not in the reference Node backend.

Firebase password login goes through `/api/login`, existing login protection,
a server-created custom token, and browser `signInWithCustomToken`. Google
sign-in uses the Firebase browser SDK. Persistence is browser local persistence.
Customer (`js/account/account.js`), admin (`js/admin/admin-events.js`) and owner
(`js/admin/owner.js`) logout call browser `signOut` and clear stored profile data.
They do not revoke Firebase refresh tokens. Browser tabs sharing Firebase local
persistence may sign out together; “this device” means this browser's Firebase
persistence, not an isolated tab or all browsers on a physical device.

Before this change, copying an ID token before browser logout allows replay to
an API until the token expires or is separately revoked. `signOut` does not prove
server invalidation. Owner role removal already invokes server revocation; it is
not a self-service logout endpoint.

Local accounts are separate: `LocalAccounts`, `LocalAccountWorker`,
`LocalAuthHandler` and `LocalSession` use SQLite and an HttpOnly cookie, including
server session deletion on `/api/local-auth/logout`. Firebase logout must not use
the local cookie as proof of Firebase identity or change this existing behavior.

## Existing API verification

All discovered C# ID-token verification calls pass `checkRevoked: true` (the SDK's
second argument). Public/guest/capability/payment-signature routes remain public
or use their existing authorization; logout does not make them private.

| Verification boundary | Protected consumers |
| --- | --- |
| `FirebaseAdminService.VerifyRequestAsync` | Products management, product image uploads, flower prices, payment administration |
| `VerifyAdminRequestAsync` / `VerifyOwnerRequestAsync` (same verifier plus live `adminRoles`) | Admin users/audit, owner users, managed catalog/settings, design administration |
| `RequestIdentity.OptionalCustomerAsync` | Authenticated order creation, customer order history/tracking through `OrderTracking` |
| Direct SDK verification, revocation enabled | Order reviews, optional design-request identity, private review images |

The matching JS helpers also request revocation checking. Optional/public paths
can intentionally continue to serve public content without identity. Tests must
assert denial of protected operations, not claim all URLs reject old tokens.

## Direct browser Firestore inventory

Paths are relative to `flower.com/`. Reads, listeners and writes bypass API C#:

| File | Firestore resources / operations |
| --- | --- |
| `js/catalog/product-store.js` | `products` reads/listeners/management transactions; `metadata/storeCategories` reads/writes/listeners |
| `js/order/order-store.js` | `orders` customer/admin listeners, status/stock transactions; `products` stock; `metadata/activePromotions` and `metadata/storeCategories` reads/writes/listeners |
| `js/review/review-store.js` | `reviews` public/admin listeners, legacy migration, moderation/replies |
| `js/admin/message-store.js` | `messages` migration, admin listener, update/delete |
| `js/core/shopping-sync.js` | `shoppingCarts/{uid}` read listener and writes |
| `js/core/store-header.js` | Initializes Firestore and starts `shopping-sync.js`; no additional collection |

Existing `firestore.rules` checks claims, UID and (for admins) live `adminRoles`,
but contains no logout revocation timestamp / session check. Revoking Auth refresh
tokens does not add such a Rules check. A copied, unexpired token can therefore
retain allowed direct Firestore access. Removing an admin role document is a
separate authorization action, not something logout should do. Public reads and
already cached/downloaded data remain available. No Rules/schema changes are
authorized here. Direct access will be tested separately on the emulator; this
cannot certify production timing or every listener/cache scenario.

## Agreed scope

The user selected: keep current browser logout and add a distinct **Đăng xuất
trên mọi thiết bị** action. Do not repurpose the existing logout button.
The separate server operation verifies the caller's ID token with revocation
checking and derives the sole target UID from the verified identity. It accepts
no client-selected account. Only a successful server response permits the UI to
claim revocation completed; then the initiating browser signs out and clears its
profile. Other devices may still display their old UI until a protected request
or token refresh fails. Revocation is account-wide, not per device.

Revocation timestamps have second precision. Firebase Admin .NET 3.7.0 compares
the ID token's `iat` (`IssuedAtTimeSeconds`) with the user's valid-after timestamp;
the Node SDK uses `auth_time`. Tests cross a second boundary before revocation.
A same-second token is not guaranteed to be rejected by the SDK's strict
less-than comparison. This is not immediate per-session invalidation.

If immediate invalidation of one session is needed later, introduce an opaque
server-issued session identifier, a server-side session registry and a check on
every protected request, with rotation and targeted deletion. A bare Firebase ID
token has no app-managed device/session identifier. Direct Firestore needs a
separately approved Rules/session design or routing private operations through
the API. `revokeRefreshTokens(uid)` cannot implement targeted device logout.

## Evidence requirements

Keep local SQLite/cookie, mocked SDK/UI, Firebase Emulator, and real Firebase
results separate. Save the exact token before browser logout/revocation and
replay the same bytes. Exercise two sessions, another account, invalid/expired
tokens, re-login, and direct Firestore. No production user revocation, schema
changes, database creation, or deployment is part of this task. Real Firebase
verification remains unverified without a dedicated approved test project.

Sources: [Firebase session management](https://firebase.google.com/docs/auth/admin/manage-sessions),
[Auth Emulator differences](https://firebase.google.com/docs/emulator-suite/connect_auth),
[.NET 3.7.0 source](https://github.com/firebase/firebase-admin-dotnet/blob/v3.7.0/FirebaseAdmin/FirebaseAdmin/Auth/AbstractFirebaseAuth.cs).
Emulator tokens are unsigned; emulator success does not verify production JWT
signature/certificate validation, IAM, propagation, or provider connectivity.

## Implemented behavior and recorded limits

`POST /api/auth/logout-all`, `Authorization: Bearer <Firebase ID token>`, with an
empty body or `{}` returns `{ "ok": true, "scope": "all" }` after SDK revocation.
Wrong method: 405 with `Allow: POST`. Invalid/expired/revoked/missing token: 401.
Any query parameter or nonempty/non-object body (including `uid`): 400 without
revocation. Revocation service failure: sanitized 503. A local cookie cannot
authenticate this operation. After authentication, revocation is not canceled
merely because the initiating browser disconnects.

Existing Firebase verification sites still enable revocation checks. Claims/live
roles, public/capability access and data structures are unchanged. Only the new
controls call this endpoint. Browser cleanup happens after confirmed success;
server failure preserves the browser session. Cleanup failure after successful
revocation is reported distinctly. Local SQLite users never see the new button.

Seven new emulator scenarios include **two limitations reproduced, not fixed**:
direct Firestore still accepts an allowed old ID token; Auth Emulator 13.35.1
still accepts an old refresh grant and can issue a new ID token accepted by
.NET's `iat` check. Its `validateRefreshToken` does not enforce the cutoff and its
refresh grants are deterministic per user/provider. Tests use separate real SDK
apps with in-memory persistence and distinct saved ID tokens, not two unique
production refresh grants. Real Firebase refresh rejection remains unverified.
See the [execution report](test-reports/2026-11-16-firebase-logout.md).

Current Render configuration uses `autoDeployTrigger: checksPass`. All four
commits contain `[skip render]` to prevent auto-deployment on push, using
[Render's documented mechanism](https://render.com/docs/deploys#skipping-an-auto-deploy).
No deployment hook, Render settings, credentials or production users are changed.
