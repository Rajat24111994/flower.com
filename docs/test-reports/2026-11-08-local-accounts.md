# Báo cáo kiểm thử — 2026-11-08 — Tài khoản tự tạo trên máy

## Thông tin đợt chạy

- **Ngày/giờ:** 2026-11-08, khoảng 18:20–18:53 (Asia/Bangkok, UTC+7).
- **Commit/nhánh:** thay đổi chưa commit trên `fix/prevent-duplicate-product-images`, nền `dd6c80d`.
- **Môi trường:** Windows, PowerShell, Node.js v24.22.1, SQLite có sẵn trong Node, Chrome headless.
- **Phạm vi:** đăng ký, đăng nhập, khóa theo tài khoản, hồ sơ, phiên đăng nhập và khôi phục
  bằng tài khoản có tên dạng email giả; không cần Firebase cho xác thực local.

## Lệnh và kết quả

Chạy trong `flower.com`. Khi chạy trình duyệt, đặt `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`
tới Chrome có sẵn. Tài khoản browser test dùng SQLite trong bộ nhớ, tách khỏi tài khoản local của người dùng.

| Lệnh | Kết quả | Đạt | Trượt | Bỏ qua | Ghi chú |
| --- | --- | ---: | ---: | ---: | --- |
| `npm.cmd run test:coverage` | Đạt | 145 | 0 | 0 | Coverage dòng toàn bộ 56,36%; tài khoản local 93,83%, HTTP auth 78,57%, local server 95,21% |
| `CI=true npm run test:e2e:local` | Đạt | 6 | 0 | 0 | Desktop/mobile: tài khoản giả, lưu mã khôi phục, phiên HttpOnly, đăng xuất, khóa, đặt lại mật khẩu, chống sửa quyền ở local storage |
| `playwright test login-protection.spec.js forgot-password.spec.js --grep "recovery form\|wrong passwords\|another email\|static server"` | Đạt | 12 | 0 | 0 | Hồi quy giao diện chế độ Firebase tùy chọn bằng SDK/API giả lập, không dùng Firebase thật |
| `node --check` với module/script JS đã đổi và `git diff --check` | Đạt | — | — | — | Không có lỗi cú pháp/khoảng trắng |

`CI=true` trong bảng thể hiện biến môi trường; trên PowerShell dùng `$env:CI='true'`.
Không cần Java/Firebase Emulator cho các lệnh kiểm thử tài khoản local trên.

## Lỗi và cách tái hiện

- Lần chạy đầu có một bài mobile khôi phục trượt: thanh liên hệ đang ẩn khi focus input,
  nhưng hiện lại ngay lúc bấm nút gửi, làm sự kiện click rơi vào BODY và không gửi yêu cầu.
- Sửa CSS để thanh liên hệ tiếp tục ẩn khi biểu mẫu có `:focus-within`, gồm cả nút gửi.
  Chạy lại cả sáu bài local và 12 bài hồi quy: đạt toàn bộ.
- Test lỗi dữ liệu bắt buộc của biểu mẫu vẫn kiểm tra `validity.valid`, không dùng thao tác gửi
  cưỡng bức hoặc bỏ qua click của người dùng.
- **Lỗi còn phát hiện trong các bộ kiểm thử cuối:** Không có.

## Những hành vi đã xác nhận

- Tên như `ban@demo` hợp lệ, không kiểm tra hộp thư có thật; tên thiếu `@` bị từ chối.
- Không lưu mật khẩu, mã phiên hoặc mã khôi phục dạng rõ trong SQLite. Phiên qua cookie
  HttpOnly/SameSite=Strict; sửa role ở local storage không đổi role máy chủ.
- Đủ chuỗi khóa: sai lần 5 → 15 phút, sau đó mỗi lần thử sai → 30/60/120/240 phút;
  sai lần 10 yêu cầu đặt lại mật khẩu. Thử trong lúc khóa không kiểm tra mật khẩu hoặc kéo dài khóa.
- Yêu cầu song song dùng chung ngân sách tài khoản; hết 15 phút vẫn chỉ một lần thử.
- Tài khoản và khóa còn nguyên sau đóng/mở lại cơ sở dữ liệu, độc lập với local storage/IP.
- Chỉ mã khôi phục đúng mới đổi được mật khẩu, xóa lịch sử khóa, hủy các phiên cũ và cấp mã mới.
  Mã cũ bị từ chối sau khi dùng; đoán sai mã khôi phục năm lần bị chờ 15 phút.
- Trang đăng nhập, khôi phục và hồ sơ chạy với SDK Firebase bị chặn trong bài local.
- Mặc định localhost dùng tài khoản local; chế độ Firebase phải được chọn rõ. Chạy bằng
  Live Server không gọi xác thực Firebase theo mặc định nhưng vẫn cần máy chủ Node cho API.

## Ghi chú

- Đã đặt `AUTH_MODE=local` và mở máy chủ tại `http://127.0.0.1:3000/login.html`.
- Kiểm tra HTTP thực: trang đăng nhập 200, runtime trả local, đăng nhập tài khoản không tồn tại
  trả 401 có cấu trúc thay vì lỗi cấu hình Firebase, đường dẫn SQLite qua HTTP trả 404.
- Đã thêm bộ browser local vào CI và tách thư mục artifact, giữ các kết quả chạy chế độ cũ.
- Chế độ này giải quyết tài khoản của bản chạy thử. Catalog, đơn hàng và API quản trị vẫn giữ
  kiến trúc dữ liệu hiện có; không khẳng định toàn bộ cửa hàng đã chuyển sang SQLite.
- Không tạo/cấu hình key Google Cloud, không gửi thư thật, không thay đổi tài khoản Firebase thật.
  Xem [hướng dẫn sử dụng tài khoản local](../../flower.com/docs/local-accounts.md).
