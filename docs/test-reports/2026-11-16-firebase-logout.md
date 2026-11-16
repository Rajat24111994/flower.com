# Rà soát đăng xuất Firebase — 16/11/2026

## Trạng thái và môi trường

Đã hoàn thành mã và kiểm thử tại máy. **Chưa xác minh Firebase thật**: chưa có
project thử nghiệm riêng được chỉ định; không thu hồi tài khoản production. Hai
giới hạn được tái hiện bên dưới vẫn tồn tại, không được diễn giải là đã bảo vệ
toàn bộ Firebase hoặc mọi đường truy cập ngay sau đăng xuất.

Ngày chạy: 16/11/2026, Asia/Bangkok (UTC+7). Windows, Node 24.22.1, .NET SDK
10.0.402/.NET 10, Java 21, Playwright Chromium desktop/mobile. Firebase CLI
13.35.1, Firestore Emulator 1.19.8, Firebase Admin Node 14.5.1 và .NET 3.7.0.
Audit từ `3842b36`; tích hợp main `bb8406b` trước khi hoàn tất.

## Trước và sau thay đổi

Trước: khách hàng/admin/owner dùng browser `signOut` và xóa profile trình duyệt.
Token đã sao chép vẫn đến được API nếu chưa hết hạn hoặc bị thu hồi riêng. Các
verifier C# đã bật `checkRevoked`; không có endpoint tự thu hồi mọi phiên.
SQLite/cookie có cơ chế xóa session độc lập.

Sau: giữ nguyên nút cũ. Theo lựa chọn của người dùng, thêm nút riêng **Đăng xuất
trên mọi thiết bị**. C# `POST /api/auth/logout-all` xác minh token và trạng thái
thu hồi, chỉ dùng UID đã xác minh; thành công mới trả `{ok:true,scope:"all"}` và
cho trình duyệt signOut/xóa profile. Sai token 401, phương thức 405, UID/query/body
không hợp lệ 400; lỗi thu hồi 503 có thông báo cố định. Không ghi token, mật khẩu,
provider exception hoặc credential vào log. Không đổi claims, phân quyền, dữ liệu,
Rules/indexes/schema. Nút mới bị ẩn với tài khoản local SQLite.

## Lệnh và kết quả tách theo loại bằng chứng

Chạy từ gốc repository trừ dòng ghi `flower.com`. Contracts là chương trình
console có assertion; không dùng `dotnet test` để suy diễn số bài của chương trình.

| Bằng chứng | Lệnh | Kết quả |
| --- | --- | --- |
| Build C# | `dotnet build flower.com/FlowerFlow.sln --configuration Release --no-restore --verbosity minimal` | Đạt; 0 warning, 0 error; đã chạy lại sau tích hợp main |
| Mock SDK Firebase | `dotnet run --project flower.com/tests/UnitTests/FlowerFlow.Contracts --configuration Release --no-build -- --firebase-logout` | 18 đạt; đã chạy lại sau tích hợp main; không gọi Firebase thật |
| Differential/mock/local C# | `dotnet run --project flower.com/tests/UnitTests/FlowerFlow.Contracts --configuration Release --no-build` | Exit 0; gồm SQLite, provider mock, HTTP/executable, không dùng làm bằng chứng Firebase thật |
| Firebase Emulator + HTTP C# | Lệnh emulator bên dưới với `node flower.com/tests/IntegrationTests/test-api.cjs` | 94 đạt, 0 trượt, 0 skip; gồm 7 bài mới và hai bài tái hiện giới hạn; chạy trước tích hợp main |
| Firebase Emulator sau tích hợp main | Cùng lệnh, dùng `node flower.com/tests/IntegrationTests/test-api.cjs firebase-logout.test.js` | 7 đạt, 0 trượt, 0 skip; vẫn tái hiện hai giới hạn đã nêu |
| UI mock Firebase | Trong `flower.com`: `node node_modules/@playwright/test/cli.js test --config playwright.firebase-logout.config.js` | 16 đạt, 0 trượt, 0 skip; đã chạy lại sau tích hợp main |
| Local SQLite/cookie Node | `node --test tests/session-security.test.js tests/local-auth-http.test.js` | 12 đạt, 0 trượt, 0 skip; tách khỏi bằng chứng Firebase |
| Local UI SQLite/cookie | Trong `flower.com`: `node node_modules/@playwright/test/cli.js test --config playwright.local.config.js e2e/local-session.spec.js --grep "logout clears both tabs"` | 2 đạt desktop/mobile; nút Firebase ẩn, cookie cũ bị từ chối |
| Hồi quy JS/local/mock | Trong `flower.com`: `npm.cmd test` | 233 đạt, 0 trượt, 0 skip trước tích hợp main; không phải 233 bài Firebase |
| Tài nguyên sinh tự động | Trong `flower.com`: `npm.cmd run check:generated` | Exit 0 |
| Sau tích hợp main | Contracts `--production-host`; `node --test tests/admin-module-split.test.js tests/seo-performance.test.js` | Host đạt; 3 bài Node đạt; giữ HSTS, SEO và module quản trị từ main |
| Firebase thật, thiết bị thật | Chưa chạy | Không có project thử nghiệm riêng; chữ ký/certificate, refresh rejection, IAM và độ trễ thu hồi thật chưa xác minh |

Windows sử dụng cache NuGet trong workspace. Runner `flower.com/tests/IntegrationTests/test-api.cjs` tắt
provider Windows Event Log riêng cho test Windows vì sandbox không cho ghi OS
Event Log; Console vẫn hoạt động và chỉ ghi thông báo cố định. Khi chạy Contracts
trong cùng sandbox, đặt `Logging__EventLog__LogLevel__Default=None`.

```powershell
$env:DOTNET_CLI_HOME = Join-Path $PWD '.tools/dotnet-home'
$env:NUGET_PACKAGES = Join-Path $PWD '.tools/nuget-packages'
$env:XDG_CONFIG_HOME = Join-Path $PWD '.tools/firebase-cli-config'
$env:FIREBASE_EMULATORS_PATH = Join-Path $PWD '.tools/firebase-emulators'
$env:JAVA_HOME = Join-Path $PWD '.tools/java21/jdk-21.0.13+9-jre'
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
$env:CI = 'true'
$env:DEBUG = ''
node tests/node_modules/firebase-tools/lib/bin/firebase.js emulators:exec --only auth,firestore --project demo-flowerflow --config flower.com/firebase.json "node flower.com/tests/IntegrationTests/test-api.cjs"
```

`.tools` là công cụ/cache đã có tại máy, không được commit; máy khác dùng Java/.NET
trong PATH và cache riêng. Restore trước nếu chưa có dependencies, không dùng
`--no-restore` cho build đầu. Emulator dùng project `demo-flowerflow`, khóa RSA tạm
sinh trong bộ nhớ, không đọc `.env` hay service account production.

## Bảy tình huống mới quan sát được

| Tình huống | Kết quả từ SDK thật và HTTP trên emulator |
| --- | --- |
| Đăng xuất một phiên | Hai app SDK có in-memory persistence độc lập, ID token lưu khác nhau; signOut A chỉ xóa user A. Phát lại nguyên token A vẫn 200; user/token B vẫn hoạt động |
| Thu hồi mọi phiên | Token A/B đều 200 trước thu hồi; phát lại chính token A/B đều 401 sau thu hồi. Tài khoản C vẫn 200; đăng nhập mới bằng custom token được 200, token lưu cũ vẫn 401 |
| Không thu hồi tài khoản khác | Thiếu token/cookie local/token giả 401; GET 405; UID qua body/query hoặc scope thiết bị 400; Origin lạ 403. Tài khoản nạn nhân vẫn được API chấp nhận |
| Token hết hạn | Token unsigned emulator có `exp` đã qua bị API mine và endpoint thu hồi trả 401; không phải kiểm tra chữ ký JWT production |
| Quản trị sau thu hồi | Admin users, products manage, delivery zones manage, wrapping manage trả 401 cho token owner cũ; `adminRoles` vẫn tồn tại |
| Giới hạn Firestore trực tiếp | REST đọc giỏ riêng với chính token cũ vẫn 200 sau thu hồi dù API mine trả 401; tài khoản khác đọc giỏ bị 403 |
| Giới hạn Auth Emulator | Refresh grant cũ vẫn cấp token mới được API chấp nhận; chính ID token lưu trước thu hồi vẫn bị 401. Đây là thiếu tương đương provider, không phải bằng chứng refresh revocation đã đúng |

Đăng nhập lại kiểm tra Firebase custom-token exchange mà frontend đang dùng.
Password-provider/login-protection C# có Contracts mock riêng; không tuyên bố
đã chạy password hoặc Google login end-to-end trên Firebase thật.

## File thay đổi và lý do

| File | Lý do |
| --- | --- |
| `flower.com/backend/FlowerFlow.Infrastructure/Accounts/FirebaseLogoutHandler.cs` | Thu hồi chính caller đã xác minh, không nhận UID và không thêm Firestore schema |
| `flower.com/backend/FlowerFlow.Api/Program.cs` | Đăng ký dependency và route C# |
| `flower.com/backend/FlowerFlow.Infrastructure/Local/BackendServer.cs` | Whitelist route mới, giữ Host/Origin/body protection |
| `flower.com/tests/UnitTests/FlowerFlow.Contracts/FirebaseLogoutContracts.cs`, `Program.cs` | 18 tình huống mock và đăng ký runner |
| `flower.com/tests/UnitTests/FlowerFlow.Contracts/ApiHostContracts.cs` | Kiểm tra dependency graph/method của route mới |
| `flower.com/tests/IntegrationTests/test-api.cjs` | Tắt OS Event Log trong test Windows, giữ Console |
| `flower.com/tests/IntegrationTests/helpers.js`, `firebase-logout.test.js` | HTTP route tới C# và test token, hai context, UID, re-login, hai giới hạn |
| `flower.com/js/account/firebase-logout.js` | Luồng mới dùng chung, xác nhận và chỉ signOut sau thành công phía server |
| `flower.com/js/account/account.js`, `js/admin/admin-events.js`, `js/admin/owner.js` | Gắn nút mới; giữ handler cũ và local SQLite |
| `flower.com/account.html`, `admin.html`, `owner.html`, `js/admin/admin.js` | Nút riêng và version cache mới; giữ cập nhật admin từ main |
| `flower.com/css/account/account.css` | Style nút mới trong layout hiện có |
| `flower.com/tests/E2ETests/firebase-logout.spec.js`, `playwright.firebase-logout.config.js` | UI mock desktop/mobile, hủy, thành công, lỗi và không đổi nút cũ |
| `flower.com/tests/E2ETests/local-session.spec.js` | Local không hiện nút Firebase |
| `docs/firebase-logout-audit.md`, `flower.com/backend/README.md`, `tests/README.md`, báo cáo này | Hiện trạng, inventory Firestore, phạm vi và bằng chứng |

## Lỗi ban đầu và xử lý

- Build đầu thiếu NuGet assets và còn static-web-assets manifest cũ: restore,
  `dotnet clean` rồi build lại; không sửa dependencies/schema để né test.
- Test HTTP Windows ban đầu trả 500 thay 401 do logger cố ghi OS Event Log bị
  sandbox chặn: tắt provider đó trong runner kiểm thử, không đổi xác thực API.
- Fixture UI ban đầu tạo lại profile khi điều hướng tới login, làm assertion
  clear-storage thất bại: sửa fixture chỉ khởi tạo một lần, không sửa app để né test.
- Giả định Emulator phát hành refresh grant duy nhất và chặn refresh sau thu hồi
  không đúng với CLI 13.35.1. Ghi lại thành bài tái hiện giới hạn; dùng hai app SDK
  và ID token khác nhau, không dùng mock giả kết quả provider.
- Không còn test trượt trong các lệnh cuối đã ghi. Các giới hạn sau vẫn tồn tại.

## Giới hạn và triển khai

Browser logout không vô hiệu hóa token sao chép. SDK .NET 3.7.0 kiểm tra cutoff
bằng `iat` với độ chính xác giây; token cùng giây thu hồi chưa được bảo đảm bị từ
chối. Không có app session registry, không bảo đảm vô hiệu hóa ngay riêng một
thiết bị. Tab dùng chung Firebase local persistence có thể đăng xuất cùng nhau.

Firestore trực tiếp không qua API C#. Rules hiện có không đọc cutoff thu hồi;
đọc công khai/cache và token cũ được Rules cho phép không bị vô hiệu hóa ngay.
Không đổi Rules/schema hay xóa quyền admin để ép kết quả này thành “đã xử lý”.
Inventory các file Firestore nằm trong audit.

Auth Emulator 13.35.1 có refresh grants deterministic, không enforce cutoff trong
`validateRefreshToken`. Firebase Admin .NET dùng `iat`; token vừa cấp từ grant đó
có thể được chấp nhận. Cần project thử nghiệm Firebase riêng để kiểm chứng provider
thật chặn refresh grant cũ, chữ ký, IAM, timing và hai thiết bị thật.

Main mới cấu hình Render `checksPass`. Cả bốn commit có `[skip render]`, theo
[tài liệu Render](https://render.com/docs/deploys#skipping-an-auto-deploy), để push
main không kích hoạt auto-deploy. Không gọi deploy hook/API hay đổi Render settings.
Chưa đọc được Events của Render để xác nhận sự kiện skip trên dashboard.

Nguồn: [Firebase quản lý phiên](https://firebase.google.com/docs/auth/admin/manage-sessions),
[Auth Emulator](https://firebase.google.com/docs/emulator-suite/connect_auth),
[source .NET SDK 3.7.0](https://github.com/firebase/firebase-admin-dotnet/blob/v3.7.0/FirebaseAdmin/FirebaseAdmin/Auth/AbstractFirebaseAuth.cs).
