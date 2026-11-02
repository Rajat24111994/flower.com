# Sao lưu và phục hồi dữ liệu FlowerFlow

## Phạm vi

Ứng dụng đang dùng Firestore database `(default)` của project `web-ban-hoa-9fe0b` cho dữ liệu nghiệp vụ như đơn hàng, sản phẩm, đánh giá, tin nhắn, danh mục và ưu đãi. Firestore Scheduled Backups tạo bản sao nhất quán của database theo lịch và tự xóa bản sao khi hết thời hạn lưu. Cấu hình đề xuất của dự án là sao lưu hằng ngày, giữ tối đa 14 tuần.

Backup Firestore không thay thế bản sao lưu Firebase Authentication, Firebase Storage hoặc mã nguồn. Những thành phần đó cần quy trình riêng nếu dự án bắt đầu lưu dữ liệu quan trọng ở đó.

## Bật lịch sao lưu

Máy quản lý cần cài Google Cloud CLI, đăng nhập bằng tài khoản có quyền quản lý backup Firestore trong project, và chọn đúng project. Từ thư mục này, chạy PowerShell:

```powershell
gcloud auth login
./scripts/setup-firestore-backup.ps1
```

Script chỉ tạo lịch hằng ngày với thời hạn lưu 14 tuần nếu database chưa có lịch nào. Nếu đã có lịch, script không thay đổi cấu hình hiện tại; hãy kiểm tra lịch trước khi chỉnh để tránh xóa hoặc tạo lịch trùng:

```powershell
gcloud firestore backups schedules list --database="(default)" --project="web-ban-hoa-9fe0b"
```

Xác minh sau khi bật:

```powershell
gcloud firestore backups schedules list --database="(default)" --project="web-ban-hoa-9fe0b"
gcloud firestore backups list --project="web-ban-hoa-9fe0b"
```

Backup đầu tiên chỉ xuất hiện sau khi lịch đã được tạo và chu kỳ sao lưu chạy. Chỉ coi tính năng đã hoạt động khi thấy lịch đúng và có backup ở trạng thái hoàn tất. Chi phí lưu trữ backup được tính theo mức sử dụng Google Cloud.

## Quyền truy cập

Giới hạn quyền xem, phục hồi và xóa backup cho tài khoản vận hành được ủy quyền. Không lưu service account key, token hay thông tin đăng nhập trong Git, Vercel hoặc tài liệu này. Kiểm tra danh sách backup định kỳ và cảnh báo nếu không có backup mới trong thời hạn dự kiến.

## Phục hồi khi có sự cố

1. Ghi nhận thời điểm sự cố và tạm dừng các thao tác quản trị có thể ghi đè dữ liệu.
2. Liệt kê backup, chọn bản gần nhất trước thời điểm dữ liệu hỏng:

   ```powershell
   gcloud firestore backups list --project="web-ban-hoa-9fe0b"
   ```

3. Phục hồi trước vào một database mới để kiểm tra, thay `LOCATION` và `BACKUP_ID` theo tên backup vừa chọn:

   ```powershell
   gcloud firestore databases restore `
     --source-backup="projects/web-ban-hoa-9fe0b/locations/LOCATION/backups/BACKUP_ID" `
     --destination-database="flower-recovery-check" `
     --project="web-ban-hoa-9fe0b"
   ```

4. Sau khi thao tác hoàn tất, kiểm tra dữ liệu và số lượng bản ghi quan trọng (đơn hàng, sản phẩm, đánh giá, tin nhắn, danh mục, ưu đãi) bằng quyền truy cập quản trị phù hợp; ghi lại backup được dùng, thời gian phục hồi và kết quả.
5. Ứng dụng hiện kết nối database `(default)` cố định. Database phục hồi riêng chỉ phục vụ kiểm tra; không tự động chuyển traffic của ứng dụng sang database đó. Khôi phục production cần người vận hành có quyền Cloud Firestore lên kế hoạch cutover và downtime. Không xóa database production trước khi đã xác nhận backup và phương án phục hồi.

## Diễn tập phục hồi

Mỗi quý, người vận hành nên phục hồi một backup gần đây vào database kiểm tra, xác nhận các dữ liệu nghiệp vụ có thể đọc được, rồi ghi kết quả và dọn database kiểm tra theo quy trình của project. Không thực hiện diễn tập trên database production.

## Trạng thái trong repository

Repository cung cấp script để tạo lịch và quy trình kiểm tra/phục hồi. Việc commit code không tự bật backup trên Google Cloud. Sau khi chạy script, xác minh lịch và backup trong Cloud Console hoặc bằng các lệnh ở trên; cho đến lúc xác minh, không coi backup của project đã được bật.
