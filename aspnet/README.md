# FlowerFlow ASP.NET Core Web API

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

- `FIREBASE_SERVICE_ACCOUNT_JSON`: service account hiện tại; bắt buộc khi dùng Firebase Admin.
- `FIREBASE_PROJECT_ID`: tùy chọn, mặc định `project_id` trong service account; dùng project/database hiện có.
- `FIREBASE_AUTH_PUBLIC_API_KEY`, `FIREBASE_AUTH_SERVER_API_KEY`: cấu hình password provider theo [hướng dẫn bảo vệ đăng nhập](../docs/login-protection.md). Public key phải khớp frontend và bị chặn các phương thức đăng nhập mật khẩu trực tiếp; server key phải khác public key.
- Các biến VNPay, `CRON_SECRET` và khóa tra cứu giữ tên/cách sử dụng của backend JS; xem `.env.example` và cấu hình triển khai hiện có.

`dotnet run` không tự đọc `.env`; `npm run dev` đọc file này qua Node launcher. Không đặt service account trong appsettings, frontend, repo hoặc log. SDK khởi tạo khi cần, không tạo lại database, không đổi schema Firestore. Xác thực Firebase ID token kiểm tra thu hồi; admin/owner vẫn kiểm tra live `adminRoles` và custom claims. `FIRESTORE_EMULATOR_HOST` chỉ dùng khi chủ động cấu hình emulator để thử nghiệm.

## Build và triển khai

```powershell
dotnet publish aspnet/src/FlowerFlow.Api --configuration Release --output aspnet/.tools/publish
```

Output chứa API và bản sao nguyên trạng các file frontend công khai. Chạy `dotnet FlowerFlow.Api.dll` từ output trên host hỗ trợ ASP.NET Core/.NET 10, cấu hình `ASPNETCORE_ENVIRONMENT=Production` và `ASPNETCORE_URLS` của host. Node không cần cho tiến trình API đã publish. Giữ frontend và API cùng origin để các URL hiện tại tiếp tục hoạt động.

Nếu có reverse proxy, cấu hình IP của proxy tin cậy bằng `ReverseProxy__KnownProxies__0` (và các chỉ số tiếp theo); middleware chỉ nhận X-Forwarded-For/Proto từ các IP này rồi dùng IP đã xác minh cho rate limit. TLS kết thúc tại host/proxy. Không tin trực tiếp header IP do client gửi. Lịch cleanup cũ cần tiếp tục gọi `GET /api/orders?action=expire` với `Authorization: Bearer <CRON_SECRET>` từ scheduler của nền tảng.

Commit/push không chuyển deployment Vercel hiện tại sang .NET. `vercel.json` và các JS entry point cũ vẫn được giữ để đối chiếu và cho deployment Node cũ; muốn chạy bản C# phải triển khai output ASP.NET trên host phù hợp. Các script quản trị/maintenance Node vẫn là công cụ vận hành riêng; không được gọi bởi runtime API C#. Bản C# của export/import/mã hóa backup nằm tại `Firebase/FirestoreBackup.cs`, giữ định dạng backup cũ và không mở thêm endpoint sao lưu công khai.

## Kiểm tra

Cần Node 24+ để chạy nguồn JS đối chiếu, .NET 10 SDK và Java 21 cho Firestore Emulator. Từ gốc repository, build trước rồi chạy:

```powershell
dotnet run --project aspnet/tests/FlowerFlow.Contracts --configuration Release --no-build
```

Bộ kiểm tra bao gồm differential contracts với nguồn JS, provider giả lập, SQLite/scrypt hai chiều Node–C#, AES-GCM backup hai chiều, HTTP socket và khởi chạy executable API thật với database local tạm. Không dùng credential hay database production.

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
