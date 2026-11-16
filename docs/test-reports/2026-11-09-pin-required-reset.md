# Bắt buộc đổi PIN sau 5 lần sai — 09/11/2026

Đã đổi chính sách PIN local từ khóa tạm 15 phút sang bắt buộc trả lời 3 câu hỏi và đặt PIN mới.

## Hành vi

- Mỗi lần sai PIN trả về `attemptsRemaining`: 4, 3, 2, 1, 0. Giao diện hiển thị số lượt này.
- Sai lần 5 trả HTTP 403 với `pin-reset-required`. PIN cũ không thể dùng để đặt mật khẩu hoặc
  đổi PIN thông thường, kể cả nhập đúng sau đó hoặc chờ lâu. Phải trả lời đúng cả 3 câu hỏi
  và chọn PIN mới khác PIN cũ.
- Đặt lại mật khẩu và đổi PIN dùng chung bộ đếm PIN theo tài khoản. Không thể chuyển endpoint,
  đổi IP, tải lại trang hoặc đăng nhập đúng mật khẩu để lấy lại lượt.
- Từ trang Quên mật khẩu, lần sai thứ 5 tự hiển thị câu hỏi và ô PIN mới. Từ trang Tài khoản,
  lần sai thứ 5 chuyển tới cùng luồng; mở lại Tài khoản vẫn chuyển sang bước bắt buộc này.
- Trạng thái bắt buộc được lưu tại máy chủ bằng SQLite, không phụ thuộc local storage.
- Trả lời sai cũng hiển thị số lượt còn lại. Sai 5 bộ câu trả lời vẫn giữ thời gian chờ 15 phút
  riêng; yêu cầu đặt PIN mới chỉ được xóa sau khi trả lời đúng cả 3 và lưu PIN mới thành công.
- Xác minh PIN thành công trước ngưỡng sẽ xóa bộ đếm PIN. Nhập sai họ tên/số điện thoại/mật khẩu
  trong thao tác đổi PIN, khi PIN đúng, dùng giới hạn thông tin tài khoản riêng 5 lần/15 phút.
- Chính sách khóa đăng nhập do sai mật khẩu được giữ nguyên. Đổi PIN không tự mở khóa mật khẩu.

## Dữ liệu cũ

Schema bổ sung `pin_failures` và `pin_reset_required` trong transaction. Khi nâng cấp tài khoản
đã có PIN, chuyển bộ đếm xác minh cũ sang PIN; tài khoản đã đủ 5 lần sai chuyển sang bắt buộc
đặt PIN mới. Không xóa tài khoản, mật khẩu, phiên hay lịch sử khóa đăng nhập.
Tài khoản chưa có PIN vẫn giữ luồng mã khôi phục cũ và bước thiết lập PIN đã có.

## Kiểm thử trình duyệt

- Local: 14/14 qua, gồm đếm lượt, lần sai thứ 5 tự mở câu hỏi, tải lại trang, quay lại Tài khoản,
  khôi phục PIN và dùng PIN mới để đặt mật khẩu; chạy trên desktop và mobile.
- Tương thích giao diện đăng nhập/khôi phục cũ: 12/12 qua với mock, không gọi Firebase thật.
- Bộ local chạy một worker và tăng thời gian chờ kiểm thử để việc băm scrypt trên máy chủ Node
  không làm các ca chạy đồng thời hết thời gian. Các tham số băm scrypt được giữ nguyên.

Máy chủ local đã khởi động lại tại http://127.0.0.1:3000/login.html.

## Kiểm thử tự động

`npm run test:coverage`: **153/153 qua**, không có ca lỗi. Bao gồm kiểm tra bộ đếm PIN dùng
chung giữa các API, không tự mở theo thời gian, không dùng PIN đúng để vượt yêu cầu đổi,
trạng thái giữ nguyên sau khởi động lại, giữ lượt của dữ liệu cũ và xóa bộ đếm khi xác minh thành công.
Các yêu cầu song song khi đã hết lượt đều bị chặn; trả lời câu hỏi mới là đường khôi phục hợp lệ.

Phủ dòng toàn bộ bộ Node: 57,50%. Riêng `local-accounts.js`: 98,48% dòng, 81,76% nhánh,
100% hàm. Đã chạy `git diff --check` và không có lỗi khoảng trắng.
