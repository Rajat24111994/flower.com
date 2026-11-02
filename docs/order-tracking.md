# Theo dõi trạng thái đơn

Luồng hiển thị: **Chờ xác nhận → Đang chuẩn bị → Đang giao → Hoàn thành**. Đơn hủy có thông báo riêng, không được hiển thị như đã hoàn thành các bước còn lại.

`order-status.js` quản lý danh sách trạng thái, nhãn và mô hình tiến độ. Để tương thích dữ liệu, kho, doanh thu, thanh toán COD và quyền đánh giá cũ, trạng thái hoàn thành vẫn lưu dưới giá trị `Đã giao`; nhãn giao diện là `Hoàn thành`. Đơn cũ dùng các tên trước đây tiếp tục được chuẩn hóa, không cần sửa hàng loạt dữ liệu.

Quản trị chọn “Đang chuẩn bị” hoặc “Hoàn thành” trong phần cập nhật trạng thái đơn hiện có. Vẫn dùng transaction của `FlowerOrderStore.update`, kiểm tra `expectedStatus` và nối `trackingHistory` vào dữ liệu mới nhất. Trạng thái giao hàng vẫn yêu cầu địa điểm và ngày giao dự kiến. Chuyển sang hoàn thành vẫn xử lý thanh toán COD và thống kê đã bán như trước.

Khách xem tiến độ bốn bước và lịch sử cập nhật thực tế tại trang theo dõi. Mốc thời gian từng bước chỉ xuất hiện khi lịch sử đã ghi nhận bước đó; không tạo ngày giờ cho bước bị bỏ qua. Đơn được chọn trong lịch sử tài khoản cập nhật lại khi subscription nhận dữ liệu mới, kể cả chuyển giữa nhóm đang xử lý và hoàn thành. Tra cứu công khai tiếp tục ẩn thông tin nhận hàng và sản phẩm; đơn QR đang chuẩn bị vẫn hiển thị hướng dẫn chuyển khoản khi chưa xác minh tiền.

Kiểm tra: test trạng thái/đơn cũ/đơn hủy, test handler quản trị ghi sự kiện và `expectedStatus`, E2E desktop/mobile cho tra cứu khách và subscription tài khoản. E2E dùng dữ liệu giả lập, không ghi Firestore production.
