import { expect, test } from "@playwright/test";

async function mockFirebaseAuth(page) {
  await page.addInitScript(() => {
    localStorage.setItem("authFixtureAccounts", JSON.stringify([]));
  });
  await page.route("https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js", (route) => route.fulfill({
    contentType: "text/javascript",
    body: `
      export const initializeApp = () => ({});
      export const getApps = () => [];
      export const getApp = () => ({});
    `
  }));
  await page.route("https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js", (route) => route.fulfill({
    contentType: "text/javascript",
    body: `
      function currentUser() {
        const stored = JSON.parse(localStorage.getItem("firebaseFixtureUser") || "null");
        return stored ? {
          ...stored,
          providerData: [{ providerId: "password" }],
          getIdTokenResult: async () => ({ claims: {} })
        } : null;
      }
      const auth = {
        authStateReady: async () => {},
        get currentUser() { return currentUser(); }
      };
      export const getAuth = () => auth;
      export const setPersistence = async () => {};
      export const browserLocalPersistence = {};
      export const signInWithCustomToken = async (_auth, token) => {
        if (token !== "fixture-token") throw { code: "auth/invalid-custom-token" };
        const user = JSON.parse(localStorage.getItem("authFixtureUser") || "null");
        if (!user) throw { code: "auth/user-not-found" };
        localStorage.setItem("firebaseFixtureUser", JSON.stringify(user));
        return { user: { ...user, getIdTokenResult: async () => ({ claims: {} }) } };
      };
      export const createUserWithEmailAndPassword = async (_auth, email, password) => {
        const accounts = JSON.parse(localStorage.getItem("authFixtureAccounts") || "[]");
        if (accounts.some((item) => item.email === email)) throw { code: "auth/email-already-in-use" };
        if (password.length < 6) throw { code: "auth/weak-password" };
        const user = { uid: "customer-new", email, displayName: "", phoneNumber: "" };
        accounts.push({ ...user, password });
        localStorage.setItem("authFixtureAccounts", JSON.stringify(accounts));
        localStorage.setItem("firebaseFixtureUser", JSON.stringify(user));
        return { user: { ...user, getIdTokenResult: async () => ({ claims: {} }) } };
      };
      export const updateProfile = async (user, profile) => {
        user.displayName = profile.displayName;
        const stored = currentUser();
        if (stored) {
          stored.displayName = profile.displayName;
          localStorage.setItem("firebaseFixtureUser", JSON.stringify(stored));
        }
      };
      export const signOut = async () => {
        localStorage.removeItem("firebaseFixtureUser");
        localStorage.setItem("firebaseSignOutCalled", "true");
      };
      export class GoogleAuthProvider {
        setCustomParameters() {}
      }
      export const signInWithPopup = async () => { throw { code: "auth/popup-closed-by-user" }; };
      export const getRedirectResult = async () => ({ user: null });
    `
  }));
}

test("valid login succeeds while invalid email or password cannot create a session", async ({ page }) => {
  await mockFirebaseAuth(page);
  await page.addInitScript(() => {
    localStorage.setItem("authFixtureUser", JSON.stringify({
      uid: "customer-1",
      email: "customer@example.test",
      displayName: "Khách hàng",
      phoneNumber: ""
    }));
  });
  await page.route("**/api/login", async (route) => {
    const { email, password } = route.request().postDataJSON();
    if (email === "customer@example.test" && password === "Flowerflow-Password-1!") {
      await route.fulfill({ json: { customToken: "fixture-token" } });
      return;
    }
    await route.fulfill({ status: 401, json: {
      code: "invalid-credential",
      error: "Email hoặc mật khẩu không chính xác."
    } });
  });
  await page.goto("/login.html");

  await page.locator("#email1").fill("missing@example.test");
  await page.locator("#password1").fill("Flowerflow-Password-1!");
  await page.locator("#signIn .submit").click();
  await expect(page.locator("#display")).toContainText("không chính xác");
  expect(await page.evaluate(() => localStorage.getItem("loggedUser"))).toBeNull();

  await page.locator("#email1").fill("customer@example.test");
  await page.locator("#password1").fill("wrong-password");
  await page.locator("#signIn .submit").click();
  await expect(page.locator("#display")).toContainText("không chính xác");
  expect(await page.evaluate(() => localStorage.getItem("loggedUser"))).toBeNull();

  await page.locator("#password1").fill("Flowerflow-Password-1!");
  await page.locator("#signIn .submit").click();
  await expect(page).toHaveURL(/product\.html$/);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("loggedUser") || "null")?.uid))
    .toBe("customer-1");
});

test("registration validates names, email, password length and confirmation before account creation", async ({ page }) => {
  await mockFirebaseAuth(page);
  await page.goto("/login.html");
  await page.locator("#signup").click();

  await page.locator("#name").fill("   ");
  await page.locator("#lastName").fill("Nguyễn");
  await page.locator("#email").fill("not-an-email");
  await page.locator("#password").fill("short");
  await page.locator("#checkpassword").fill("short");
  await page.locator("#signUp .submit").click();
  await expect(page.locator("#email")).toHaveJSProperty("validity.typeMismatch", true);
  await expect(page.locator("#password")).toHaveJSProperty("validity.tooShort", true);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("authFixtureAccounts") || "[]"))).toHaveLength(0);

  await page.locator("#name").fill("An");
  await page.locator("#email").fill("new@example.test");
  await page.locator("#password").fill("Flowerflow-Password-1!");
  await page.locator("#checkpassword").fill("different-password");
  await page.locator("#signUp .submit").click();
  await expect(page.locator("#signup-display")).toContainText("không khớp");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("authFixtureAccounts") || "[]"))).toHaveLength(0);

  await page.locator("#checkpassword").fill("Flowerflow-Password-1!");
  await page.locator("#signUp .submit").click();
  await expect(page).toHaveURL(/product\.html$/);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("loggedUser") || "null")?.name))
    .toBe("An Nguyễn");
});

test("logout ends the Firebase session and clears the browser account", async ({ page }) => {
  await mockFirebaseAuth(page);
  await page.addInitScript(() => {
    if (location.pathname === "/account.html") {
      const user = {
        uid: "customer-logout",
        email: "logout@example.test",
        displayName: "Khách đăng xuất",
        phoneNumber: ""
      };
      localStorage.setItem("firebaseFixtureUser", JSON.stringify(user));
      localStorage.setItem("loggedUser", JSON.stringify({ ...user, role: "customer", authProvider: "password" }));
    }
  });
  await page.goto("/account.html");
  await expect(page.locator("#account-email")).toHaveText("logout@example.test");
  await page.locator("#logout-button").click();
  await expect(page).toHaveURL(/login\.html$/);
  expect(await page.evaluate(() => localStorage.getItem("firebaseFixtureUser"))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("loggedUser"))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("firebaseSignOutCalled"))).toBe("true");
});
