# Giai đoạn tiếp theo cần xác nhận riêng: lưu trữ SQL Server/EF Core

Đây chỉ là đề xuất để review. Chưa thêm package EF, DbContext, connection string,
database, migration hoặc thao tác chuyển dữ liệu. Yêu cầu mục 3 hiện vẫn cấm các
việc đó; cần xác nhận mở giai đoạn mới trước khi thực hiện.

## Phạm vi đề xuất sau khi được phép

1. Hoàn thiện query contracts có lọc/phân trang ở tầng lưu trữ, tránh ListAsync toàn bảng.
2. Thiết kế mapping từ entity hiện tại; giữ hợp đồng HTTP và các kiểm thử nghiệp vụ.
3. Thêm adapter EF Core và unit of work; dùng database phát triển riêng, không nối hoặc sửa Firestore.
4. Kiểm thử lại rollback, unique constraints, version, idempotency và cạnh tranh trên SQL thật.
5. Sau đó mới xử lý xác thực/gateway thật và thiết kế migration/cutover riêng.

## Mô hình lưu trữ sơ bộ

| Nhóm | Dữ liệu dự kiến tách bảng | Ràng buộc quan trọng |
| --- | --- | --- |
| Catalog | Categories, Products, ProductImages/Tags | ID ổn định; version; giá/kho VND nguyên an toàn |
| Giá/kho | PriceChanges, InventoryChanges | Lịch sử cùng transaction với thay đổi sản phẩm |
| Giỏ | Carts, CartItems | Một giỏ/tài khoản; version; ID dòng khác productId |
| Cài đặt | Promotions/ProductLinks, DeliveryZones, WrappingTiers | Bậc phí tăng và kết thúc 50 cành; phạm vi ưu đãi |
| Đơn | Orders, OrderItems, OrderHistory | Snapshot thông tin/giá/phí tại thời điểm đặt, không phụ thuộc giá hiện tại |
| Chống trùng | OrderRequestKeys | Unique key toàn hệ thống; lưu user và fingerprint chuẩn hóa |
| Thanh toán | PaymentAttempts, PaymentAudit | Một kết quả không áp dụng hai lần; nhận diện attempt hiện tại và tiền trễ |
| Đánh giá | Reviews, ReviewImages, ReviewProducts | Unique orderId; quyền sở hữu; kiểm duyệt |
| Thiết kế | DesignRequests, Stems, History | Chỉ lưu hash token; snapshot báo giá và thông tin khách |
| Quyền/audit | Users/Roles hoặc identity adapter, AdminAudit | Chủ sở hữu/quyền hiệu lực, không tự đổi quyền Owner |

Tiền và kho hiện là long; có thể ánh xạ bigint kèm giới hạn số nguyên an toàn hiện tại.
Thời điểm dùng UTC/datetimeoffset; ngày và khung giao theo quy tắc Việt Nam.
ID/key phải so sánh cùng semantics với C# hiện tại: không để collation không phân biệt
hoa/thường mặc định của database vô tình gộp các ID khác nhau.

## Bảo đảm transaction phải giữ

- Tạo đơn + giữ kho + idempotency + quota/audit: cùng thành công hoặc cùng rollback.
- Check/update kho và version phải nguyên tử; kiểm thử nhiều kết nối/instance, không dùng khóa process làm bằng chứng.
- Hoàn kho/hủy/khôi phục chỉ áp dụng đúng một lần kể cả job và request chạy đồng thời.
- Retry transaction không được lặp tác động bên ngoài. Gateway thật cần outbox hoặc workflow bền vững;
  không giữ transaction SQL mở trong lúc gọi nhà cung cấp.
- Thay adapter không được thay cách làm tròn VND hoặc hợp đồng DTO. Chạy lại suite hiện có và test tích hợp SQL bổ sung.

## Các việc không nằm trong đề xuất triển khai ngay

Không chuyển dữ liệu sản xuất, không xóa Firebase/Firestore/Node, không đổi frontend,
không tạo dịch vụ trả phí và không cutover production chỉ vì adapter SQL đã chạy.
Mỗi việc đó cần phạm vi, kiểm chứng và yêu cầu riêng.
