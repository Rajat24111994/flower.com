// Shared setup for the integration tests. They run the real api/*.js handlers and the real
// firestore.rules against the Firebase emulators (started by `npm run integration`), never
// against the live project: the project id is a "demo-" id, which the emulators keep offline.
const { generateKeyPairSync, randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ID = process.env.GCLOUD_PROJECT || "demo-flowerflow";
const ROOT = path.join(__dirname, "../../flower.com");
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST;
if (!AUTH_HOST || !FIRESTORE_HOST || !PROJECT_ID.startsWith("demo-")) {
    throw new Error("Chạy bằng `npm run integration` trong thư mục tests (cần Firebase emulator, project demo-).");
}

// api/*.js read the service account from the environment like on Vercel. A throwaway key is
// enough because the emulators do not check signatures.
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
Object.assign(process.env, {
    FIREBASE_PROJECT_ID: PROJECT_ID,
    FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
        type: "service_account",
        project_id: PROJECT_ID,
        client_email: `test@${PROJECT_ID}.iam.gserviceaccount.com`,
        private_key: privateKey.export({ type: "pkcs8", format: "pem" })
    }),
    CRON_SECRET: "test-cron-secret"
});

const { getAdminAuth, getAdminFirestore } = require(path.join(ROOT, "lib/firebase-admin.js"));
const { Timestamp } = require(require.resolve("firebase-admin/firestore", { paths: [ROOT] }));
const { syncAdminRole } = require(path.join(ROOT, "lib/admin-roles.js"));
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "flower.json"), "utf8")).flower;

const handlers = {
    orders: require(path.join(ROOT, "api/orders.js")),
    products: require(path.join(ROOT, "api/products.js")),
    adminUsers: require(path.join(ROOT, "api/admin/users.js")),
    ownerUsers: require(path.join(ROOT, "api/owner/users.js"))
};

// Calls a Vercel-style handler in-process and returns { status, body, headers }.
async function callApi(name, { method = "POST", body, query = {}, token, headers = {} } = {}) {
    const response = { statusCode: 200, headers: {}, body: undefined };
    const res = {
        setHeader(key, value) { response.headers[key.toLowerCase()] = value; },
        getHeader(key) { return response.headers[key.toLowerCase()]; },
        status(code) { response.statusCode = code; return res; },
        json(data) { response.body = JSON.parse(JSON.stringify(data)); return res; },
        end() { return res; }
    };
    const req = {
        method,
        query,
        body,
        headers: {
            "x-forwarded-for": "203.0.113.7",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...headers
        },
        socket: { remoteAddress: "203.0.113.7" }
    };
    await handlers[name](req, res);
    return { status: response.statusCode, body: response.body, headers: response.headers };
}

async function resetEmulators() {
    await fetch(`http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
    await fetch(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: "DELETE" });
}

async function seedProducts(quantities = {}) {
    const db = getAdminFirestore();
    const batch = db.batch();
    catalog.forEach((product) => {
        batch.set(db.collection("products").doc(String(product.id)), {
            ...product,
            quantity: quantities[product.id] ?? 10
        });
    });
    await batch.commit();
}

async function setPromotions(items) {
    await getAdminFirestore().doc("metadata/activePromotions").set({ items });
}

// Creates an account (optionally admin/owner) and returns { uid, email, token }.
async function createUser(role = "customer") {
    const email = `${role}-${randomUUID().slice(0, 8)}@test.vn`;
    const password = "Test@12345";
    const user = await getAdminAuth().createUser({ email, password, displayName: `Khách ${role}` });
    if (role !== "customer") {
        const claims = role === "owner" ? { admin: true, role: "owner" } : { admin: true };
        await getAdminAuth().setCustomUserClaims(user.uid, claims);
        await syncAdminRole(getAdminFirestore(), { ...user, customClaims: claims }, true);
    }
    return { uid: user.uid, email, password, token: await signIn(email, password) };
}

async function signIn(email, password) {
    const response = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, returnSecureToken: true })
    });
    const data = await response.json();
    if (!data.idToken) throw new Error(`Đăng nhập emulator thất bại: ${JSON.stringify(data)}`);
    return data.idToken;
}

function deliveryDate() {
    return new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Quotes then places an order the way checkout.html does. Returns { status, body, quote }.
async function placeOrder({ items = [{ id: "1", quantity: 1 }], paymentMethod = "cod", promotionId = "", token, overrides = {} } = {}) {
    const quote = await callApi("orders", { body: { action: "quote", items, promotionId } });
    if (quote.status !== 200) return { ...quote, quote };
    const result = await callApi("orders", {
        token,
        body: {
            customerName: "Nguyễn Văn A",
            phone: "0908123456",
            address: "147 Lê Lợi, Quận 1",
            deliveryDate: deliveryDate(),
            deliveryTime: "08:00–12:00",
            paymentMethod,
            promotionId,
            idempotencyKey: randomUUID(),
            expectedTotals: quote.body.totals,
            items,
            ...overrides
        }
    });
    return { ...result, quote };
}

async function stockOf(id) {
    return (await getAdminFirestore().doc(`products/${id}`).get()).data().quantity;
}

module.exports = {
    PROJECT_ID,
    FIRESTORE_HOST,
    ROOT,
    catalog,
    callApi,
    resetEmulators,
    seedProducts,
    setPromotions,
    createUser,
    signIn,
    placeOrder,
    stockOf,
    deliveryDate,
    Timestamp,
    db: () => getAdminFirestore(),
    auth: () => getAdminAuth()
};
