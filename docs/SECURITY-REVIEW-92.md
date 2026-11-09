# Phòng chống thử mật khẩu liên tục — Issue #92

Email/mật khẩu được xác thực bởi Firebase Authentication. Firebase thực thi giới hạn đăng nhập ở phía máy chủ và trả lỗi `auth/too-many-requests` khi yêu cầu bị giới hạn; không dùng bộ đếm phía trình duyệt làm biện pháp bảo mật vì có thể bị bỏ qua.

Form đăng nhập chỉ cho phép một yêu cầu email/mật khẩu đang chạy tại một thời điểm, vô hiệu hóa nút gửi trong khi chờ, và thông báo người dùng đợi trước khi thử lại khi Firebase giới hạn yêu cầu. Ngưỡng và thời gian giới hạn do Firebase quản lý, không được giả định là một con số cố định phía giao diện.

Các lỗi thông tin đăng nhập không hợp lệ tiếp tục dùng thông báo chung, không tiết lộ chi tiết lỗi của nhà cung cấp. Kiểm thử bao phủ thông báo giới hạn và thông báo dự phòng không lộ chi tiết.
