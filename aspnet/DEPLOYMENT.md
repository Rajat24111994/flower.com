# Triển khai ASP.NET trên Render Docker

Render là hosting chính thức của website từ ngày 16/11/2026: `https://flower-com.onrender.com` (gói Free, Docker, region Singapore). Kiểm tra trực tiếp ngày 16/11/2026: `/health` trả 200, `GET /api/products` đọc được catalog Firestore, `POST /api/login` với JSON rỗng và Origin của host trả 400 `invalid-argument`, header CSP/X-Frame-Options/Referrer-Policy khớp bản Vercel. Địa chỉ cũ `https://flower-com-six.vercel.app` chỉ còn chuyển hướng tạm thời (307) sang Render qua `redirects` trong `flower.com/vercel.json`.

## Việc cần làm trên dashboard khi chuyển

Các bước này nằm ngoài repo, chủ dự án phải tự làm:

1. **Render → service → Settings → Build & Deploy:** đổi Branch sang `main` (khớp `render.yaml`), bật Auto-Deploy "After CI checks pass" nếu muốn tự deploy, rồi **Manual Deploy → Deploy latest commit**.
2. **Render → Environment:** đủ các biến ở mục [Firebase và nghiệp vụ](#firebase-và-nghiệp-vụ-trước-khi-chuyển-lưu-lượng), gồm `CRON_SECRET` (cùng giá trị với GitHub secret) và `PUBLIC_APP_URL=https://flower-com.onrender.com` nếu dùng VNPay.
2b. **Đăng nhập email/mật khẩu (bắt buộc, nếu thiếu `/api/login` luôn trả 503 `auth-service-unavailable`):** làm đủ mục *Bắt buộc cấu hình trước khi triển khai* trong [`flower.com/docs/login-protection.md`](../flower.com/docs/login-protection.md). Tóm tắt: tạo một API key máy chủ riêng chỉ được gọi `SignInWithPassword`; đặt API method restrictions cho key công khai (`apiKey` trong `js/core/firebase-config.js`) theo [`login-public-key-restrictions.json`](../flower.com/docs/login-public-key-restrictions.json) để key này **bị chặn** `signInWithPassword` và `verifyPassword`; đặt `FIREBASE_AUTH_PUBLIC_API_KEY` (đúng key công khai) và `FIREBASE_AUTH_SERVER_API_KEY` (key máy chủ, khác key công khai) trong Render Environment. Kiểm tra từ máy: gọi `accounts:signInWithPassword` bằng key công khai phải trả 403 `API_KEY_SERVICE_BLOCKED`, không phải 400 `INVALID_LOGIN_CREDENTIALS`.
3. **Firebase Console → Authentication → Settings → Authorized domains:** thêm `flower-com.onrender.com`, nếu không thì đăng nhập Google sẽ bị chặn.
4. **GitHub → Settings → Secrets and variables → Actions → Variables:** đổi `FLOWER_APP_URL` thành `https://flower-com.onrender.com` để workflow *Expire unpaid orders* gọi đúng host; chạy thử workflow một lần.
5. **VNPay (nếu đã đăng ký merchant):** đổi Return URL/IPN URL sang `https://flower-com.onrender.com/payment-result.html` và `https://flower-com.onrender.com/api/vnpay-ipn`.
6. Thử trên Render: đăng nhập email và Google, mở `/admin.html` bằng tài khoản admin, `/owner.html` bằng Owner, đặt một đơn COD thử rồi hủy.
7. Sau khi merge vào `main`, Vercel tự deploy bản có redirect. Mở `https://flower-com-six.vercel.app/about.html` phải chuyển sang `https://flower-com.onrender.com/about.html`. Khi đã ổn định có thể đổi `permanent` thành `true`.

Rollback: xóa khối `redirects` trong `flower.com/vercel.json` (hoặc Promote deployment Vercel trước đó trong dashboard Vercel). Cả hai bản dùng chung Firestore nên không cần chuyển dữ liệu.

## Cấu hình service

`render.yaml` tại gốc repo khai báo đúng một web service Free, nhánh `main`, Dockerfile `aspnet/Dockerfile`, build context gốc repo, region Singapore và health check `/health`. Không khai báo database mới. Auto-deploy chỉ chạy sau khi CI của commit đạt (`autoDeployTrigger: checksPass`). Docker chạy .NET 10 với user không phải root và group `1000`, cần thiết để đọc Render Secret Files trong `/etc/secrets`; frontend nguyên trạng và `/api/...` được phục vụ cùng host.

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

Render cấp `RENDER_EXTERNAL_URL` chứa URL HTTPS công khai trong khi container nhận HTTP nội bộ. ASP.NET dùng origin của URL server-side này và `PUBLIC_APP_URL` (nếu có) để kiểm tra Origin cho API. Chỉ các origin được cấu hình rõ ràng mới được bổ sung; không lấy giá trị tin cậy từ header do client gửi. Vì `UseHsts` chỉ gắn header cho request HTTPS mà container chỉ nhận HTTP, khi origin công khai là HTTPS ứng dụng tự gửi `Strict-Transport-Security: max-age=31536000; includeSubDomains` giống bản Vercel; contract test host production kiểm tra header này. Quy tắc proxy/IP vẫn giữ riêng và phải được kiểm tra trước khi chuyển toàn bộ lưu lượng production. Không bật tin cậy mọi X-Forwarded-For/Proto để giải quyết lỗi HTTPS.

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
