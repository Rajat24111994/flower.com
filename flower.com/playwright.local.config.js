import { defineConfig } from "@playwright/test";
import base from "./playwright.config.js";

export default defineConfig({
  ...base,
  // Keep CPU-heavy browser scenarios sequential on development machines.
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  testMatch: ["local-accounts.spec.js", "local-session.spec.js"],
  testIgnore: [],
  outputDir: "../test-results-local",
  reporter: process.env.CI ? [["list"], ["html", { outputFolder: "playwright-report-local", open: "never" }]] : "list",
  use: { ...base.use, baseURL: "http://127.0.0.1:4174" },
  webServer: undefined
});
