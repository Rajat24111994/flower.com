<div align="center">

<img src="flower.com/images/flowerflow-logo.png" alt="FlowerFlow" width="120">

# FlowerFlow

**Website cửa hàng hoa tươi trực tuyến: danh mục sản phẩm, giỏ hàng, thanh toán COD/VNPay và trang quản trị.**

[Xem bản demo](https://flower-com.onrender.com) · [Kiến trúc kỹ thuật](flower.com/README.md) · [Cấu hình quản trị](docs/ADMIN-SETUP.md) · [Ghi chú phát hành](docs/RELEASE_NOTES_v0.2.0.md)

![HTML5](https://img.shields.io/badge/HTML5-E34F26?logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=black)
![Firebase](https://img.shields.io/badge/Firebase-FFCA28?logo=firebase&logoColor=black)
![ASP.NET Core](https://img.shields.io/badge/ASP.NET%20Core-.NET%2010-512BD4?logo=dotnet&logoColor=white)
![Render](https://img.shields.io/badge/Render-46E3B7?logo=render&logoColor=black)
![Node.js](https://img.shields.io/badge/Node.js-24.x-339933?logo=nodedotjs&logoColor=white)

</div>

> **Hosting:** Website chạy trên Render tại `https://flower-com.onrender.com` bằng backend ASP.NET Core C# (Docker), giữ nguyên Firebase/Firestore và frontend. `npm run dev` khởi động backend C# và cần .NET 10 SDK. Xem [hướng dẫn ASP.NET](flower.com/backend/README.md) và [triển khai Render](flower.com/docs/backend/DEPLOYMENT.md). Địa chỉ Vercel cũ `flower-com-six.vercel.app` chỉ còn chuyển hướng sang Render; backend Node trong `flower.com/api` và `flower.com/backend` được giữ làm nguồn đối chiếu test.

---

## Mục lục

- [Giới thiệu](#giới-thiệu)
- [Tính năng](#tính-năng)
- [Công nghệ](#công-nghệ)
- [Cấu trúc thư mục](#cấu-trúc-thư-mục)
- [Bắt đầu nhanh](#bắt-đầu-nhanh)
- [Cấu hình](#cấu-hình)
- [Triển khai](#triển-khai)
- [Kiểm thử](#kiểm-thử)
- [Phân quyền](#phân-quyền)
- [Hạn chế đã biết](#hạn-chế-đã-biết)
- [Lộ trình](#lộ-trình)
- [Đóng góp](#đóng-góp)
- [Nguồn gốc và bản quyền](#nguồn-gốc-và-bản-quyền)

## Giới thiệu

FlowerFlow là website bán hoa gồm ba lớp:

- **Frontend:** các trang HTML, CSS và JavaScript thuần, không framework, không cần bước build.
- **Backend:** ASP.NET Core (.NET 10) chạy trong Docker trên Render, dùng Firebase Admin SDK; phục vụ cả frontend và `/api/...` trên cùng origin. `/api/orders` tự tính giá, ưu đãi và giữ tồn kho khi tạo đơn; `/api/flower-prices` chỉ cho Owner cập nhật giá hoa và ghi lịch sử trong cùng giao dịch.
- **Cơ sở dữ liệu:** Cloud Firestore lưu sản phẩm, đơn hàng, đánh giá, ưu đãi và phân loại, được bảo vệ bằng Security Rules; Firebase Authentication quản lý tài khoản và phân quyền.

## Tính năng

### Khách hàng

| Tính năng | Mô tả |
| --- | --- |
| Hai hình thức bán | Bó làm sẵn bán đúng giá niêm yết; Owner quản lý giá hoa nguyên liệu, giá được duy trì đến lần cập nhật tiếp theo |
| Danh mục sản phẩm | Duyệt, tìm kiếm, lọc theo danh mục, sắp xếp bó làm sẵn |
| Chi tiết sản phẩm | Thư viện ảnh, giá VND, tồn kho, chọn số lượng, gợi ý sản phẩm liên quan |
| Đánh giá sản phẩm | Khách đã đăng nhập gửi đánh giá 1–5 sao; đánh giá hiển thị công khai trên trang sản phẩm |
| Giỏ hàng và yêu thích | Đồng bộ giữa các trang và thiết bị khi đăng nhập, gộp dữ liệu cũ, giới hạn theo tồn kho |
| Ưu đãi | Chọn chương trình khuyến mãi áp dụng cho các sản phẩm phù hợp khi thanh toán |
| Đặt hàng | Server báo giá, kiểm tra tồn kho và giữ hàng (VNPay 15 phút, COD 30 phút; đơn QR cũ 30 phút); đơn hết hạn tự hủy và hoàn kho |
| Thanh toán | Thanh toán khi nhận hàng (COD) hoặc VNPay; VNPay xác nhận tự động qua IPN có chữ ký. Đơn chuyển khoản QR cũ vẫn được admin đối soát thủ công |
| Theo dõi đơn | Tra cứu bằng mã đơn và số điện thoại; tự hiển thị đơn của tài khoản đang đăng nhập |
| Tài khoản | Đăng ký, đăng nhập bằng email/mật khẩu hoặc Google, quên mật khẩu, trang hồ sơ |
| Liên hệ | Thanh liên hệ nhanh qua Facebook và Zalo |

### Quản trị

| Tính năng | Mô tả |
| --- | --- |
| Sản phẩm và giá hoa | Thêm bó làm sẵn hoặc hoa nguyên liệu; Owner cập nhật giá bán hoa kèm lịch sử thay đổi, tồn kho theo bó/cành |
| Danh mục và ưu đãi | Quản lý danh mục hoa và chương trình khuyến mãi |
| Đơn hàng | Xem đơn của mọi khách theo thời gian thực, cập nhật trạng thái (Chờ xác nhận, Đang giao, Đã giao, Đã hủy) |
| Xác minh thanh toán | Đối chiếu đúng số tiền, nhập mã giao dịch ngân hàng; API kiểm tra quyền và ghi audit người xác nhận/thời gian/thông tin đối soát |
| Doanh thu | Báo cáo doanh thu theo hôm nay, theo tháng, toàn thời gian hoặc khoảng ngày tùy chọn |
| Đánh giá và lời nhắn | Trả lời, đánh dấu hoàn thành hoặc xóa đánh giá và lời nhắn khách để lại khi đặt hàng |
| Người dùng | Danh sách tài khoản Firebase và nhà cung cấp đăng nhập (qua API bảo vệ) |
| Owner | Cấp hoặc gỡ quyền admin cho từng tài khoản tại `/owner.html` |

## Công nghệ

| Lớp | Công nghệ |
| --- | --- |
| Giao diện | HTML5, CSS3, JavaScript (ES modules), không framework |
| Xác thực | Firebase Authentication (Email/Password, Google) |
| Backend | ASP.NET Core .NET 10 (Docker), Firebase Admin SDK; GitHub Actions gọi cleanup đơn hết hạn |
| Cơ sở dữ liệu | Cloud Firestore (Security Rules, chỉ mục trong `firestore.indexes.json`) |
| Thanh toán | VNPay (URL thanh toán + IPN ký HMAC-SHA512), COD; VietQR chỉ còn cho đơn QR tạo trước đây |
| Kiểm thử | `node:assert` có sẵn của Node.js, không cần thư viện ngoài |
| Hosting | Render (Docker, region Singapore) |

Ở chế độ triển khai, Firebase Authentication quản lý mật khẩu và lưu giá trị băm phía máy chủ; ở chế độ local, máy chủ dùng scrypt với salt riêng và lưu vào SQLite. Cả hai chế độ đều không ghi mật khẩu gốc vào Firestore hoặc bộ nhớ trình duyệt. Bản sao phiên `localStorage.loggedUser` chỉ chứa hồ sơ cần thiết; nhật ký xác thực chỉ ghi mã lỗi đã lọc, không ghi đối tượng lỗi hay mật khẩu.

## Cấu trúc thư mục

```text
.
├── flower.com/                       # Website: frontend tĩnh + backend ASP.NET Core
│   ├── backend/                      # Backend ASP.NET Core (Render, Docker: backend/Dockerfile)
│   │   ├── FlowerFlow.Api/           # Tầng nhận HTTP: Program.cs, Controllers/, Middleware/
│   │   ├── FlowerFlow.Application/   # Nghiệp vụ: Accounts, Admin, Catalog, Orders, Payments, DesignRequests, ShopSettings
│   │   ├── FlowerFlow.Domain/        # Entities, Models, Enums, Constants (không phụ thuộc thư viện ngoài)
│   │   └── FlowerFlow.Infrastructure/# Kết nối ngoài: Firebase, Vnpay, Security, Audit; Local (tài khoản chạy trên máy)
│   ├── legacy-node/                  # Backend Node/Vercel cũ (api/, backend/), giữ làm bản đối chiếu cho test
│   ├── js/                           # Frontend – giữ nguyên: account, admin, catalog, core, order, review
│   ├── css/  images/  *.html         # Giao diện và các trang (địa chỉ như /product.html không đổi)
│   ├── lib/                          # Hạ tầng tài khoản local và máy chủ chạy trên máy (Node)
│   ├── scripts/                      # Công cụ quản trị và vận hành: gán quyền, sao lưu/khôi phục, smoke test
│   ├── tests/                        # UnitTests/ (JS + FlowerFlow.Contracts .NET), IntegrationTests/ (emulator), E2ETests/ (Playwright)
│   ├── docs/                         # Tài liệu kỹ thuật; docs/backend: triển khai, chuyển đổi ASP.NET
│   ├── FlowerFlow.sln                # Solution ASP.NET Core
│   ├── flower.json  firestore.rules  firebase.json  vercel.json  package.json
├── render.yaml                       # Blueprint Render
└── docs/                             # Tài liệu dự án: cấu hình quản trị, phát hành, wiki, báo cáo test
```

Mô tả chi tiết kiến trúc và luồng dữ liệu nằm trong [`flower.com/README.md`](flower.com/README.md).

## Bắt đầu nhanh

### Yêu cầu

- [Node.js](https://nodejs.org/) 24.x (để chạy kiểm thử và script quản trị)
- Tài khoản tự tạo trên máy hoạt động ngay với Node.js, không cần Firebase hoặc email thật
- (Tùy chọn) [Vercel CLI](https://vercel.com/docs/cli) nếu muốn dùng `vercel dev`

### Chạy giao diện và API trên máy cục bộ

```sh
git clone https://github.com/longg5048/flower.com.git
cd flower.com/flower.com
npm ci
npm run dev
```

Mở <http://127.0.0.1:3000> hoặc <http://127.0.0.1:3000/login.html> trong trình duyệt.
Máy chủ Node phục vụ cả giao diện lẫn `/api/*` trên cùng địa chỉ, không cần bật Live Server.

Mặc định `AUTH_MODE=local`: vào **Tạo tài khoản**, dùng tên có `@` như `ban@demo`, chọn mật khẩu
và tự đặt PIN gồm 4–6 chữ số cùng 3 câu hỏi khôi phục PIN. Tên đăng nhập không cần là email có thật. Tài khoản, mật khẩu băm
và trạng thái khóa được lưu trên máy trong `.tools/local-auth/accounts.sqlite`; không cần điền
các key Firebase. Xem [tài khoản chạy thử](flower.com/docs/local-accounts.md).

Nếu muốn dùng Firebase Authentication cho tài khoản, đặt `AUTH_MODE=firebase` rồi cấu hình
theo [hướng dẫn Firebase](flower.com/docs/login-protection.md). Khởi động lại `npm run dev`
sau khi sửa `.env`. File `.env` bị Git bỏ qua và máy chủ local không phục vụ file này hoặc mã
nguồn nội bộ qua HTTP.

> [!NOTE]
> Không mở trực tiếp file HTML bằng `file://`: trình duyệt cần HTTP để gọi API và Firebase Authentication/Firestore.

Live Server/Python HTTP server chỉ phù hợp xem giao diện tĩnh. Các máy chủ đó không chạy API
đăng nhập, đặt hàng hoặc quản trị; nút đăng nhập sẽ báo thiếu API thay vì bỏ qua giới hạn bảo mật.

### Chạy bằng Vercel CLI (tùy chọn)

Một lựa chọn khác để chạy các Vercel Functions ở máy cục bộ:

```sh
cd flower.com
npm install
vercel link
vercel dev
```

Cần cấu hình biến môi trường như mô tả ở mục [Cấu hình](#cấu-hình).

## Cấu hình

### Firebase Web App

1. Tạo project trong [Firebase Console](https://console.firebase.google.com/) và đăng ký một Web App.
2. Vào **Authentication → Sign-in method**, bật **Email/Password** và **Google**.
3. Vào **Authentication → Settings → Authorized domains**, thêm domain triển khai và `localhost`.
4. Dán cấu hình Web App vào [`flower.com/js/core/firebase-config.js`](flower.com/js/core/firebase-config.js).

> [!IMPORTANT]
> Cấu hình Firebase Web App là thông tin công khai, không phải bí mật. Dữ liệu được bảo vệ bằng **Firestore Security Rules**, Authorized domains và custom claims.

### Firestore Security Rules

Quy tắc bảo mật được quản lý trong [`flower.com/firestore.rules`](flower.com/firestore.rules):

| Collection | Đọc | Ghi |
| --- | --- | --- |
| `products` | Công khai | Chỉ admin |
| `reviews` | Công khai | Tạo: người dùng đã đăng nhập (kiểm tra schema, 1–5 sao, tối đa 1000 ký tự); sửa/xóa: chỉ admin |
| `orders` | Admin, hoặc khách đọc đơn có UID của mình | Tạo: chỉ backend; sửa/xóa: chỉ admin |
| `metadata` (ưu đãi, phân loại, trạng thái catalog) | Chỉ admin | Chỉ admin |
| Còn lại | Từ chối | Từ chối |

Triển khai quy tắc bằng [Firebase CLI](https://firebase.google.com/docs/cli):

```sh
cd flower.com
firebase deploy --only firestore:rules,firestore:indexes
```

### Biến môi trường (Render)

| Biến | Bắt buộc | Mô tả |
| --- | :---: | --- |
| `FIREBASE_SERVICE_ACCOUNT_FILE` hoặc `FIREBASE_SERVICE_ACCOUNT_JSON` | ✅ | Đường dẫn Secret File (`/etc/secrets/firebase-service-account.json`) hoặc toàn bộ nội dung JSON của service account có vai trò *Firebase Authentication Admin* |
| `FIREBASE_PROJECT_ID` | ➖ | Project ID của Firebase; mặc định lấy từ service account |
| `FIREBASE_AUTH_PUBLIC_API_KEY`, `FIREBASE_AUTH_SERVER_API_KEY` | ✅ | Khóa dùng cho API đăng nhập phía server |
| `CRON_SECRET` | ✅ | Bảo vệ `/api/orders?action=expire` |
| `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET`, `VNPAY_ENV`, `PUBLIC_APP_URL` | ➖ | Khi bật VNPay |

Danh sách đầy đủ và cách kiểm tra kết nối (`--check-firebase`) có trong [`flower.com/docs/backend/DEPLOYMENT.md`](flower.com/docs/backend/DEPLOYMENT.md).

> [!CAUTION]
> Không bao giờ commit file service account vào repository. `.gitignore` đã chặn các mẫu tên file key phổ biến; chỉ lưu key trong Environment/Secret Files của Render.

## Triển khai

1. Trên [Render](https://dashboard.render.com/), tạo Web Service kiểu Docker từ repository (hoặc Blueprint [`render.yaml`](render.yaml)): nhánh `main`, Dockerfile `flower.com/backend/Dockerfile`, build context gốc repo, health check `/health`.
2. Thêm biến môi trường và Secret File ở trên trong **Environment** của service.
3. Deploy, sau đó gán quyền Owner đầu tiên bằng script `npm run set-owner`.
4. Thêm domain Render vào **Firebase Authentication → Authorized domains** và cập nhật biến GitHub Actions `FLOWER_APP_URL`.
5. Triển khai Firestore Security Rules và composite indexes bằng `firebase deploy --only firestore:rules,firestore:indexes` (chọn đúng Firebase project trước khi chạy).

Hướng dẫn từng bước, bao gồm cách gán quyền Owner bằng Application Default Credentials mà không cần tải key, có trong [`docs/ADMIN-SETUP.md`](docs/ADMIN-SETUP.md). URL chính thức là `https://flower-com.onrender.com`; kết quả kiểm tra bản đang chạy và các bằng chứng còn thiếu (Firestore Rules, VNPay sandbox, Lighthouse) ghi trong [`docs/issue-119-deployment.md`](docs/issue-119-deployment.md).

## Kiểm thử

| Loại | Lệnh | Nội dung |
| --- | --- | --- |
| Unit test | `cd flower.com && npm test` | 231 test: tính giá, ưu đãi, dữ liệu đơn hàng, trạng thái đơn, giỏ hàng, danh mục, sản phẩm, cấu hình bảo mật |
| Coverage | `cd flower.com && npm run test:coverage` | Như trên, kèm tỉ lệ dòng/nhánh/hàm được test; CI yêu cầu tối thiểu 70% coverage dòng |
| Feature, system, security | `cd flower.com/tests && npm ci && npm run integration` | 91 test: đặt hàng, đăng nhập, quản lý, luồng xuyên hệ thống và Security Rules trên Firebase Emulator (cần Java 11+) |
| Browser E2E | `cd flower.com && npm run test:e2e:emulator` | 148 test (74 kịch bản × desktop/mobile): xem sản phẩm, giỏ hàng, đăng nhập, đặt hàng trên desktop/mobile; Firebase Emulator và Playwright |
| Tài khoản trên máy | `cd flower.com && npm run test:e2e:local` | 24 test: đăng ký, PIN, câu hỏi khôi phục, khóa tài khoản (không cần emulator) |
| Smoke test sau deploy | `cd flower.com && SMOKE_URL=https://... npm run smoke` | Trang và API còn chạy, không đổi dữ liệu |

CI trên GitHub Actions chạy unit test, test tích hợp và browser E2E cho mọi Pull Request và mỗi lần push lên `main`; báo cáo coverage và ảnh/trace trình duyệt được lưu trong kết quả chạy. Chi tiết: [`tests/README.md`](flower.com/tests/README.md). Sau mỗi đợt kiểm thử, tạo báo cáo từ [mẫu báo cáo](docs/test-reports/TEMPLATE.md) trong `docs/test-reports/` ([ví dụ ngày 2026-10-28](docs/test-reports/2026-10-28.md)). Trước mỗi lần phát hành làm theo [`docs/RELEASE-CHECKLIST.md`](docs/RELEASE-CHECKLIST.md).

Để cấu hình VNPay sandbox và kiểm tra giao dịch thật trước khi bật production, xem [`docs/payments-vnpay.md`](docs/payments-vnpay.md). Không commit merchant secrets; chỉ bật VNPay sau khi đã cấu hình biến môi trường trên host triển khai và xác nhận luồng IPN trên sandbox.

## Phân quyền

| Vai trò | Custom claims | Quyền hạn |
| --- | --- | --- |
| Khách hàng | (không có) | Mua hàng, theo dõi đơn, quản lý hồ sơ |
| Admin | `admin: true` | Truy cập trang quản trị và API `/api/admin/users` |
| Owner | `role: "owner"`, `admin: true` | Mọi quyền của Admin, cấp/gỡ quyền admin qua `/owner.html` |

Mỗi lần đổi vai trò, refresh token của người dùng bị thu hồi để quyền mới có hiệu lực ngay. Owner chỉ được tạo bằng script tin cậy chạy ở máy cục bộ, không tạo được qua giao diện web.

## Hạn chế đã biết

Bản **v0.1.0** đã phát hành ngày 14/10/2026 ([release](https://github.com/Longg5048/flower.com/releases/tag/v0.1.0)); **v0.2.0** đang phát triển trên `main`. Trước khi vận hành thật, cần lưu ý:

- **VNPay mới kiểm thử bằng test tự động, chưa có giao dịch sandbox thật** (#39, #119). Cần tài khoản merchant sandbox để xác nhận luồng IPN trên môi trường thật.
- Trang thanh toán chỉ còn COD và VNPay. Đơn chuyển khoản QR tạo trước đây vẫn cần admin tự kiểm tra sao kê rồi bấm “Xác nhận đã nhận tiền”.
- Ghi nhận hoàn tiền chỉ hỗ trợ hoàn toàn bộ giá trị đơn sau khi cửa hàng đã chuyển tiền và nhập mã giao dịch. Không có chuyển tiền tự động, hoàn một phần hoặc nhiều khoản hoàn trên cùng đơn.
- **Render Free ngủ sau 15 phút không có truy cập**; lần mở đầu tiên sau đó có thể chờ khoảng một phút. Cleanup đơn hết hạn chạy bằng GitHub Actions mỗi 15 phút, cần cấu hình `FLOWER_APP_URL` và `CRON_SECRET` theo [`ADMIN-SETUP.md`](docs/ADMIN-SETUP.md).
- Dữ liệu cũ chỉ lưu trong `localStorage` (đơn hàng, đánh giá, lời nhắn trước khi có backend) không được chuyển lên Firestore. Phân loại cũ được tải lên ở lần đầu admin mở trang quản trị.
- **Tài khoản tự tạo trên máy** (`AUTH_MODE=local`, chỉ khi chạy `npm run dev`) lưu trong SQLite trên máy chạy, mật khẩu/PIN băm bằng scrypt; không dùng trên bản Render. Bản triển khai dùng Firebase Authentication.
- Khách chưa đăng nhập chỉ lưu giỏ hàng và yêu thích trên thiết bị hiện tại. Tài khoản đăng nhập được đồng bộ hai danh sách qua Firestore; khi ngoại tuyến, bản cục bộ vẫn dùng được và sẽ báo nếu đồng bộ thất bại.

## Lộ trình

- [x] Lưu đánh giá sản phẩm trên Firestore
- [x] Quản lý Firestore Security Rules trong repository
- [x] Backend tạo đơn: báo giá, kiểm tra tồn kho, giữ hàng và tự hủy đơn hết hạn
- [x] Chuyển đơn hàng, ưu đãi, phân loại, lời nhắn và trang quản lý đánh giá lên Firestore
- [x] Xác minh thanh toán QR thủ công trong trang quản trị
- [x] Tích hợp VNPay: tạo URL thanh toán, IPN kiểm tra chữ ký và số tiền (còn chờ kiểm thử sandbox thật, #39)
- [x] Thiết lập CI chạy unit test và test tích hợp trên GitHub Actions, kèm coverage
- [ ] Tách `admin.js` thành các module theo chức năng (#128)

## Đóng góp

Mọi thay đổi đi qua Pull Request, viết test trước (Red → Green → Refactor), CI xanh và có ít nhất 1 người review mới được gộp vào `main`. Chi tiết trong [`CONTRIBUTING.md`](CONTRIBUTING.md). Phần việc có dùng AI được ghi trong [`docs/AI-USAGE-LOG.md`](docs/AI-USAGE-LOG.md).

## Nguồn gốc và bản quyền

Repository được fork từ [Rajat24111994/flower.com](https://github.com/Rajat24111994/flower.com), một dự án HTML/CSS/JS tĩnh năm 2023. Trên `main` hiện chỉ còn 77/43.530 dòng (≈ 0,18%) có nguồn gốc từ repo đó, đều là mẫu chung (dấu ngoặc, CSS reset, phần đầu HTML); ảnh gốc đã được thay hết bằng ảnh có giấy phép ([`docs/product-image-credits.md`](docs/product-image-credits.md)). Repo gốc không khai báo giấy phép nên repo này **chưa có file `LICENSE`**; phân tích chi tiết và hai hướng xử lý ở [`docs/PROVENANCE.md`](docs/PROVENANCE.md).

---

<div align="center">
Ứng dụng Django quản lý kho trước đây được lưu tại nhánh <code>django-backend</code>.
</div>
