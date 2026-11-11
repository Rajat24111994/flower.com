// Unit test các module nhỏ còn thiếu coverage (#125): kiểm tra/nén ảnh đánh giá,
// cấu hình Firebase Admin, kiểm tra quyền và chính sách mật khẩu.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const SITE = path.join(__dirname, "../flower.com");

test("review photos: at most 3 JPG/PNG/WebP files of up to 5 MB each", async () => {
    const { validateFiles, MAX_PHOTOS, MAX_UPLOAD_SIZE } = await import(pathToFileURL(path.join(SITE, "js/review/review-images.js")));
    const photo = (type = "image/jpeg", size = 1000) => ({ type, size });
    assert.equal(MAX_PHOTOS, 3);
    assert.doesNotThrow(() => validateFiles([photo(), photo("image/png"), photo("image/webp")]));
    assert.throws(() => validateFiles([photo(), photo(), photo(), photo()]), /tối đa 3 ảnh/);
    assert.throws(() => validateFiles([photo("image/gif")]), /JPG, PNG hoặc WebP/);
    assert.throws(() => validateFiles([photo("image/jpeg", 0)]), /không quá 5 MB/);
    assert.throws(() => validateFiles([photo("image/jpeg", MAX_UPLOAD_SIZE + 1)]), /không quá 5 MB/);
});

test("review photos are scaled to 1280px, flattened on white and compressed under 120 KB", async (t) => {
    const { preparePhotos } = await import(pathToFileURL(path.join(SITE, "js/review/review-images.js")) + "?prepare");
    const revoked = [];
    const drawn = [];
    let sizeCalls = 0;
    const saved = { URL: globalThis.URL, Image: globalThis.Image, document: globalThis.document };
    t.after(() => Object.assign(globalThis, saved));
    globalThis.URL = Object.assign(function URL() {}, { createObjectURL: () => "blob:photo", revokeObjectURL: (url) => revoked.push(url) });
    globalThis.Image = class { constructor() { this.naturalWidth = 4000; this.naturalHeight = 2000; } async decode() {} };
    globalThis.document = {
        createElement: () => ({
            width: 0, height: 0,
            getContext() { return { fillRect: () => {}, drawImage: (image, x, y, width, height) => drawn.push([width, height]), set fillStyle(value) { this.color = value; } }; },
            // Lần đầu quá lớn để đi qua vòng giảm chất lượng, sau đó vừa giới hạn.
            toDataURL: () => "data:image/jpeg;base64," + "A".repeat(++sizeCalls < 3 ? 200 * 1024 : 1000)
        })
    };
    const [data] = await preparePhotos([{ type: "image/jpeg", size: 1000 }]);
    assert.match(data, /^data:image\/jpeg;base64,/);
    assert.deepEqual(drawn[0], [1280, 640], "giữ tỉ lệ, cạnh dài 1280px");
    assert.deepEqual(revoked, ["blob:photo"], "luôn giải phóng URL tạm");

    globalThis.Image = class { async decode() { throw new Error("broken"); } };
    await assert.rejects(preparePhotos([{ type: "image/png", size: 10 }]), /Không đọc được ảnh/);
    assert.equal(revoked.length, 2);
});

test("Firebase Admin reports missing or malformed service account as a configuration error", () => {
    const saved = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    try {
        const admin = require(path.join(SITE, "lib/firebase-admin.js"));
        delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
        assert.throws(() => admin.getAdminAuth(), (error) => error.code === "admin-api-not-configured" && /not configured/.test(error.message));
        process.env.FIREBASE_SERVICE_ACCOUNT_JSON = "{khong-phai-json";
        assert.throws(() => admin.getAdminFirestore(), (error) => error.code === "admin-api-not-configured" && /not valid JSON/.test(error.message));
    } finally {
        if (saved === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
        else process.env.FIREBASE_SERVICE_ACCOUNT_JSON = saved;
    }
});

test("role checks: missing/invalid token 401, non-admin 403, revoked role 403, owner needs both claim and record", async (t) => {
    const errorLog = console.error;
    console.error = () => {};
    t.after(() => { console.error = errorLog; });
    const { verifyAdminRequest, verifyOwnerRequest } = require(path.join(SITE, "lib/firebase-admin.js"));
    const { fakeFirestore, fakeAuth } = require("./helpers/fake-firestore");
    const auth = fakeAuth({ "fake-owner": { uid: "admin-uid", admin: true, role: "owner" } });
    const db = fakeFirestore({ "adminRoles/admin-uid": { role: "admin" }, "adminRoles/owner-uid": { role: "owner" } });
    const run = async (check, authorization, database = db) => {
        const result = {};
        const res = { status(code) { result.status = code; return res; }, json(body) { result.body = body; return res; } };
        const claims = await check({ headers: authorization ? { authorization } : {} }, res, auth, database);
        return { claims, ...result };
    };
    assert.equal((await run(verifyAdminRequest)).status, 401);
    assert.equal((await run(verifyAdminRequest, "Bearer sai")).status, 401);
    assert.equal((await run(verifyAdminRequest, "Bearer user-token")).status, 403);
    assert.equal((await run(verifyAdminRequest, "Bearer admin-token")).claims.uid, "admin-uid");
    assert.equal((await run(verifyAdminRequest, "Bearer admin-token", fakeFirestore())).status, 403, "đã gỡ trong adminRoles");
    assert.equal((await run(verifyOwnerRequest, "Bearer admin-token")).status, 403);
    assert.equal((await run(verifyOwnerRequest, "Bearer fake-owner")).status, 403, "claim owner nhưng hồ sơ chỉ là admin");
    assert.equal((await run(verifyOwnerRequest, "Bearer owner-token")).claims.uid, "owner-uid");
    const broken = { collection: () => ({ doc: () => ({ get: async () => { throw new Error("down"); } }) }) };
    assert.equal((await run(verifyAdminRequest, "Bearer admin-token", broken)).status, 503);
});

test("password hint follows the shared policy as the user types", () => {
    const policy = require(path.join(SITE, "js/core/password-policy.js"));
    const listeners = {};
    const input = { value: "", validity: "", addEventListener: (type, fn) => { listeners[type] = fn; },
        setCustomValidity(message) { this.validity = message; } };
    const hint = { textContent: "" };
    policy.bindPasswordHint(input, hint);
    assert.equal(input.validity, "", "ô trống chưa báo lỗi");
    assert.equal(hint.textContent, policy.message);
    input.value = "abcdefgh";
    listeners.input();
    assert.equal(input.validity, policy.message, "thiếu số");
    input.value = "abcdefg1";
    listeners.input();
    assert.equal(input.validity, "");
    assert.match(hint.textContent, /Đã đáp ứng/);
    assert.equal(policy.isStrongPassword("a1".repeat(2049)), false, "quá 4096 ký tự");
});
