# FlowerFlow: backend độc lập

## Phạm vi và đích đến

Tài liệu này tổng hợp cả 10 mục yêu cầu ngày 16/11/2026. Host mới là
`src/FlowerFlow.Backend`; host chuyển đổi Firebase cũ `src/FlowerFlow.Api` được giữ nguyên.

| Mục | Cam kết thực hiện |
| --- | --- |
| 1 | Tập trung ASP.NET Core Web API, phát triển theo từng module nghiệp vụ. |
| 2 | Controllers, services, entities, DTOs, DI, middleware, validation, OpenAPI và kiểm thử. |
| 3 | Không thêm SQL Server, database, EF Core; không sửa dữ liệu, xác thực Firebase, Node/Vercel hoặc frontend. |
| 4 | Đã đối chiếu `aspnet/` với main sau PR #149; Domain trống, handler ghép HTTP/Firestore; giữ lại các quy tắc thuần C#. |
| 5 | Controller → application service → domain và interface lưu trữ → implementation in-memory. |
| 6 | Ưu tiên catalog → giá/kho → giỏ/báo giá → đơn → thanh toán → đánh giá/thiết kế/quản trị. |
| 7 | Validation, ProblemDetails, HTTP status, kiểm soát phiên bản, transaction và kiểm thử. |
| 8 | Giải thích luồng, lý do từng lớp, ví dụ và cách chạy trong tài liệu này. |
| 9 | Báo cáo đã được gửi; người dùng đã xác nhận thực hiện. Triển khai theo giai đoạn, ghi rõ trạng thái thực tế. |
| 10 | Đích đến ASP.NET duy nhất + SQL Server. Không đưa Firebase vào code mới; chỉ chuyển production và loại bỏ backend cũ sau yêu cầu riêng. |

Người dùng sau đó yêu cầu riêng merge PR #150 chuyển hosting sang Render.
PR đó đã được merge ở `6ab3748`; thay đổi đó là baseline của nhánh này,
không phải một phần của luồng API in-memory mới.

## Các thành phần

```text
FlowerFlow.Backend (host mới, Controllers, cấu hình HTTP)
    → FlowerFlow.Application/Commerce (DTOs, application services, interfaces)
    → FlowerFlow.Domain/Commerce (entities)
FlowerFlow.InMemory → Application + Domain
```

Host mới không tham chiếu `FlowerFlow.Infrastructure`, Firebase SDK hay SQLite.
Application cũ chứa các quy tắc C# thuần đã chuyển từ JavaScript; có thể tái sử dụng
mà không cần backend JS chạy kèm. Host mới không phục vụ hoặc đọc frontend.

`ICommerceUnitOfWork` là biên transaction: mọi thay đổi trong một thao tác phải
commit cùng nhau hoặc rollback cùng nhau. Implementation bộ nhớ dùng working copy
và khóa chung để bảo vệ cả chuỗi thao tác. `ExpectedVersion` phát hiện cập nhật
dựa trên dữ liệu cũ, tránh hai người ghi đè tồn kho.

Sau này implementation SQL cần bảo toàn isolation, rollback, unique constraints,
idempotency và optimistic concurrency. Repository hiện tại có `ListAsync` để chạy
bộ dữ liệu nhỏ trong bộ nhớ; trước production cần thêm query contracts có lọc và
phân trang ở tầng lưu trữ, tránh tải toàn bộ bảng. Chưa thêm package EF hoặc migration.

## Chạy và thử API

Từ gốc repo, cần .NET 10 SDK:

```powershell
dotnet run --project aspnet/src/FlowerFlow.Backend
```

Mở `http://localhost:5090/swagger` hoặc `/openapi/v1.json`.
`/health` chỉ xác nhận host mới và storage InMemory.

Trong Swagger, bấm **Authorize**, nhập một danh tính giả lập:

| Header `X-Development-User` | Quyền |
| --- | --- |
| `owner` | Owner và quản trị |
| `admin` | Quản trị, không được đổi giá cành hoa |
| `customer-a`, `customer-b` | Hai khách khác nhau để kiểm tra quyền sở hữu |
| Không gửi | Khách chưa đăng nhập |

Đây là mô phỏng danh tính, không xác minh mật khẩu/token. Chỉ dùng trên máy local;
host từ chối khởi động ở Production và chặn kết nối ngoài loopback. Không deploy
host này như một dịch vụ production. Firebase Authentication đang dùng không bị thay đổi.
Mỗi lần khởi động dữ liệu seed được tạo trong bộ nhớ rồi mất khi tiến trình dừng.
Không có endpoint reset công khai và không mở kết nối database.

Ví dụ tạo danh mục:

```powershell
Invoke-RestMethod http://localhost:5090/api/v1/categories -Method Post `
  -Headers @{ 'X-Development-User' = 'admin' } `
  -ContentType 'application/json' -Body '{"name":"Hoa tốt nghiệp"}'
```

Luồng: request JSON → MVC kiểm tra DTO → policy Admin → CatalogService kiểm tra
trùng tên → repository trong transaction → entity danh mục và audit → `201` cùng
Location. Trùng tên trả `409`; dữ liệu sai `400`; chưa đăng nhập `401`; thiếu quyền `403`.

Tại sao có từng lớp: Controller chỉ xử lý giao thức; DTO ngăn client gửi tùy ý
trường nội bộ; service điều phối nghiệp vụ; entity lưu trạng thái nghiệp vụ;
repository che cách lưu; middleware thống nhất lỗi; DI quản lý lifetime.
Unit of work singleton sở hữu dữ liệu chung; services/current actor scoped theo request.

Entity là trạng thái nội bộ, response DTO là hợp đồng HTTP. Các controller ánh xạ
entity sang DTO tường minh trong `ResponseDtos.cs`; bổ sung trường lưu trữ sau này
không tự xuất hiện trong JSON. Value object ổn định (tổng tiền, dòng hàng, lịch sử)
có thể dùng chung. Test kiến trúc kiểm tra không trả entity qua response và không
tham chiếu Firebase/SQLite/EF/SQL từ các project của host mới.

## Nguồn nghiệp vụ và hợp đồng mới

- Sản phẩm: `flower.com/js/admin/product-admin-validation.js`.
- Danh mục: `flower.com/js/admin/admin-categories.js` (đổi tên giữ liên kết, xóa bỏ phân loại).
- Giá cành hoa: `flower.com/backend/catalog/flower-prices.js` (Owner, 1.000–1.000.000.000 VND, lịch sử).
- Giá/khuyến mãi/giữ hàng/lịch giao: `flower.com/backend/orders/` và quy tắc C# thuần tương ứng.

API mới dùng prefix `/api/v1`, không thay URL website hiện tại. Danh mục được định danh
bằng ID ổn định và trả thêm tên hiển thị. Thay đổi tồn kho đi qua API điều chỉnh
có lý do và lịch sử; xóa sản phẩm trên API mới là ẩn để giữ tham chiếu đơn hàng.
Đây là hợp đồng mới chưa nối frontend; không tuyên bố thay thế hợp đồng backend cũ.

## Kiểm thử

```powershell
dotnet test aspnet/tests/FlowerFlow.Backend.Tests --configuration Release
```

Có thể chạy riêng theo nhóm bằng `--filter 'Category=Unit'`,
`--filter 'Category=Integration'` hoặc `--filter 'Category=Architecture'`.

Unit tests gọi service trực tiếp; integration tests dùng WebApplicationFactory,
khởi động pipeline MVC thực và gửi HTTP qua TestServer. Mỗi factory có store riêng.
Các test này không cần Node, Firebase Emulator, credentials hoặc database.
Bộ `FlowerFlow.Contracts` cũ vẫn giữ để đối chiếu hành vi backend chuyển đổi.

## API hiện có

Hợp đồng hiện tại: [API-CONTRACT.md](API-CONTRACT.md). Nhật ký rà soát và các lỗi
đã tái hiện/sửa: [REVIEW-152.md](REVIEW-152.md).

Các đường dẫn sau đều bắt đầu bằng `/api/v1`. Truy cập Swagger để xem schema và gửi request.

| Nhóm | API chính | Quyền ghi |
| --- | --- | --- |
| Sản phẩm | `GET/POST products`, `GET/PUT/DELETE products/{id}` | Admin/Owner |
| Danh mục | `GET/POST categories`, `PUT/DELETE categories/{id}` | Admin/Owner |
| Giá hoa | `PUT products/{id}/flower-price`, `GET products/{id}/price-history` | Owner |
| Kho | `POST/GET products/{id}/inventory-adjustments` | Admin/Owner |
| Giỏ và báo giá | `GET/PUT cart`, `POST quotes` | Giỏ riêng theo tài khoản; báo giá công khai |
| Đơn | `POST/GET orders`, `GET orders/{id}`, `PUT orders/{id}/status`, `POST orders/tracking` | Chủ đơn đọc; Admin cập nhật |
| Thanh toán | `POST orders/{id}/payments`, `POST payments/{id}/retry`, `POST payments/{id}/simulation` | Chủ đơn hoặc mã thanh toán; simulator chỉ Owner |
| Đối soát/hoàn tiền | `POST orders/{id}/qr-reconciliation`, `POST orders/{id}/refunds`, `GET orders/{id}/payment-audit` | Admin/Owner |
| Đánh giá | `POST/GET reviews`, `GET reviews/own/{orderId}`, `PUT reviews/{id}/moderation` | Chủ đơn đã giao gửi; Admin duyệt |
| Thiết kế | `POST/GET design-requests`, `GET/PUT design-requests/{id}`, `POST design-requests/{id}/response` | Khách gửi/phản hồi; Admin báo giá |
| Quản trị | `GET admin/users`, `PUT admin/users/{id}/role`, `GET admin/audit` | Đổi quyền chỉ Owner |
| Cài đặt | `GET/PUT shop-settings/wrapping`, `GET/PUT shop-settings/delivery-zones/{id}`, `GET/PUT shop-settings/promotions/{id}` | Phí gói/giao Owner; ưu đãi Admin |

Danh sách khu vực/ưu đãi dùng `GET shop-settings/delivery-zones` và `GET shop-settings/promotions`.
Khách chưa đăng nhập tạo thanh toán bằng header `X-Payment-Reference` lấy từ kết quả tạo đơn.
Mã thiết kế truyền qua header `X-Design-Token`, không đưa vào query string hoặc log.
Mã token thiết kế chỉ trả một lần khi tạo; chỉ hash được lưu trong bộ nhớ.

Không có gateway VNPay thật trong host mới. `IPaymentGateway` hiện dùng simulator;
`POST payments/{id}/simulation` nhận `outcome` là `paid` hoặc `failed`, `amount` chính xác
và `providerReference`. Không nhập thông tin thẻ, khóa VNPay hoặc credentials vào đây.
Khi thêm provider thật phải thiết kế xác minh callback và outbox/idempotency cho tác động
ngoài transaction; không thay simulator bằng lời gọi mạng nằm trong transaction SQL.

Đánh giá cần đơn của đúng tài khoản, đã giao và chưa từng đánh giá; ban đầu chờ duyệt.
Ảnh đánh giá dùng lại kiểm tra JPEG/120 KB/1600px, tối đa 3 ảnh. Đánh giá chưa duyệt
và ảnh của nó không hiển thị công khai. Yêu cầu thiết kế kiểm tra màu, số cành,
ngân sách, lịch giao và tính phí nhưng không giữ kho trước khi thành đơn.

## Ví dụ đặt hàng đầy đủ

Mở PowerShell tại máy đang chạy host:

```powershell
$baseUrl = 'http://localhost:5090/api/v1'
$identity = @{ 'X-Development-User' = 'customer-a' }
$items = @(@{ id = 'bouquet-rose'; quantity = 2 })
$quote = Invoke-RestMethod "$baseUrl/quotes" -Method Post -ContentType 'application/json' `
  -Body (@{ items = $items; promotionId = ''; deliveryZoneId = 'hcm-q1' } | ConvertTo-Json -Depth 8)
$checkout = @{
  items = $items; customerName = 'Khách thử'; phone = '0901234567'; address = 'Địa chỉ giả lập'
  deliveryDate = (Get-Date).AddDays(1).ToString('yyyy-MM-dd'); deliveryTime = '08:00–11:00'
  deliveryZoneId = 'hcm-q1'; paymentMethod = 'qr'; idempotencyKey = [guid]::NewGuid().ToString()
  expectedTotals = $quote.totals; customerIsRecipient = $true
}
$order = Invoke-RestMethod "$baseUrl/orders" -Method Post -Headers $identity `
  -ContentType 'application/json' -Body ($checkout | ConvertTo-Json -Depth 8)
$order
```

Gửi lại cùng `idempotencyKey` và cùng nội dung sẽ nhận lại đơn cũ; đổi nội dung
trên cùng key trả `409`. Giá được đọc lại ngay lúc tạo đơn: nếu tổng đã thay đổi,
trả `409 price-changed`, không giữ kho hoặc tạo đơn. Các dòng khác tùy chọn vẫn
phải gộp nhu cầu theo productId khi kiểm tra kho.

Luồng học tiếp: dùng admin đối soát QR đúng số tiền → đọc đơn để lấy `version`
→ cập nhật `Đang chuẩn bị` → `Đang giao` (kèm location/estimatedDelivery) → `Đã giao`
→ dùng customer-a gửi đánh giá → admin duyệt → thử GET đánh giá khi không có header.
Khung giờ/ngày giao tuân theo Việt Nam; chọn ngày tương lai khi chạy ví dụ.

## Trạng thái và lộ trình

- Đã xây dựng: host độc lập, DI, development identity, ProblemDetails, OpenAPI/Swagger.
- Đã xây dựng: sản phẩm/danh mục, giá cành hoa có lịch sử, điều chỉnh kho có lịch sử,
  kiểm tra phiên bản, audit nguyên tử và unit/integration tests.
- Đã xây dựng luồng in-memory: giỏ/báo giá, đơn và idempotency, giới hạn tạo/tra cứu,
  giữ/hoàn kho, trạng thái/số lượng đã bán, khôi phục đơn hết hạn, retry thanh toán,
  thanh toán trễ, đối soát QR/hoàn tiền và audit, đánh giá/ảnh/kiểm duyệt,
  thiết kế/báo giá/phản hồi, vai trò Admin/Owner và cài đặt.
- Cleanup chạy mỗi 30 giây trong host mới; API `POST orders/expire` cho Admin để thử
  trực tiếp. Việc xác nhận đơn hoặc thanh toán ngăn hết hạn giữ hàng. Hủy đơn đã giao
  chỉ hoàn kho khi yêu cầu `restockSold=true`; ghi nhận hoàn tiền không tự hoàn kho.
- Trước chuyển production: hoàn thành bảng đối chiếu tất cả nghiệp vụ, xác thực thật,
  phân quyền, rate limits, background jobs, SQL transaction/query contracts, kiểm thử
  tải, quan sát vận hành và kế hoạch chuyển dữ liệu/rollback được duyệt riêng.

Không coi việc có endpoint hoặc CI xanh là bằng chứng đã đạt toàn bộ parity hoặc
sẵn sàng chuyển website. Không kết nối SQL Server trong giai đoạn này.

Các khoảng trống trước thay backend cũ: import/export backup, upload ảnh sản phẩm,
wishlist và đồng bộ nhiều thiết bị, toàn bộ báo cáo/nội dung quản trị hiện ghi trực
tiếp Firestore, tài khoản/xác thực thực, gateway thật và các công cụ vận hành.
Những chức năng này tiếp tục ở hệ thống hiện tại; không bị xóa hoặc giả vờ đã chuyển.
Xem [COMPATIBILITY-MATRIX.md](COMPATIBILITY-MATRIX.md) để phân biệt luồng đã kiểm thử
trong bộ nhớ với những điều kiện cần trước khi thay backend chính thức.

## Ghi chú kiểm tra ban đầu

Kết quả kiểm tra local ngày 16/11/2026: solution build Release có 0 lỗi/0 cảnh báo;
42 kiểm thử xUnit đạt. Bản publish được khởi động riêng và trả `/health` InMemory,
Swagger HTTP 200, OpenAPI 37 đường dẫn. Output publish không có assembly Firebase,
Google.Cloud, SQLite, EF Core hoặc SqlClient. Những kết quả này xác nhận phạm vi
in-memory, không xác nhận production hoặc toàn bộ parity backend cũ.

`FlowerFlow.Api/Program.cs` ánh xạ nghiệp vụ bằng handler trong Infrastructure;
`HealthController` là controller ban đầu. `Domain` trước thay đổi này chỉ có csproj.
`LocalAccounts` dùng SQLite cho tài khoản local; host mới không tham chiếu nó.
Thư viện Firebase và Google.Cloud.Firestore nằm trong Infrastructure cũ, còn
Application chỉ tham chiếu Domain. Bộ Contracts là console runner đối chiếu JS,
có các kiểm thử SQLite/emulator; suite mới là xUnit + WebApplicationFactory.
Chưa sửa handler cũ, cấu trúc dữ liệu cũ hoặc cơ chế xác thực của website.
