const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
let loginHandler;
if (process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST) {
  // The test server only runs this API against local emulators. No real credentials
  // or production data are needed, and the API keeps its normal server-side checks.
  const { generateKeyPairSync } = require("node:crypto");
  const projectId = process.env.GCLOUD_PROJECT || "web-ban-hoa-9fe0b";
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env.FIREBASE_PROJECT_ID = projectId;
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
    project_id: projectId, client_email: `test@${projectId}.iam.gserviceaccount.com`,
    private_key: privateKey.export({ type: "pkcs8", format: "pem" })
  });
  loginHandler = require("../api/login");
}
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };
http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (pathname === "/api/login") {
      res.setHeader("Content-Type", "application/json");
      if (!loginHandler) { res.writeHead(503).end(JSON.stringify({ error: "Cần khởi động Firebase Emulator." })); return; }
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 8192) { res.writeHead(413).end(); return; }
      }
      req.body = body ? JSON.parse(body) : {};
      res.status = (status) => { res.statusCode = status; return res; };
      res.json = (value) => res.end(JSON.stringify(value));
      await loginHandler(req, res);
      return;
    }
    const file = path.resolve(root, "." + (pathname === "/" ? "/index.html" : pathname));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    let data = await fs.readFile(file);
    if (path.extname(file) === ".html") {
      data = Buffer.from(data.toString("utf8").replace(/<head(?:\s[^>]*)?>/i,
        '$&\n<script>window.FlowerAuthMode = "firebase";</script>'));
    }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" }).end(data);
  } catch { res.writeHead(404).end(); }
}).listen(4173, "127.0.0.1");
