# Báo cáo kiểm thử — 2026-11-08 — Máy chủ local cùng API

## Thông tin đợt chạy

- **Ngày/giờ:** 2026-11-08, kết thúc khoảng 17:58 (Asia/Bangkok, UTC+7).
- **Commit/nhánh:** thay đổi chưa commit trên `fix/prevent-duplicate-product-images`, nền `dd6c80d`.
- **Môi trường:** Windows, PowerShell, Node.js v24.22.1, Firebase CLI 15.34.1, JBR Java 25,
  Google Chrome headless.

## Lệnh và kết quả

Các lệnh npm/Node dưới đây chạy từ `flower.com`. Emulator dùng cache `.tools/emulators`,
Java có sẵn được thêm vào PATH của tiến trình kiểm thử.

| Lệnh | Kết quả | Đạt | Trượt | Bỏ qua | Ghi chú |
| --- | --- | ---: | ---: | ---: | --- |
| `npm.cmd run test:coverage` | Đạt | 134 | 0 | 0 | Coverage dòng toàn bộ 54,70%; `local-server.js` 94,66% |
| `node node_modules/firebase-tools/lib/bin/firebase.js emulators:exec --project demo-flowerflow --only auth,firestore "node --test --test-concurrency=1 ../tests/integration/login-protection.test.js ../tests/integration/local-server.test.js"` | Đạt | 4 | 0 | 0 | HTTP server gọi handler thật, xác thực/token, route API quản trị lồng nhau, chính sách khóa và đặt lại mật khẩu |
| `node node_modules/firebase-tools/lib/bin/firebase.js emulators:exec --project web-ban-hoa-9fe0b --only auth,firestore "node node_modules/@playwright/test/cli.js test login-protection.spec.js forgot-password.spec.js store-purchase.spec.js"` | Đạt | 16 | 0 | 0 | Desktop/mobile; thêm kiểm thử Live Server trả HTML/404 |
| `node --check` với `lib/local-server.js`, `scripts/dev.js`; `git diff --check` | Đạt | — | — | — | Không có lỗi cú pháp/khoảng trắng |
| `npm.cmd run dev` | Đạt phần khởi động | — | — | — | HTTP server thực chạy tại `127.0.0.1:3000`, giao diện và API cùng origin |

## Lỗi và cách tái hiện

- **Nguyên nhân xác nhận trực tiếp:** `http://127.0.0.1:5500/flower.com/login.html` trả 200,
  nhưng `/flower.com/api/login` trả 404 với `Content-Type: text/html`. Live Server không chạy
  Vercel Functions; lỗi parse JSON trước đây trở thành thông báo kết nối chung.
- **Kết quả HTTP ở máy chủ mới:** `/login.html` trả 200; `/.env` và `/lib/firebase-admin.js`
  trả 404; `POST /api/login` trả JSON `503 auth-service-unavailable` khi thiếu cấu hình Firebase.
  API đã nhận yêu cầu đúng, khác với HTML/404 của Live Server.
- **Lỗi trong lần viết test đầu:** test route quản trị dùng GET trong khi endpoint yêu cầu POST;
  đã sửa test theo hợp đồng API và chạy lại bộ tích hợp, đạt 4/4.
- **Lỗi chức năng còn phát hiện trong các bộ kiểm thử cuối:** Không có.

## Ghi chú

- Thêm `npm run dev`: nạp `.env`, phục vụ HTML/tài nguyên công khai và các handler `/api/*`
  bằng một máy chủ Node chỉ lắng nghe loopback.
- Kiểm tra Host/Origin, giới hạn JSON, kiểm soát đường dẫn/tài nguyên công khai và không lộ
  nội dung exception. Client không truy cập `.env`, cấu hình nội bộ, thư viện hoặc source API.
- Trường hợp API thiếu/trả HTML có thông báo chỉ dẫn chạy máy chủ local; chính sách giới hạn
  đăng nhập phía hệ thống được giữ nguyên.
- Đã tạo `.env` mới bằng thao tác chỉ tạo nếu chưa có, điền duy nhất cấu hình công khai.
  `git check-ignore` xác nhận `.env` bị bỏ qua. Không ghi khóa bí mật vào báo cáo/Git.
- Theo lựa chọn của người dùng, máy chủ local dùng Firebase thật. Tại thời điểm kiểm tra,
  `FIREBASE_AUTH_SERVER_API_KEY` và `FIREBASE_SERVICE_ACCOUNT_JSON` chưa được điền;
  chưa xác minh đăng nhập tài khoản thật hoặc thay đổi API key restrictions trên Google Cloud.
- Cần điền các giá trị bí mật tại máy, hoàn tất
  [cấu hình bảo vệ đăng nhập](../../flower.com/docs/login-protection.md), chạy
  `npm run check-login-protection` và khởi động lại `npm run dev` trước khi đăng nhập thật.
- Kiểm thử chức năng có đăng nhập/khôi phục dùng Firebase Emulator, không thay đổi tài khoản
  hoặc dữ liệu khách hàng thật. Máy chủ local ở cổng 3000 được để chạy cho người dùng kiểm tra.

## Kiểm tra bổ sung thông báo thiếu cấu hình

- Thêm test hồi quy cho trường hợp `npm run dev` phát hiện thiếu biến Firebase: test trượt
  trước khi thêm xử lý, sau sửa bộ unit đạt **135/135**, không có test trượt hoặc bỏ qua.
- Máy chủ dev trả JSON `503 login-not-configured`, nêu tên biến còn thiếu và yêu cầu hoàn tất
  `.env` rồi khởi động lại, thay cho thông báo thử lại chung. Không trả bất kỳ giá trị bí mật nào.
- Phần chẩn đoán chỉ được truyền từ `scripts/dev.js`; handler đăng nhập triển khai và các lỗi
  dịch vụ Firebase khác giữ thông báo chung. Quy tắc khóa theo tài khoản được giữ nguyên.
- Đã khởi động lại máy chủ local và xác nhận phản hồi HTTP mới; `git diff --check` và kiểm tra
  cú pháp hai file thay đổi đều đạt. Hai giá trị máy chủ vẫn chưa được cung cấp.
