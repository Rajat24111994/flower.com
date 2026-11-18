# Nội dung bổ sung theo Engineering Software Products

## Ch1 – Sản phẩm, tầm nhìn
- Tầm nhìn Moore: Flowerflow giúp khách hàng đặt hoa nhanh, dễ dàng và cá nhân hóa bó hoa; admin quản lý bán hàng hiệu quả.
- Prototype: wireframe các trang chính (home, product, cart, checkout, admin report).

## Ch2 – Agile
- Scrum: sprint 1-2 tuần, retro sau mỗi sprint, Definition of Done rõ ràng.

## Ch3 – Feature, người dùng
- Scenarios: khách chọn hoa → thêm giỏ → thanh toán → theo dõi đơn; admin xem báo cáo → lọc theo thời gian → xuất Excel.
- Feature spec: input (filters/orders), action (buildReport), output (series, totalRevenue).

## Ch4 – Kiến trúc
- Monolith phân lớp Api/Application/Domain/Infrastructure; REST JSON; Firestore schema.

## Ch5 – Cloud
- Multi-tenant: hiện phục vụ 1 cửa hàng; nếu mở rộng cần tenantId và rules theo tenant.

## Ch6 – Microservices
- Hiện là monolith; nếu scale, tách Orders/Payments/Catalog thành service riêng.

## Ch7 – Kiểm thử
- Unit/integration/E2E đã có; bổ sung test scenario end-to-end cho thanh toán sandbox.

## Ch8 – Lập trình tin cậy
- Validation đầu vào, audit log, reserve/restore stock, refactor.

## Ch9 – Bảo mật, riêng tư
- MFA chưa triển khai; có thể thêm OTP/TOTP cho admin/owner.

## Ch10 – DevOps
- CI/CD GitHub Actions + Render; checklist release đã có; cần rollback plan.
