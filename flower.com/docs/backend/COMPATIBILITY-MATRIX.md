# Đối chiếu backend độc lập với hệ thống hiện tại

Phạm vi hiện tại: xây dựng và kiểm thử ASP.NET bằng dữ liệu trong bộ nhớ.
Không kết nối database, không thay frontend hoặc backend hiện có. Bảng này không
phải bằng chứng đã đạt toàn bộ parity production. SQL/EF và chuyển dữ liệu là giai đoạn riêng.

| Module | Nguồn nghiệp vụ đang tham khảo | Luồng mới đã có và kiểm thử | Phần cần trước cutover |
| --- | --- | --- | --- |
| Sản phẩm | `js/admin/product-admin-validation.js`, `backend/catalog/products.js` | DTO có validation; CRUD/ẩn; version; danh sách/phân trang | Upload ảnh, chuẩn hóa/import catalog cũ và toàn bộ field ngoài hợp đồng mới |
| Danh mục | `js/admin/admin-categories.js` | Trùng tên; đổi tên giữ liên kết; xóa về chưa phân loại | Kế hoạch ánh xạ tên cũ sang ID ổn định khi chuyển dữ liệu |
| Giá hoa | `backend/catalog/flower-prices.js` | Owner; VND nguyên; giới hạn; lịch sử/audit nguyên tử | Truy vấn lịch sử và quyền từ kho dữ liệu thật |
| Kho | `backend/orders/reservations.js`, `js/order/order-store.js`, `js/catalog/product-sales.js` | Chống oversell, giữ/hoàn một lần; phục hồi; soldCount | Chứng minh transaction/isolation/concurrency trên database đích và nhiều instance |
| Giỏ | `js/core/shopping-sync.js`, `js/catalog/bouquet-options.js` | Giỏ riêng theo tài khoản, version, tùy chọn và giới hạn dòng | Wishlist, đồng bộ nhiều thiết bị, dữ liệu giỏ cũ |
| Báo giá | `backend/orders/pricing.js`, `validation.js`, `checkout.js` | Giá server, ưu đãi, phí gói/giao; gộp nhu cầu theo productId | Mở rộng fixture đối chiếu ranh giới từ dữ liệu cũ trước chuyển hệ thống |
| Đơn | `backend/orders/checkout.js`, `tracking.js` | Idempotency; giá thay đổi; lịch Việt Nam; guest cap; quota; tracking riêng tư | Query/index, retention, job bền vững, kiểm thử tải và truy cập thực |
| Trạng thái | `js/order/order-status.js`, `js/order/order-store.js` | Thứ tự trạng thái; location khi đang giao; hoàn kho có điều kiện; số đã bán | Đồng bộ các màn báo cáo/nội dung quản trị hiện ghi trực tiếp Firestore |
| Thanh toán | `backend/payments/payments.js`, `vnpay-ipn.js`, `orders/payment-admin.js` | Simulator; retry; hết hạn; callback cũ/trùng; thanh toán trễ; QR/refund/audit | Gateway thật, chữ ký, callback endpoint, outbox và reconciliation vận hành |
| Đánh giá | `backend/orders/reviews.js`, `catalog/image-rules.js`, `js/admin/admin-reviews.js` | Chủ đơn đã giao; một đánh giá/đơn; JPEG có giới hạn; kiểm duyệt trước công khai | Kho ảnh thật, truy vấn công khai và dữ liệu moderation hiện có |
| Thiết kế | `backend/design-requests/validation.js`, `controller.js` | Lựa chọn/màu/ngân sách; kiểm tra cành; ước tính; báo giá; khách phản hồi qua token | Kho ảnh, lưu bền và các tình huống vận hành/fixture mở rộng |
| Quản trị | `backend/admin/users.js`, `owner-users.js`, `roles.js`, `audit.js` | Danh tính giả lập; Owner cấp/thu hồi admin; quyền hiệu lực request tiếp theo; audit | Xác thực thật, phiên/token, tài khoản và toàn bộ chức năng admin ngoài các module trên |
| Cài đặt | `backend/shop-settings/delivery-zones.js`, `bouquet-wrapping.js` | Khu vực bật/tắt, phí giao và bậc phí 50 cành; ưu đãi | Lưu bền, đồng thời cập nhật và lịch sử đầy đủ của cài đặt |
| Vận hành | `lib/firestore-backup.js`, scripts hiện có | Các công cụ cũ được giữ nguyên | Backup/restore cho hệ thống đích, cảnh báo, metrics, release/rollback |

## Những khác biệt hợp đồng có chủ đích

- Host mới dùng `/api/v1` và chạy riêng trên localhost. Các URL `/api/...` cũ không bị sửa.
- Controller + DTO thay cho action dispatcher cũ; frontend hiện tại chưa gọi API mới.
- CategoryId ổn định thay cho dùng tên danh mục làm liên kết. Tên vẫn được trả để hiển thị.
- ExpectedVersion bảo vệ cập nhật; điều chỉnh tồn kho có lý do và lịch sử.
- DELETE sản phẩm nghĩa là ẩn trong host mới. Backend cũ không bị đổi hành vi.
- Danh tính `X-Development-User` và gateway simulator chỉ dùng để kiểm thử local;
  chúng không thay Firebase Authentication hoặc VNPay đang vận hành.
- In-memory không bảo đảm bền dữ liệu hoặc nhất quán giữa nhiều tiến trình. Không triển khai
  host mới thành production khi chưa có các adapter và kiểm thử giai đoạn sau.

## Điều kiện hoàn thành theo 10 mục

1. API độc lập đã có host riêng và không phục vụ frontend.
2. Có C#, Controllers, services, entities, DTOs, DI, middleware, validation, OpenAPI và tests.
3. Không thêm SQL Server/EF, không tạo database, không sửa Firebase/Node/frontend.
4. Đã kiểm tra solution cũ, giữ cấu trúc phù hợp và ghi nhận technical debt.
5. Các lớp và biên transaction đã tách; responses không xuất entity trực tiếp.
6. Có các luồng cốt lõi cho 10 nhóm nghiệp vụ bằng dữ liệu giả lập; phạm vi thiếu được liệt kê trên.
7. Có kiểm thử nghiệp vụ, HTTP, concurrent updates, rollback và kiến trúc; chưa thay kiểm thử tải production.
8. Có hướng dẫn chạy, request mẫu, giải thích luồng và vai trò các lớp trong INDEPENDENT-BACKEND.md.
9. Thực hiện sau xác nhận, trên nhánh riêng; commit/CI cho kết quả cụ thể có thể review.
10. Hướng tới ASP.NET + SQL Server qua adapter lưu trữ và danh tính; chưa thực hiện cutover hoặc loại bỏ backend cũ.

## Technical debt còn được theo dõi

- Repository ListAsync hiện đọc tập dữ liệu nhỏ trong bộ nhớ. Cần query contracts có filter,
  pagination và index ở adapter SQL trước production; không tải cả bảng để lọc bằng C#.
- Unit of work hiện serialize toàn bộ thao tác trong một instance. SQL phải chứng minh các
  bảo đảm tương đương bằng transaction/unique constraints/optimistic concurrency, không dùng
  khóa trong process để giả định bảo vệ được nhiều instance.
- Gateway hiện chỉ là phép mô phỏng local trong transaction. Provider mạng thật cần outbox
  hoặc workflow bền vững; không giữ transaction SQL mở trong lúc gọi nhà cung cấp.
- Các bảng/quy tắc domain vẫn cần đối chiếu dữ liệu và các ngoại lệ cũ trước migration.
- Xác thực thật, phân quyền bền, secrets, observability, retention và recovery chưa nằm trong
  việc kết nối SQL ở giai đoạn hiện tại. Không tự bật các hệ thống đó trong thay đổi này.
