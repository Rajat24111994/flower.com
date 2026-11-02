// One command to set up (or repair) the Firestore database of the shop:
//   1. adminRoles/{uid} for every admin/owner account (needed by firestore.rules)
//   2. products from flower.json that are missing (existing products are not touched), and
//      prices still stored in USD converted to whole VND
//   3. firestore.rules deployed (Firebase Rules API)
//   4. the composite index and TTL policy from firestore.indexes.json
// Safe to run again. Uses Application Default Credentials of a project owner:
//   gcloud auth application-default login
//   npm run setup-firestore
const fs = require("fs");
const path = require("path");
const { applicationDefault, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");
const { syncAdminRoles } = require("../lib/admin-roles");
const { toVndPrice } = require("../product-store");

const projectId = process.env.GOOGLE_CLOUD_PROJECT || "web-ban-hoa-9fe0b";
const root = path.join(__dirname, "..");
const credential = applicationDefault();
initializeApp({ credential, projectId });

async function googleApi(method, url, body) {
    const { access_token: token } = await credential.getAccessToken();
    const response = await fetch(url, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "x-goog-user-project": projectId
        },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok) {
        const error = new Error(data.error?.message || `${response.status} ${response.statusText}`);
        error.status = response.status;
        throw error;
    }
    return data;
}

async function step(label, action) {
    process.stdout.write(`- ${label}... `);
    try {
        const result = await action();
        console.log(result || "xong");
        return true;
    } catch (error) {
        console.log(`LỖI: ${error.message}`);
        return false;
    }
}

async function enableRulesApi() {
    const url = `https://serviceusage.googleapis.com/v1/projects/${projectId}/services/firebaserules.googleapis.com:enable`;
    await googleApi("POST", url, {});
    // Give the newly enabled API a moment before using it.
    await new Promise((resolve) => setTimeout(resolve, 15000));
}

async function deployRules() {
    const content = fs.readFileSync(path.join(root, "firestore.rules"), "utf8");
    const base = `https://firebaserules.googleapis.com/v1/projects/${projectId}`;
    const ruleset = await googleApi("POST", `${base}/rulesets`, {
        source: { files: [{ name: "firestore.rules", content }] }
    });
    const releaseName = `projects/${projectId}/releases/cloud.firestore`;
    try {
        await googleApi("PATCH", `${base}/releases/cloud.firestore`, {
            release: { name: releaseName, rulesetName: ruleset.name }
        });
    } catch (error) {
        if (error.status !== 404) throw error;
        await googleApi("POST", `${base}/releases`, { name: releaseName, rulesetName: ruleset.name });
    }
    return `xong (${ruleset.name.split("/").pop()})`;
}

// Some Firestore features (TTL policies) need the paid Blaze plan; on the free Spark plan they
// are skipped instead of failing the whole setup.
function needsBilling(error) {
    return /billing/i.test(error.message);
}

async function createIndexes() {
    const config = JSON.parse(fs.readFileSync(path.join(root, "firestore.indexes.json"), "utf8"));
    const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/collectionGroups`;
    const done = [];
    for (const index of config.indexes || []) {
        try {
            await googleApi("POST", `${base}/${index.collectionGroup}/indexes`, {
                queryScope: index.queryScope || "COLLECTION",
                fields: index.fields.map(({ fieldPath, order, arrayConfig }) => ({ fieldPath, ...(order ? { order } : { arrayConfig }) }))
            });
            done.push(`index ${index.collectionGroup} đang được tạo`);
        } catch (error) {
            if (error.status === 409) done.push(`index ${index.collectionGroup} đã có`);
            else if (needsBilling(error)) done.push(`index ${index.collectionGroup} bỏ qua (cần gói Blaze)`);
            else throw error;
        }
    }
    for (const field of config.fieldOverrides || []) {
        if (!field.ttl) continue;
        try {
            await googleApi("PATCH", `${base}/${field.collectionGroup}/fields/${field.fieldPath}?updateMask=ttlConfig`, { ttlConfig: {} });
            done.push(`TTL ${field.collectionGroup}.${field.fieldPath}`);
        } catch (error) {
            if (!needsBilling(error)) throw error;
            done.push(`TTL ${field.collectionGroup}.${field.fieldPath} bỏ qua (cần gói Blaze, không bắt buộc)`);
        }
    }
    return done.join(", ");
}

(async () => {
    console.log(`Thiết lập Firestore cho project ${projectId}`);
    const db = getFirestore();
    const results = [];

    results.push(await step("Danh sách admin (adminRoles)", async () => {
        let pageToken;
        let changed = 0;
        do {
            const page = await getAuth().listUsers(1000, pageToken);
            if (page.users.length) changed += await syncAdminRoles(db, page.users);
            pageToken = page.pageToken;
        } while (pageToken);
        const total = (await db.collection("adminRoles").get()).size;
        return `xong (${total} tài khoản quản trị, ${changed} thay đổi)`;
    }));

    results.push(await step("Sản phẩm từ flower.json", async () => {
        const catalog = JSON.parse(fs.readFileSync(path.join(root, "flower.json"), "utf8")).flower;
        const existing = new Set((await db.collection("products").get()).docs.map((doc) => doc.id));
        const missing = catalog.filter((product) => !existing.has(String(product.id)));
        const batch = db.batch();
        missing.forEach((product) => batch.set(db.collection("products").doc(String(product.id)), { ...product, quantity: product.quantity ?? 10 }));
        batch.set(db.collection("metadata").doc("productCatalog"), { catalogSeeded: true }, { merge: true });
        await batch.commit();
        return `xong (thêm ${missing.length}, giữ nguyên ${existing.size} sản phẩm đã có)`;
    }));

    // Prices used to be stored in USD (e.g. 73.99); they are whole VND now (#40).
    results.push(await step("Đổi giá sản phẩm cũ từ USD sang VND", async () => {
        const snapshot = await db.collection("products").get();
        const legacy = snapshot.docs.filter((doc) => {
            const price = Number(doc.get("price"));
            return price > 0 && price < 1000;
        });
        for (let index = 0; index < legacy.length; index += 400) {
            const batch = db.batch();
            legacy.slice(index, index + 400).forEach((doc) => batch.update(doc.ref, { price: toVndPrice(doc.get("price")) }));
            await batch.commit();
        }
        return `xong (đổi ${legacy.length}, giữ nguyên ${snapshot.size - legacy.length} sản phẩm đã là VND)`;
    }));

    results.push(await step("Bật Firebase Rules API", enableRulesApi));
    results.push(await step("Đưa firestore.rules lên", deployRules));
    results.push(await step("Tạo index và TTL", createIndexes));

    const failed = results.filter((ok) => !ok).length;
    console.log(failed ? `\nCòn ${failed} bước lỗi. Chụp màn hình gửi người hỗ trợ.` : "\nHoàn tất. Mở trang admin và bấm Ctrl + F5.");
    process.exitCode = failed ? 1 : 0;
})();
