# Chuyển backend JavaScript sang C# theo từng file

## Yêu cầu áp dụng

- Nguồn đối chiếu: `../flower.com/backend/`, các entry point `../flower.com/api/`, rewrite trong `vercel.json` và các module dùng chung được backend import.
- Giữ Firebase Authentication và Cloud Firestore hiện tại. Dùng Firebase Admin SDK cho xác thực và Google.Cloud.Firestore cho truy cập Firestore trong các bước tích hợp C#.
- Không chuyển dữ liệu sang SQL Server, tạo lại database, đổi collection/document/field hoặc chạy EF migration cho công việc chuyển đổi này.
- Giữ nguyên frontend, URL, HTTP method, query, body, response, mã lỗi, thông báo lỗi, header, điều kiện phân quyền và transaction.
- Không lưu service account vào mã nguồn, frontend hoặc tài liệu. Giữ cấu hình bí mật ở phía server.
- Mỗi bước chuyển một file nghiệp vụ, đối chiếu nguồn và kiểm tra trước khi chuyển file tiếp theo. Không xóa file JS hoặc chuyển lưu lượng khi các phụ thuộc và hợp đồng API chưa được kiểm chứng.

## Hiện trạng và phần cần phân tích tiếp

Đã kiểm kê 32 file trong `backend/`, rà soát import/export, điểm vào API và các collection được tham chiếu. Đây là kiểm kê ban đầu, **chưa phải xác nhận đã phân tích đầy đủ mọi nhánh nghiệp vụ**. Cần hoàn thành phân tích chi tiết toàn bộ backend cùng các module chia sẻ ngoài thư mục trước khi chuyển các luồng thực thi/API.

Nhánh riêng `codex/aspnet-sql-server` có `ProductsController` và `AccountController` dùng SQL Server. Các endpoint này chưa tương đương backend Firestore và không được coi là đã chuyển đổi xong. Không đưa khung SQL Server đó vào main trong bước chuyển đổi này. Main bắt đầu với project Application độc lập, không có phụ thuộc SQL Server.

Các nhóm cần đối chiếu chi tiết:

| Nhóm | File nguồn | Điểm cần bảo toàn |
| --- | --- | --- |
| shared | firebase-admin, request-identity, admin-audit, api-routes | Token bị thu hồi, claim admin và document adminRoles, owner, lỗi 401/403/503, session local, audit trong transaction, query route |
| accounts | password-auth, login-protection, login | Firebase password provider, kiểm tra public API key bị chặn, lease transaction, khóa tăng dần, reset mật khẩu, custom token |
| admin | roles, users, owner-users, audit | Claims và adminRoles, phân trang, không tự đổi quyền owner, audit |
| catalog | image-rules, product-images, review-images, products, flower-prices | Bytes/JPEG, quyền xem ảnh, chuẩn hóa sản phẩm/ảnh cũ, giá nguyên VND, owner và lịch sử giá |
| shop-settings | delivery-zones, bouquet-wrapping | Metadata hiện tại, vùng trùng, bậc phí, public/manage, audit nguyên tử |
| orders | config, validation, pricing, checkout, reservations, tracking, payment-admin, reviews, controller | Giá/khuyến mãi/phí, lịch Việt Nam, giới hạn giỏ hàng, idempotency, chống vượt kho, thời hạn giữ hàng, hoàn kho một lần, tra cứu, đối soát/hoàn tiền, quyền đánh giá |
| payments | vnpay, payments, vnpay-ipn | Canonical query/HMAC, attempt/retry, idempotency IPN, kiểm tra tiền, hết hạn và hoàn kho |
| design-requests | validation, controller | Token truy cập, lựa chọn thiết kế, quote/reply, quyền và lịch sử |

Backend còn import module frontend dùng chung như `product-store.js`, `bouquet-options.js`, `bouquet-wrapping.js`, cùng `lib/local-session.js`. Cần chuyển phần quy tắc dùng ở server mà vẫn giữ nguyên các file frontend. Các API rewrite `/api/flower-prices`, `/api/bouquet-wrapping`, `/api/admin/audit` và dạng `?route=` cần được đối chiếu riêng.

## File 01: orders/config.js

Đích: `src/FlowerFlow.Application/Orders/OrderConfig.cs`.

Đã chuyển đủ 9 export, giữ nguyên giá trị và đơn vị milliseconds:

| JavaScript | C# | Giá trị |
| --- | --- | --- |
| MAX_QUANTITY_PER_PRODUCT | MaxQuantityPerProduct | 50 |
| QR_RESERVATION_MS | QrReservationMs | 1800000 |
| VNPAY_RESERVATION_MS | VnpayReservationMs | 900000 |
| COD_RESERVATION_MS | CodReservationMs | 1800000 |
| ORDER_LOOKUP_WINDOW_MS | OrderLookupWindowMs | 600000 |
| ORDER_LOOKUP_MAX_ATTEMPTS | OrderLookupMaxAttempts | 20 |
| DELIVERY_TIME_WINDOWS | DeliveryTimeWindows | 08:00–11:00; 11:00–14:00; 14:00–17:00; 17:00–20:00 |
| DELIVERY_TIME_ZONE | DeliveryTimeZone | Asia/Ho_Chi_Minh |
| MAX_ORDER_NOTE_LENGTH | MaxOrderNoteLength | 500 |

Danh sách khung giờ giữ đúng ký tự en dash của nguồn và được cung cấp dạng chỉ đọc. File không truy cập database, không thay đổi endpoint và chưa được nối vào các luồng C# khác. Việc chuyển file này chưa có nghĩa API đơn hàng đã chạy bằng C#.

Khung ASP.NET Core Web API đã có solution `FlowerFlow.sln` và bốn project Api, Application, Domain, Infrastructure. `OrderConfig.cs` được đặt trong Application/Orders. Có CI build .NET riêng, không thay đổi các job kiểm thử JavaScript hiện tại.

Kiểm tra từ gốc repository: `dotnet build aspnet/FlowerFlow.sln --configuration Release --nologo` thành công, 0 warning và 0 error. Chạy API Release và gọi `/health` thực tế: HTTP 200, `Cache-Control: no-store`, body `{"status":"ok","service":"flowerflow-api"}`. Đây là kiểm tra khung HTTP và biên dịch, chưa phải kiểm tra tích hợp Firebase hoặc xác nhận tương đương API nghiệp vụ.

Bước tiếp theo: hoàn thành phân tích chi tiết backend trước khi chuyển các file có logic thực thi; ưu tiên nền tảng Firebase/Firestore và phân quyền trước các controller.

## File 02: shared/firebase-admin.js

Nhánh làm việc từ bước này: `asp.net`, bắt đầu từ commit khung ASP.NET `d1644f1` trên main.

Đích: `src/FlowerFlow.Infrastructure/Firebase/FirebaseAdminService.cs`. Chỉ chuyển file nguồn này, kèm đăng ký DI, thư viện SDK và kiểm thử cần thiết.

| JavaScript | C# |
| --- | --- |
| getAdminAuth | FirebaseAdminBackend.GetAdminAuth |
| getAdminFirestore | FirebaseAdminBackend.GetAdminFirestore |
| sendError | FirebaseAdminService.SendErrorAsync |
| verifyRequest | FirebaseAdminService.VerifyRequestAsync |
| verifyAdminRequest | FirebaseAdminService.VerifyAdminRequestAsync |
| verifyOwnerRequest | FirebaseAdminService.VerifyOwnerRequestAsync |

Giữ service account ở biến môi trường server, project ID override/fallback, một app dùng chung cho Auth/Firestore, xác minh token có `checkRevoked: true`, claim `admin` phải là boolean true, document `adminRoles/{uid}` phải tồn tại; owner yêu cầu cả claim role và document role là `owner`. Giữ mã HTTP, code và thông báo lỗi tiếng Việt, không cache document phân quyền. JSON lỗi vẫn có `{ code, error }`.

Khác biệt triển khai SDK: C# tạo app có tên riêng thuộc singleton và giải phóng khi host dừng, không dùng nhầm app toàn cục của thành phần khác. Firestore dùng thư viện Google.Cloud.Firestore, cùng credential và project với Firebase Admin. Lỗi cấu hình credential và log được làm sạch để không lộ khóa, token hoặc chi tiết provider. Chưa đổi URL, method, frontend, dữ liệu hoặc cấu trúc Firestore.

Bộ kiểm thử đối chiếu trực tiếp với JS gốc và kiểm tra khởi tạo SDK dùng khóa tạm, không thao tác database thật. Chưa xác nhận kết nối project Firebase thật hoặc triển khai API nghiệp vụ.

Kết quả kiểm tra file 02:

- Build Release toàn solution: thành công, 0 warning, 0 error.
- `dotnet run --project aspnet/tests/FlowerFlow.Contracts --configuration Release`: 31 tình huống thành công, trong đó 24 tình huống đối chiếu trực tiếp với module JavaScript và 7 tình huống cấu hình/khởi tạo SDK (gồm emulator).
- API khởi động khi không có biến bí mật Firebase; `/health` trả HTTP 200 và `Cache-Control: no-store`.
- Frontend, backend JS nguồn và cấu hình Vercel không bị thay đổi.

## File 03: catalog/image-rules.js

Đích: `src/FlowerFlow.Application/Catalog/ImageRules.cs`. Giữ giới hạn 3 ảnh, 120 KiB/ảnh, JPEG SOF C0/C1/C2, kích thước 1–1600, base64 canonical và dữ liệu bytes gốc; phân biệt tham số thiếu với JSON null. Đối chiếu trực tiếp với module JS qua `image-rules-oracle.cjs` gồm ảnh thật, biên kích thước, dữ liệu sai định dạng và quá giới hạn. Không thay frontend hoặc endpoint.

## File 04: shared/api-routes.js

Đích: `src/FlowerFlow.Infrastructure/Http/ApiRoutes.cs`. Giữ handler mặc định khi không có query route; phân biệt hoa/thường, từ chối query lặp hoặc route không khai báo bằng HTTP 404, `{ code, error }` và no-store. Danh sách route được sao chép chỉ đọc. Tám tình huống đối chiếu trực tiếp với JavaScript, gồm route rỗng, lặp và `__proto__`.

## File 05: shared/request-identity.js

Đích: `src/FlowerFlow.Infrastructure/Http/RequestIdentity.cs`. Giữ khách ẩn danh, bearer nghiêm ngặt có kiểm tra thu hồi, danh tính local chỉ từ middleware server, từ chối session local sai hoặc trộn bearer/local. Port cả helper sessionCookie được export từ local-session: không có cookie trả null, cookie lặp trả chuỗi rỗng. Kiểm thử ranh giới local/bearer và cookie mơ hồ; chưa chuyển SQLite/local-server runtime.

## File 06: shared/admin-audit.js

Đích: `src/FlowerFlow.Infrastructure/Firebase/AdminAudit.cs`. Giữ collection adminAudit, giới hạn độ dài UTF-16, server timestamp, details gốc (kể cả null), tạo document mới và audit nằm trong transaction gốc khi gọi AddAdminAudit. RecordAdminAuditAsync tạo riêng như JS. Kiểm thử dữ liệu audit và giới hạn; kiểm thử ghi thật cần Firestore Emulator, không ghi project production.

Đã kiểm thử ghi audit, timestamp do server tạo, commit đồng thời và rollback trên Firestore Emulator 127.0.0.1:8787, project cố định demo-flowerflow-csharp. Bộ kiểm thử từ chối dùng credentials/endpoint production bằng cách khởi tạo client test với endpoint loopback và channel insecure cố định. CI đã có bước khởi động emulator và chạy `--firestore-emulator`.

## File 07: admin/roles.js

Đích: `src/FlowerFlow.Infrastructure/Firebase/AdminRoles.cs`. Giữ boolean claim, owner/admin, merge khi đồng bộ một tài khoản, xóa quyền, backfill chỉ tạo thiếu/xóa thừa và không sửa document đang tồn tại. Kiểm tra trên emulator: merge giữ field cũ, owner, batch write count, chạy lặp không ghi và gỡ quyền.

## File 08: accounts/login-protection.js

Đích: `src/FlowerFlow.Infrastructure/Accounts/LoginProtection.cs`. Giữ 5 lần sai đầu, khóa 15/30/60/120/240 phút rồi bắt buộc reset, lease 60 giây, transaction trước/sau provider, chỉ phiên bản mật khẩu server mới xóa khóa. Test emulator: hai yêu cầu đồng thời chỉ một lease, phiên bản mới không vượt lease đang chạy, leo thang khóa và expiry, reset, thành công xóa record, provider outage không tăng failures, lease hết hạn từ chối kết quả.

## File 09: payments/vnpay.js

Đích: `src/FlowerFlow.Application/Payments/Vnpay.cs`. Giữ cấu hình sandbox/production, thời gian Việt Nam, ký HMAC-SHA512 và so sánh constant-time, mã tham chiếu/số tiền hợp lệ, giới hạn số tiền nhân 100, IP fallback và form encoding của URLSearchParams. Kiểm thử đối chiếu canonical query, chữ ký và URL đã ký chính xác với JS (Unicode, khoảng trắng, ký tự đặc biệt, IP không hợp lệ), biên số tiền và thiếu cấu hình. Chưa chuyển payments/IPN handler.

## File 10: catalog/review-images.js

Đích: `src/FlowerFlow.Infrastructure/Catalog/ReviewImagesHandler.cs`, route `/api/review-images` trên API C#. Giữ GET, regex id, ảnh approved công khai/ảnh pending chỉ tác giả hoặc admin có role sống, token thu hồi, photoIds và reviewId khớp, bytes JPEG, private/no-store và nosniff, lỗi tiếng Việt. Test emulator: pending không lộ cho guest, tác giả xem được, approved public, bytes/header, từ chối ảnh thuộc review khác. Chưa chuyển traffic từ Vercel.

## File 11: catalog/product-images.js

Đích: `src/FlowerFlow.Infrastructure/Catalog/ProductImagesHandler.cs`, URL `/api/product-images`. Giữ quyền claim + adminRoles, kiểm tra ảnh, document SHA-1, create và bỏ qua AlreadyExists, HTTP 201 URL cũ, GET bytes JPEG với immutable cache 1 năm/nosniff, mã lỗi và thông báo. Test emulator: claim không role bị từ chối, tải lặp cùng ảnh không lỗi, SHA-1 URL, bytes/cache giữ nguyên, ảnh sai bị từ chối.

## File 12: admin/audit.js

Đích: `src/FlowerFlow.Infrastructure/Admin/AdminAuditHandler.cs`, URL `/api/admin/audit`. Giữ GET, private/no-store, xác thực admin, thứ tự createdAt giảm dần/100 bản ghi, whitelist field và timestamp ISO, lỗi nguyên bản. Test emulator: trường trả về và giới hạn, bản ghi audit tồn tại trong kết quả, không có token bị từ chối. Alias `?route=audit` sẽ được nối khi chuyển admin/users.js.

## File 13: shop-settings/bouquet-wrapping.js

Đích: `src/FlowerFlow.Infrastructure/ShopSettings/BouquetWrappingHandler.cs`, kèm bản C# server-only của quy tắc bouquet-wrapping mà backend import từ frontend. Giữ metadata/bouquetWrapping, GET public/manage, POST admin, 1–10 bậc tăng dần kết thúc 50 cành, phí VND nguyên, audit cùng transaction, response/errors và URL cũ. Test emulator: chưa cấu hình, bậc thiếu bị từ chối không ghi, lưu hợp lệ và audit. Frontend không sửa. Alias query được nối khi chuyển delivery-zones.js.

## File 14: shop-settings/delivery-zones.js

Đích: `src/FlowerFlow.Infrastructure/ShopSettings/DeliveryZonesHandler.cs`. Giữ coercion và validation zone, phí số nguyên, enabled boolean, trùng tỉnh/quận không phân biệt hoa/thường tiếng Việt, public/manage, upsert/delete và audit trong transaction, alias `?route=bouquet-wrapping`. Kèm adapter JS coercion dùng chung cho các bước tiếp theo. Test emulator: upsert/delete, trùng địa bàn trả 409, public ẩn vùng disabled/manage hiện đầy đủ, alias cũ hoạt động.

## File 15: orders/validation.js

Đích: `src/FlowerFlow.Application/Orders/OrderValidation.cs`, kèm server copy của normalize/demand từ bouquet-options.js. Giữ nguyên chuẩn hóa điện thoại, checkout/quote/items/options, UUID v4, expectedTotals safe integer, recipient fallback, khung giờ và cutoff 15:00 Việt Nam, ngày Gregorian kể cả năm 0000. Đối chiếu trực tiếp JS các biên dữ liệu, coercion số, duplicate cart lines, tùy chọn bó hoa và lịch giao ở hai phía cutoff. Frontend giữ nguyên.

## File 16: orders/pricing.js

Đích: `src/FlowerFlow.Application/Orders/OrderPricing.cs`. Giữ quy đổi giá USD cũ sang VND (25949.123093), làm tròn đúng JS, giá hoa/sản phẩm, khuyến mãi và ngày Việt Nam, eligibility theo productId, tổng hợp dòng tồn kho, mã QR từ idempotency key, khu vực giao và phí bó tùy chỉnh. Kiểm thử đối chiếu trực tiếp với JS cả kết quả và mã/thông báo lỗi, các biên giá/khuyến mãi/bó tối đa 50 cành.

## File 17: orders/reservations.js

Đích: `src/FlowerFlow.Infrastructure/Orders/Reservations.cs`. Giữ giải phóng kho trong transaction, tổng hợp dòng sản phẩm, không hủy đơn đã xác nhận/thanh toán, xóa timer cũ, trạng thái QR/VNPay/history và attempt hết hạn, quét tối đa 500/100 mỗi batch, cleanup lỗi không chặn đặt hàng. Test emulator: hai tiến trình cleanup chỉ hoàn kho một lần, dòng trùng cộng đúng, giữ kho confirmed/paid, cleanup attempt VNPay pending.

## File 18: orders/tracking.js

Đích: `src/FlowerFlow.Infrastructure/Orders/OrderTracking.cs`. Giữ dữ liệu public giới hạn riêng tư, QR/VNPay/refund, dữ liệu account, auth và local identity, tra cứu mã đơn/điện thoại, limiter HMAC từ IP trusted và service-account secret, transaction 20 lần/10 phút, đơn account tối đa 100 và thông báo lỗi. Kèm adapter Firestore timestamp/JSON tương thích Node (_seconds/_nanoseconds khi spread raw; ISO làm tròn mili giây như Timestamp.toDate). URL orders sẽ nối sau khi các service orders còn lại đã chuyển. Reverse proxy triển khai phải ghi đè x-forwarded-for như Vercel hiện tại; không dùng IP do client tự chọn để triển khai production.

## File 19: catalog/flower-prices.js

Đích: `src/FlowerFlow.Infrastructure/Catalog/FlowerPricesHandler.cs`, GET/PATCH `/api/flower-prices`. Giữ claim+document owner, validation id/giá, danh sách hoa tiếng Việt, lịch sử giảm dần, quy đổi giá cũ, no-op giá không đổi, update product/history/audit trong cùng transaction, mã lỗi và response. Test emulator: Owner cập nhật và lịch sử đúng, không ghi lặp giá không đổi, document owner bị gỡ từ chối claim cũ. Alias trên products nối ở file kế tiếp.

## File 20: catalog/products.js

Đích: `src/FlowerFlow.Infrastructure/Catalog/ProductsHandler.cs`. Giữ trường Firestore gốc, id fallback, timestamp top-level ISO, sửa title lỗi dấu và ảnh cũ theo flower.json hiện tại, public chỉ loại status hidden (không tự loại archived), manage claim+document, header cache và alias flower-prices. flower.json được liên kết làm content build/publish, không sửa file frontend. Test emulator: sửa dữ liệu catalog cũ, public/manage/hidden/archived, timestamp và giữ trường gốc.
