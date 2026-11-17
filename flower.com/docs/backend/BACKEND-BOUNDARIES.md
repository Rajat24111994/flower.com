# Backend hiện tại và nguồn đối chiếu

Đường dẫn trong tài liệu tính từ gốc repository. Chuẩn hóa cho FF-11 (#166), 17/11/2026.

| Vai trò | Mã nguồn và hợp đồng | Cách chạy | Dữ liệu/xác thực |
| --- | --- | --- | --- |
| Website chính | `flower.com/backend/FlowerFlow.Api`, `/api/...`, frontend cùng origin | `cd flower.com && npm run dev` (cổng 3000); Render dùng `backend/Dockerfile` | Firestore/Firebase; local chỉ thay xác thực bằng SQLite, không thay DB nghiệp vụ |
| Node cũ | `flower.com/legacy-node/api`, `legacy-node/backend` | Runner integration/oracle; không có lệnh triển khai production | Firebase Emulator trong CI; helper còn được script quản trị sử dụng |
| Backend độc lập | `flower.com/backend/FlowerFlow.Backend`, `/api/v1/...` | Từ gốc: `dotnet run --project flower.com/backend/FlowerFlow.Backend` (5090) | InMemory, development identity, payment simulator; mất dữ liệu khi restart |

Host độc lập chỉ cho Development/Testing và đã từ chối Production trong `Program.cs`.
Không đổi frontend sang `/api/v1` khi chưa hoàn tất các khoảng trống trong
[compatibility matrix](COMPATIBILITY-MATRIX.md). Không có SQL Server/EF migration
trong phạm vi chuẩn hóa này. Không gộp hai hợp đồng HTTP khác nhau hoặc chuyển dữ liệu.

## Nơi sửa nghiệp vụ

Thay đổi website được thực hiện ở controller C# → Application → Domain/interface →
Infrastructure. Kiểm thử native HTTP chứng minh hành vi host thật; Node oracle giúp
phát hiện khác biệt chuyển đổi. Source legacy giữ vai trò baseline: nếu yêu cầu nghiệp
vụ mới chủ động khác JS cũ, ghi rõ khác biệt và kiểm tra kỳ vọng C#, không sửa oracle
chỉ để test xanh. Các thay đổi mới như khu vực Hà Nội ở C# có thể khác baseline Node.

| Phạm vi | Nguồn thực thi chính | Bằng chứng cần chạy |
| --- | --- | --- |
| Giá, kho, đơn, thiết kế, thanh toán | Application/Infrastructure của `FlowerFlow.Api` | Native xUnit, contracts và native HTTP trên Auth/Firestore Emulator |
| Header, static frontend, local auth, readiness, cleanup | Api + Infrastructure | Contracts, native HTTP và Docker smoke trong ASP.NET workflow |
| Hành vi Node dùng đối chiếu | `legacy-node` | Node unit/integration; coverage Node không đại diện coverage C# |
| Domain độc lập và `/api/v1` | Commerce/InMemory/Backend | `FlowerFlow.Backend.Tests`; không chứng minh parity hay payment thật |
| Script cấp quyền và backup | `flower.com/scripts` + helper/lib Node | Kiểm thử CLI riêng; credential không nằm trong frontend hoặc Git |

Client còn đọc/ghi Firestore trực tiếp ở một số chức năng. Chuẩn hóa host không có
nghĩa toàn bộ truy cập dữ liệu đã đi qua C#. Firestore Rules tiếp tục là ranh giới
bảo vệ cho các truy cập đó.

## Lệnh xác minh

Từ gốc repository, với .NET 10 SDK, Node 24 và Java 21:

```sh
npm ci --prefix flower.com
npm run check:backends --prefix flower.com
dotnet build flower.com/FlowerFlow.sln --configuration Release
dotnet test flower.com/FlowerFlow.sln --configuration Release --no-build
dotnet run --project flower.com/tests/UnitTests/FlowerFlow.Contracts --configuration Release --no-build
```

`check:backends` xác minh Render và launcher dev cùng chọn `FlowerFlow.Api`, Docker
khởi động đúng DLL, và cây ProjectReference production không kéo host độc lập/
Commerce/InMemory vào. Kiểm tra không gọi mạng hoặc cần credential. Nó là kiểm tra
cấu hình source, không chứng minh cấu hình dashboard Render hoặc deployment đã chạy.

Workflow ASP.NET còn chạy native HTTP (runner `tests/IntegrationTests/test-api.cjs`),
contracts Firestore và container smoke. Workflow Node chạy baseline legacy và frontend;
workflow independent kiểm thử/publish host InMemory riêng. Xem [hướng dẫn test](../../tests/README.md).

## Chuyển đổi và rollback

Giữ Render trên `main`, Dockerfile `flower.com/backend/Dockerfile`, frontend và API
cùng origin. Rollback website bằng image/commit C# đã xác minh trước đó theo
[runbook triển khai](DEPLOYMENT.md); không chuyển sang Node cũ hoặc InMemory để
chữa lỗi tạm thời. Nếu thay schema/dữ liệu trong tương lai phải có backup, đối chiếu
đơn/thanh toán/kho và kế hoạch chuyển riêng. Công việc này không deploy dashboard,
đọc secret, thay database hoặc xác minh VNPay thật.
