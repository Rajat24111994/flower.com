const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const h = require("./helpers");
const jpeg = fs.readFileSync(path.join(h.ROOT, "images/start.jpeg"));
const photo = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
test.beforeEach(async () => { await h.resetEmulators(); });

test("chỉ quản lý còn quyền mới tải được ảnh sản phẩm", async () => {
  const customer = await h.createUser();
  const admin = await h.createUser("admin");
  assert.equal((await h.callApi("productImages", { body: { photo } })).status, 401);
  assert.equal((await h.callApi("productImages", { token: customer.token, body: { photo } })).status, 403);
  await h.db().doc(`adminRoles/${admin.uid}`).delete();
  assert.equal((await h.callApi("productImages", { token: admin.token, body: { photo } })).status, 403);
});

test("ảnh không phải JPG hợp lệ bị từ chối, không lưu gì", async () => {
  const admin = await h.createUser("admin");
  for (const bad of [undefined, "", "https://example.com/a.jpg", "data:image/png;base64,iVBORw0KGgo=",
    `data:image/jpeg;base64,${Buffer.from("not a jpeg").toString("base64")}`]) {
    const response = await h.callApi("productImages", { token: admin.token, body: { photo: bad } });
    assert.equal(response.status, 400, String(bad).slice(0, 40));
    assert.equal(response.body.code, "invalid-photo");
  }
  assert.equal((await h.db().collection("productImages").get()).size, 0);
});

test("tải ảnh trả về đường dẫn dùng được ngay; khách xem được; tải lại cùng ảnh không tạo bản sao", async () => {
  const admin = await h.createUser("admin");
  const uploaded = await h.callApi("productImages", { token: admin.token, body: { photo } });
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
  assert.match(uploaded.body.url, /^\/api\/product-images\?id=[a-f0-9]{40}$/);
  const id = new URL(uploaded.body.url, "https://shop.test").searchParams.get("id");

  const again = await h.callApi("productImages", { token: admin.token, body: { photo } });
  assert.equal(again.body.url, uploaded.body.url);
  assert.equal((await h.db().collection("productImages").get()).size, 1);

  const shown = await h.callApi("productImages", { method: "GET", query: { id } });
  assert.equal(shown.status, 200);
  assert.equal(shown.headers["content-type"], "image/jpeg");
  assert.match(shown.headers["cache-control"], /immutable/);
  assert.deepEqual(Buffer.from(shown.body), jpeg);

  assert.equal((await h.callApi("productImages", { method: "GET", query: { id: "a".repeat(40) } })).status, 404);
  assert.equal((await h.callApi("productImages", { method: "GET", query: { id: "../x" } })).status, 404);
});
