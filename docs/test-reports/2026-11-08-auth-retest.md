# Báo cáo kiểm thử — 2026-11-08 — Đăng nhập và Quên mật khẩu

## Thông tin đợt chạy

- **Ngày/giờ:** 2026-11-08, kết thúc 17:40 (Asia/Bangkok, UTC+7).
- **Commit/nhánh:** thay đổi chưa commit; nền `dd6c80d`, nhánh `fix/prevent-duplicate-product-images`.
- **Môi trường:** Windows, Node.js v24.22.1, Firebase CLI 15.34.1, JBR Java 25, Google Chrome headless.

## Lệnh và kết quả

Chạy từ `flower.com`; đặt PATH tới Java có sẵn, cache emulator/config trong `.tools/` và
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` tới Chrome có sẵn.

| Lệnh | Kết quả | Đạt | Trượt | Bỏ qua | Ghi chú |
| --- | --- | ---: | ---: | ---: | --- |
| `npm.cmd test` | Đạt | 128 | 0 | 0 | Toàn bộ kiểm thử đơn vị |
| `node node_modules/firebase-tools/lib/bin/firebase.js emulators:exec --project demo-flowerflow --only auth,firestore "node --test ../tests/integration/login-protection.test.js"` | Đạt | 3 | 0 | 0 | Chính sách khóa, đồng thời, custom token, hoàn tất đặt lại mật khẩu |
| `node node_modules/firebase-tools/lib/bin/firebase.js emulators:exec --project web-ban-hoa-9fe0b --only auth,firestore "node node_modules/@playwright/test/cli.js test login-protection.spec.js forgot-password.spec.js store-purchase.spec.js"` | Đạt | 14 | 0 | 0 | Máy tính và điện thoại; gồm 8 kiểm thử Quên mật khẩu mới |
| `node --check e2e/forgot-password.spec.js` và `git diff --check` | Đạt | — | — | — | Cú pháp và khoảng trắng hợp lệ |

## Lỗi và cách tái hiện

- **Lỗi chức năng còn phát hiện:** Không có trong phạm vi đã chạy.
- Lần đầu chạy bộ giao diện: 12 đạt, 2 trượt do assertion mới so sánh đối tượng DOM
  `ValidityState` bằng `toHaveJSProperty(..., expect.anything())`. Đã đổi sang kiểm tra trực tiếp
  `element.validity.valid`, giữ nguyên điều kiện email không hợp lệ và không gửi yêu cầu.
  Chạy lại cả 14 kiểm thử: đạt toàn bộ, không bỏ qua bài nào.
- **Tái hiện kiểm thử email:** chạy Playwright với
  `test forgot-password.spec.js --grep "prefills normalized email"`.

## Ghi chú

- Đã xác nhận điền email từ trang đăng nhập, chuẩn hóa email và từ chối email sai định dạng.
- Email đã đăng ký và chưa đăng ký có cùng thông báo công khai.
- Nút gửi bị vô hiệu hóa trong khi xử lý, được bật lại sau lỗi mạng/giới hạn của nhà cung cấp.
- Trên Firebase Emulator thật: tài khoản bị buộc đặt lại mật khẩu vẫn bị chặn khi biết mật khẩu
  cũ; gửi email chưa xóa khóa; hoàn tất đặt lại khiến mật khẩu cũ bị từ chối, mật khẩu mới đăng
  nhập thành công và lịch sử khóa bị xóa. Kiểm tra này chạy ở cả desktop và mobile.
- Luồng đăng nhập rồi mua hàng vẫn đạt trên cả desktop và mobile.
- Các thao tác xác thực, email và dữ liệu đều dùng emulator hoặc SDK giả lập có kiểm soát,
  không gửi email thật hoặc thay đổi tài khoản khách hàng thật.
- Chưa kiểm tra website đang triển khai hoặc API key restrictions Google Cloud thật.
  Xem [cấu hình trước triển khai](../../flower.com/docs/login-protection.md).
