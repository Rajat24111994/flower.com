# Triển khai ASP.NET trên Render Docker

Người dùng đã chọn Render và Free để chạy thử trước. Ngày 16/11/2026, người dùng đã tạo host `https://flower-com.onrender.com` qua dashboard. Đã kiểm tra trực tiếp `/health`: HTTP 200, `status=ok`, `service=flowerflow-api`. API catalog hiện trả 503 `admin-api-not-configured`, vì vậy chưa xác nhận Firebase thật sẵn sàng. Website production gốc `https://flower-com-six.vercel.app` chưa chuyển routing sang Render và không kích hoạt gói trả phí.

## Gói chạy thử

`render.yaml` tại gốc repo khai báo đúng một web service Free, nhánh `asp.net`, Dockerfile `aspnet/Dockerfile`, build context gốc repo, region Singapore và health check `/health`. Không khai báo database mới. Auto-deploy tắt để kiểm tra commit trước mỗi lần triển khai. Docker chạy .NET 10 với user không phải root và group `1000`, cần thiết để đọc Render Secret Files trong `/etc/secrets`; frontend nguyên trạng và `/api/...` được phục vụ cùng host.

Ứng dụng nhận biến `PORT` do Render cấp và bind `0.0.0.0` trong Production; Development tiếp tục bind loopback. `AUTH_MODE=firebase` và API tài khoản SQLite local bị tắt ở Production. `.dockerignore` giới hạn nội dung build, loại `.env`, key files, Git metadata, bin/obj và JSON ngoài các file cấu hình công khai đã chỉ định. Secrets chỉ được truyền lúc chạy từ Render Environment/Secret Files.

Build và thử trên máy có Docker:

```sh
docker build -f aspnet/Dockerfile -t flowerflow-csharp .
docker run --rm -p 127.0.0.1:8080:8080 -e PORT=8080 flowerflow-csharp
```

`/health` chỉ kiểm tra tiến trình HTTP. Việc endpoint này trả 200 không xác nhận Firebase hay thanh toán đã sẵn sàng. CI build image, chạy HTTP thật, kiểm tra frontend giữ nguyên bytes, tắt local-auth và xác nhận image không chứa credentials mặc định; không tạo cloud service trong CI.

## Quyền truy cập cần có

Cần tài khoản Render đã được kết nối/đăng nhập để tạo web service Free từ Blueprint. Quyền truy cập GitHub hiện tại chỉ cho phép chuẩn bị/push code và chạy CI, không thay thế quyền triển khai Render. Tích hợp Render đã được tìm thấy nhưng phải được người dùng kết nối trước khi gọi thao tác triển khai.

Host hiện tại do người dùng tạo thủ công; agent chưa có kết nối quản trị Render để bấm deploy hoặc đặt secrets thay người dùng. Nếu service không tự deploy, sau khi push bản sửa cần chọn Manual Deploy → Deploy latest commit rồi chờ Live.

Nếu người dùng tự đăng nhập để tạo dịch vụ, dùng [Deploy bản Free từ nhánh asp.net](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2FLongg5048%2Fflower.com%2Ftree%2Fasp.net), kiểm tra `plan: free` trước khi tạo. Link chỉ mở quy trình trên tài khoản Render của người dùng; không có nghĩa agent đã tạo host hoặc website đã chuyển production. Quy tắc chọn nhánh theo [Deploy to Render](https://render.com/docs/deploy-to-render).

Free được dùng cho bản thử theo lựa chọn của người dùng. Render khuyến cáo không dùng Free cho production; dịch vụ Free ngủ sau 15 phút không có truy cập. Không tự chuyển sang gói trả phí. Tham khảo [Render Free](https://render.com/docs/free) và [Render Docker](https://render.com/docs/docker).

## Firebase và nghiệp vụ trước khi chuyển lưu lượng

### HTTPS sau proxy Render

Render cấp `RENDER_EXTERNAL_URL` chứa URL HTTPS công khai trong khi container nhận HTTP nội bộ. ASP.NET dùng origin của URL server-side này và `PUBLIC_APP_URL` (nếu có) để kiểm tra Origin cho API. Chỉ các origin được cấu hình rõ ràng mới được bổ sung; không lấy giá trị tin cậy từ header do client gửi. Quy tắc proxy/IP vẫn giữ riêng và phải được kiểm tra trước khi chuyển toàn bộ lưu lượng production. Không bật tin cậy mọi X-Forwarded-For/Proto để giải quyết lỗi HTTPS.

Regression test mô phỏng HTTPS ngoài proxy/HTTP trong container, yêu cầu hợp lệ đi tới validation, origin lạ vẫn 403 và forwarded IP giả vẫn bị bỏ qua. Docker CI kiểm tra cùng trường hợp. Lệnh POST `/api/login` với JSON rỗng và Origin của host phải trả 400 `invalid-argument`, không phải 403 `same-origin-required`; phép thử này không dùng tài khoản, mật khẩu hoặc ghi dữ liệu.

Trong Render Environment, cấu hình các giá trị server đang dùng, không đưa chúng vào Git:

- `FIREBASE_SERVICE_ACCOUNT_JSON` hoặc file bí mật. Với file `firebase-service-account.json`, đặt `FIREBASE_SERVICE_ACCOUNT_FILE=/etc/secrets/firebase-service-account.json`; container chạy trong group `1000` để đọc file đó.
- `FIREBASE_PROJECT_ID=web-ban-hoa-9fe0b`: giữ nguyên project Firestore/Authentication.
- `FIREBASE_AUTH_PUBLIC_API_KEY` khớp frontend và `FIREBASE_AUTH_SERVER_API_KEY` riêng, có restriction theo hướng dẫn đăng nhập hiện có.
- Các giá trị `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET`, `VNPAY_ENV`, `PUBLIC_APP_URL` nếu đang dùng VNPay; giữ thông số merchant hiện tại cho production và dùng sandbox cho thử thanh toán.
- `CRON_SECRET` và các secret server khác đang dùng. GitHub hiện có tên secret `CRON_SECRET`; chưa có Service Account hoặc credentials hosting trong repo secrets khi kiểm tra.

Chạy `dotnet FlowerFlow.Api.dll --check-firebase` trong môi trường đã nhận secrets: yêu cầu `status=connected`, `authentication=true`, `firestore=true`. Lệnh này chỉ đọc và kiểm tra project khớp frontend, không tạo tài khoản hay ghi dữ liệu. Nếu chưa có key/quyền, các API cần Firebase chưa thể chạy đầy đủ; không coi preview tĩnh là hoàn tất migration production.

Thử đăng nhập/ID token/quyền admin–owner, đọc catalog/giá/phí và các tình huống nghiệp vụ trên môi trường thử được thống nhất. Giữ nguyên dữ liệu Firestore. Nếu dùng tên miền mới, cập nhật Authorized domains của Firebase Auth và callback/return URL của các nhà cung cấp liên quan theo URL thực tế; không đổi Firebase project.

## Chuyển production và rollback

Chỉ chuyển lưu lượng sau khi biết URL Render thực, cấu hình Firebase/password provider/payment, kiểm tra quyền và xác nhận các luồng cần thiết hoạt động. Không đổi routing production trong bước chuẩn bị thiếu quyền/credentials.

Nếu chuyển toàn website sang domain riêng trỏ Render, cấu hình domain/TLS của host và giữ frontend–API cùng origin. Domain `flower-com-six.vercel.app` thuộc Vercel; không thể chuyển DNS của domain này sang Render như domain riêng. Để giữ URL đó cần cấu hình reverse proxy/routing tại Vercel, hoặc thống nhất chuyển sang domain mới. Proxy phải truyền đúng origin/protocol và IP đã xác minh; không bật tin cậy toàn bộ X-Forwarded-For để né lỗi cấu hình. Chưa thêm rewrite tới host giả hoặc URL chưa kiểm tra.

Giữ cron cleanup gọi `/api/orders?action=expire` với CRON_SECRET và cập nhật scheduler khi đổi origin. Kiểm tra VNPay IPN/return URL, bao gồm callback của các đơn đang xử lý. Đối chiếu hoạt động cả trước và sau chuyển lưu lượng trên cùng Firestore. Không xóa backend JS và không merge thay đổi routing production chỉ để đổi biểu đồ Languages.

Giữ lại deployment Vercel trước đó và bản ASP.NET đã kiểm chứng để rollback routing khi cần. Rollback không restore/xóa database và không chạy lại thao tác thanh toán; trạng thái giao dịch và kho vẫn được xử lý qua transaction/idempotency hiện có.
