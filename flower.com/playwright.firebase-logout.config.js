import { defineConfig } from "@playwright/test";
import base from "./playwright.config.js";

const baseURL = "http://127.0.0.1:4176";
export default defineConfig({
    ...base,
    testMatch: ["firebase-logout.spec.js"],
    workers: 2,
    outputDir: "../test-results/firebase-logout",
    use: { ...base.use, baseURL, serviceWorkers: "block" },
    webServer: {
        ...base.webServer,
        url: `${baseURL}/account.html`,
        env: { FLOWER_E2E_PORT: "4176", FIREBASE_AUTH_EMULATOR_HOST: "", FIRESTORE_EMULATOR_HOST: "" }
    }
});
