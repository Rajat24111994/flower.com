# Đối chiếu và tích hợp issue #141

Ngày kiểm tra: 2026-11-16. Nền tích hợp: `main` tại `1c30738`; nhánh được đối chiếu: `feat/issue-92-login-brute-force` tại `f4cfd95` (28 commit, mỗi commit một file, nền cũ `4aa91a1`).

## Quyết định

Giữ `aspnet/` làm runtime C# duy nhất. Main đã có bản chuyển đổi đầy đủ hơn, cùng cấu hình Render, service-account file, bảo vệ đăng nhập, audit, tài khoản local, backup và HTTP server. Không đưa thư mục `backend/` ở gốc từ nhánh cũ vào deployment. Các commit cũ được ghi nhận trong lịch sử merge, nhưng snapshot runtime/configuration của chúng đã được thay thế bằng bản trên main. Không dùng bản `.dockerignore` cũ để ghi đè allowlist Render mới.

| Phần ở nhánh cũ | Phần được giữ trên main | Xử lý |
| --- | --- | --- |
| `backend/Flower.Api/Program.cs`, csproj, FirebaseServices, Data, ApiFailures | `aspnet/src/FlowerFlow.Api` và Infrastructure/Http, Firebase, Compatibility | Giữ host, DI, hợp đồng lỗi và hỗ trợ credentials hiện tại |
| UserEndpoints | Infrastructure/Admin, Accounts | Giữ phân quyền, audit, password protection mới |
| CatalogEndpoints, ProductEndpoints, ImageEndpoints | Infrastructure/Catalog, ShopSettings và Application/Catalog | Giữ module hiện tại; sửa lỗi đọc lại request ảnh sau middleware |
| OrderRules, OrderEndpoints | Application/Orders và Infrastructure/Orders | Giữ quota đặt hàng, idempotency, transaction, privacy và audit hiện tại |
| PaymentEndpoints, DesignEndpoints | Infrastructure/Payments, DesignRequests | Giữ implementation và hợp đồng JS mới nhất |
| Dockerfile, `.dockerignore`, env example | `aspnet/Dockerfile`, `.dockerignore`, `render.yaml`, tài liệu deployment | Giữ cấu hình Render và bảo vệ secrets của main |
| ContractTests và test-contracts.cjs | `aspnet/tests/FlowerFlow.Contracts` | Giữ bộ differential/provider/local-account/backup/socket/emulator đầy đủ hơn |
| test-api.cjs, HTTP transport trong helpers | `aspnet/test-api.cjs`, `tests/integration/helpers.js` | Chuyển runner sang host hiện tại, giữ các handler/alias mới, giới hạn target loopback |
| aspnet-migration.test.js | `tests/integration/aspnet-migration.test.js` | Chuyển bốn test tương thích, dùng nguồn JS đã refactor trên main |
| Workflow riêng backend-aspnet.yml | `.github/workflows/aspnet.yml` | Thêm job HTTP integration vào workflow hiện tại |

## Lỗi tìm thấy khi đối chiếu

`BackendServer` đã đọc JSON và lưu vào `JsonInput` trước khi dispatch API. `ProductImagesHandler` vẫn parse trực tiếp stream đã hết dữ liệu, khiến cả ảnh hợp lệ và yêu cầu thiếu ảnh trả 503. Handler nay đọc `JsonInput.ReadAsync`, như các API khác: ảnh hợp lệ trả 201, ảnh sai trả 400, tải lại cùng ảnh không tạo bản sao. Test HTTP sử dụng request thật bắt được lỗi này; contract Firestore cũng bổ sung trường hợp body đã bị middleware đọc hết.

## Kiểm chứng

- Build toàn bộ solution Release: 0 warning, 0 error.
- Bộ contract hiện tại: Firebase configuration/auth boundary, validation/pricing/encoding JS parity, local accounts/worker/HTTP, session/CSP, backup hai chiều, executable Development/Production và credential-file checks.
- HTTP integration trên host ASP.NET với Firebase Authentication + Firestore Emulator: **87/87 test đạt**, gồm bốn test chuyển tiếp từ nhánh cũ.
- Cấu hình Docker, Render, whitelist secrets và frontend không bị thay đổi bởi tích hợp này. Không gọi Firebase production, không deploy, không thay DNS hoặc credentials.

Đây là tích hợp vào mã nguồn trên main; deployment Render vẫn tuân theo cấu hình hiện có và không được coi là đã cập nhật chỉ vì push Git.
