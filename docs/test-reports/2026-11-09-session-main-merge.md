# Kiểm tra ghép bảo vệ phiên vào main — 09/11/2026

- Giữ nguyên commit `d70e24395383f8f74a742fc955a90f03ee66da2c` — “giới hạn thời gian đăng nhập”.
- Ghép main tại `e0cb8f7dbfea2e28e74b9d067796e28016397b75`, bao gồm kiểm thử tài khoản và audit thao tác quản trị mới. Giữ nguyên mã API, quy tắc Firestore và tài liệu audit từ main.
- HTML đăng ký giữ cả phiên bản script của tính năng phiên lẫn `autocomplete="new-password"` / `minlength="6"` trên main.
- Cập nhật fixture kiểm thử giá hoa để phân biệt `priceHistory` và `adminAudit`. Kiểm tra cùng transaction tạo đúng một lịch sử giá và một audit với chủ thể, tài nguyên và giá trước/sau đúng; trường hợp không đổi giá hoặc dữ liệu không hợp lệ vẫn không tạo bản ghi.

| Kiểm tra | Kết quả |
| --- | --- |
| Unit + coverage sau cập nhật fixture audit | 169/169 đạt, 0 trượt, 0 bỏ qua |
| Coverage dòng / nhánh / hàm | 58,96% / 80,80% / 82,01%; qua ngưỡng CI 50% dòng |
| Luồng tài khoản/PIN/phiên local trên desktop và mobile | 24/24 đạt |
| Luồng Firebase giả lập trên desktop và mobile | 18/18 đạt; gồm đăng ký, đăng nhập, đăng xuất, khóa và quên mật khẩu |

Môi trường: Windows, Node.js 24.22.1, Chrome headless. Log được gitignore tại `flower.com/.tools/session-main-unit-passed.log`, `session-main-local-browser.log` và `session-main-firebase-browser.log`; coverage tại `flower.com/coverage/lcov.info`. Không liên hệ tài khoản Firebase thật trong các ca dùng mock.

Không chạy lại toàn bộ tích hợp Firestore trong đợt ghép này. Mã audit từ main được giữ nguyên; kiểm thử backend tích hợp tiếp tục thuộc job CI sau khi đẩy. Xem [chính sách và phạm vi bảo vệ phiên local](../security/2026-11-09-session-security.md).
