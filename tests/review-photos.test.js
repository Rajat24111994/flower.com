const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { validateReviewPhotos, jpegDimensions, MAX_PHOTO_BYTES } = require("../flower.com/lib/review-images");
const jpeg = fs.readFileSync(path.join(__dirname, "../flower.com/images/start.jpeg"));
const photo = `data:image/jpeg;base64,${jpeg.toString("base64")}`;

test("ảnh đánh giá: JPEG có giới hạn, không nhận SVG/URL/giả định dạng/quá số ảnh", () => {
  assert.deepEqual(jpegDimensions(jpeg), { width: 1182, height: 300 });
  assert.equal(validateReviewPhotos([photo])[0].length, jpeg.length);
  assert.deepEqual(validateReviewPhotos(), []);
  for (const input of [[photo, photo, photo, photo], ["https://example.com/photo.jpg"],
    ["data:image/svg+xml;base64,PHN2Zz4="], ["data:image/jpeg;base64,dGV4dA=="], {},
    [`data:image/jpeg;base64,${Buffer.alloc(MAX_PHOTO_BYTES + 1).toString("base64")}`]]) {
    assert.equal(validateReviewPhotos(input), null);
  }
});
test("client quản trị từ chối thay đổi sao, nhận xét, ảnh trước khi gọi Firestore", async () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../flower.com/js/review/review-store.js"), "utf8"), context);
  for (const changes of [{ rating: 5 }, { comment: "Admin sửa" }, { photoIds: [] }, { authorUid: "admin" }, { verifiedPurchase: true }]) {
    await assert.rejects(context.FlowerReviewStore.update("id", changes), /Không được sửa/);
  }
});
test("client kiểm tra file đầu vào trước xử lý ảnh", async () => {
  const { validateFiles } = await import("../flower.com/js/review/review-images.js");
  assert.doesNotThrow(() => validateFiles([{ type: "image/png", size: 1000 }]));
  assert.throws(() => validateFiles([{ type: "image/svg+xml", size: 1000 }]));
  assert.throws(() => validateFiles([{ type: "image/jpeg", size: 6 * 1024 * 1024 }]));
});
