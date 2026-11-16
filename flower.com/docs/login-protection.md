# Bảo vệ đăng nhập theo tài khoản

## Tài khoản chạy thử mặc định

`npm run dev` mặc định dùng `AUTH_MODE=local`: đăng ký tài khoản như `ban@demo`, không cần
email thật, Firebase, service account hoặc API key. Tài khoản được lưu trên máy, mật khẩu được
băm và chính sách khóa bên dưới được giữ nguyên. Xem [tài khoản local](./local-accounts.md).

## Chạy với tài khoản Firebase thật (tùy chọn)

Live Server ở cổng 5500 chỉ phục vụ file tĩnh. `fetch("./api/login")` vì thế đi tới Live Server,
không chạy file `api/login.js`; phản hồi HTML/404 trước đây bị hiển thị thành lỗi kết nối chung.
Không sửa lỗi này bằng cách cho phép CORS rộng hoặc quay về xác thực mật khẩu trực tiếp.

1. Tạo `flower.com/.env` từ `.env.example` nếu chưa có; đặt `AUTH_MODE=firebase` và không ghi đè các cấu hình khác.
2. Điền `FIREBASE_AUTH_PUBLIC_API_KEY` đúng với `js/core/firebase-config.js`.
3. Điền `FIREBASE_AUTH_SERVER_API_KEY` bằng key riêng từ Google Cloud Console → APIs & Services
   → Credentials → Create credentials → API key. Giữ key này trên máy chủ; hạn chế phương thức
   như phần cấu hình triển khai bên dưới.
4. Điền `FIREBASE_SERVICE_ACCOUNT_JSON` bằng toàn bộ JSON của service account đúng project:
   Firebase Console → Project settings → Service accounts → Generate new private key.
   Trong `.env`, đặt toàn bộ JSON thực trong dấu nháy đơn, dạng
   `FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'`.
   Node.js 24 cũng hỗ trợ giá trị có nháy đơn trải nhiều dòng, nên có thể dán JSON nguyên dạng;
   giữ các escape `\n` bên trong `private_key`.
   Không gửi key hoặc JSON vào chat và không commit file `.env`.
5. Hoàn tất hạn chế phương thức cho các key công khai theo phần dưới và chạy
   `npm run check-login-protection`. Việc hạn chế key công khai ảnh hưởng mọi ứng dụng đang
   dùng key đó, nên cần phối hợp với bản triển khai website thật đang sử dụng key.
6. Từ `flower.com`, chạy `npm run dev`, mở `http://127.0.0.1:3000/login.html`.
   Frontend và API có cùng origin. Có thể đổi `PORT` trong `.env`; mặc định là 3000.
   Khởi động lại máy chủ sau khi sửa `.env`.

Máy chủ chỉ lắng nghe `127.0.0.1`, không phục vụ `.env`, service-account JSON, `node_modules`,
`lib`, `scripts` hoặc source API. Chế độ này dùng Firebase thật; không tự tạo tài khoản hoặc
chuyển sang emulator. Nếu thiếu cấu hình, máy chủ vẫn mở giao diện và in tên biến còn thiếu,
nhưng xác thực tiếp tục bị từ chối an toàn.

Phân biệt lỗi: HTML/404 hoặc thông báo nhắc `npm run dev` nghĩa là đang mở máy chủ tĩnh.
Khi chạy `npm run dev`, JSON `503 login-not-configured` liệt kê tên biến còn thiếu trong `.env`;
điền đủ rồi khởi động lại máy chủ. JSON `503 auth-service-unavailable` nghĩa là API đã chạy
nhưng Firebase/cấu hình bảo vệ chưa sẵn sàng. Không nhập key vào JavaScript trình duyệt để
xử lý lỗi 503.

## Chính sách

Đăng nhập local đi qua `POST /api/local-auth/login`; chế độ Firebase dùng `POST /api/login`.
Bốn lần sai đầu trả `401 invalid-credential`.
Lần sai thứ 5 khóa 15 phút; hết hạn chỉ có một lần thử, sai tiếp sẽ khóa lần lượt 30, 60,
120 và 240 phút. Sau năm lần khóa tạm, lần sai thứ 10 trả `403 password-reset-required`.
Không có cửa sổ tự xóa số lần sai: thời gian trôi qua chỉ kết thúc lần khóa hiện tại.
Đăng nhập đúng khi được phép thử hoặc hoàn tất thay đổi mật khẩu tại Firebase mới xóa lịch sử.
Khóa chỉ áp dụng đăng nhập mật khẩu, không hủy các phiên đang hoạt động và không chặn Google.

Trạng thái lưu tại `loginProtection/{firebaseUid}`, không dùng IP, cookie hoặc local storage.
UID giữ nguyên khi đổi email. Email không tồn tại dùng khóa HMAC và cùng chính sách lỗi.
Firestore Rules hiện tại mặc định cấm client đọc/ghi collection này, kể cả client có quyền admin.
Không bật TTL cho collection này và không xóa nó khi dọn dữ liệu: trạng thái yêu cầu đặt lại
mật khẩu phải tồn tại cho tới khi người dùng khôi phục tài khoản.

Transaction cấp một lease 60 giây cho mỗi tài khoản, nên nhiều server/tab/IP không thể kiểm tra
mật khẩu song song. Firebase gọi ngoài transaction, có timeout; yêu cầu lỗi mạng/dịch vụ không tăng
bộ đếm. Lease đã hết hạn hoặc bị thay thế không được phát phiên đăng nhập.
Trong thời gian khóa, API trả `429 account-locked` cùng `Retry-After` và `retryAfter` (giây),
không kiểm tra mật khẩu và không kéo dài thời gian khóa.

Máy chủ đọc `passwordUpdatedAt` từ Firebase bằng OAuth của service account. Khi Firebase xác nhận
phiên bản mật khẩu đã tăng, yêu cầu đăng nhập tiếp theo xóa lịch sử cũ rồi xác thực mật khẩu mới.
Gửi email khôi phục, báo thành công từ client hoặc sửa timestamp gửi lên API không mở khóa.
Luồng Quên mật khẩu hiện có tiếp tục dùng Firebase, không cần thay email template.

## Bắt buộc cấu hình trước khi triển khai

Chỉ đưa form qua một API không thể bảo vệ đường gọi trực tiếp Firebase. Key công khai phải bị
cấm gọi phương thức xác thực mật khẩu; key máy chủ riêng chỉ được giữ trong kho bí mật của hosting.
Không dùng HTTP referrer làm biện pháp thay thế: client có thể giả mạo header đó.

1. Trong Google Cloud project đang dùng, tạo **một API key riêng cho máy chủ**. Chỉ cho key này
   gọi `identitytoolkit.googleapis.com`, phương thức
   `google.cloud.identitytoolkit.v1.AuthenticationService.SignInWithPassword`.
   Không đưa key này vào `firebase-config.js`, HTML, Git hoặc log. Nếu hosting có IP ra cố định,
   giới hạn thêm theo các IP máy chủ đó.
2. Trên Vercel/local API server, cấu hình:
   - `FIREBASE_AUTH_PUBLIC_API_KEY`: đúng giá trị `firebaseConfig.apiKey` đang dùng trên website.
   - `FIREBASE_AUTH_SERVER_API_KEY`: key máy chủ mới tạo, khác key công khai.
   - `FIREBASE_SERVICE_ACCOUNT_JSON` và `FIREBASE_PROJECT_ID`: cấu hình Admin SDK đã có.
     Service account cần `firebaseauth.users.get` và quyền đọc/ghi Firestore như các API hiện tại.
3. Đặt **API method restrictions** trên key công khai. File
   [`login-public-key-restrictions.json`](./login-public-key-restrictions.json) chứa phần `restrictions`
   mẫu, giữ các phương thức cần cho đăng ký, Google, phiên custom token, hồ sơ và khôi phục mật khẩu.
   Áp dụng bằng API Keys API `PATCH .../keys/KEY_ID?updateMask=restrictions` với body
   `{ "restrictions": <nội dung file>, "etag": "<etag hiện tại>" }`.
   Đọc cấu hình hiện tại trước; hợp nhất các API khác và client restrictions đang cần thay vì ghi đè
   mù. **Không** cho phép `SignInWithPassword`, `VerifyPassword`, `*`, `SignIn*` hoặc wildcard bao phủ
   chúng; không thêm một target Identity Toolkit khác không giới hạn methods.
4. Rà soát **tất cả key đang hoạt động trong cùng project**, kể cả key web/Android/iOS cũ.
   Thu hồi key lộ/không dùng hoặc áp dụng hạn chế tương tự; một key công khai khác cho phép xác thực
   mật khẩu vẫn tạo đường bỏ qua giới hạn. Không chỉ giới hạn tên miền hoặc IP client.
5. Chạy `npm run check-login-protection` trong `flower.com` với cấu hình ở trên.
   Đây là kiểm tra chỉ đọc, không tạo user/đơn hoặc ghi dữ liệu. Kiểm tra key công khai chặn cả
   `accounts:signInWithPassword` lẫn `relyingparty/verifyPassword`, key riêng hoạt động và server đọc
   được Firestore. Chạy lại sau khi thay key hoặc restrictions. Công cụ chỉ kiểm tra key công khai
   đang cấu hình, không thay thế bước rà soát các key khác.
6. Triển khai website cùng API; kiểm tra thêm đăng ký, Google, hồ sơ, gửi email/hoàn tất đặt lại mật
   khẩu và đăng nhập lại để chắc allowlist phù hợp project. Firebase có thể áp dụng giới hạn riêng
   chặt hơn; ứng dụng không cam kết vượt các giới hạn chống lạm dụng của nhà cung cấp.

Nếu cấu hình thiếu/sai hoặc chưa chặn API mật khẩu bằng key công khai, `/api/login` trả `503`.
Ứng dụng **không** tự quay về đăng nhập mật khẩu trực tiếp Firebase. Kiểm tra restrictions được
cache tối đa 60 giây trên mỗi instance; các thay đổi key cần kiểm tra lại và có thể cần chờ lan truyền.
Phần code này không tự thay đổi tài khoản Google Cloud, key hoặc triển khai website đang chạy.

## Kiểm thử

- `npm test`: chính sách đủ 10 lần sai, các mốc thời gian, đổi IP/email case, lỗi dịch vụ,
  yêu cầu song song, khôi phục sau lease hết hạn, kiểm tra chặn key và không làm lộ token.
- `cd ../tests && npm run integration`: Firebase Auth/Firestore thật trong emulator,
  custom token, transaction đồng thời, gửi và hoàn tất đặt lại mật khẩu, Security Rules.
- `npm run test:e2e:emulator`: luồng mua hàng dùng API đăng nhập thật trên emulator.
  Emulator không thực thi Google API key restrictions; cần kiểm tra cấu hình triển khai riêng.

Đánh đổi được chấp nhận: người biết email có thể cố tình gây khóa tài khoản. Không khóa vĩnh viễn
đường khôi phục. Không ghi mật khẩu/token vào log, không lưu mật khẩu ở Firestore/trình duyệt.

Nguồn: [API key method restrictions](https://cloud.google.com/api-keys/docs/add-restrictions-api-keys),
[tên phương thức Identity Toolkit](https://cloud.google.com/identity-platform/docs/activity-logging#logged_operations),
[truy vấn metadata tài khoản](https://cloud.google.com/identity-platform/docs/reference/rest/v1/projects.accounts/lookup),
[passwordUpdatedAt](https://cloud.google.com/identity-platform/docs/reference/rest/v1/UserInfo),
[OWASP account lockout](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html#account-lockout).
