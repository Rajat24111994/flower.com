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
    FlowerFlow.Infrastructure/   # Firebase Admin/Firestore và dịch vụ ngoài
      Firebase/FirebaseAdminService.cs # File thứ hai: shared/firebase-admin.js
  tests/FlowerFlow.Contracts/    # Đối chiếu hợp đồng trực tiếp với backend JS
```

Chiều phụ thuộc: Api → Application và Infrastructure; Infrastructure → Application; Application → Domain. Đã cài FirebaseAdmin và Google.Cloud.Firestore; khởi tạo client khi dùng lần đầu. Chưa có API nghiệp vụ được chuyển lưu lượng. Không có EF Core, SQL Server hoặc database migration trong khung này.

## Chạy trên máy

Cần .NET 10 SDK. Từ gốc repository:

```powershell
dotnet build aspnet/FlowerFlow.sln
dotnet run --project aspnet/src/FlowerFlow.Api
```

`GET http://localhost:5080/health` trả `{"status":"ok","service":"flowerflow-api"}`. Đây chỉ là kiểm tra tiến trình HTTP, không phải kiểm tra kết nối Firebase. URL `/api/...` hiện tại vẫn thuộc backend Node.js; chưa đổi frontend hoặc cấu hình Vercel.

## Các bước tiếp theo

Đọc [MIGRATION-STATUS.md](MIGRATION-STATUS.md) để theo dõi từng file. `FirebaseAdminBackend` cung cấp `GetAdminAuth()` và `GetAdminFirestore()`. `FirebaseAdminService` cung cấp `VerifyRequestAsync`, `VerifyAdminRequestAsync`, `VerifyOwnerRequestAsync` và `SendErrorAsync` với hợp đồng lỗi của JS. Các service đã đăng ký singleton trong DI; controller nghiệp vụ sau này phải gọi đúng helper trước khi xử lý dữ liệu. Việc đăng ký này chưa tự bảo vệ endpoint bằng middleware.

Service account chỉ được cấu hình phía server qua biến môi trường `FIREBASE_SERVICE_ACCOUNT_JSON` và `FIREBASE_PROJECT_ID` tương thích backend hiện tại, lấy từ kho bí mật triển khai. `FIREBASE_SERVICE_ACCOUNT_JSON` là bắt buộc khi sử dụng service; project ID mặc định lấy từ `project_id` của service account nếu không có biến override. Không đưa khóa vào appsettings, frontend, repository, log hoặc tài liệu. `/health` vẫn chạy được khi chưa cấu hình bí mật. SDK dùng database Firestore mặc định của project đã cấu hình, không tạo database mới. `FIRESTORE_EMULATOR_HOST` được nhận diện khi kiểm thử bằng emulator, tương thích backend Node.

## Kiểm thử

Cần Node.js cùng .NET SDK. Từ gốc repository:

```powershell
dotnet run --project aspnet/tests/FlowerFlow.Contracts --configuration Release
```

Chương trình chạy module JS gốc với SDK giả lập rồi so sánh kết quả với C#: HTTP status, JSON lỗi, UID, token được kiểm tra, cờ kiểm tra thu hồi và số lần đọc quyền. Các ca cấu hình dùng khóa RSA sinh tạm trong bộ nhớ để kiểm tra khởi tạo SDK. Không gọi đọc/ghi dữ liệu Firebase thật. CI chạy cùng bộ kiểm tra trên nhánh `asp.net`.

Tham chiếu SDK: [Firebase Admin setup](https://firebase.google.com/docs/admin/setup), [xác minh ID token](https://firebase.google.com/docs/auth/admin/verify-id-tokens), [FirestoreDbBuilder](https://docs.cloud.google.com/dotnet/docs/reference/Google.Cloud.Firestore/latest/Google.Cloud.Firestore.FirestoreDbBuilder).
