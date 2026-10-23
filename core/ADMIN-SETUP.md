# Admin account directory

The admin dashboard lists Firebase Authentication accounts and their sign-in providers. Passwords are never returned by Firebase Authentication's user-list API and are not shown. The admin and Owner APIs use Vercel Functions with the Firebase Admin SDK; they do not require Firebase Cloud Functions or a Firebase Blaze upgrade.

## Deployment target

Deploy the `flower.com` directory as the Vercel project root to use the admin account list and Owner role-management page. The `api/` directory contains only request handlers; shared Firebase Admin code is in `lib/` so it is bundled as a library, not exposed as another API route.

For local testing, run Vercel CLI from `flower.com` with `vercel dev` after linking the project and configuring the required environment variables. A plain static HTTP server can serve the pages but cannot run `/api/admin/users` or `/api/owner/users`.

## One-time setup

1. In Firebase Console, enable the sign-in providers required by the shop and create the admin account in **Authentication → Users**.
2. Add the Vercel production hostname under **Authentication → Settings → Authorized domains**.
3. In Google Cloud Console for the same project, create a service account with the **Firebase Authentication Admin** role. Create a JSON key and store it only as a Vercel environment variable:

   - Open Vercel → project `flower-com` → **Settings → Environment Variables**.
   - Add `FIREBASE_SERVICE_ACCOUNT_JSON` with the entire contents of the service-account JSON file. Select **Production** (and Preview too if preview deployments should have access).
   - Add `FIREBASE_PROJECT_ID` with `web-ban-hoa-9fe0b`.
   - Never paste the key into source code, commit it, or send it in chat. Restrict/delete the key if it is accidentally exposed.

4. Redeploy the Vercel project after saving those variables. Its Root Directory must remain `flower.com`; the APIs are at `/api/admin/users` and `/api/owner/users`.
5. Bootstrap the first Owner for the existing Firebase user from a trusted local terminal. Install Google Cloud CLI if needed, then authenticate Application Default Credentials as a project administrator:

   ```powershell
   gcloud auth application-default login
   npm install
   $env:OWNER_EMAIL = "owner@example.com"
   npm run set-owner
   Remove-Item Env:OWNER_EMAIL
   ```

   Run these commands from the `flower.com` directory. The script preserves existing custom claims, revokes the user's refresh tokens, and does not require downloading a service-account key. To identify the account by UID instead, set `OWNER_UID` and leave `OWNER_EMAIL` unset. The account must sign in again.
6. Deploy the Vercel project. The Owner page is `/owner.html`; it can grant or remove `admin` access, but cannot create or modify Owner accounts. Use the trusted bootstrap process above for Owner changes.

## Roles and access

The admin page and Vercel admin API require the Firebase ID token's `admin: true` custom claim. Owner accounts have both `role: "owner"` and `admin: true`; the separate Owner API requires `role: "owner"` and verifies token revocation. The Owner page can grant or remove admin access, and each role change revokes the target user's refresh tokens. It does not allow creating Owners or changing the signed-in Owner's role. Admin account listing is paginated in batches of 100.

Do not share one Owner login among a group. Bootstrap one trusted Owner, then let that Owner grant `admin` to each teammate's individual Firebase account.
