# Theo dõi trạng thái đơn

Luồng hiển thị: **Chờ xác nhận → Đang chuẩn bị → Đang giao → Hoàn thành**. Đơn hủy có thông báo riêng, không được hiển thị như đã hoàn thành các bước còn lại.

`order-status.js` quản lý danh sách trạng thái, nhãn và mô hình tiến độ. Để tương thích dữ liệu, kho, doanh thu, thanh toán COD và quyền đánh giá cũ, trạng thái hoàn thành vẫn lưu dưới giá trị `Đã giao`; nhãn giao diện là `Hoàn thành`. Đơn cũ dùng các tên trước đây tiếp tục được chuẩn hóa, không cần sửa hàng loạt dữ liệu.

Quản trị chọn “Đang chuẩn bị” hoặc “Hoàn thành” trong phần cập nhật trạng thái đơn hiện có. Vẫn dùng transaction của `FlowerOrderStore.update`, kiểm tra `expectedStatus` và nối `trackingHistory` vào dữ liệu mới nhất. Trạng thái giao hàng vẫn yêu cầu địa điểm và ngày giao dự kiến. Chuyển sang hoàn thành vẫn xử lý thanh toán COD và thống kê đã bán như trước.

Khách xem tiến độ bốn bước và lịch sử cập nhật thực tế tại trang theo dõi. Mốc thời gian từng bước chỉ xuất hiện khi lịch sử đã ghi nhận bước đó; không tạo ngày giờ cho bước bị bỏ qua. Lịch sử Firestore chỉ cho phép đọc truy vấn theo UID đang đăng nhập; đổi mã đơn trên URL không cấp quyền xem đơn khác. API tra cứu chi tiết cho tài khoản xác thực UID của chủ đơn và từ chối các mã không thuộc tài khoản đó. Khách vãng lai vẫn có thể tra cứu bằng mã đơn và số điện thoại, nhưng chỉ nhận trạng thái và thông tin thanh toán giới hạn, không nhận thông tin giao hàng, sản phẩm hay cá nhân. Đơn QR đang chuẩn bị vẫn hiển thị hướng dẫn chuyển khoản khi chưa xác minh tiền.

Kiểm tra: test trạng thái/đơn cũ/đơn hủy, test handler quản trị ghi sự kiện và `expectedStatus`, E2E desktop/mobile cho tra cứu khách và subscription tài khoản. E2E dùng dữ liệu giả lập, không ghi Firestore production.
