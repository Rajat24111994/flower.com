# Release notes v0.1.0

Ngày phát hành: chưa phát hành

## Tính năng

- Duyệt danh mục hoa, tìm kiếm, lọc và xem chi tiết sản phẩm cùng các sản phẩm liên quan.
- Quản lý giỏ hàng và danh sách yêu thích; kiểm tra tồn kho ở giao diện.
- Tạo đơn minh họa, xem trạng thái đơn hàng và cập nhật giao diện trên thiết bị nhỏ.
- Đăng nhập bằng Firebase Email/Password hoặc Google khi đã cấu hình; có luồng tài khoản demo chạy cục bộ.
- Quản lý catalog qua API MockAPI và quản lý vai trò qua các API Firebase Admin được bảo vệ.

## Đã sửa / cải thiện

- Đồng bộ trạng thái giỏ hàng và wishlist giữa các trang.
- Giới hạn số lượng theo tồn kho và loại bỏ trùng lặp trong danh sách sản phẩm liên quan.
- Cải thiện điều hướng, hiển thị tiếng Việt, bố cục responsive và phần chân trang.
- Bổ sung kiểm thử cho trang sản phẩm, sản phẩm liên quan, đồng bộ catalog, giỏ hàng và chân trang.

## Hạn chế đã biết

- Checkout chỉ minh họa ở frontend; chưa tích hợp cổng thanh toán hoặc lưu đơn hàng ở backend.
- Cart, wishlist và tài khoản demo lưu trong localStorage, không đồng bộ giữa thiết bị. Mật khẩu tài khoản demo không được mã hóa; không dùng mật khẩu thật.
- Catalog quản trị phụ thuộc dịch vụ MockAPI; API quản trị và chức năng Firebase Admin cần cấu hình Vercel/Firebase riêng.
- Cần cấu hình Firebase providers và authorized domains để dùng đăng nhập thật.

## Kiểm tra trước phát hành

- `npm test` trong `flower.com` — đạt (5 bộ kiểm thử).
- `git diff --check` — đạt.

## Trạng thái phát hành

Bản ghi chú này được chuẩn bị cho v0.1.0. Chưa tạo tag hoặc phát hành GitHub.
