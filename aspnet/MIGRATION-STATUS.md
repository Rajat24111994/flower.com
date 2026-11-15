# Chuyển backend JavaScript sang C# theo từng file

## Yêu cầu áp dụng

- Nguồn đối chiếu: `../flower.com/backend/`, các entry point `../flower.com/api/`, rewrite trong `vercel.json` và các module dùng chung được backend import.
- Giữ Firebase Authentication và Cloud Firestore hiện tại. Dùng Firebase Admin SDK cho xác thực và Google.Cloud.Firestore cho truy cập Firestore trong các bước tích hợp C#.
- Không chuyển dữ liệu sang SQL Server, tạo lại database, đổi collection/document/field hoặc chạy EF migration cho công việc chuyển đổi này.
- Giữ nguyên frontend, URL, HTTP method, query, body, response, mã lỗi, thông báo lỗi, header, điều kiện phân quyền và transaction.
- Không lưu service account vào mã nguồn, frontend hoặc tài liệu. Giữ cấu hình bí mật ở phía server.
- Mỗi bước chuyển một file nghiệp vụ, đối chiếu nguồn và kiểm tra trước khi chuyển file tiếp theo. Không xóa file JS hoặc chuyển lưu lượng khi các phụ thuộc và hợp đồng API chưa được kiểm chứng.

## Hiện trạng

Đã đọc và chuyển lần lượt 32 file trong `backend/` cùng 8 file server trong `lib/`, đối chiếu import/export, nhánh xử lý, điểm vào API, collection và quy tắc frontend được server import. Các bước 01–40 bên dưới ghi bản C# và kiểm thử cho từng file. Runtime ASP.NET phục vụ frontend và toàn bộ API; launcher `npm run dev` cũng khởi động C#. JS backend cũ được giữ để làm oracle; HTML/CSS/JS frontend không bị sửa. Hướng dẫn chạy/cấu hình/giới hạn triển khai ở [README.md](README.md). Chưa chuyển deployment hoặc dùng database Firebase thật.

Nhánh riêng `codex/aspnet-sql-server` có `ProductsController` và `AccountController` dùng SQL Server. Các endpoint này chưa tương đương backend Firestore và không được coi là đã chuyển đổi xong. Không đưa khung SQL Server đó vào main trong bước chuyển đổi này. Main bắt đầu với project Application độc lập, không có phụ thuộc SQL Server.

Các nhóm đã đối chiếu (các ghi chú phía dưới là nhật ký tại từng bước chuyển đổi):

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
| lib | local-session, local-rate-limit, content-security, local-accounts, local-account-worker, local-auth-http, firestore-backup, local-server | Cookie, CSP, SQLite/scrypt cũ, recovery/lockout, worker giới hạn, mã hóa backup, static whitelist, Host/Origin, JSON size và IP tin cậy |

Quy tắc server từ `product-store.js`, `bouquet-options.js`, `bouquet-wrapping.js` đã được chép tương đương vào Application; file frontend giữ nguyên. Các API rewrite `/api/flower-prices`, `/api/bouquet-wrapping`, `/api/admin/audit` và dạng `?route=` đã có kiểm tra riêng. Không có thay đổi API yêu cầu sửa frontend.

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

## File 21: design-requests/validation.js

Đích: `src/FlowerFlow.Infrastructure/DesignRequests/DesignValidation.cs`. Giữ toàn bộ lựa chọn/giới hạn, chuẩn hóa thiết kế/cành/màu, phụ kiện và budget, chữ ký ảnh JPEG/PNG/WebP, token SHA-256 constant-time, dữ liệu public loại accessTokenHash và history. Đối chiếu trực tiếp với JS cả các quy tắc dễ sai như paperLayers số 0 so với chuỗi "0", addons trùng/coercion, null design và hex token có hậu tố (Buffer.from semantics).

## File 22: design-requests/controller.js

Đích: `src/FlowerFlow.Infrastructure/DesignRequests/DesignRequestsHandler.cs`, `/api/design-requests`. Giữ create/lookup/manage/respond/admin-update, token ngẫu nhiên chỉ lưu hash, kiểm tra màu/kho/giá hoa hiện tại, estimate không tính phí giao và không giữ kho, phí gói, báo giá và history/state transaction. Giữ cả response snapshot history cũ ở respond/admin-update như JS. Test emulator: tạo và ước tính không trừ kho, lookup không lộ hash, admin báo giá, khách xác nhận và trạng thái lưu đúng.

## File 23: orders/reviews.js

Đích: `src/FlowerFlow.Infrastructure/Orders/OrderReviews.cs`. Giữ ID review SHA-256 rút gọn 40, chủ đơn đã giao, một review/đơn trong transaction, JPEG và photoIds, tên/sản phẩm lấy từ đơn, không giả danh cửa hàng, pending moderation và own-review lookup. Test emulator: đơn chưa giao bị từ chối, hai yêu cầu đồng thời chỉ một thành công, pending/name privacy và chủ đơn đọc review. Nối action trên orders sau khi controller được chuyển.

## File 24: orders/payment-admin.js

Đích: `src/FlowerFlow.Infrastructure/Orders/PaymentAdmin.cs`. Giữ phân quyền với mã forbidden, đối soát QR đúng tổng tiền, xác nhận tiền trễ riêng, ghi nhận hoàn tiền một lần, audit orderPaymentAudit trong transaction và whitelist 25 bản ghi mới nhất. Test emulator: sai số tiền từ chối, xác minh/hoàn tiền lặp từ chối, audit chỉ ghi cho lần thành công, tiền trễ không tự khôi phục đơn/kho đã giải phóng. Nối action khi controller orders hoàn tất.

## File 25: accounts/password-auth.js

Đích: `src/FlowerFlow.Infrastructure/Accounts/PasswordAuth.cs`. Giữ khóa public/server riêng, kiểm tra public key khớp frontend hiện tại (content liên kết, không sửa frontend), probe cả hai endpoint yêu cầu API_KEY_SERVICE_BLOCKED đúng method, cache chung 60 giây, lookup passwordUpdatedAt phía server, HMAC tài khoản không tồn tại, lỗi provider không tính sai mật khẩu, timeout 10 giây và chặn redirect. Bổ sung ranh giới SDK FirebaseAccounts dùng credential phía server với scope identitytoolkit. Emulator chỉ loopback và bị chặn trên môi trường production của ASP.NET/Node/Vercel. HttpClient logging tắt để không lộ API key trong URL.

## File 26: accounts/login.js

Đích: `src/FlowerFlow.Infrastructure/Accounts/LoginHandler.cs`, `/api/login`. Giữ POST/validation, email chuẩn hóa, provider readiness trước password check, lock transaction, chỉ mint customToken sau cả hai kiểm tra thành công, Retry-After và thông báo cũ, outage giải phóng lease không tăng failures và không log mật khẩu/token. Test emulator + fake provider: khóa sau lần 5, không gọi provider/mint token khi khóa, thành công chỉ trả customToken, outage trả 503 không tăng failures hoặc lộ chi tiết. Credential scope identitytoolkit được tái sử dụng để giữ cache access token phía server.

## File 27: admin/users.js

Đích: `src/FlowerFlow.Infrastructure/Admin/AdminUsersHandler.cs`, `/api/admin/users` và alias `?route=audit`. SDK adapter đọc đúng một page 100 tài khoản và định dạng UTC metadata như Node; không trả password hash hoặc custom claims thô. Giữ admin permission, POST, validation pageToken, fields và nextPageToken. Test fake SDK + emulator: whitelist 8 field/tài khoản, token phân trang, từ chối token sai type và alias audit giữ header private/no-store.

## File 28: admin/owner-users.js

Đích: `src/FlowerFlow.Infrastructure/Admin/OwnerUsersHandler.cs`, `/api/owner/users`. Giữ owner authorization, list/backfill, cấp/gỡ admin giữ custom claims khác, chặn tự đổi quyền/chỉnh owner khác, mirror adminRoles, revoke rồi audit, thông báo lỗi một phần sau khi quyền đã thay đổi. Hoàn tất mirror/revoke sau khi bắt đầu thay đổi kể cả client ngắt kết nối. Test fake SDK + emulator: cấp/gỡ và giữ claim, role document, thu hồi session, bảo vệ owner, backfill và lỗi revoke không giả báo rollback.

## File 29: orders/checkout.js

Đích: `src/FlowerFlow.Infrastructure/Orders/Checkout.cs`. Giữ quote/create, báo thiếu kho/ẩn sản phẩm, giá/ưu đãi/phí/lịch giao, note/quantity limit, guest cap, HMAC quotas, idempotency hash và UID, ghi quota+kho+order+orderRequests trong một transaction, toàn bộ trường order và hạn giữ QR/VNPay/COD. Kèm JSON.stringify tương thích để fingerprint khớp Node, kể cả Unicode/control escapes và thứ tự key. Test emulator: nhiều option cùng sản phẩm, hai request cùng key chỉ giữ kho một lần, content conflict, stale totals không ghi, phone quota, guest cap và hai đơn cạnh tranh không vượt tồn kho.

## File 30: orders/controller.js

Đích: `src/FlowerFlow.Infrastructure/Orders/OrdersHandler.cs`, `/api/orders`. Nối toàn bộ action quote/create/lookup/mine/review/review-get/payment reconciliation/refund/audit/expire theo đúng method. Giữ POST action không nhận diện vẫn tạo đơn, GET mặc định yêu cầu POST, cleanup bằng CRON_SECRET hoặc admin, no-store và lỗi nguyên bản. Test emulator: method, mine, review-get không rơi sang create và cron expire.

## File 31: payments/payments.js

Đích: `src/FlowerFlow.Infrastructure/Payments/PaymentsHandler.cs`, `/api/payments`. Giữ create/retry/status, capability orderId+paymentReference hoặc txnRef trước, pending attempt reuse, xác nhận số tiền, cleanup và khôi phục kho đơn hết hạn trong transaction, hạn 15 phút, số lần thử, URL ký và response lỗi. Test emulator: chữ ký URL, capability sai, reuse không tạo thêm/không trừ kho, retry đơn expired hoàn rồi giữ kho một lần, đơn paid không tạo lại attempt.

## File 32: payments/vnpay-ipn.js

Đích: `src/FlowerFlow.Infrastructure/Payments/VnpayIpnHandler.cs`, `/api/vnpay-ipn`. Giữ GET/HMAC/TmnCode/txnRef/currency/số tiền, gateway response HTTP 200 với đúng RspCode/Message viết hoa, transaction attempt+order, duplicate callback, failure cũ không ghi đè attempt hiện tại, thanh toán thêm/trễ cần attention không khôi phục kho tự động. Test emulator: chữ ký sai/tiền sai không đổi dữ liệu, success/duplicate, failed attempt cũ, extra payment, cancelled late payment và thiếu cấu hình.

## File 33: lib/local-session.js

Đích: `src/FlowerFlow.Infrastructure/Local/LocalSession.cs`. Giữ cookie 12 giờ, HttpOnly/SameSite Strict/Path, Secure khi HTTPS, xóa cookie epoch và từ chối cookie mơ hồ. RequestIdentity dùng helper chung này; nhiều Cookie header được xét như Node nối cookie header bằng dấu chấm phẩy, không chọn nhầm danh tính. Test thuộc tính cookie và nhiều header.

### Tương thích kiểu số Firestore

`Firebase/FirestoreWrites.cs` chuẩn hóa mọi write của backend theo serializer Node: số nguyên an toàn thành integer, số lẻ/số ngoài miền an toàn/âm zero vẫn double; áp dụng cả map và array lồng nhau. Không sửa database đang có. Toàn bộ contract + Firestore Emulator pass, có kiểm tra kiểu thực tế trả về từ database (không chỉ giá trị số).

## File 34: lib/local-rate-limit.js

Đích: `Local/LocalRateLimit.cs`. Giữ cửa sổ cố định, dọn entry hết hạn, capacity 5000, retry-after làm tròn lên và trả 60 giây khi đầy. Đối chiếu trực tiếp Node và kiểm tra 100 request đồng thời không vượt ngân sách.

## File 35: lib/content-security.js

Đích: `Local/ContentSecurity.cs`. Giữ chuẩn hóa xuống dòng trước khi SHA-256, loại script ngoài/JSON, hash duy nhất có thứ tự và thay directive CSP đúng vị trí. Đối chiếu trực tiếp Node trên toàn bộ HTML gốc; không chỉnh sửa frontend.

## File 36: lib/local-accounts.js

Đích: `Local/LocalAccounts.cs`. Giữ schema SQLite local, migration thêm cột không thay tài khoản/hashes/lịch sử khóa, scrypt N32768/r8/p1 cho password và p3 cho PIN/đáp án, session hash/TTL/rotation, đăng ký/đăng nhập/khóa tăng dần, reset password/PIN, đủ ba đáp án và thiết lập bảo mật cho tài khoản cũ. SQLite chỉ dành cho chế độ tài khoản local vốn có; Firebase và Firestore không bị thay thế.

Kiểm tra: đối chiếu trực tiếp Node toàn bộ chuỗi thao tác và lỗi; hash Unicode khớp byte; C# mở tài khoản/session do Node tạo và Node đăng nhập bằng password C# cập nhật; carry-over ngân sách PIN cũ, PIN format cũ và enrollment thu hồi session. Dùng Microsoft.Data.Sqlite 10.0.14 và BouncyCastle.Cryptography 2.7.0, không tự viết thuật toán hash.

## File 37: lib/local-account-worker.js

Đích: `Local/LocalAccountWorker.cs`. Một thread riêng sở hữu SQLite/scrypt; tuần tự hóa thao tác, tối đa 16 request tính cả request đang chạy, lỗi busy 429 và đóng worker không để Task treo. Không hủy cập nhật ngân sách xác thực theo disconnect của client. Test queue đầy trước startup, xử lý queue, lỗi startup không lộ chi tiết và từ chối sau shutdown.

## File 38: lib/local-auth-http.js

Đích: `Local/LocalAuthHandler.cs`. Giữ chín action/method, session chỉ qua HttpOnly cookie, thông báo/response/attemptsRemaining/retry-after, xóa cookie sau reset/recovery/session lỗi, rate limit theo socket IP và nhóm thao tác. Đối chiếu toàn bộ thông báo lỗi với Node; kiểm tra cookie không lộ token trong JSON, queue busy, lỗi worker được che chi tiết và giới hạn đăng ký.

## File 39: lib/firestore-backup.js

Đích: `Firebase/FirestoreBackup.cs`. Giữ format v1, markers timestamp/geopoint/reference/bytes, export root collections bỏ duy nhất orderLookupLimits, import overwrite theo lô 400 và giữ document ngoài backup. Giữ scrypt N16384/r8/p1 và AES-256-GCM, salt/IV/tag/base64 để đọc được file cũ. Test Node/C# mã hóa–giải mã hai chiều, password sai/tamper, native markers; emulator import 401 document qua hai batch, giữ document khác và export đúng collection. Không backup/restore database thật trong quá trình chuyển đổi.

## File 40: lib/local-server.js

Đích: `Local/BackendServer.cs` và host `FlowerFlow.Api/Program.cs`. Phục vụ frontend nguyên trạng cùng API, whitelist static và kiểm tra realpath từng thành phần để chặn symlink ra file riêng tư; giữ query lặp/alias, JSON 32 KiB cho login/local-auth và 4 MiB cho API khác, lỗi JSON/content-type, CSP, Host/Origin, IP socket và trusted local identity. Development giữ runtime auth script bằng chèn response HTML trong bộ nhớ; không sửa HTML/JS frontend. Production dùng Firebase, headers/cache theo cấu hình gốc, hỗ trợ proxy được khai báo IP tin cậy. Body nhận quá 30 giây trả HTTP 408 có JSON `request-timeout` thay cho response timeout tự động của Node; không ảnh hưởng request frontend hợp lệ.

`scripts/dev.js` chuyển thành launcher .NET, giữ `npm run dev`, PORT/AUTH_MODE/.env và đường dẫn SQLite cũ. Các API entry point được đăng ký ở C#, gồm ba alias; không yêu cầu sửa frontend. Build/publish kèm file frontend công khai; không kèm backend JS, `.env` hoặc credentials.

Kiểm tra cuối: build Release 0 warning/0 error; bộ contract tổng thể và Firestore Emulator pass; socket HTTP kiểm tra HTML/HEAD/asset/private paths/JSON limits/Host/Origin/forwarded IP/alias; executable API thật dùng SQLite tạm đăng ký–session–logout thành công và khởi tạo mọi dependency graph endpoint. CI chạy cùng bộ kiểm tra trên Linux, có fixture symlink parent. Những phần kết nối Firebase/password provider thực được kiểm bằng mock/emulator; chưa dùng project/credentials production và chưa chuyển deployment Vercel.

Publish Production đã chạy smoke HTTP: health/HTML 200, cache/CSP đúng và local-auth 404; launcher `npm.cmd run dev` đã khởi động ASP.NET Development, health và auth-runtime đúng. Chặn request diagnostics chứa query string để không ghi token truy cập thiết kế/thanh toán vào log; test executable xác nhận query token không xuất hiện trong stdout/stderr. Bổ sung tương thích Blob → Buffer JSON và tọa độ số nguyên trong backup.

Đối chiếu CI Linux bổ sung: fixture symlink dùng request GET rõ ràng và dọn các file đã tạo trong finally, tránh lỗi cleanup che lỗi assertion. Đây là sửa test fixture, không thay logic server.
