# Rà soát bảo mật — Issue #91

## Phạm vi

Rà soát các luồng đăng nhập, sản phẩm, giỏ hàng, thanh toán/checkout và đặt/theo dõi đơn hàng, tập trung vào:

- Chèn JavaScript độc hại (XSS).
- Kiểm tra dữ liệu đầu vào từ biểu mẫu.
- Truy cập trái phép thông tin đơn hàng.
- Biện pháp giảm thiểu cho rủi ro phát hiện được.

## Kết quả

Không phát hiện lỗ hổng khai thác được trong phạm vi đã rà soát.

| Khu vực/rủi ro | Kết quả rà soát | Kiểm soát hiện có / hướng xử lý |
| --- | --- | --- |
| XSS trong nội dung sản phẩm, giỏ hàng và đơn hàng | Không phát hiện đường chèn mã có thể khai thác. | Nội dung động được hiển thị bằng API DOM an toàn thay vì chèn HTML tùy ý. Tiếp tục giữ nguyên cách hiển thị này khi thêm nội dung động. |
| Dữ liệu biểu mẫu và checkout | Không phát hiện lỗi cho phép bỏ qua kiểm tra phía máy chủ. | Dữ liệu đơn hàng, giá, tổng tiền và tồn kho được kiểm tra phía máy chủ. Không dựa vào giá trị do trình duyệt gửi để xác định giá cuối cùng. |
| Truy cập trái phép dữ liệu đơn hàng | Không phát hiện quyền đọc chéo tài khoản trong phạm vi được rà soát. | Quy tắc Firestore giới hạn đọc đơn hàng theo tài khoản hoặc quyền quản trị; tra cứu khách vãng lai được giới hạn tốc độ và chỉ trả dữ liệu tối thiểu. |
| Thanh toán và tạo đơn | Không phát hiện rủi ro bổ sung trong luồng đã rà soát. | Giữ việc xác minh giá, tồn kho và dữ liệu đơn hàng ở phía máy chủ; tiếp tục chạy kiểm thử API và quy tắc Firestore trên emulator trước khi phát hành thay đổi liên quan. |

Do không phát hiện lỗ hổng, không có thay đổi mã khắc phục trong đợt này. Các biện pháp hiện có cần được duy trì; phạm vi kiểm thử emulator chưa được chạy cục bộ và được ghi rõ trong [báo cáo kiểm thử](./test-reports/2026-11-09-issue-91.md).

## Phạm vi kiểm thử

- Unit tests: 108 đạt, 0 trượt.
- Kiểm thử tích hợp API và Firestore Rules trên Firebase Emulator: chưa chạy trong đợt này.
