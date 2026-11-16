# FF-03 — Xác thực và phân quyền API

Issue: #158. Ngày kiểm chứng: 17/11/2026, Asia/Bangkok.
Baseline `main`: `c38c2f8bd6119267e87c3f06bd65cf4d5bd7db4f`.

## Lỗi phát hiện và sửa

Ma trận HTTP mới tái hiện tài khoản Owner bị Firebase Auth vô hiệu hóa nhưng
token đã cấp vẫn được API `/api/admin/users` chấp nhận: HTTP 200 thay vì 401.
Response đã ghi rõ user `disabled=true`, nên lỗi không chỉ do test đọc nhầm trạng thái.

`FirebaseAdminService.VerifyIdTokenAsync` nay giữ kiểm tra SDK/revocation hiện có
và đọc user trực tiếp qua Admin SDK khi `checkRevoked=true`; user Disabled gây
`auth/user-disabled` trước khi tạo identity. Không cache trạng thái, không sửa
claims hoặc quyền để làm test đạt. Tất cả caller xác minh token trong backend
Firebase hiện dùng `checkRevoked=true`.

Ma trận kiểm tra token Owner cũ bị chặn ở 9 bề mặt đọc Admin/Owner, danh sách đơn
của user, logout-all và upload ảnh. Lần kiểm tra account bổ sung tăng một Auth
lookup mỗi lần xác minh; lỗi lookup vẫn fail closed, không được cấp quyền.

## Ma trận kiểm thử mới

8 test trong `flower.com/tests/IntegrationTests/authorization-matrix.test.js`:

1. Thiếu bearer, sai scheme, token giả và bearer nhập nhằng bị từ chối.
2. Customer không leo quyền qua header development, header role, cookie hay query.
3. Admin dùng 6 bề mặt đọc quản trị, không dùng 3 bề mặt Owner; Owner dùng cả 9;
   đổi live mirror Owner thành Admin chặn ngay quyền Owner dù token cũ còn hạn.
4. Document Owner riêng lẻ không cấp quyền; claim admin dạng string/number/false bị chặn.
5. Xóa live role chặn toàn bộ bề mặt đọc quản trị với token Owner đã cấp.
6. Disabled user bị chặn dù token và live role vẫn tồn tại.
7. Token sai audience/issuer bị SDK từ chối; đây là token unsigned của emulator.
8. Customer và Owner đã thu hồi quyền không thể ghi role, khu vực, phí bó, giá,
   cấu hình giá héo, yêu cầu thiết kế hoặc đối soát QR. Đối chiếu order/product,
   settings, custom claims và audit/history để xác nhận không có ghi trái phép.

9 bề mặt đọc: admin users, products manage, delivery zones manage, bouquet wrapping
manage, admin audit, design requests manage, owner users, flower prices và wilting prices.

Bộ kiểm thử hiện hữu bổ sung kiểm chứng cross-account order lookup, privacy,
refresh revocation API, token expired/invalid, cron secret, ảnh/review và Owner grant/remove.
Contract runner còn kiểm tra password-provider restrictions, khóa đăng nhập,
local/Firebase identity boundary và response/log đã lọc.

## Kết quả

- Build Release: đạt, 0 warning/error.
- Contract runner đầy đủ, không bật nhóm Firestore bổ sung: exit 0; gồm 31 Firebase
  Admin/configuration scenario, 118 shared cases, password provider và 18 logout scenario.
- Lượt HTTP trước sửa: 109/111 đạt, 2 lỗi. Một lỗi disabled thật như trên; lỗi còn lại
  do test dùng POST thay vì PATCH cho flower-prices, đã sửa phương thức test.
- Kết quả HTTP cuối sau sửa: **111/111 đạt, 0 lỗi, 0 bỏ qua**, 60,09 giây;
  gồm 8 test ma trận mới. Emulator và host thử nghiệm đã dừng sau lượt chạy.

Tái chạy từ gốc repository với dependency Node đã cài và Java 21:

```sh
dotnet build flower.com/FlowerFlow.sln --configuration Release
dotnet run --project flower.com/tests/UnitTests/FlowerFlow.Contracts --configuration Release --no-build
node flower.com/node_modules/firebase-tools/lib/bin/firebase.js emulators:exec --only auth,firestore --project demo-flowerflow --config flower.com/firebase.json "node flower.com/tests/IntegrationTests/test-api.cjs"
```

## Giới hạn

- Windows local dùng Node 26.13.0; workflow ASP.NET trên main dùng Node 24.
- Không gọi password login Firebase production, thay đổi tài khoản thật hay cấu hình
  secret. Xác minh signature/certificate và refresh grant production chưa được thực hiện.
- Auth Emulator có thể cấp token unsigned mới từ refresh grant bị thu hồi; test hiện hữu
  ghi rõ giới hạn. Token được lưu có thể đọc own-cart qua Rules sau API revoke;
  kiểm tra Firestore Rules riêng thuộc #159.
- API capability cho thanh toán/thiết kế và IPN có cơ chế khác với role. Không yêu cầu
  bearer Admin cho callback VNPay hoặc cho mọi API public.
- Không có thay đổi trên nhánh `codex/aspnet-sql-server` được nhập vào đợt này.

Chính sách và phạm vi vận hành: [AUTHORIZATION.md](../../flower.com/docs/backend/AUTHORIZATION.md).
