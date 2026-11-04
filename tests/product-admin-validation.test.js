const test = require("node:test");
const assert = require("node:assert/strict");
const { UNCATEGORIZED, safeImageUrl, validateProductInput } = require("../flower.com/js/admin/product-admin-validation.js");

const categories = ["Hoa sinh nhật", "Hoa khai trương"];
const validInput = {
    title: "Bó hoa hồng",
    image: "./images/rose.webp",
    images: "https://cdn.example.test/rose-1.webp\nhttps://cdn.example.test/rose-2.webp",
    category: "Hoa sinh nhật",
    price: "450000",
    quantity: "5",
    description: "Bó hoa tươi tặng sinh nhật.",
    meaning: "Tượng trưng cho tình yêu.",
    colors: "đỏ, trắng, đỏ",
    occasions: "sinh nhật, kỷ niệm",
    status: "active"
};

test("sản phẩm hợp lệ được chuẩn hóa đầy đủ, bỏ trùng ảnh và tag", () => {
    const result = validateProductInput(validInput, categories);
    assert.deepEqual(result.errors, {});
    assert.deepEqual(result.product, {
        title: "Bó hoa hồng",
        image: "./images/rose.webp",
        images: ["https://cdn.example.test/rose-1.webp", "https://cdn.example.test/rose-2.webp"],
        category: "Hoa sinh nhật",
        price: 450000,
        quantity: 5,
        description: "Bó hoa tươi tặng sinh nhật.",
        meaning: "Tượng trưng cho tình yêu.",
        colors: ["đỏ", "trắng"],
        occasions: ["sinh nhật", "kỷ niệm"],
        status: "active"
    });
});

test("từ chối tên trống, giá sai, tồn kho âm/phân số và danh mục không tồn tại", () => {
    const result = validateProductInput({
        ...validInput,
        title: "   ",
        price: "1000.5",
        quantity: "-1",
        category: "Danh mục không có"
    }, categories);
    assert.equal(result.product, null);
    assert.equal(result.errors.title, "Vui lòng nhập tên sản phẩm.");
    assert.match(result.errors.price, /số nguyên VND/);
    assert.match(result.errors.quantity, /số nguyên từ 0/);
    assert.match(result.errors.category, /danh mục hợp lệ/);
});

test("danh mục chưa phân loại được chấp nhận nhưng phải chọn rõ ràng", () => {
    const uncategorized = validateProductInput({ ...validInput, category: UNCATEGORIZED }, categories);
    assert.equal(uncategorized.product.category, "");
    const missing = validateProductInput({ ...validInput, category: "" }, categories);
    assert.match(missing.errors.category, /danh mục hợp lệ/);
});

test("kiểm tra URL ảnh, giới hạn 8 ảnh phụ và trạng thái", () => {
    assert.equal(safeImageUrl("javascript:alert(1)"), false);
    assert.equal(safeImageUrl("data:image/png;base64,abc"), false);
    assert.equal(safeImageUrl("https://cdn.example.test/flower.webp"), true);
    const tooMany = Array.from({ length: 9 }, (_, index) => `./images/${index}.webp`).join("\n");
    const images = validateProductInput({ ...validInput, images: tooMany }, categories);
    assert.match(images.errors.images, /tối đa 8/);
    const invalidStatus = validateProductInput({ ...validInput, status: "deleted" }, categories);
    assert.match(invalidStatus.errors.status, /không hợp lệ/);
});

test("mất kết nối và lỗi quyền được thông báo bằng tiếng Việt", () => {
    const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "../flower.com/js/catalog/product-store.js"), "utf8");
    assert.match(source, /Mất kết nối Firestore nên thay đổi chưa được lưu/);
    assert.match(source, /Tài khoản không có quyền quản lý sản phẩm/);
});
