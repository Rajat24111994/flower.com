const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const privacyPage = fs.readFileSync(
  path.join(__dirname, "../flower.com/privacy.html"),
  "utf8"
);

test("privacy policy describes data collected and its purposes", () => {
  for (const phrase of [
    "Email, mã tài khoản và phương thức đăng nhập",
    "Tên người đặt",
    "Lời chúc và ghi chú bạn tự nhập",
    "Thông tin thanh toán",
    "Dữ liệu kỹ thuật cần cho an toàn",
    "Mục đích sử dụng",
    "Firebase Authentication",
    "Cloud Firestore",
    "Vercel",
    "VNPay",
    "Google Fonts"
  ]) {
    assert.ok(privacyPage.includes(phrase), `privacy policy should mention ${phrase}`);
  }
});

test("privacy policy maps each personal data type to necessity and purpose", () => {
  const table = privacyPage.match(/<tbody>([\s\S]*?)<\/tbody>/);
  assert.ok(table, "privacy policy should include the data and purpose table");
  const rows = [...table[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)];
  assert.ok(rows.length >= 10, "privacy policy should itemize the collected data");
  for (const [, row] of rows) {
    assert.match(row, /<th scope="row">[\s\S]+?<\/th>/, "each data type should be named");
    assert.equal((row.match(/<td>/g) || []).length, 2, "each data type should state when it is needed and why it is used");
  }

  for (const phrase of [
    "Dữ liệu",
    "Khi nào cần cung cấp",
    "Mục đích sử dụng",
    "Tên người đặt",
    "Số điện thoại người đặt",
    "Địa chỉ giao hàng",
    "Tên và số điện thoại người nhận",
    "Email không bắt buộc khi đặt hàng không dùng tài khoản",
    "không sao chép email vào hồ sơ đơn",
    "không hỏi ngày sinh, giới tính hoặc giấy tờ tùy thân"
  ]) {
    assert.ok(privacyPage.includes(phrase), `privacy policy should mention ${phrase}`);
  }
});

test("privacy policy explains storage, safeguards, retention and deletion requests", () => {
  for (const phrase of [
    "local storage",
    "session storage",
    "HTTPS",
    "24 giờ",
    "xem, sửa hoặc xóa",
    "hello@flowerflow.vn",
    "./contact.html",
    "mã đơn",
    "Không gửi mật khẩu"
  ]) {
    assert.ok(privacyPage.includes(phrase), `privacy policy should mention ${phrase}`);
  }
  assert.match(privacyPage, /<a href="#information-collected">/);
  assert.match(privacyPage, /<section class="information-section" id="your-choices">/);
  assert.match(privacyPage, /href="mailto:hello@flowerflow\.vn/);
});
