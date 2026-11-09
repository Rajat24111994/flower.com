const test = require("node:test");
const assert = require("node:assert/strict");
const { internals } = require("../flower.com/api/design-requests.js");

test("yêu cầu thiết kế kiểm tra số lượng, màu, vai trò và giới hạn 50 cành", () => {
  assert.deepEqual(internals.normalizeStems([
    { productId: "rose", quantity: 3, color: "Hồng", role: "main" },
    { productId: "tulip", quantity: 4, color: "Trắng", role: "support" }
  ]), [
    { productId: "rose", quantity: 3, color: "Hồng", role: "main" },
    { productId: "tulip", quantity: 4, color: "Trắng", role: "support" }
  ]);
  assert.equal(internals.normalizeStems([{ productId: "rose", quantity: 0, color: "Hồng" }]), null);
  assert.equal(internals.normalizeStems([{ productId: "rose", quantity: 51, color: "Hồng" }]), null);
  assert.equal(internals.normalizeStems([
    { productId: "rose", quantity: 26, color: "Hồng" },
    { productId: "tulip", quantity: 25, color: "Trắng" }
  ]), null);
  assert.equal(internals.normalizeStems([{ productId: "../other", quantity: 1, color: "Hồng" }]), null);
});

test("thiết kế giới hạn ngân sách, kiểu sắp xếp và số lớp gói", () => {
  assert.equal(internals.parseDesign({ arrangement: "Tự nhiên", size: "Vừa", paperLayers: "2", budget: "500000" }).budget, 500000);
  assert.equal(internals.parseDesign({ arrangement: "tùy ý" }), null);
  assert.equal(internals.parseDesign({ paperMaterial: "Giấy bạc" }), null);
  assert.equal(internals.parseDesign({ palette: "màu lạ" }), null);
  assert.equal(internals.parseDesign({ paperLayers: 6 }), null);
  assert.equal(internals.parseDesign({ budget: -1 }), null);
  assert.equal(internals.parseDesign({ specialRequest: "x".repeat(1501) }), null);
});

test("ảnh mẫu phải là JPEG, PNG hoặc WebP đúng chữ ký và dưới 250 KB", () => {
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(8)]);
  assert.equal(internals.validImage(`data:image/png;base64,${png.toString("base64")}`).startsWith("data:image/png"), true);
  assert.equal(internals.validImage("data:image/png;base64,SGVsbG8="), null);
  assert.equal(internals.validImage(`data:image/png;base64,${Buffer.alloc(250001).toString("base64")}`), null);
  assert.equal(internals.validImage("data:image/svg+xml;base64,PHN2Zz4="), null);
  assert.equal(internals.validImage(""), "");
});

test("mã truy cập chỉ khớp với hash đã lưu", () => {
  const token = "a".repeat(44);
  const crypto = require("node:crypto");
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  assert.equal(internals.validAccessToken(token, hash), true);
  assert.equal(internals.validAccessToken("b".repeat(44), hash), false);
  const request = internals.publicRequest("request-one", { accessTokenHash: hash, status: "Chờ tư vấn" });
  assert.equal(request.accessTokenHash, undefined);
});
