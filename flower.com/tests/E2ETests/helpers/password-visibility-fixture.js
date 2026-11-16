import { test as base, expect } from "@playwright/test";

const appMock = 'export const initializeApp = () => ({ name: "visibility-test" });';
const authMock = `
  const unexpected = () => {
    globalThis.visibilityAuthCalls.push("unexpected authentication call");
    throw new Error("Authentication is disabled in password visibility tests");
  };
  export const browserLocalPersistence = "mock-local";
  export const getAuth = () => ({});
  export const setPersistence = async () => {};
  export const getRedirectResult = async () => null;
  export const createUserWithEmailAndPassword = unexpected;
  export const signInWithCustomToken = unexpected;
  export const signInWithPopup = unexpected;
  export const signInWithRedirect = unexpected;
  export const updateProfile = unexpected;
  export const GoogleAuthProvider = class {};
`;

export const test = base.extend({
  page: async ({ page, baseURL }, use) => {
    const origin = new URL(baseURL);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname)) {
      throw new Error("Password visibility tests require a loopback test server");
    }
    const backendRequests = [];
    await page.context().route("**/*", async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === "https://www.gstatic.com" && request.method() === "GET") {
        if (/\/firebase-app\.js$/.test(url.pathname)) {
          return route.fulfill({ contentType: "text/javascript", body: appMock });
        }
        if (/\/firebase-auth\.js$/.test(url.pathname)) {
          return route.fulfill({ contentType: "text/javascript", body: authMock });
        }
      }
      if (url.origin === origin.origin && !url.pathname.startsWith("/api/")
          && ["GET", "HEAD"].includes(request.method())) return route.continue();
      if (url.pathname.startsWith("/api/") || !["GET", "HEAD"].includes(request.method())
          || /identitytoolkit|securetoken|firestore|firebaseio/.test(url.hostname)) {
        backendRequests.push({ method: request.method(), host: url.host, path: url.pathname });
      }
      // All other network traffic, including fonts and Firebase, is blocked.
      return route.abort();
    });
    await page.addInitScript(() => {
      window.visibilitySubmits = { signIn: 0, signUp: 0 };
      window.visibilityAuthCalls = [];
      document.addEventListener("submit", event => {
        if (!Object.hasOwn(window.visibilitySubmits, event.target.id)) return;
        window.visibilitySubmits[event.target.id]++;
        event.preventDefault();
        event.stopImmediatePropagation();
      }, true);
    });
    await page.clock.install();
    await page.goto("/login.html");
    await expect(page.locator("#signIn [type=submit]")).toBeEnabled();
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    await use(page);
    expect(await page.evaluate(() => window.visibilitySubmits)).toEqual({ signIn: 0, signUp: 0 });
    expect(await page.evaluate(() => window.visibilityAuthCalls)).toEqual([]);
    expect(backendRequests, "Visibility controls must not call an API or write data").toEqual([]);
  }
});

export { expect };

export async function watchTypeWrites(page) {
  await page.evaluate(() => {
    window.concealTypeWrites = 0;
    const observer = new MutationObserver(records => { window.concealTypeWrites += records.length; });
    document.querySelectorAll(".password-field input").forEach(input => {
      observer.observe(input, { attributes: true, attributeFilter: ["type"] });
    });
  });
}
