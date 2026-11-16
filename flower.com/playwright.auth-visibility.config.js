import { defineConfig } from "@playwright/test";
import base from "./playwright.config.js";

const baseURL = "http://127.0.0.1:4175";

export default defineConfig({
  ...base,
  workers: 2,
  testMatch: ["login-password-visibility.spec.js", "signup-password-visibility.spec.js",
    "password-selection.spec.js", "password-inactivity.spec.js", "password-concealment.spec.js"],
  outputDir: "../test-results/auth-visibility",
  use: { ...base.use, baseURL, serviceWorkers: "block" },
  webServer: {
    ...base.webServer,
    url: `${baseURL}/login.html`,
    env: { FLOWER_E2E_PORT: "4175", FIREBASE_AUTH_EMULATOR_HOST: "", FIRESTORE_EMULATOR_HOST: "" }
  }
});
