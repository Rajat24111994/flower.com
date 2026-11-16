# FlowerFlow ASP.NET Core Web API

> Backend độc lập dùng dữ liệu trong bộ nhớ: xem [INDEPENDENT-BACKEND.md](INDEPENDENT-BACKEND.md).
> Chạy `dotnet run --project aspnet/src/FlowerFlow.Backend`, mở `http://localhost:5090/swagger`.
> Host Firebase `FlowerFlow.Api` được giữ nguyên; host mới chưa thay website production.

Backend C# trên nhánh `asp.net` đã có bản chuyển đổi của 32 module `flower.com/backend` và 8 thư viện server `flower.com/lib`. URL API, phương thức, dữ liệu JSON, logic giá/khuyến mãi/tồn kho/đơn hàng/thanh toán và Firebase được giữ theo nguồn JS. Nhật ký từng file và kiểm thử: [MIGRATION-STATUS.md](MIGRATION-STATUS.md).

## Chạy trên máy

Cần .NET 10 SDK. Từ gốc repository:

```powershell
dotnet build aspnet/FlowerFlow.sln --configuration Release
dotnet run --project aspnet/src/FlowerFlow.Api
```

Mở `http://localhost:5080/`. ASP.NET phục vụ nguyên HTML/CSS/JS hiện có cùng `/api/...`; `GET /health` kiểm tra tiến trình, không kiểm tra kết nối Firebase. Trong Development, mặc định `AUTH_MODE=local`, dùng lại SQLite tài khoản local ở `flower.com/.tools/local-auth/accounts.sqlite` khi chạy từ source project. Có thể đặt `LOCAL_ACCOUNTS_FILE` để chọn đường dẫn ổn định khác. Local không thay thế database nghiệp vụ Firestore.

Lệnh cũ vẫn dùng được:

```powershell
cd flower.com
npm run dev
```

Lệnh này tải `.env` như trước rồi khởi động ASP.NET tại `http://127.0.0.1:3000/`. `scripts/dev.js` chỉ là launcher, không xử lý HTTP hoặc nghiệp vụ. Có thể đặt `PORT`, `AUTH_MODE=local|firebase`. Tài khoản local chỉ bật trong Development và chỉ nhận request loopback; cookie HttpOnly/SameSite Strict, session 12 giờ, mật khẩu/PIN/câu trả lời và lịch sử khóa tương thích SQLite cũ. Chế độ local cho phép thử tài khoản mà không cần Firebase; catalog, đặt hàng và quản trị vẫn cần Firestore/Firebase phù hợp như hệ thống cũ.

Nếu PowerShell chặn `npm.ps1`, dùng `npm.cmd run dev`.

## Firebase và bí mật

Production dùng `AUTH_MODE=firebase` (mặc định). Cấu hình phía server bằng biến môi trường hoặc kho bí mật của nền tảng:

- `FIREBASE_SERVICE_ACCOUNT_JSON`: nội dung Service Account hiện tại, giữ cách cấu hình của deployment cũ.
- Hoặc `FIREBASE_SERVICE_ACCOUNT_FILE`: đường dẫn file Service Account JSON ngoài Git/OneDrive, chỉ dùng ở server ASP.NET. Nếu đồng thời đặt JSON và FILE thì JSON được ưu tiên như cấu hình triển khai cũ. Không dùng file cấu hình Firebase Web thay cho Service Account.
- `FIREBASE_PROJECT_ID`: tùy chọn, mặc định `project_id` trong service account; dùng project/database hiện có.
- `FIREBASE_AUTH_PUBLIC_API_KEY`, `FIREBASE_AUTH_SERVER_API_KEY`: cấu hình password provider theo [hướng dẫn bảo vệ đăng nhập](../docs/login-protection.md). Public key phải khớp frontend và bị chặn các phương thức đăng nhập mật khẩu trực tiếp; server key phải khác public key.
- Các biến VNPay, `CRON_SECRET` và khóa tra cứu giữ tên/cách sử dụng của backend JS; xem `.env.example` và cấu hình triển khai hiện có.

`dotnet run` không tự đọc `.env`; `npm run dev` đọc file này qua Node launcher. Không đặt service account trong appsettings, frontend, repo hoặc log. SDK khởi tạo khi cần, không tạo lại database, không đổi schema Firestore. Xác thực Firebase ID token kiểm tra thu hồi; admin/owner vẫn kiểm tra live `adminRoles` và custom claims. `FIRESTORE_EMULATOR_HOST` chỉ dùng khi chủ động cấu hình emulator để thử nghiệm.

Kiểm tra kết nối project thật từ máy đã có file khóa (thay đường dẫn mẫu bằng file của bạn):

```powershell
$env:FIREBASE_SERVICE_ACCOUNT_FILE = 'C:\Users\<user>\.secrets\flowerflow-admin.json'
$env:FIREBASE_PROJECT_ID = 'web-ban-hoa-9fe0b'
$env:AUTH_MODE = 'firebase'
dotnet run --project aspnet/src/FlowerFlow.Api -- --check-firebase
```

Lệnh chỉ kiểm tra quyền đọc Firebase Authentication và đọc document cài đặt Firestore hiện có; không tạo tài khoản, ghi document hoặc tạo database. Kiểm tra project phải khớp frontend trước khi gọi mạng; từ chối chạy kiểm tra project thật khi đang cấu hình emulator. Kết quả thành công có `status=connected`, `authentication=true`, `firestore=true`. Khi thiếu/sai khóa hoặc lỗi kết nối, exit code là 1 và chỉ báo mã lỗi, không in khóa/chi tiết provider. Sau đó dùng cùng biến môi trường để chạy API bình thường. Kiểm tra này không thay cho cấu hình hai API key của luồng đăng nhập mật khẩu.

## Giá héo tự động (#107)

Owner cấu hình tại `owner.html`; mặc định tắt và không tự điền mức giảm. API `/api/wilting-prices` quản lý quy tắc/ngày nhập; catalog, checkout và dự toán thiết kế dùng giá theo ngày Việt Nam. Xem [công thức, dữ liệu, giới hạn và cách triển khai](../docs/wilting-pricing.md), bao gồm yêu cầu triển khai Firestore Rules trước khi bật và giới hạn một ngày nhập cho mỗi sản phẩm.

## Build và triển khai

Đã có Dockerfile và Blueprint Render Free cho bước chạy thử theo lựa chọn người dùng. Xem [DEPLOYMENT.md](DEPLOYMENT.md) về build, quyền truy cập, secrets, điều kiện chuyển lưu lượng và rollback. Gói triển khai không có nghĩa production đã được chuyển khi chưa có host/credentials.

```powershell
dotnet publish aspnet/src/FlowerFlow.Api --configuration Release --output aspnet/.tools/publish
```

Output chứa API và bản sao nguyên trạng các file frontend công khai. Chạy `dotnet FlowerFlow.Api.dll` từ output trên host hỗ trợ ASP.NET Core/.NET 10, cấu hình `ASPNETCORE_ENVIRONMENT=Production` và `ASPNETCORE_URLS` của host. Node không cần cho tiến trình API đã publish. Giữ frontend và API cùng origin để các URL hiện tại tiếp tục hoạt động.

Nếu có reverse proxy, cấu hình IP của proxy tin cậy bằng `ReverseProxy__KnownProxies__0` (và các chỉ số tiếp theo); middleware chỉ nhận X-Forwarded-For/Proto từ các IP này rồi dùng IP đã xác minh cho rate limit. TLS kết thúc tại host/proxy. Không tin trực tiếp header IP do client gửi. Lịch cleanup cũ cần tiếp tục gọi `GET /api/orders?action=expire` với `Authorization: Bearer <CRON_SECRET>` từ scheduler của nền tảng.

Trên Render, origin HTTPS công khai được nhận từ `RENDER_EXTERNAL_URL` do nền tảng cấp; `PUBLIC_APP_URL` cũng được nhận nếu cấu hình domain riêng. Điều này cho phép request trình duyệt hợp lệ sau TLS proxy mà không nới quy tắc tin cậy IP hoặc nhận Origin tùy ý. Cần deploy commit mới để bản sửa có hiệu lực trên host đang chạy.

Commit/push không chuyển deployment Vercel hiện tại sang .NET. `vercel.json` và các JS entry point cũ vẫn được giữ để đối chiếu và cho deployment Node cũ; muốn chạy bản C# phải triển khai output ASP.NET trên host phù hợp. Các script quản trị/maintenance Node vẫn là công cụ vận hành riêng; không được gọi bởi runtime API C#. Bản C# của export/import/mã hóa backup nằm tại `Firebase/FirestoreBackup.cs`, giữ định dạng backup cũ và không mở thêm endpoint sao lưu công khai.

## Kiểm tra

Đăng xuất Firebase có hai thao tác riêng: nút **Đăng xuất** giữ hành vi `signOut`
trong trình duyệt; nút **Đăng xuất trên mọi thiết bị** gọi C# `POST /api/auth/logout-all`
với Firebase Bearer token và body `{}`. Server kiểm tra thu hồi, lấy UID từ token đã
xác minh và gọi Firebase Admin thu hồi phiên cũ của chính tài khoản đó. Không nhận
UID từ client và không dùng cookie SQLite để xác thực endpoint này. Giới hạn token
sao chép, độ chính xác giây, Firestore trực tiếp và Emulator được ghi tại
[audit đăng xuất](../docs/firebase-logout-audit.md). Chưa xác minh Firebase thật;
không triển khai production trong công việc này.

Cần Node 24+ để chạy nguồn JS đối chiếu, .NET 10 SDK và Java 21 cho Firestore Emulator. Từ gốc repository, build trước rồi chạy:

```powershell
dotnet run --project aspnet/tests/FlowerFlow.Contracts --configuration Release --no-build
```

Bộ kiểm tra bao gồm differential contracts với nguồn JS, provider giả lập, SQLite/scrypt hai chiều Node–C#, AES-GCM backup hai chiều, HTTP socket và khởi chạy executable API thật với database local tạm. Không dùng credential hay database production.

Kiểm thử các API nghiệp vụ qua HTTP trên chính host ASP.NET bằng bộ integration JS hiện có:

```powershell
npm ci --prefix flower.com
npm ci --prefix tests
node flower.com/node_modules/firebase-tools/lib/bin/firebase.js emulators:exec --only auth,firestore --project demo-flowerflow --config flower.com/firebase.json "node aspnet/test-api.cjs"
```

Runner yêu cầu build Release trước, tự chọn cổng loopback và chỉ dùng project `demo-` với cả hai emulator. Có thể truyền tên suite, ví dụ `node aspnet/test-api.cjs product-images.test.js`. Ba suite gọi trực tiếp JS local server/password provider không nằm trong lượt HTTP này; bản C# tương ứng đã có trong `FlowerFlow.Contracts`. Bốn test chuyển đổi bổ sung kiểm tra retry đơn từ JS sang C#, cấu hình wrapping/phân trang, giả mạo header IP và kiểu integer Firestore. Kết quả đối chiếu nhánh issue #141 và quyết định tích hợp: [INTEGRATION-141.md](INTEGRATION-141.md).

Để kiểm tra transaction Firestore, khởi động emulator ở `127.0.0.1:8787`, project `demo-flowerflow-csharp`, rồi chạy:

```powershell
dotnet run --project aspnet/tests/FlowerFlow.Contracts --configuration Release --no-build -- --firestore-emulator
```

Client test cố định loopback/demo project. Kiểm tra quota, idempotency, cạnh tranh tồn kho, hoàn kho một lần, quyền truy cập, audit nguyên tử, callback thanh toán và backup/import theo batch. CI `.github/workflows/aspnet.yml` tự khởi động emulator và chạy bộ này.

## Cấu trúc

- `FlowerFlow.Api`: host, DI, routes, frontend công khai và cấu hình môi trường.
- `FlowerFlow.Application`: validation, giá/khuyến mãi, VNPay signing và các quy tắc JS tương thích.
- `FlowerFlow.Infrastructure`: Firebase Auth/Firestore, các handler, transaction, local accounts/server và backup.
- `FlowerFlow.Domain`: khung domain; không có SQL Server/EF migration trong bản chuyển đổi này.

Nguồn JS backend được giữ làm oracle kiểm thử. HTML/CSS/JavaScript frontend không bị chỉnh sửa. Chưa chạy thử với credentials/project Firebase thật hoặc chuyển lưu lượng production trong quá trình chuyển đổi.
