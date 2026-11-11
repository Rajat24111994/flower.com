const test = require("node:test");
const assert = require("node:assert/strict");

test("authentication error logs contain only a validated Firebase error code", async () => {
  const { logAuthError } = await import("../flower.com/js/account/auth-logging.js");
  const originalError = console.error;
  const entries = [];
  const password = "secret-password-value";
  console.error = (...args) => entries.push(args);

  try {
    const error = Object.assign(new Error(`Request contained ${password}`), {
      code: "auth/invalid-credential",
      customData: { password }
    });
    logAuthError("Authentication failed:", error);
  } finally {
    console.error = originalError;
  }

  assert.deepEqual(entries, [["Authentication failed:", "auth/invalid-credential"]]);
  assert.equal(JSON.stringify(entries).includes(password), false);
});

test("authentication error logs do not include invalid error codes", async () => {
  const { logAuthError } = await import("../flower.com/js/account/auth-logging.js");
  const originalError = console.error;
  const entries = [];
  console.error = (...args) => entries.push(args);

  try {
    logAuthError("Authentication failed:", { code: "password was exposed" });
  } finally {
    console.error = originalError;
  }

  assert.deepEqual(entries, [["Authentication failed:", "unknown"]]);
});
