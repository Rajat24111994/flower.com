# Kiểm tra ghép hai commit PIN/bảo mật vào main — 09/11/2026

- Hai commit gốc được giữ nguyên: `ac0fb9bcf595d31e436b529e3833b382b3b12fe5` (tạo mã pin đăng nhập), `71212e681f13fadc81119ec57a19214d52059dd9` (tăng cường khả năng bảo mật).
- Main được ghép: `d33d2ce2f15204b364e240f5f0af2d6acaf4b701`. Không thay thế lịch sử main.
- Xử lý xung đột `login.js` bằng cách giữ luồng local/PIN, gateway xác thực và chính sách chờ phía máy chủ; dùng module `login-errors.js` từ main cho thông báo Firebase. Cơ chế một yêu cầu đăng nhập đang chạy được duy trì bằng `loginPending`.
- Giữ HTML thiết lập PIN và khóa nút gửi trước khi module sẵn sàng, cập nhật phiên bản CSS/JS. Giữ CSS trạng thái vô hiệu hóa nút từ main. Bổ sung liên kết giữa các báo cáo bảo mật cũ và mới.

| Kiểm tra | Kết quả |
| --- | --- |
| Cú pháp JavaScript theo cách kiểm tra của CI | 90 tệp đạt |
| `npm run test:coverage` | 162/162 đạt, 0 trượt, 0 bỏ qua |
| Coverage dòng / nhánh / hàm | 58,44% / 80,30% / 81,96%; qua ngưỡng CI 50% dòng |
| `npm run test:e2e:local` | 14/14 đạt trên desktop/mobile |
| Luồng Firebase với SDK/API giả lập: đăng nhập và recovery form | 12/12 đạt trên desktop/mobile; không gửi thư khôi phục thật |
| Kiểm tra khoảng trắng và dấu xung đột | Đạt |

Môi trường: Windows, Node.js 24.22.1, Chrome headless có sẵn. Log và coverage cục bộ nằm trong các thư mục được gitignore (`flower.com/.tools/main-merge-*.log`, `flower.com/coverage/`). Kiểm thử tích hợp Firebase backend không chạy lại trong lần ghép này vì không đổi mã API/Firestore; kết quả đợt sửa trước nằm trong [báo cáo khắc phục](../security/2026-11-09-security-remediation.md). Các kiểm tra CI trên GitHub chạy riêng sau khi đẩy.
