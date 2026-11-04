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
    "Tài khoản",
    "Đơn hàng",
    "Nội dung bạn tự nhập",
    "Thanh toán",
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
