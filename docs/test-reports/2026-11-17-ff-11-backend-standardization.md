# FF-11: Chuẩn hóa backend cũ và mới (#166)

Baseline: main `3eb88dc`, ngày 17/11/2026, Windows, Node 26.13.0, .NET 10 SDK.
CI dùng Node 24. Không dùng credential hoặc dữ liệu production.

## Phát hiện và xử lý

- README gốc mô tả `npm run dev` là server Node và trỏ nguồn cũ vào `api/backend`.
  Đã sửa theo launcher thực tế: Node tải env, C# phục vụ HTTP; legacy nằm dưới `legacy-node`.
- README kiến trúc còn trỏ `../aspnet`, mô tả Vercel Functions là backend chính và
  hướng dẫn thêm route Node. Đã thay bằng host/controller C#, nguồn đối chiếu legacy
  và scheduler hiện tại. Không viết lại toàn bộ tài liệu dự án của FF-12.
- README backend, tài liệu migration/independent và hướng dẫn test được đồng bộ
  đường dẫn, phiên bản Java và phân biệt Node coverage với native C# HTTP.
- Thêm bản đồ trách nhiệm, nơi sửa nghiệp vụ, lệnh xác minh, điều kiện chuyển đổi
  và rollback tại `flower.com/docs/backend/BACKEND-BOUNDARIES.md`.
- Thêm `npm run check:backends` vào CI để bắt Render/dev/Docker chọn sai host hoặc
  dependency production kéo backend InMemory vào. Không đổi API, schema hay dữ liệu.

## Xác minh

Local: `check:backends` đạt; build solution Release 0 warning/error; xUnit
**93/93 đạt** (35 native API + 58 independent), không bỏ qua. Cú pháp script và
`git diff --check` đạt. Kết quả contracts và CI được ghi trên issue #166 cùng commit cuối.
Kiểm tra cấu hình backend không cần mạng; build/test solution kiểm tra cả host production lẫn độc lập.
Các workflow CI tiếp tục giữ native HTTP/contracts/Docker và legacy/frontend độc lập.

## Giới hạn còn lại

Backend độc lập chưa thay production: identity/payment simulator, dữ liệu in-memory;
parity, migration dữ liệu, SQL/persistence và provider thật còn theo compatibility
matrix. Node không bị xóa vì test/oracle và script quản trị còn phụ thuộc helper.
Một số chức năng frontend truy cập Firestore trực tiếp, vẫn cần Rules. Không kiểm
tra dashboard deployment, tải production hay giao dịch VNPay thật. #160 và #118
tiếp tục theo dõi bằng chứng vận hành VNPay/backup riêng.
