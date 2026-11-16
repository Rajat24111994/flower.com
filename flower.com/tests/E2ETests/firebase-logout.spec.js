// Mock browser UI evidence only. Server revocation is verified by firebase-logout.test.js over C# HTTP + emulators.
import { expect, test } from "@playwright/test";

async function fixture(page, role = "customer", response = { status: 200, body: { ok: true, scope: "all" } }) {
    const requests = [];
    await page.addInitScript(role => {
        window.FlowerAuthMode = "firebase";
        if (!sessionStorage.getItem("logoutFixtureInitialized")) {
            localStorage.setItem("loggedUser", JSON.stringify({ uid: "fixture-user", name: "Khách thử nghiệm", email: "test@example.test", authProvider: "password", role }));
            sessionStorage.setItem("logoutFixtureInitialized", "true");
        }
        localStorage.setItem("firebaseLogoutRole", role);
    }, role);
    await page.route("https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js", route => route.fulfill({
        contentType: "text/javascript", body: "export const getApps = () => [{}]; export const getApp = () => ({}); export const initializeApp = () => ({});"
    }));
    await page.route("https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js", route => route.fulfill({
        contentType: "text/javascript", body: `
            const role = localStorage.getItem("firebaseLogoutRole");
            const user = { uid: "fixture-user", email: "test@example.test", displayName: "Khách thử nghiệm", providerData: [{providerId:"password"}],
                getIdToken: async () => "saved-ui-token", getIdTokenResult: async () => ({claims: { admin: role !== "customer", role }}) };
            const auth = { currentUser: user, authStateReady: async () => {} };
            export const getAuth = () => auth;
            export const onAuthStateChanged = (_auth, callback) => { queueMicrotask(() => callback(auth.currentUser)); return () => {}; };
            export const signOut = async () => { auth.currentUser = null; localStorage.setItem("firebaseSignOutCalled", "true"); };
            export const setPersistence = async () => {};
            export const browserLocalPersistence = {};
            export const getRedirectResult = async () => null;
            export class GoogleAuthProvider { setCustomParameters() {} }
        `
    }));
    await page.route("https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js", route => route.fulfill({
        contentType: "text/javascript", body: "export const getFirestore = () => ({});"
    }));
    await page.route("**/api/**", route => {
        if (new URL(route.request().url()).pathname === "/api/auth/logout-all") {
            requests.push({ method: route.request().method(), body: route.request().postDataJSON(), authorization: route.request().headers().authorization });
            return route.fulfill({ status: response.status, contentType: "application/json", body: JSON.stringify(response.body) });
        }
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({ users: [], products: [], orders: [], tiers: [], zones: [] }) });
    });
    return requests;
}

test("existing browser logout does not call account-wide revocation", async ({ page }) => {
    const requests = await fixture(page);
    await page.goto("/account.html");
    await expect(page.locator("#logout-button")).toBeEnabled();
    await page.locator("#logout-button").click();
    await expect(page).toHaveURL(/login\.html/);
    expect(requests).toHaveLength(0);
    expect(await page.evaluate(() => localStorage.getItem("firebaseSignOutCalled"))).toBe("true");
});

for (const [role, path, selector] of [
    ["customer", "/account.html", "#logout-all-button"],
    ["admin", "/admin.html", "#logout_all_devices"],
    ["owner", "/owner.html", "#owner-logout-all"]
]) {
    test(`${role}: separate logout-all action sends bearer without UID, then signs out`, async ({ page }) => {
        const requests = await fixture(page, role);
        await page.goto(path);
        await expect(page.locator(selector)).toBeVisible();
        page.once("dialog", dialog => dialog.accept());
        await page.locator(selector).click();
        await expect(page).toHaveURL(/login\.html/);
        expect(requests).toEqual([{ method: "POST", body: {}, authorization: "Bearer saved-ui-token" }]);
        expect(await page.evaluate(() => localStorage.getItem("firebaseSignOutCalled"))).toBe("true");
        expect(await page.evaluate(() => localStorage.getItem("loggedUser"))).toBeNull();
    });
}

test("canceling logout-all leaves current session and server untouched", async ({ page }) => {
    const requests = await fixture(page);
    await page.goto("/account.html");
    page.once("dialog", dialog => dialog.dismiss());
    await page.locator("#logout-all-button").click();
    expect(requests).toHaveLength(0);
    await expect(page).toHaveURL(/account\.html/);
    expect(await page.evaluate(() => localStorage.getItem("firebaseSignOutCalled"))).toBeNull();
});

for (const [name, response] of [
    ["server failure", { status: 503, body: { code: "logout-all-failed", error: "private-provider-detail" } }],
    ["invalid session", { status: 401, body: { code: "unauthenticated" } }],
    ["unexpected success body", { status: 200, body: {} }]
]) {
    test(`logout-all ${name} does not claim success or clear the browser session`, async ({ page }) => {
        await fixture(page, "customer", response);
        await page.goto("/account.html");
        page.once("dialog", dialog => dialog.accept());
        await page.locator("#logout-all-button").click();
        await expect(page.locator("#account-message")).toContainText(/Chưa|không còn hợp lệ/);
        await expect(page.locator("#account-message")).not.toContainText("private-provider-detail");
        await expect(page.locator("#logout-all-button")).toBeEnabled();
        expect(await page.evaluate(() => localStorage.getItem("firebaseSignOutCalled"))).toBeNull();
        expect(await page.evaluate(() => localStorage.getItem("loggedUser"))).not.toBeNull();
    });
}
