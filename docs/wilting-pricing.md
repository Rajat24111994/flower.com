# Giá héo tự động (#107)

Tính năng chạy trên backend ASP.NET (`flower.com/backend/`). Mặc định **tắt**, không tự tạo cấu hình hay sửa dữ liệu khi khởi động. Owner phải nhập mức giảm và giá sàn trước khi bật ở `owner.html`. Firebase vẫn dùng project hiện tại `web-ban-hoa-9fe0b`.

## Quy tắc đã thống nhất

Ngày nhập là ngày lịch `yyyy-MM-dd` tại Việt Nam (UTC+7). Ngày nhập là ngày 0; tuổi hoa là chênh lệch giữa ngày hiện tại ở Việt Nam và ngày nhập, không phải số khoảng 24 giờ đã trôi qua.

Với giá gốc `B`, tuổi hoa `A`, ngày bắt đầu `S`, phần trăm giảm mỗi ngày `P` và giá sàn `F`:

```text
D = max(0, A - S + 1)
R = min(100, D * P)
giá héo = min(B, max(F, làm_tròn_VND(B * (100 - R) / 100)))
```

Giảm tuyến tính trên giá gốc, không giảm lũy kế. Ví dụ `B=100.000`, `S=1`, `P=10`, `F=40.000`: ngày nhập giữ 100.000, ngày 1 còn 90.000, ngày 2 còn 80.000; từ ngày 6 giữ 40.000. Nếu chọn `S=0`, giảm ngay ngày nhập. Làm tròn tới đồng gần nhất, nửa đồng làm tròn lên. Giá sàn cao hơn giá gốc không làm tăng giá.

Mỗi sản phẩm chọn một quy tắc đang bật, theo thứ tự **từng sản phẩm → nhóm sản phẩm → toàn bộ**. Nhóm là danh sách ID do Owner chọn; từng sản phẩm trong nhóm tính riêng, không đòi hỏi mua đủ nhóm. Cấm các quy tắc đang bật trùng phạm vi cùng cấp. Quy tắc ưu tiên cao chưa tới ngày giảm vẫn được chọn, không rơi xuống quy tắc cấp thấp hơn.

Thiếu ngày nhập, ngày không hợp lệ/ở tương lai, không có quy tắc phù hợp hoặc tính năng tắt thì dùng giá gốc. Khuyến mãi hiện có tính **sau** giá héo. Giá sàn chỉ giới hạn giá héo, không giới hạn phần giảm thêm từ khuyến mãi.

## Thao tác của Owner

1. Đăng nhập tài khoản Owner, mở mục **Giá héo tự động** trên trang Owner.
2. Chọn phạm vi, sản phẩm, ngày bắt đầu, phần trăm giảm mỗi ngày và giá sàn. Thêm quy tắc vào bản nháp.
3. Nhập ngày nhập của sản phẩm và lưu ngày. Để trống rồi lưu để xóa ngày. Lưu ngày không xóa bản nháp quy tắc.
4. Chọn bật và bấm **Lưu cấu hình**. Thêm/xóa quy tắc và bật/tắt chỉ có hiệu lực sau khi lưu cấu hình. Bỏ chọn bật rồi lưu để ngừng giảm giá.

Ngày nhập áp dụng cho **toàn bộ tồn kho hiện tại của một sản phẩm**. Owner phải cập nhật ngày khi nhập hàng mới. Chưa theo dõi nhiều lô, chưa tự chọn lô cũ trước và chưa tự gắn ngày từ phiếu nhập kho. Không dùng tính năng này để thể hiện tuổi riêng của nhiều lô chung một mã.

Nếu nhận lỗi xung đột, bản nháp vẫn còn để xem lại; tải lại từ máy chủ để lấy phiên bản hiện tại rồi nhập lại thay đổi cần thiết. Tải lại chủ động sẽ bỏ bản nháp. API kiểm tra cả custom claims và quyền Owner đang có trong `adminRoles`; Admin thường không được sửa.

## Dữ liệu và API

| Đường dẫn | Nội dung |
| --- | --- |
| `metadata/wiltingPricing` | `enabled`, `revision`, `rules[]`, `updatedAt`, `updatedBy` |
| `productFreshness/{productId}` | `receivedDate`, `updatedAt`, `updatedBy` |
| `adminAudit` | Thay đổi cấu hình/ngày nhập, trước và sau, ghi cùng transaction |
| Dòng đơn hàng/yêu cầu thiết kế | `wiltingPricing` snapshot: giá gốc, giá áp dụng, quy tắc, tuổi, số ngày giảm, ngày nhập/ngày tính, revision và tiết kiệm mỗi đơn vị |

Không sửa `products.price` hay thay đổi tồn kho khi cấu hình giá. Không cần migration SQL Server. Quy tắc có `id`, `name`, `enabled`, `scope` (`all`, `group`, `product`), `productIds`, `startAfterDays`, `dailyDiscountPercent`, `minPrice`. Giới hạn: 50 quy tắc, 200 ID/quy tắc, 500 ID khác nhau/cấu hình; ngày bắt đầu 0–3650, phần trăm nguyên 1–100, giá sàn nguyên 1.000–1.000.000.000 VND.

`GET /api/wilting-prices` trả cấu hình, ngày Việt Nam hiện tại và danh sách sản phẩm gồm giá gốc/giá hiện tại/ngày nhập. POST dùng Bearer token Owner:

```json
{
  "action": "save-rules",
  "expectedRevision": 0,
  "enabled": true,
  "rules": [{
    "id": "rule-1", "name": "Hoa theo ngày", "enabled": true,
    "scope": "all", "productIds": [], "startAfterDays": 1,
    "dailyDiscountPercent": 10, "minPrice": 10000
  }]
}
```

```json
{
  "action": "set-received-date", "productId": "1",
  "receivedDate": "2026-11-15", "expectedReceivedDate": ""
}
```

Ví dụ chỉ minh họa payload, không phải mức giảm mặc định. POST cấu hình tăng revision trong transaction; POST ngày kiểm tra ngày cũ trong transaction. Xung đột trả 409, dữ liệu sai 400, sản phẩm không tồn tại 404, backend/cấu hình lưu hỏng 503. Cấu hình hỏng không âm thầm chuyển sang một mức giá khác.

Catalog công khai trả giá đã tính kèm `basePrice` và snapshot; chế độ quản trị giữ giá gốc và thêm `effectivePrice`. Client không ghi giá giảm trở lại giá gốc. Khi biết giá héo đang bật, catalog dùng API định kỳ thay vì ghi đè bằng giá gốc từ Firestore listener. Khi API lỗi, cache có thể cũ; checkout luôn xác minh lại giá trên server.

Quote và tạo đơn tính lại theo cùng công thức. Tạo đơn đọc cấu hình/ngày nhập trong transaction, trước khi ghi tồn kho. Tổng tiền thay đổi sau quote trả lỗi `price-changed` để khách xác nhận lại. Đơn đã tạo và lần gọi lại idempotent giữ giá đã chốt; VNPay dùng tổng tiền đã lưu. Dự toán hoa của yêu cầu thiết kế dùng giá héo; quy trình báo giá thủ công hiện có vẫn được giữ.

## Triển khai và kiểm tra

Triển khai backend ASP.NET và frontend cùng phiên bản; JS backend cũ chỉ là bộ đối chiếu, chưa cung cấp API mới này. Triển khai `flower.com/firestore.rules` tới **project đang chạy** trước khi bật: client, kể cả Owner, không được ghi trực tiếp `metadata/wiltingPricing` hoặc đọc/ghi `productFreshness`; thao tác phải qua API có kiểm tra và audit. Đây là hướng dẫn triển khai, không xác nhận đã deploy hay bật trên production.

Chạy kiểm tra công thức độc lập:

```powershell
dotnet run --project flower.com/tests/UnitTests/FlowerFlow.Contracts --configuration Release -- --wilting
node --test tests/wilting-catalog.test.js
```

Chạy `flower.com/tests/IntegrationTests/wilting-prices.test.js` qua `flower.com/tests/IntegrationTests/test-api.cjs` trong Firebase Auth/Firestore Emulator; chạy giao diện bằng `playwright test e2e/wilting-prices.spec.js` tại `flower.com`. Kiểm thử chỉ dùng project demo, không thao tác database production.
