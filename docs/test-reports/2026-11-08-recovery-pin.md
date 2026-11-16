# Kiểm thử PIN khôi phục — 08/11/2026

Đã thay mã khôi phục ngẫu nhiên cho tài khoản local bằng PIN tự đặt 9–64 chữ số và 3 câu hỏi tự đặt.
Máy chủ phát triển đã khởi động lại tại http://127.0.0.1:3000/login.html với AUTH_MODE=local.

## Kết quả

| Bộ kiểm thử | Kết quả |
| --- | --- |
| Toàn bộ Node (`npm run test:coverage`) | 151/151 qua |
| Kiểm tra cuối riêng tài khoản local và HTTP | 16/16 qua, gồm PIN 9 chữ số có số 0 đầu và chuyển dữ liệu cũ |
| Trình duyệt local desktop/mobile | 10/10 qua |
| Tương thích biểu mẫu đăng nhập/khôi phục Firebase bằng mock | 12/12 qua, không cần key thật |
| Mở lại luồng quên PIN | 2/2 qua trên desktop/mobile |

Phủ dòng toàn bộ bộ Node: 57,24%. Kiểm tra cuối phần `local-accounts.js`: 98,31% dòng,
81,17% nhánh, 100% hàm. Đây không phải tuyên bố toàn bộ ứng dụng đã được kiểm thử.

## Hành vi đã xác minh

- Đăng ký từ chối PIN thiếu/8 chữ số/chứa chữ, PIN xác nhận sai và câu hỏi trùng hoặc thiếu.
  PIN 9 chữ số có số 0 đầu được giữ nguyên.
- Đổi PIN cần phiên hợp lệ, tên đăng nhập, họ tên, số điện thoại, mật khẩu hiện tại và PIN cũ.
  PIN cũ không còn dùng được, phiên hiện tại được đổi cookie và các phiên cũ bị hủy.
- Khôi phục PIN cần đúng cả 3 câu trả lời; một câu sai là không đủ. Chấp nhận khác biệt chữ hoa
  và khoảng trắng thừa. API chỉ trả nội dung câu hỏi, không trả câu trả lời, hash hay PIN.
- Năm lần sai thông tin PIN khóa 15 phút, dùng chung ngân sách giữa đổi PIN và đặt mật khẩu.
  Khôi phục bằng câu trả lời có bộ đếm 5 lần/15 phút riêng. Các bộ đếm ở máy chủ, không theo IP.
- Đổi/khôi phục PIN không mở khóa đăng nhập bằng mật khẩu. Đặt lại mật khẩu bằng PIN hợp lệ
  mới mở khóa và hủy các phiên cũ. PIN không tự xoay sau khi đặt lại mật khẩu.
- Chính sách mật khẩu giữ nguyên: sai lần 5 khóa 15 phút, mỗi lần sai sau đó tăng lên
  30/60/120/240 phút, lần sai thứ 10 bắt buộc đặt lại mật khẩu.
- Chuyển schema giữ nguyên tài khoản, mật khẩu, phiên và trạng thái khóa. Tài khoản cũ thiết lập
  PIN trong trang Tài khoản bằng mật khẩu hiện tại. Không thể dùng API thiết lập để ghi đè PIN đã có.
- Mã khôi phục cũ chỉ dùng một lần trước khi thiết lập PIN; sau khi dùng/thiết lập PIN, mã hết hiệu lực.
- SQLite không chứa PIN, câu trả lời hoặc mật khẩu rõ. Local storage chỉ giữ hồ sơ, không giữ các bí mật.
- Đăng ký, đăng xuất/đăng nhập, đổi PIN, quên PIN và khôi phục mật khẩu đã thao tác trên desktop/mobile.
  Kiểm tra ảnh bố cục và ẩn thanh liên hệ khi nhập biểu mẫu để tránh che trường nhập.

## Phạm vi

Các thay đổi PIN áp dụng cho tài khoản thử local, không cần email thật hoặc Firebase.
Các ca Firebase ở đây dùng mock để kiểm tra tương thích giao diện, không kiểm tra dịch vụ Firebase thật.
API dữ liệu cửa hàng khác vẫn theo kiến trúc có sẵn của dự án. Trong test local, trang sản phẩm có
thể ghi log thiếu cấu hình Firebase cho API dữ liệu cửa hàng; xác thực tài khoản local vẫn hoạt động.
Dữ liệu thử của bộ trình duyệt nằm trong SQLite bộ nhớ; dữ liệu tài khoản đang dùng không bị xóa.
