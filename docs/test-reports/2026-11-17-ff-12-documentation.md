# FF-12: README, Wiki, SAD và sơ đồ dữ liệu (#167)

Ngày 17/11/2026; baseline main `a1b9bef`. Phạm vi tài liệu, không đổi mã ứng dụng,
API/schema, database hay deployment. Môi trường kiểm tra Windows, Node 26.13.0,
Chromium Playwright và Mermaid 12.3.0 cài riêng trong artifacts (không thêm dependency production).

## Thay đổi và nguồn đối chiếu

- README gốc: bỏ lệnh Vercel dev không còn đúng, sửa bảng Rules (review moderation,
  cart UID, metadata public, giới hạn update đơn), bổ sung mục tài liệu/kiểm thử C#,
  bỏ số lượng test lỗi thời. README kỹ thuật sửa Render/Firebase config và vùng giao
  Hà Nội mặc định theo code mới.
- Home/Wiki/SAD: C# .NET 10 trên Render cùng origin, Node legacy làm oracle, host
  InMemory chưa thay production. Không cam kết Vercel preview hoặc SQL đã triển khai.
- SAD: thành phần/phụ thuộc, sequence checkout/VNPay, trust boundaries, cấu hình
  triển khai, cleanup, diagnostic, backup và rollback. `/health` chỉ liveness;
  không có endpoint Firebase readiness riêng trong host hiện tại.
- Data-Model: ERD logic Firestore, bảng collection/document, quyền client, dữ liệu
  nhạy cảm và transaction. `orders.items` là mảng embedded, Firebase Auth là dịch vụ
  ngoài DB, quan hệ review suy ra từ hash orderId chứ không giả định field/foreign key.
- Thiết kế SQL giữ nguyên nội dung đề xuất, thêm link tới mô hình Firestore hiện tại.
- NFR bỏ khẳng định Lighthouse/uptime/backup production đã đạt khi thiếu bằng chứng.
  Traceability giữ snapshot lịch sử 11/11, thêm mốc C#/CI 17/11 và khoảng trống #118/#160.
- Giữ PNG lịch sử để không phá URL cũ; sơ đồ kiến trúc/dữ liệu/vận hành hiện tại dùng Mermaid.

Nguồn kiểm tra: Domain constants/entities, CheckoutService, ReviewsService,
PaymentsService/VnpayIpnService, FlowerPricesService, DeliveryZonesService,
HanoiDeliveryZones, firestore.rules, health controller, launcher, Dockerfile,
render.yaml và ba workflow CI. Không đọc dữ liệu hay secret production.

## Kiểm tra thực hiện

- **83 liên kết tương đối** tồn tại và Markdown code fences cân bằng trong 10 file
  README/Wiki/database liên quan trước khi thêm báo cáo này.
- **9/9 sơ đồ Mermaid parse và render thành công trong Chromium**: ERD, Home
  context/checkout/state, backup, SAD context/layers/sequence/deployment.
- `git diff --check` đạt. Không cần thêm unit test cho thay đổi tài liệu; CI tự chạy
  trên commit cuối và được dẫn tại issue #167.
- Wiki là Git repository riêng. Đã đọc bản hiện tại trước đồng bộ; sáu trang nguồn
  được chuyển link `.md` sang Wiki slug, ánh xạ đúng tên NFR U+2010. SHA commit/push
  và đối chiếu blob remote được ghi trên issue; push main đơn thuần không cập nhật Wiki.

## Giới hạn

Mermaid được kiểm tra với bản 12.3.0 local, không bảo đảm phiên bản renderer GitHub
hoặc mọi màn hình có bố cục giống nhau. Link local được kiểm tra tồn tại; link ngoài
trong snapshot lịch sử không được crawl lại toàn bộ. Chưa xác minh dashboard Render,
Firebase Rules/Password Policy deployed, backup production/RPO/RTO, sandbox/IPN thật,
SLA/hiệu năng production. Các bằng chứng đó vẫn theo issue riêng; không dùng sơ đồ
hay CI xanh thay bằng chứng thực tế. SQL và host độc lập chưa thay production.
