const test = require("node:test");
const assert = require("node:assert/strict");
const catalog = require("../flower.com/js/catalog/catalog-search.js");
const { adjustment } = require("../flower.com/js/catalog/product-sales.js");
const { normalizeProduct } = require("../flower.com/js/catalog/product-store.js");
const products = [
  { id: 1, title: "Bó hồng đỏ", description: "Hoa hồng đỏ", price: 450000, soldCount: 7, colors: ["đỏ"], occasions: ["sinh nhật"] },
  { id: 2, title: "Bó hướng dương", description: "Hoa hướng dương vàng", price: 600000, soldCount: 12, colors: ["vàng"], occasions: ["tốt nghiệp", "khai trương"] },
  { id: 3, title: "Giỏ hồng vàng", description: "Hoa hồng vàng", price: 850000, soldCount: 3, colors: ["vàng"], occasions: ["khai trương"] },
  { id: 4, title: "Lan trắng", description: "Hoa lan hồ điệp", price: 1200000 }
];
const ids = (filters) => catalog.search(products, filters).map((item) => item.id);

test("tìm kiếm không dấu, không phân biệt hoa thường, từ đảo thứ tự và tên loài Anh/Việt", () => {
  assert.deepEqual(ids({ query: "  DO  HỒNG " }), [1]);
  assert.deepEqual(ids({ query: "rose" }), [1, 3]);
  assert.deepEqual(ids({ query: "lan ho diep" }), [4]);
  assert.deepEqual(ids({ query: "sunflower" }), [2]);
  assert.deepEqual(ids({ query: "khong co loai hoa nay" }), []);
});

test("kết hợp loài, khoảng giá bao gồm biên, dịp tặng và màu", () => {
  assert.deepEqual(ids({ flower: "rose" }), [1, 3]);
  assert.deepEqual(ids({ min: 600000, max: 850000, color: "vàng", occasion: "khai trương" }), [2, 3]);
  assert.deepEqual(ids({ occasion: "tốt nghiệp", color: "vàng" }), [2]);
  assert.deepEqual(ids({ flower: "rose", occasion: "tốt nghiệp" }), []);
  assert.equal(catalog.matchesColor({ title: "Hoa hồng đỏ", description: "Hoa hồng đỏ" }, "hồng"), false);
  assert.equal(catalog.matchesColor({ description: "Hoa hồng; phối sắc đỏ, trắng; bó vừa" }, "trắng"), true);
});

test("sắp giá/phổ biến và giữ metadata sau chuẩn hóa Firestore", () => {
  assert.deepEqual(ids({ sort: "dsc-p" }), [4, 3, 2, 1]);
  assert.deepEqual(ids({ sort: "asc-p" }), [1, 2, 3, 4]);
  assert.deepEqual(ids({ sort: "popular" }), [2, 1, 3, 4]);
  const product = normalizeProduct(products[1]);
  assert.equal(product.soldCount, 12);
  assert.deepEqual(product.colors, ["vàng"]);
  assert.deepEqual(product.occasions, ["tốt nghiệp", "khai trương"]);
});

test("chỉ ghi nhận bán một lần khi giao, giảm khi nhận lại hàng và không tính đơn chờ", () => {
  assert.equal(adjustment({}, "Đã giao"), 1);
  assert.equal(adjustment({ salesCounted: true }, "Đã giao"), 0);
  assert.equal(adjustment({}, "Chờ xác nhận"), 0);
  assert.equal(adjustment({ salesCounted: true }, "Đã hủy", false), 0);
  assert.equal(adjustment({ salesCounted: true }, "Đã hủy", true), -1);
  assert.equal(adjustment({ salesCounted: false }, "Đã hủy", true), 0);
});

{
  // #30: the occasion filter lists the usual occasions plus every occasion the admin set on a product.
  const { occasionOptions } = require("../flower.com/js/catalog/catalog-search.js");
  const options = occasionOptions([
    { occasions: ["Valentine", "sinh nhật"] },
    { occasions: ["  Lễ tốt nghiệp  "] },
    { title: "Không có dịp" }
  ]);
  assert.ok(options.includes("Sinh nhật"), "giữ các dịp có sẵn");
  assert.ok(options.includes("Valentine"), "thêm dịp admin tự gắn");
  assert.ok(options.includes("Lễ tốt nghiệp"), "bỏ khoảng trắng thừa");
  assert.equal(options.filter((value) => value.toLocaleLowerCase("vi") === "sinh nhật").length, 1, "không lặp dịp đã có");
  assert.equal(options.indexOf("Sinh nhật"), 0, "dịp có sẵn đứng trước");
}
