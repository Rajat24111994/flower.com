# Sao lưu và phục hồi dữ liệu FlowerFlow

## Cách sao lưu (miễn phí, không cần gói Blaze)

Sao lưu tự động có sẵn của Firestore (Scheduled Backups) cần gói trả phí Blaze. Dự án dùng cách miễn phí:

- **Tự động mỗi ngày** bằng GitHub Actions (workflow **Sao lưu Firestore**, 01:23 giờ Việt Nam):
  1. xuất toàn bộ Firestore ra file;
  2. mã hóa file bằng AES-256-GCM với mật khẩu riêng của cửa hàng;
  3. lưu file trên GitHub (artifact), **giữ 30 ngày**.
- **Bằng tay** trên máy quản lý: `npm run backup` lưu một bản mã hóa vào thư mục `flower.com/backups/`.

Bản sao lưu gồm mọi collection: sản phẩm, đơn hàng, đánh giá, lời nhắn, danh mục, ưu đãi, `adminRoles`, `orderRequests`… Chỉ bỏ `orderLookupLimits` (bộ đếm chống dò mã đơn, không cần khôi phục).

Không sao lưu được: tài khoản Firebase Authentication (email, mật khẩu) và mã nguồn (mã nguồn đã nằm trên GitHub).

> Repository đang **công khai**, nên file sao lưu **luôn được mã hóa**. Không có mật khẩu thì không ai đọc được, kể cả người tải được file. Ngược lại, **mất mật khẩu thì không mở được bản sao lưu**: hãy cất mật khẩu ở chỗ an toàn ngoài máy tính (ví dụ trình quản lý mật khẩu). Không commit file sao lưu vào Git (`.gitignore` đã chặn).

## Bật sao lưu tự động (làm một lần)

Chủ repository vào GitHub → **Settings → Secrets and variables → Actions → New repository secret**, thêm 2 secret:

| Tên | Giá trị |
| --- | --- |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Nội dung JSON của service account, giống biến cùng tên trên Vercel |
| `BACKUP_PASSPHRASE` | Mật khẩu mã hóa bản sao lưu, ít nhất 12 ký tự, tự đặt và cất kỹ |

Sau đó vào tab **Actions → Sao lưu Firestore → Run workflow** để chạy thử. Chỉ coi sao lưu là đã bật khi lần chạy đó **xanh** và cuối trang có file `firestore-backup-…`. Thiếu secret thì workflow báo đỏ và ghi rõ còn thiếu secret nào.

## Sao lưu bằng tay trên máy

Trong thư mục `flower.com`, đăng nhập Google Cloud một lần (`gcloud auth application-default login`), rồi chạy trên PowerShell:

```powershell
$env:BACKUP_PASSPHRASE = "mật-khẩu-sao-lưu"
npm run backup
```

File mới nằm trong `flower.com/backups/`.

## Phục hồi khi có sự cố

1. Ghi lại thời điểm sự cố và tạm dừng các thao tác quản trị có thể ghi đè dữ liệu.
2. Lấy bản sao lưu gần nhất **trước** thời điểm dữ liệu hỏng: trên GitHub vào **Actions → Sao lưu Firestore**, mở lần chạy phù hợp, tải file `firestore-backup-…` về rồi giải nén. Hoặc dùng file trong `flower.com/backups/`.
3. Xem trước nội dung (lệnh này **chưa ghi gì** vào Firestore):

   ```powershell
   $env:BACKUP_PASSPHRASE = "mật-khẩu-sao-lưu"
   npm run restore -- "đường-dẫn\flowerflow-....json.enc"
   ```

   Lệnh in ra thời điểm sao lưu và số bản ghi của từng collection. Kiểm tra cho đúng.
4. Khôi phục thật:

   ```powershell
   npm run restore -- "đường-dẫn\flowerflow-....json.enc" --dong-y
   ```

   - Mọi bản ghi trong file được ghi lại: tạo mới nếu mất, ghi đè nếu đã có.
   - Bản ghi phát sinh **sau** lúc sao lưu (không có trong file) được **giữ nguyên**, không bị xóa.
5. Mở trang admin, bấm Ctrl + F5, kiểm tra đơn hàng, sản phẩm, đánh giá. Ghi lại bản sao lưu đã dùng và kết quả.

## Diễn tập phục hồi

Mỗi quý, chạy bước 3 với một bản sao lưu gần đây để chắc chắn mật khẩu còn đúng và file mở được. Muốn diễn tập cả bước 4 thì làm trên Firebase Emulator, **không** làm trên dữ liệu thật. Test tự động `tests/integration/backup.test.js` cũng diễn tập toàn bộ vòng sao lưu → mất dữ liệu → khôi phục trên emulator mỗi lần CI chạy.

## Tùy chọn khi có gói Blaze

Nếu sau này bật gói trả phí Blaze, có thể bật thêm Firestore Scheduled Backups bằng `./scripts/setup-firestore-backup.ps1`. Bản sao lưu loại này lưu trên Google Cloud và khôi phục bằng `gcloud firestore databases restore`. Cách miễn phí ở trên vẫn dùng được song song.
