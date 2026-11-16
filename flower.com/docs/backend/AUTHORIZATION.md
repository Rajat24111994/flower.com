# Xác thực và phân quyền API Firebase

Áp dụng cho `FlowerFlow.Api`, backend Docker phục vụ website. Host thử nghiệm
`FlowerFlow.Backend` với `/api/v1` dùng identity development riêng và từ chối chạy
trong Production; không dùng `X-Development-User` để xác thực website production.

## Chính sách

- Firebase token được kiểm tra bằng SDK với `checkRevoked=true`. Sau đó đọc trạng
  thái tài khoản trực tiếp qua Admin SDK và từ chối tài khoản `Disabled`.
- Token sai, hết hạn, bị thu hồi hoặc tài khoản bị vô hiệu hóa không được dùng
  như guest để tiếp tục request yêu cầu xác thực. Các API trả lỗi 401 phù hợp.
- Quyền Admin cần claim `admin` là boolean `true` và document `adminRoles/{uid}`
  còn tồn tại. Không cấp quyền từ body, query, cookie, UID hoặc header tự khai.
- Quyền Owner cần thêm claim `role=owner` và document quyền trực tiếp có `role=owner`.
  Token Owner cũ bị chặn khỏi chức năng Owner ngay khi mirror đổi thành Admin.
- Lỗi đọc token/tài khoản/quyền không được biến thành cấp quyền. Response/log không
  chứa bearer token hay nội dung exception của provider.

## Phạm vi quyền

| Chức năng | Điều kiện |
| --- | --- |
| Catalog public, cấu hình giao hàng/phí bó public | Không cần đăng nhập; dữ liệu public được lọc |
| Catalog manage, cấu hình manage, admin users/audit, quản trị yêu cầu thiết kế, tải ảnh sản phẩm | Admin hoặc Owner đang có quyền |
| Owner users, giá hoa, cấu hình giá héo | Owner đang có quyền |
| Đơn của tài khoản, đánh giá riêng | Firebase user hợp lệ; kiểm tra chủ sở hữu ở nghiệp vụ |
| Tra cứu đơn guest | Mã đơn và số điện thoại; giới hạn request và dữ liệu trả về |
| Link/trạng thái thanh toán và yêu cầu thiết kế guest | Capability/reference theo hợp đồng API; không coi một UID tự khai là quyền truy cập |
| Đối soát/hoàn tiền và payment audit | Admin hoặc Owner đang có quyền |
| Dọn đơn hết hạn | CRON_SECRET đúng hoặc Admin/Owner hợp lệ |
| VNPay IPN | Kiểm tra chữ ký, giao dịch và số tiền; không dùng bearer của khách |

## Khi vô hiệu hóa tài khoản hoặc thu hồi quyền

Vô hiệu hóa tài khoản trong Firebase Auth làm các request dùng token cũ bị chặn
qua kiểm tra live account state. Không cache `Disabled` cùng token. Điều này thêm
một lần đọc Auth user cho mỗi lần xác minh token có kiểm tra thu hồi; cần theo dõi
độ trễ/quota khi vận hành. Không bỏ kiểm tra hoặc cache dài để giảm độ trễ.

Thu hồi quyền quản trị cần cập nhật claims, xóa/cập nhật `adminRoles`, thu hồi
refresh token và lưu audit như luồng Owner hiện có. Không xóa document mirror
trong test production để kiểm chứng; dùng emulator hoặc tài khoản thử được cấp phép.

## Kiểm thử và giới hạn

`authorization-matrix.test.js` chạy qua HTTP host C# bằng `test-api.cjs`, dùng
project demo và SDK thật với Auth/Firestore Emulator. Xem
[báo cáo FF-03](../../../docs/test-reports/2026-11-17-ff-03-authentication-authorization.md).

ID token của Auth Emulator không có chữ ký production. Kiểm tra audience/issuer,
expiry và disabled ở emulator không chứng minh certificate/signature của Firebase
thật. Emulator còn có giới hạn refresh grant sau revoke. Browser `signOut` chỉ
xóa phiên client; logout-all dùng server API để thu hồi.

Firestore Rules không tự áp dụng logic thu hồi token của API; token đã lưu có thể
tiếp tục đọc dữ liệu client được Rules cho phép đến khi hết hạn. Đây là ranh giới
cần kiểm chứng riêng trong #159, không được tuyên bố logout-all chặn mọi truy cập SDK.
