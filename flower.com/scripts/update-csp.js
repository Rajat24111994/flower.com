const fs = require("node:fs");
const path = require("node:path");
const { withSecurityPolicy } = require("../lib/content-security");
const root = path.join(__dirname, "..");
const filename = path.join(root, "vercel.json");
const config = JSON.parse(fs.readFileSync(filename, "utf8"));
for (const rule of config.headers) for (const header of rule.headers) {
    if (header.key === "Content-Security-Policy") header.value = withSecurityPolicy(header.value, root);
}
fs.writeFileSync(filename, JSON.stringify(config, null, 2) + "\n");
