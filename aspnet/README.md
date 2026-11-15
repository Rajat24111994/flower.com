# FlowerFlow ASP.NET Core Web API

Khung .NET 10 để chuyển backend Node.js sang C# từng file, giữ nguyên frontend, Firebase Authentication và Cloud Firestore hiện tại.

## Cấu trúc

```text
aspnet/
  FlowerFlow.sln
  src/
    FlowerFlow.Api/              # HTTP controller và cấu hình ứng dụng
    FlowerFlow.Application/      # Quy tắc nghiệp vụ và use case
      Orders/OrderConfig.cs     # File nghiệp vụ đầu tiên đã chuyển
    FlowerFlow.Domain/           # Dành cho kiểu dữ liệu nghiệp vụ, chưa có model mới
    FlowerFlow.Infrastructure/   # Dành cho Firebase Admin/Firestore và dịch vụ ngoài
```

Chiều phụ thuộc: Api → Application và Infrastructure; Infrastructure → Application; Application → Domain. Khung hiện chưa cài Firebase SDK, chưa kết nối database và chưa có API nghiệp vụ được chuyển lưu lượng. Không có EF Core, SQL Server hoặc database migration trong khung này.

## Chạy trên máy

Cần .NET 10 SDK. Từ gốc repository:

```powershell
dotnet build aspnet/FlowerFlow.sln
dotnet run --project aspnet/src/FlowerFlow.Api
```

`GET http://localhost:5080/health` trả `{"status":"ok","service":"flowerflow-api"}`. Đây chỉ là kiểm tra tiến trình HTTP, không phải kiểm tra kết nối Firebase. URL `/api/...` hiện tại vẫn thuộc backend Node.js; chưa đổi frontend hoặc cấu hình Vercel.

## Các bước tiếp theo

Đọc [MIGRATION-STATUS.md](MIGRATION-STATUS.md) để theo dõi từng file. Firebase Admin SDK, xác minh ID token có kiểm tra thu hồi, quyền trong `adminRoles` và Google.Cloud.Firestore sẽ được tích hợp ở bước chuyển file nền tảng Firebase; không triển khai endpoint nghiệp vụ có bảo vệ trước khi bước này được kiểm chứng.

Service account chỉ được cấu hình phía server, thông qua biến môi trường `FIREBASE_SERVICE_ACCOUNT_JSON` và `FIREBASE_PROJECT_ID` tương thích backend hiện tại hoặc kho bí mật triển khai. Không đưa khóa vào appsettings, frontend, repository, log hoặc tài liệu. Khung hiện chưa đọc các biến này; cấu hình bí mật khi file kết nối Firebase được chuyển.
