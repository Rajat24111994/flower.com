const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const root = path.join(__dirname, "..", "flower.com");
const adminRoot = path.join(root, "js", "admin");
const entry = fs.readFileSync(path.join(adminRoot, "admin.js"), "utf8");
const featureModules = [
  "admin-state.js",
  "admin-data.js",
  "admin-lifecycle.js",
  "admin-dashboard.js",
  "admin-products.js",
  "admin-categories.js",
  "admin-promotions.js",
  "admin-delivery.js",
  "admin-orders.js",
  "admin-reviews.js",
  "admin-users.js",
  "admin-events.js"
];

test("admin entry loads feature modules and each admin module stays under 800 lines", () => {
  for (const filename of featureModules) {
    const modulePath = path.join(adminRoot, filename);
    assert.ok(fs.existsSync(modulePath), `${filename} should exist`);
    assert.match(entry, new RegExp(`\\./${filename.replaceAll(".", "\\.")}(?:\\?v=\\d+)?`), `${filename} should be loaded by admin.js`);
    const lines = fs.readFileSync(modulePath, "utf8").split(/\r?\n/).length;
    assert.ok(lines <= 800, `${filename} has ${lines} lines; expected at most 800`);
  }

  const html = fs.readFileSync(path.join(root, "admin.html"), "utf8");
  assert.match(html, /admin\.js\?v=\d+/, "admin.html should version the admin entry module");
});

test("admin feature modules load and publish their tab operations", async () => {
  global.document = { getElementById: () => null, querySelector: () => null };
  global.window = global;
  global.addEventListener = () => {};

  try {
    for (const filename of featureModules) {
      await import(pathToFileURL(path.join(adminRoot, filename)).href);
    }
    for (const operation of [
      "renderDashboard",
      "renderProductTab",
      "renderCategoriesTab",
      "renderOffersTab",
      "renderDeliveryZonesTab",
      "renderOrdersTab",
      "renderReviewsTab",
      "renderMessagesTab",
      "renderUsersTab",
      "bindAdminEvents"
    ]) {
      assert.equal(typeof global[operation], "function", `${operation} should be registered`);
    }
  } finally {
    delete global.document;
    delete global.window;
    delete global.addEventListener;
  }
});
