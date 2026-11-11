# Project charter — FlowerFlow

Cho issue #131. Các mục ghi **"Nhóm điền"** cần nhóm xác nhận; phần còn lại lấy từ repository và wiki tính đến 11/11/2026.

## 1. Thông tin chung

| Mục | Nội dung |
| --- | --- |
| Tên dự án | FlowerFlow – website bán hoa tươi trực tuyến |
| Học phần | Nhóm điền (tên học phần, mã lớp, giảng viên) |
| Repository | [Longg5048/flower.com](https://github.com/Longg5048/flower.com), fork từ [Rajat24111994/flower.com](https://github.com/Rajat24111994/flower.com) (xem [`PROVENANCE.md`](../PROVENANCE.md)) |
| Bản chạy thật | https://flower-com-six.vercel.app |
| Bắt đầu | 05/10/2026 (commit đầu tiên của nhóm sau điểm fork) |
| Mốc đã đạt | v0.1.0 phát hành 14/10/2026; v0.2.0 đang phát triển trên `main` |
| Kết thúc dự kiến | Nhóm điền (hạn nộp/bảo vệ) |

## 2. Vấn đề và mục tiêu

**Vấn đề:** cửa hàng hoa nhỏ bán qua mạng xã hội phải chốt đơn, tính tiền và theo dõi kho bằng tay. Dễ sai giá, bán quá số hoa còn lại, và khó biết doanh thu.

**Tầm nhìn:** khách **tìm, chọn và đặt hoa trong vài phút**; chủ cửa hàng **quản lý sản phẩm, tồn kho, đơn hàng và doanh thu ở cùng một nơi**.

| # | Mục tiêu | Cách đo (đã có trong repo) |
| --- | --- | --- |
| M1 | Mua hoa nhanh: giỏ hàng → thanh toán → xác nhận | E2E `store-purchase` trên desktop và mobile |
| M2 | Không bán vượt tồn kho | Test `order-inventory`, `api-orders`; load test tranh mua (`docs/test-reports/2026-11-11-load-test.md`) |
| M3 | Giá và thanh toán chính xác, do máy chủ tính | Test `order-pricing`, `vnpay`; NF-09, NF-10 |
| M4 | Giảm thao tác thủ công cho cửa hàng | Trang quản trị, báo cáo doanh thu, xuất Excel (QT-01..QT-11) |

## 3. Phạm vi

| Trong phạm vi | Ngoài phạm vi |
| --- | --- |
| Website cho máy tính và điện thoại; trang quản trị | Nhiều chi nhánh |
| Danh mục, tìm kiếm, giỏ hàng, đặt hàng, theo dõi đơn, đánh giá | Ứng dụng di động riêng |
| Thanh toán COD và VNPay | Thanh toán thẻ tín dụng trực tiếp trên site |
| Quản lý sản phẩm, tồn kho, danh mục, ưu đãi, khu vực giao, đơn, doanh thu, người dùng | Giao hàng tích hợp đơn vị vận chuyển |

Chi tiết yêu cầu: [Yêu cầu chức năng](../wiki/Functional-Requirements.md), [Yêu cầu phi chức năng](../wiki/Non-Functional-Requirements.md), [Ma trận truy vết](../wiki/Traceability-Matrix.md).

## 4. Các bên liên quan và người dùng

| Vai trò | Nhu cầu chính | Persona |
| --- | --- | --- |
| Khách mua hoa | Chọn nhanh, giá rõ ràng, giao đúng giờ, theo dõi được đơn | [P1, P2](PERSONAS.md) |
| Nhân viên quản lý (admin) | Xử lý đơn, cập nhật kho, duyệt đánh giá | [P3](PERSONAS.md) |
| Chủ cửa hàng (owner) | Doanh thu, giá hoa, cấp quyền nhân viên | [P4](PERSONAS.md) |
| Giảng viên | Đánh giá quy trình kỹ thuật, bằng chứng, đóng góp cá nhân | — |

## 5. Nhóm và phân công

Danh tính và vai trò chính thức ghi tại [`docs/TEAM.md`](../TEAM.md) (#127), nhiều mục vẫn **chờ xác nhận**. Bảng dưới chỉ ghi phần việc **thấy được trong repo** (issue được giao, PR đã gộp); nhóm sửa lại cho đúng.

| GitHub | Phần việc thấy trong repo | Vai trò (nhóm điền) |
| --- | --- | --- |
| Longg5048 | Điều phối PR, kiểm thử, CI, tái cấu trúc, tài liệu (nhiều PR dùng Claude Code, xem [`AI-USAGE-LOG.md`](../AI-USAGE-LOG.md)) | |
| DoThai207 | Danh sách sản phẩm, checkout (#28, #29), rà soát bảo mật (#91), chống brute force (#92), CSP (#120), chính sách mật khẩu (#121), quy trình review (#127), rà soát issue (#123), ma trận truy vết (#124) | |
| Dol-tech07 | Quyền riêng tư (#106, #108), giá hoa (#110), phân quyền đơn (#112), HTTPS (#113), mật khẩu (#116) | |
| haib15526-oss | Lọc doanh thu (#78), phân quyền admin (#117), giá héo tự động (#107) | |
| Cuongvan-pixel | Tăng cường bảo mật tài khoản trên máy (commit 71212e6), trang thông tin thanh toán (PR #73, chưa gộp) | |
| Ng-Anh-Lx | Khôi phục mật khẩu (#26), thanh toán online (#39), xác thực (#93) | |
| Nanh, Anh.NV, lvn5048, thcslxtnhp1-glitch (tên commit) | Có commit trong lịch sử; chưa xác nhận là tài khoản của ai (#127) | |

## 6. Cách làm việc và Definition of Done

- Mỗi việc là một issue → nhánh riêng → Pull Request → review → gộp vào `main` ([`CONTRIBUTING.md`](../../CONTRIBUTING.md)).
- **Một việc được coi là xong khi:**
  1. Có test cho hành vi mới hoặc lỗi được sửa; unit, tích hợp (Firebase Emulator) và e2e trên CI đều xanh.
  2. Coverage dòng unit không dưới 70%.
  3. Có ít nhất 1 Approve của thành viên khác, không còn góp ý chưa giải quyết.
  4. Tài liệu liên quan (README, wiki, ma trận truy vết) được cập nhật; đổi JS/CSS thì tăng `?v=`.
  5. Nếu có dùng AI thì khai báo trong PR và nhật ký AI.
  6. Issue được đóng kèm liên kết PR và bằng chứng kiểm thử.

## 7. Rủi ro chính

| Rủi ro | Ảnh hưởng | Cách xử lý | Issue |
| --- | --- | --- | --- |
| API production lỗi 500 | Khách không đặt hàng được | Lấy log Vercel, sửa, rollback tạm | #119 |
| Sao lưu và dọn đơn chưa chạy (thiếu secret) | Mất dữ liệu, kho bị giữ | Chủ repo cài secret | #118 |
| VNPay chưa thử sandbox | Lỗi thanh toán thật | Chạy 5 kịch bản sandbox | #39, #119 |
| Nhiều khách cùng mua một sản phẩm bị lỗi 503 | Mất đơn dịp lễ | Thử lại khi `ABORTED`, chia tồn kho | #126 |
| Repo gốc không có giấy phép | Rủi ro bản quyền | Viết lại 77 dòng mẫu hoặc xin phép | #130 |
| Chưa có nghiên cứu người dùng | Làm sai nhu cầu | Theo [kế hoạch nghiên cứu](USER-RESEARCH-PLAN.md) | #131 |

## 8. Phê duyệt

| Vai trò | Họ tên | Ngày |
| --- | --- | --- |
| Trưởng nhóm | Nhóm điền | |
| Thành viên | Nhóm điền | |
