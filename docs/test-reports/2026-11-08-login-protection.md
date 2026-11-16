# Báo cáo kiểm thử — 2026-11-08 — Giới hạn đăng nhập

## Thông tin đợt chạy

- **Ngày/giờ:** 2026-11-08, khoảng 17:15–17:28 (Asia/Bangkok, UTC+7).
- **Commit/nhánh:** thay đổi chưa commit trên `fix/prevent-duplicate-product-images`, nền `dd6c80d`.
- **Môi trường:** Windows, PowerShell, Node.js v24.22.1; Firebase CLI 15.34.1;
  Java 25 từ JBR có sẵn; Google Chrome headless có sẵn.

## Lệnh và kết quả

Các lệnh chạy từ `flower.com`; Java được thêm vào PATH cho tiến trình kiểm thử,
`FIREBASE_EMULATORS_PATH` và `XDG_CONFIG_HOME` trỏ vào `.tools/` của workspace.
Emulator tích hợp dùng project `demo-flowerflow`, không truy cập dữ liệu cửa hàng thật.

| Lệnh | Kết quả | Đạt | Trượt | Bỏ qua | Ghi chú |
| --- | --- | ---: | ---: | ---: | --- |
| `npm.cmd run test:coverage` | Đạt | 128 | 0 | 0 | Coverage dòng toàn bộ 53,28%; API login và hai module bảo vệ đăng nhập đạt 100% dòng |
| `node node_modules/firebase-tools/lib/bin/firebase.js emulators:exec --project demo-flowerflow --only auth,firestore "node --test --test-concurrency=1 ../tests/integration/*.test.js"` | Đạt | 80 | 0 | 0 | Toàn bộ API, Firestore Rules và luồng nghiệp vụ; có kiểm thử khôi phục mật khẩu thật trong emulator |
| `node node_modules/firebase-tools/lib/bin/firebase.js emulators:exec --project demo-flowerflow --only auth,firestore "node --test ../tests/integration/login-protection.test.js"` | Đạt | 3 | 0 | 0 | Chạy lại phạm vi đăng nhập sau sửa lỗi snapshot metadata tới trễ |
| `node node_modules/firebase-tools/lib/bin/firebase.js emulators:exec --project web-ban-hoa-9fe0b --only auth,firestore "node node_modules/@playwright/test/cli.js test"` | Đạt | 52 | 0 | 0 | Toàn bộ trình duyệt desktop/mobile; đặt `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` tới Chrome có sẵn; backend đăng nhập thật trên emulator |
| `node --check` với API, module bảo vệ, script cấu hình, hai module giao diện và static test server | Đạt | — | — | — | Không có lỗi cú pháp |
| `git diff --check` | Đạt | — | — | — | Không có lỗi khoảng trắng |

Các lần chạy lại không phải bài kiểm thử mới ngoài tổng số bài duy nhất của từng bộ.

## Lỗi và cách tái hiện

- **Lỗi còn tồn tại trong các bộ kiểm thử cuối:** Không có.
- **Lỗi đã phát hiện và sửa:** snapshot `passwordUpdatedAt` cũ tới trễ có thể ghi đè phiên bản
  mới, khiến lần gọi sau hiểu nhầm rằng vừa đặt lại mật khẩu và xóa khóa. Đã tái hiện bằng test
  `a delayed metadata lookup cannot downgrade the password version and clear a later lock`:
  test trượt trước sửa, đạt sau khi giữ phiên bản mật khẩu không giảm trong transaction.
- **Chạy lại test hồi quy:**
  `node --test --test-name-pattern="delayed metadata" ../tests/login-protection.test.js`.
- **Điều chỉnh test tích hợp:** phản hồi Firebase đổi custom token không chứa `localId`;
  kiểm tra UID bằng ID token do Admin SDK xác minh. Bộ tích hợp cuối đạt toàn bộ.

## Ghi chú

- Đã kiểm tra đủ chuỗi sai lần 5 → khóa 15 phút → 30/60/120/240 phút → sai lần 10 bắt buộc đặt
  lại mật khẩu; thử trong lúc khóa không kiểm tra mật khẩu hoặc kéo dài khóa.
- Đã kiểm tra đổi IP/email hoa thường, tài khoản khác độc lập, request song song, lease hết hạn,
  lỗi dịch vụ không tăng bộ đếm, client không được đọc/sửa/xóa trạng thái khóa, chỉ hoàn tất thay
  đổi mật khẩu tại Firebase mới mở khóa; gửi email khôi phục không mở khóa.
- Lần chạy trình duyệt trong sandbox đầu tiên đạt bốn bài mới nhưng treo lúc dọn tiến trình và
  đã được dừng. Lần chạy đầy đủ ngoài sandbox sau đó kết thúc bình thường với 52/52 đạt.
- Việc tải emulator/thư viện lần đầu bị sandbox chặn mạng; đã tải lại bằng quyền được duyệt.
- Emulator không thực thi API key restrictions. Chưa kiểm tra restrictions hoặc thay đổi key
  trên Google Cloud thật. Trước triển khai phải hoàn tất
  [cấu hình bảo vệ đăng nhập](../../flower.com/docs/login-protection.md) và chạy
  `npm run check-login-protection` với cấu hình triển khai. Khi thiếu bảo vệ, API trả 503;
  không tự quay lại đường đăng nhập mật khẩu trực tiếp.
- Chưa triển khai hoặc commit các thay đổi trong phiên này.
