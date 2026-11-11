# Kiểm chứng vận hành — issue #118

## Trạng thái ngày 11/11/2026

Chưa hoàn tất. API GitHub xác nhận danh sách repository Actions secrets và variables đều rỗng. Không ghi giá trị secret vào tài liệu, log hay issue.

Các lần chạy thất bại gần nhất được kiểm tra:

- [Sao lưu Firestore](https://github.com/Longg5048/flower.com/actions/runs/42924541915).
- [Expire unpaid orders](https://github.com/Longg5048/flower.com/actions/runs/42926672585).

## Cấu hình cần chủ repo cung cấp

Tại Settings → Secrets and variables → Actions:

| Loại | Tên | Yêu cầu |
| --- | --- | --- |
| Variable | `FLOWER_APP_URL` | Origin HTTPS của production; xem `docs/ADMIN-SETUP.md` |
| Secret | `CRON_SECRET` | Khớp chính xác với CRON_SECRET trên Vercel Production |
| Secret | `FIREBASE_SERVICE_ACCOUNT_JSON` | Service account của đúng Firebase project; xem `docs/BACKUP-RESTORE.md` |
| Secret | `BACKUP_PASSPHRASE` | Ít nhất 12 ký tự; lưu an toàn ngoài GitHub để có thể khôi phục |

Không tạo CRON_SECRET mới chỉ ở GitHub vì sẽ làm xác thực khác với production. Không thay passphrase đã dùng nếu chưa giữ lại mật khẩu giải mã các bản sao lưu cũ.

## Diễn tập và bằng chứng cần bổ sung

Workflow backup chạy `npm run restore -- <file>` ngay sau khi tạo file mã hóa, dùng cùng passphrase. Không truyền `--dong-y`, nên bước này chỉ giải mã, đọc số lượng bản ghi và không ghi vào Firestore. Nếu giải mã hoặc preview thất bại, workflow phải thất bại. Kết quả preview nằm trong job summary; artifact chỉ chứa file `.json.enc`.

Sau khi cấu hình, mở Actions và Run workflow trên `main` cho cả hai workflow. Ghi bằng chứng thực tế vào bảng sau, không điền thành công trước khi kiểm tra:

| Bằng chứng | Kết quả |
| --- | --- |
| Link chạy cleanup xanh | Chờ cấu hình và chạy |
| Link chạy backup xanh | Chờ cấu hình và chạy |
| Artifact mã hóa `firestore-backup-<run_id>` | Chờ kiểm tra |
| Preview restore: thời điểm backup, tổng số bản ghi, không ghi Firestore | Chờ job summary |
| Khoảng theo dõi ít nhất 24 giờ (bắt đầu/kết thúc, múi giờ) | Chưa bắt đầu |
| Các lần chạy theo lịch trong khoảng theo dõi đều xanh | Chưa xác minh |

Cleanup chạy theo lịch mỗi 15 phút; backup lúc 01:23 giờ Việt Nam mỗi ngày. Chờ đủ ít nhất 24 giờ sau khi cấu hình, kiểm tra các lần chạy theo lịch của cả hai workflow và cập nhật bảng. Một lần workflow_dispatch xanh chưa đủ đóng issue #118. GitHub có thể chạy lịch trễ, nên dùng thời điểm thực tế của run khi ghi bằng chứng.

## Kiểm tra cục bộ

- 4/4 test trong tests/backup-crypto.test.js đạt.
- Preview một backup mã hóa giả lập chứa một đơn hàng thành công; không dùng cờ ghi dữ liệu. Đây chưa phải diễn tập trên backup production.
- Bước backup dùng shell bash tường minh để GitHub bật pipefail: lỗi backup hoặc restore không bị lệnh tee che mất.
