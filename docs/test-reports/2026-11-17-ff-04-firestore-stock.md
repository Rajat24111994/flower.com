# FF-04 — Firestore Rules và transaction tồn kho

Issue #159. Ngày kiểm chứng: 17/11/2026 (Asia/Bangkok).
Baseline main: `4af2e8746e80be689ed3e78d4a5762d56282f1bb`.
Project thử nghiệm: `demo-flowerflow`; Auth/Firestore Emulator, HTTP tới DLL C# thật.

## Thay đổi Rules

- Số lượng sản phẩm phải là số nguyên không âm, tối đa `9007199254740991`, khi
  tạo hoặc cập nhật từ client. Giới hạn khớp khả năng tính số nguyên chính xác của JS.
- Khi thay đổi cờ tồn kho của đơn: inventoryReserved/salesCounted phải là boolean;
  deadline/thời điểm hết hạn nếu còn tồn tại phải là timestamp.
- inventoryState chỉ nhận reserved/sold/released và phải nhất quán với cờ reserved
  cùng trạng thái đơn. Ví dụ: đơn đang chờ không thể tự chuyển inventoryState thành
  released hoặc giữ state reserved nhưng tắt inventoryReserved.
- Đơn legacy chưa có inventoryState vẫn được sửa trạng thái như trước. Khi đổi các
  cờ inventory, client phải ghi một state hợp lệ. Không sửa dữ liệu cũ tự động.
- Luồng hợp lệ reserved → sold → released → reserved và rollback transaction SDK
  đã được kiểm thử; không chặn thao tác quản trị hiện hữu của order-store.js.

Rà soát query phát hiện thiếu composite index cho
`orderPaymentAudit.where(orderId == ...).orderBy(createdAt desc)` tại
PaymentAdminService. Đã bổ sung cấu hình index vào `firestore.indexes.json`.
Index expiry `(inventoryReserved, reservationExpiresAt)` đã có và được giữ nguyên.

## Kiểm thử bổ sung

4 test Rules mới:

1. Từ chối quantity âm, lẻ, string và vượt giới hạn integer an toàn; vẫn cho 0/giá trị hợp lệ.
2. Từ chối cờ/state không nhất quán hoặc sai kiểu; chấp nhận lifecycle quản trị hợp lệ.
3. Một transaction client chứa stock âm bị từ chối toàn bộ: trạng thái đơn và stock
   không đổi. Transaction hợp lệ đổi cả stock và order được commit.
4. Guest/customer/admin/owner/admin đã thu hồi không thể get/list/create/update/delete
   13 collection nội bộ: orderRequests, orderCreationLimits, orderLookupLimits,
   paymentTransactions, orderPaymentAudit, loginProtection, designRequests, adminAudit,
   priceHistory, productFreshness, adminRoles, productImages, reviewImages.

4 test HTTP/transaction C# mới:

1. 12 request cùng key → một order, một orderRequests, stock chỉ giảm một lần;
   đổi nội dung trên key đó trả 409, không trừ thêm.
2. 5 người tranh 3 sản phẩm → 3 đơn thành công, 2 insufficient-stock; stock cuối 0,
   không có order/idempotency thừa.
3. Sản phẩm thứ hai thiếu kho sau quote → rollback toàn bộ, không mất kho sản phẩm
   đầu và không ghi order/idempotency. Cấp đủ hàng rồi dùng lại cùng key thành công.
4. 6 cleanup đồng thời → tổng released=1, hoàn lượng sản phẩm đã gộp đúng một lần;
   cleanup sau trả 0. Đơn đã xác minh thanh toán không bị giải phóng tồn kho.

Đây là transaction thật bằng SDK/Emulator, không mô phỏng stock bằng object trong bộ nhớ.

## Sửa lỗi tranh khóa replay

Lượt tập trung đầu tiên đạt nhưng lượt toàn hệ thống tiếp theo chỉ đạt 118/119:
test 12 request cùng key có response 503 `order-service-unavailable`, kèm
`Transaction lock timeout`. Kết quả lỗi này được giữ lại trong báo cáo.

Checkout replay trước đây đọc order/idempotency rồi kết thúc callback bình thường,
khiến SDK commit transaction không có write. Nay replay và expiry no-op ném một
kết quả chỉ đọc nội bộ; SDK rollback, lớp bao trả lại kết quả mà không commit rỗng.
Chỉ sử dụng kết thúc này ở nhánh chưa stage write. Các nhánh xóa deadline vẫn commit.

InventoryTransactions chỉ chạy lại tối đa 3 vòng SDK khi nhận `RpcException Aborted`.
Mỗi vòng chạy lại toàn bộ read/validate/write, không commit lại dữ liệu cũ; không
retry Unavailable, DeadlineExceeded, AlreadyExists, PermissionDenied hoặc Cancelled.
Tôn trọng cancellation trong backoff. Không tăng timestamp giả, không chuyển create
thành upsert và không dùng khóa process để thay bảo đảm transaction giữa các instance.

InventoryTransactionContracts xác minh giới hạn retry, phân loại lỗi, kết quả chỉ đọc
và hủy khi backoff; chương trình trả exit 0.

## Kết quả

- Nhóm Rules + stock tập trung: **23/23 đạt, 0 bỏ qua**, 27,83 giây ở lượt đầu.
- Bộ HTTP toàn hệ thống sau sửa transaction: **119/119 đạt, 0 lỗi, 0 bỏ qua**,
  60,88 giây. Bao gồm ma trận Rules mở rộng cuối cùng và 4 test tranh chấp/rollback.
- Kiểm tra cú pháp JavaScript và `git diff --check`: đạt.
- Build Release sau sửa C#: đạt, 0 warning/error. Phần mã chạy là host trên main;
  không nhập backend của nhánh aspnet-upgrade chưa merge.

Lệnh tái chạy đầy đủ từ gốc repository sau khi cài dependency và build Release:

```sh
node flower.com/node_modules/firebase-tools/lib/bin/firebase.js emulators:exec --only auth,firestore --project demo-flowerflow --config flower.com/firebase.json "node flower.com/tests/IntegrationTests/test-api.cjs"
dotnet run --project flower.com/tests/UnitTests/FlowerFlow.Contracts --configuration Release --no-build -- --inventory-retry
```

## Ranh giới bảo đảm

- Firestore Admin SDK của backend bỏ qua Rules. Kiểm thử backend phải kiểm tra chính
  transaction/authorization; Rules pass không thay thế kiểm tra nghiệp vụ C#.
- Admin hợp lệ hiện được phép chỉnh stock và trạng thái đơn trực tiếp qua client SDK.
  Rules kiểm tra quyền, kiểu dữ liệu và state; không chứng minh tổng delta của mọi
  sản phẩm bằng items của order trong mọi thao tác admin tùy ý. Atomicity được chứng
  minh cho transaction đã thử, không cho một admin cố ý gửi các write riêng rẽ.
- Rules không đọc trạng thái Disabled hoặc thời điểm revoke từ Firebase Auth. Xóa
  live adminRoles chặn quyền admin trong Rules; API có kiểm tra Disabled riêng từ #158.
  Token client cũ vẫn có thể truy cập dữ liệu được Rules cho phép tới khi hết hạn.
- Không dùng Emulator để kết luận composite index production đã READY. Emulator
  không thực thi yêu cầu index giống production.
- Chỉ kiểm chứng Rules trong repository và Emulator; **chưa deploy Rules/indexes lên
  Firebase production**. Push main/Render deployment không tự triển khai Firestore Rules.
- Trước khi triển khai Rules, xác nhận live adminRoles đầy đủ, kiểm thử staging và
  đối chiếu dữ liệu legacy. Triển khai rules/indexes bằng tài khoản có quyền trên
  project đích đã xác nhận, chờ index READY rồi smoke test; giữ ruleset trước để rollback.
- Local Windows dùng Node 26.13.0, Java 21; CI dùng Node 24. Không ghi dữ liệu thật,
  không tạo đơn hay giao dịch production trong đợt này.
