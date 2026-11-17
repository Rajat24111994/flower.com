# Sổ nguồn gốc tài sản

Ngày 17/11/2026; baseline `5c6be2f`. Kiểm kê **46 đường dẫn tracked**: 35 ảnh trong
`flower.com/images`, favicon SVG và 10 PNG Wiki. Không đọc ảnh do khách upload
trong Firestore, không tuyên bố kiểm kê mọi hình từ Internet hoặc mọi tài sản lịch sử.

| Nhóm | Số đường dẫn | Nguồn/bằng chứng | Trạng thái |
| --- | ---: | --- | --- |
| Product/homepage photos và start.jpeg | 33 | [Ghi công từng file](../product-image-credits.md); Commons author/source/license, đã resize/chuyển WebP | Có bảng ghi công; không cấp phép lại theo repo |
| flowerflow-logo.png | 1 | Git `e3981fd`; chưa có nguồn/tác giả/văn bản quyền trong hồ sơ | Chờ người đóng góp cung cấp bằng chứng; không suy luận quyền từ commit |
| anh-dai-dien.webp | 1 | Git `91fdeaf`, PR #85 có ghi sử dụng AI; chưa có bằng chứng nguồn/đồng ý riêng | Chưa clearance; không tự nhận CC0 hay suy luận đó là ảnh AI tạo |
| favicon.svg | 1 | Git `5b5cecb`; source SVG trong repo | Cần xác nhận nguồn/tác giả/quyền, source công khai không thay giấy phép |
| docs/wiki/*.png | 10 | Nhật ký AI ghi PR #82 tạo sơ đồ, các commit tạo/cập nhật sơ đồ trong Git | Chưa có xác nhận quyền riêng; giữ lịch sử, không gắn license chung |

Inventory JSON ghi `documented-image-credit` khi đúng đường dẫn có trong bảng
credits; điều đó chỉ xác nhận hồ sơ tồn tại, không tự xác minh lại mọi tuyên bố
của người upload Commons. `permission-evidence-not-recorded` là thiếu hồ sơ trong
repo, không phải kết luận tài sản vi phạm.

Các ảnh CC BY/CC BY-SA vẫn theo license riêng; chuyển WebP/resize là thay đổi đã
được ghi trong bảng credits. Khi tái phân phối giữ tác giả, link nguồn, license và
thông tin thay đổi; không tuyên bố toàn bộ website trở thành CC BY-SA chỉ vì một ảnh.

Để hoàn thiện quyền với 13 tài sản chưa đủ bằng chứng: người đóng góp cung cấp
nguồn, tác giả và văn bản/quyền hoặc license cụ thể; nếu không có, chuẩn bị thay
bằng tài sản có nguồn rõ trong thay đổi riêng được review. Không xóa hoặc đổi ảnh
production trong công việc kiểm kê này và không dùng tên người commit làm bằng chứng quyền.
