# FF-06 — Luồng khách hàng

Issue #161. Ngày 17/11/2026, Asia/Bangkok; baseline main `98a6a33`.
Thực hiện sau khi người dùng cho phép để #160 mở.

## Kết quả

- Playwright Chromium: **66/66 đạt**, desktop 1280 và mobile 390, khoảng 1,1 phút.
  Nhóm account-auth, catalog-search, bouquet-options, order-tracking, payment-result,
  purchase-review, store-purchase, forgot-password, firebase-logout, login-protection.
- HTTP tới host C# thật: **28/28 bài hiện hữu đạt** trong feature-accounts,
  feature-orders và system: gắn user với đơn, chặn token sai, giá server, quote,
  đặt hàng/replay, tranh kho, expiry, tra cứu, đánh giá và yêu cầu thiết kế/báo giá.
- Hai bài frontend module → C# → Firestore mới: **2/2 đạt** ở 1280 và 390 px.
  Đọc catalog, quote, create/replay, account tracking, link VNPay, lưu stock/order;
  đánh giá sau fixture giao hàng và chặn gửi đánh giá lặp.
- Hồi quy cuối cùng sau tất cả thay đổi FF-06–FF-09: **122/122 HTTP/integration đạt**,
  0 bỏ qua, 72,74 giây; gồm cả hai bài browser-module mới.
- Lượt native đầu có 2 test mới thất bại do fixture thiếu profile trong safe-storage:
  getPublicOrder trả dữ liệu guest đã lọc đúng thiết kế. Đã nạp safe-storage.js và
  profile đăng nhập vào fixture; không đổi API để làm test đạt.

## Phạm vi và thay đổi

Browser UI kiểm tra đăng ký/đăng nhập, khôi phục mật khẩu, catalog/lọc/tìm kiếm,
bó tùy chỉnh, giỏ/checkout, tracking, kết quả thanh toán, review và logout-all.
Một số bài dùng API/SDK giả lập để kiểm tra giao diện/error/retry; store-purchase
và khôi phục mật khẩu dùng Auth Emulator. Không gọi các bài này là UI → C# trọn vẹn.

`customer-browser.test.js` nạp order-store.js thật trong Chromium, gửi HTTP thật
đến host C#, kiểm tra dữ liệu lưu bằng Admin SDK. Identity ở browser là fixture có
token Auth Emulator; backend xác minh token thật. Trang contract là fixture tối giản,
không thay thế bộ kiểm thử bố cục của các trang website.

Đã chuyển script E2E sang project `demo-flowerflow-browser`; static test server
chỉ thay Firebase project trong response test, không sửa config production. Fixture
store-purchase/recovery dùng cùng project. CI ASP.NET cài Chromium để chạy các bài
browser → C# mới; không bỏ qua bài mới trên host native.

Ảnh của lượt UI được giữ local tại `artifacts/ff-06-browser`; CI browser lưu artifact
theo workflow hiện hữu. Không commit ảnh/bản ghi chứa token.

## Giới hạn

Không kiểm tra Google OAuth thật, email thực hoặc VNPay provider thật; #160 vẫn mở.
Không tạo giao dịch/dữ liệu production. Môi trường local Windows, Node 26.13.0,
.NET 10, Java 21; CI dùng Node 24. Các viewport là kiểm chứng trình duyệt, không phải
thiết bị vật lý. Phần giao hàng trong test native là fixture back-office có ghi rõ.
