# FF-07 — Chức năng quản trị

Issue #162. Ngày 17/11/2026, Asia/Bangkok; thực hiện sau #161.

- UI desktop/mobile: **26/26 đạt**, 37,9 giây, các nhóm admin-products,
  admin-report, wilting-prices và purchase-review.
- HTTP C# + Firestore/Auth Emulator: **32/32 đạt**, 31,07 giây, các nhóm
  feature-admin, delivery-zones, product-management, flower-prices,
  authorization-matrix, review-moderation và wilting-prices.

## Phạm vi

UI kiểm tra lọc/CRUD/ẩn sản phẩm, upload ảnh, validation và lỗi lưu, chống gửi lặp,
xác nhận trước xóa, không nạp catalog mẫu vào kho thật; dashboard/doanh thu/xuất Excel;
Owner sửa quy tắc giá héo và ngày nhập, conflict/retry/giữ draft; duyệt/ẩn review mà
không sửa nội dung của khách. Account không phải Admin không mở/xuất report được.

SDK/HTTP kiểm tra lưu sản phẩm bền, tránh ghi đè tồn kho mới, atomic audit cấu hình,
Owner grant/remove, bảo vệ Owner, live role revocation, disabled token, giá hoa/history,
ảnh review sau duyệt và khả năng giữ order snapshot khi giá héo thay đổi.

Ảnh/traces local: `artifacts/ff-07-browser`. Các bài UI dùng fixture API/SDK có kiểm soát;
chúng không chứng minh quyền backend. Quyền và dữ liệu được kiểm chứng riêng bằng HTTP
tới C# cùng SDK Emulator. Không kết luận đã kiểm tra mọi tổ hợp chức năng trên production.

## Kết quả và giới hạn

Không phát hiện lỗi ứng dụng mới trong các nhóm trên. Không sửa dữ liệu/tài khoản thật,
không dùng token Admin production. Windows, Node 26.13.0, Chromium; CI dùng Node 24.
Đối soát tiền thật và VNPay provider vẫn phụ thuộc #160. Giao dịch stock và Rules có
báo cáo riêng FF-04; không giả định UI fixture thay thế các bằng chứng đó.
