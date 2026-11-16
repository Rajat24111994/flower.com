# Báo cáo kiểm thử — 2026-11-11 — nút ẩn/hiện mật khẩu

## Thông tin đợt chạy

- **Ngày:** 2026-11-11, múi giờ Asia/Bangkok.
- **Commit/nhánh nền:** `27ca225`, nhánh `sync/github-main-latest`.
- **Môi trường:** Windows, PowerShell, Node.js v24.22.1, Playwright và Google Chrome đã cài trên máy.
- **Phạm vi:** các tương tác ẩn/hiện mật khẩu và bộ unit test hiện có; chỉ thay đổi kiểm thử, cấu hình test và tài liệu.

## Lệnh và kết quả

Các lệnh chạy từ `flower.com`. Đặt `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` tới `C:/Program Files/Google/Chrome/Application/chrome.exe` để dùng trình duyệt đã cài.

| Lệnh | Kết quả | Đạt | Trượt | Bỏ qua | Ghi chú |
| --- | --- | ---: | ---: | ---: | --- |
| `npm.cmd run test:auth-visibility` | Đạt | 28 | 0 | 0 | 14 kịch bản trên desktop Chromium 1280×800 và mobile Chromium giả lập Pixel 7, 390×844 |
| `npm.cmd test` | Đạt | 178 | 0 | 0 | Toàn bộ Node.js unit test, khoảng 149 giây |
| `node --check` trên 8 file JS/CJS thay đổi | Đạt | — | 0 | 0 | Fixture, cấu hình Playwright, 5 file spec và static server |
| `git diff --check` | Đạt | — | 0 | 0 | Không có lỗi whitespace |

## Phạm vi đã kiểm tra

- Bật/tắt mật khẩu đăng nhập, mật khẩu đăng ký và xác nhận mật khẩu; trạng thái từng ô độc lập, giá trị không đổi.
- Form có dữ liệu hợp lệ nhưng bấm nút không submit. Validation, ID, name, autocomplete và giới hạn độ dài của hai ô đăng ký được so sánh trước/sau thao tác.
- Giữ con trỏ đầu/giữa/cuối, selectionStart, selectionEnd và hướng chọn xuôi/ngược; nhập tiếp sau chuột/chạm; Tab, Shift+Tab, Enter và Space giữ focus phù hợp.
- API vùng chọn không khả dụng, trả null hoặc ném lỗi không làm hỏng thao tác ẩn/hiện.
- Vẫn hiện ở 2999ms, tự ẩn ở 3000ms; tự ẩn giữ nguyên giá trị, vùng chọn và focus.
- Gõ, xóa, thay vùng chọn và các InputEvent mô phỏng dán/cắt/undo/redo đều đặt lại bộ đếm. Hai ô đăng ký có thời hạn riêng.
- Chủ động ẩn hủy tác vụ đang chờ; chỉnh sửa ô đang che không tạo bộ đếm; bật lại bắt đầu đủ 3 giây mới.
- `document.hidden=true` và chuyển form che mật khẩu ngay, hủy bộ đếm, đồng bộ SVG/nhãn và không tự hiện lại khi quay về.

## Cách ly dữ liệu và mạng

- Máy chủ static chỉ nghe loopback cổng 4175. Cấu hình riêng xóa các biến host Firebase Emulator ở tiến trình server để không khởi tạo API Firebase; không cần `.env` hoặc thông tin xác thực.
- Fixture mock Firebase App/Auth trước khi tải trang, chặn tất cả kết nối ngoài origin static và mọi yêu cầu API/ghi dữ liệu; service worker bị chặn trong cấu hình riêng.
- Capture listener chặn submit trước handler thật. Cuối mỗi test xác nhận: **0 submit**, **0 lời gọi xác thực ngoài mock khởi tạo**, **0 yêu cầu backend**.
- Không tạo tài khoản và không gửi yêu cầu đọc/ghi tới Firebase production.
- Đồng hồ dùng Playwright Clock. Rời tab được mô phỏng bằng `document.hidden` và `visibilitychange`; dán/cắt/undo/redo dùng InputEvent mô phỏng, không thay đổi clipboard hoặc tab thật của người dùng.

## Lỗi và cách tái hiện

- **Test/file lỗi:** Không có.
- **Thông báo lỗi:** Không có.
- **Cách tái hiện lỗi:** Không có. Để chạy lại bộ kiểm thử: `cd flower.com` rồi `npm.cmd run test:auth-visibility`.

## Giới hạn

Không chạy kiểm thử Firebase Emulator, luồng mua hàng đầy đủ hoặc xác thực SDK thật trong đợt này. Kết quả trên chỉ áp dụng cho các lệnh và môi trường đã nêu; không thay thế kiểm thử Firefox, Safari hoặc thiết bị di động thật.
