# Kiểm thử lại đăng nhập và PIN — 09/11/2026

Đã chạy lại bộ Node hiện có và các ca trình duyệt cho phần tài khoản/PIN sau khi đổi PIN sang
4–6 chữ số. Tất cả các ca trong phạm vi chạy lần này đều đạt. Đợt này bổ sung báo cáo kiểm thử;
không cần sửa thêm mã chức năng sau khi kiểm thử.

## Kết quả thực tế

| Bộ kiểm thử | Kết quả | Thời gian |
| --- | --- | --- |
| `npm run test:coverage` | 154/154 đạt, 0 lỗi, 0 bỏ qua | 110,6 giây |
| Local: `playwright.local.config.js` | 14/14 đạt | Khoảng 2,5 phút |
| Tương thích đăng nhập/khôi phục bằng mock | 12/12 đạt | 13,1 giây |
| `git diff --check` | Đạt | — |

154 ca Node có bao gồm 19 ca trong `tests/local-accounts.test.js` và
`tests/local-auth-http.test.js`; 19 ca này không được cộng thêm vào tổng 154.
Trình duyệt dùng Chrome trên Windows, viewport desktop 1280×800 và mô phỏng Pixel 7 390×844.
Bộ tương thích Firebase dùng mock. Phạm vi trình duyệt lần này là các luồng tài khoản,
không phải kiểm thử toàn bộ cửa hàng hoặc các dịch vụ thanh toán/Firebase thật.

Độ phủ dòng trong báo cáo Node: **57,52%**. Riêng `lib/local-accounts.js`: **98,49% dòng**,
**82,39% nhánh**, **100% hàm**. `lib/login-protection.js`: **100% dòng**.

## Những hành vi đã xác minh

1. Đăng ký tài khoản với tên có `@`, không yêu cầu email thật hoặc Firebase trong chế độ local.
2. PIN chấp nhận 4, 5 hoặc 6 chữ số; giữ số 0 đầu. Từ chối PIN thiếu, ngắn/dài ngoài giới hạn,
   chữ, khoảng trắng, dấu câu, dạng số mũ/thập phân, chữ số Unicode và JSON kiểu số.
3. Giao diện loại ký tự khác số khi gõ và không nhập được chữ số thứ 7. Các luồng dùng PIN mới
   để đăng ký, đổi PIN và khôi phục đều hoạt động trên desktop và mobile giả lập.
4. Sai PIN hiển thị 4, 3, 2, 1 rồi 0 lượt còn lại. Lần sai thứ 5 tự mở 3 câu hỏi và yêu cầu
   PIN mới. Tải lại trang, quay lại Tài khoản, chờ lâu hoặc dùng PIN cũ đúng đều không bỏ qua yêu cầu.
5. Các API đặt mật khẩu và đổi PIN dùng chung bộ đếm PIN theo tài khoản. Các yêu cầu song song
   khi đã hết lượt đều bị chặn. Bộ đếm và yêu cầu khôi phục giữ nguyên sau khi khởi động lại.
6. Đổi PIN thông thường phải khớp tên đăng nhập, họ tên, số điện thoại, mật khẩu và PIN cũ.
7. Quên PIN phải trả lời đúng cả 3 câu hỏi; một câu sai không đủ để khôi phục. Mỗi lần trả lời
   sai cũng hiện lượt còn lại, sai 5 lần phải chờ 15 phút. PIN mới phải khác PIN cũ.
8. Khôi phục PIN không tự xóa khóa đăng nhập do sai mật khẩu. Đặt lại mật khẩu bằng PIN hợp lệ
   mới mở lại đăng nhập và hủy các phiên cũ.
9. Chính sách mật khẩu giữ đúng: sai lần 5 khóa 15 phút, các lần sai tiếp theo sau mỗi lần chờ
   khóa 30/60/120/240 phút; lần sai thứ 10 bắt buộc đặt lại mật khẩu. Các mốc dài được kiểm tra
   bằng đồng hồ giả lập trong kiểm thử tự động.
10. Chuyển tài khoản dùng PIN dài cũ sang PIN 4–6 số cần đúng 3 câu trả lời. Mật khẩu, hồ sơ,
    câu hỏi và trạng thái khóa được giữ lại. Tài khoản chưa có PIN vẫn có bước thiết lập riêng.
11. Đăng xuất, hết hạn và thu hồi phiên hoạt động. Cookie phiên có `HttpOnly`, `SameSite=Strict`;
    sửa role trong local storage không biến tài khoản khách thành quản trị.
12. Kiểm tra SQLite không chứa mật khẩu/PIN/câu trả lời rõ và local storage không chứa PIN/câu trả lời.

## Những phần đã thay đổi trong các đợt triển khai trước

| Phần | Thay đổi |
| --- | --- |
| `flower.com/login.html`, `js/account/login.js` | Đăng ký có PIN, xác nhận PIN và 3 câu hỏi tự đặt; local dùng tài khoản có `@`; hiển thị lỗi/chờ đăng nhập |
| `flower.com/account.html`, `js/account/account.js` | Xem hồ sơ, thiết lập PIN cho tài khoản cũ, đổi PIN bằng đầy đủ thông tin và PIN cũ; tự chuyển tới khôi phục khi bắt buộc |
| `flower.com/forgot-password.html`, `js/account/forgot-password.js` | Đặt mật khẩu bằng PIN; quên PIN bằng 3 câu hỏi; tự hiện câu hỏi khi hết lượt và phân biệt yêu cầu đổi định dạng PIN cũ |
| `js/account/recovery-security.js`, `local-auth-client.js` | Giới hạn nhập số, hiển thị số lượt còn lại, xử lý lỗi API và phiên local |
| `lib/local-accounts.js`, `lib/local-auth-http.js` | SQLite, băm scrypt riêng cho mật khẩu/PIN/câu trả lời, bộ đếm theo tài khoản, khóa, thu hồi phiên và nâng cấp dữ liệu cũ |
| `lib/local-server.js`, `scripts/dev.js` | Phục vụ giao diện và API trên cùng địa chỉ loopback, chọn chế độ local/Firebase, chặn truy cập tệp nội bộ qua HTTP |
| `js/core/store-header.js`, `js/order/order-store.js` | Giữ và xác minh phiên local thay vì phụ thuộc phiên Firebase |
| CSS tài khoản/liên hệ | Bố cục biểu mẫu dài, hiển thị/ẩn các bước và tránh thanh liên hệ che ô nhập khi đang thao tác |
| Tests, README, `docs/local-accounts.md` | Bổ sung ca kiểm thử, cấu hình chạy local và tài liệu cho quy tắc hiện tại |

Trong `flower.com/package.json` đã thêm:

- `dev`: chạy máy chủ giao diện/API bằng `npm run dev`.
- `test:e2e:local`: chạy kiểm thử trình duyệt local, không cần Firebase Emulator.
- `check-login-protection`: kiểm tra cấu hình bảo vệ đăng nhập khi chọn chế độ Firebase.

## Kiểm tra máy chủ đang chạy

`http://127.0.0.1:3000/login.html` trả HTTP 200, dùng chế độ local, quy tắc PIN `[0-9]{4,6}`
và script đăng nhập mới. API thực tế từ chối PIN chứa chữ bằng HTTP 400 `invalid-pin`;
PIN `0123` vượt kiểm tra định dạng, sau đó trả HTTP 401 `invalid-recovery` cho tên thử ngẫu nhiên
không tồn tại. Các yêu cầu kiểm tra này không tạo tài khoản.

Các ca tài khoản dùng SQLite bộ nhớ hoặc tệp thử có tên ngẫu nhiên, tách khỏi dữ liệu tài khoản
đang sử dụng. Log của trang sản phẩm trong E2E có cảnh báo thiếu cấu hình Firebase ở API dữ liệu
cửa hàng; bộ xác thực local vẫn đạt, và kết quả trên không chứng nhận các API dữ liệu Firebase đó.

Log chi tiết của lần chạy nằm trong `flower.com/.tools/auth-pin-retest-*.log`;
báo cáo độ phủ ở `flower.com/coverage/`, báo cáo trình duyệt ở các thư mục
`flower.com/playwright-report-local/` và `flower.com/playwright-report/`.
