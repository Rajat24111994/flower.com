# Sao lưu và phục hồi dữ liệu FlowerFlow

## Cách sao lưu (miễn phí, không cần gói Blaze)

Sao lưu tự động có sẵn của Firestore (Scheduled Backups) cần gói trả phí Blaze. Dự án dùng cách miễn phí:

- **Tự động mỗi ngày** bằng GitHub Actions (workflow **Sao lưu Firestore**, 01:23 giờ Việt Nam):
  1. xuất toàn bộ Firestore ra file;
  2. mã hóa file bằng AES-256-GCM với mật khẩu riêng của cửa hàng;
  3. lưu file trên GitHub (artifact), **giữ 30 ngày**.
- **Bằng tay** trên máy quản lý: `npm run backup` lưu một bản mã hóa vào thư mục `flower.com/backups/`.

Bản sao lưu gồm collection gốc và subcollection đệ quy, kể cả subcollection dưới document cha đã xóa: sản phẩm, đơn hàng, đánh giá, lời nhắn, danh mục, ưu đãi, `adminRoles`, `orderRequests`… Chỉ bỏ cây `orderLookupLimits` cấp gốc (bộ đếm chống dò mã đơn, không cần khôi phục). Format v1 lưu collection con bằng đường dẫn đầy đủ, ví dụ `orders/order-id/events`, vẫn đọc được archive phẳng cũ.

Không sao lưu được: tài khoản Firebase Authentication (email, mật khẩu) và mã nguồn (mã nguồn đã nằm trên GitHub).

> Repository đang **công khai**, nên file sao lưu **luôn được mã hóa**. Không có mật khẩu thì không ai đọc được, kể cả người tải được file. Ngược lại, **mất mật khẩu thì không mở được bản sao lưu**: hãy cất mật khẩu ở chỗ an toàn ngoài máy tính (ví dụ trình quản lý mật khẩu). Không commit file sao lưu vào Git (`.gitignore` đã chặn).

## Bật sao lưu tự động (làm một lần)

Chủ repository vào GitHub → **Settings → Secrets and variables → Actions → New repository secret**, thêm 2 secret:

| Tên | Giá trị |
| --- | --- |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Service account của project cần sao lưu, đặt qua secret manager; không lấy từ source hoặc gửi qua chat |
| `BACKUP_PASSPHRASE` | Mật khẩu mã hóa bản sao lưu, ít nhất 12 ký tự, tự đặt và cất kỹ |

Sau đó vào tab **Actions → Sao lưu Firestore → Run workflow** để chạy thử. Chỉ coi sao lưu là đã bật khi lần chạy đó **xanh** và cuối trang có file `firestore-backup-…`. Thiếu secret thì workflow báo đỏ và ghi rõ còn thiếu secret nào.

## Sao lưu bằng tay trên máy

Trong thư mục `flower.com`, đăng nhập Google Cloud một lần (`gcloud auth application-default login`). Không lưu `BACKUP_PASSPHRASE` trong `.env` vì file này là văn bản thuần. Nhập mật khẩu ẩn vào biến môi trường của phiên PowerShell, chạy lệnh, rồi xóa biến:

```powershell
$secure = Read-Host "BACKUP_PASSPHRASE" -AsSecureString
$pointer = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $env:BACKUP_PASSPHRASE = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    npm run backup
}
finally {
    Remove-Item Env:BACKUP_PASSPHRASE -ErrorAction SilentlyContinue
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    $secure.Dispose()
}
```

File mới nằm trong `flower.com/backups/`.

## Phục hồi khi có sự cố

1. Ghi lại thời điểm sự cố và tạm dừng các thao tác quản trị có thể ghi đè dữ liệu.
2. Lấy bản sao lưu gần nhất **trước** thời điểm dữ liệu hỏng: trên GitHub vào **Actions → Sao lưu Firestore**, mở lần chạy phù hợp, tải file `firestore-backup-…` về rồi giải nén. Hoặc dùng file trong `flower.com/backups/`.
3. Xem trước nội dung (lệnh này **chưa ghi gì** vào Firestore):

   Nhập lại passphrase vào biến môi trường ẩn như trên, thay `npm run backup` bằng lệnh restore:

   ```powershell
   $secure = Read-Host "BACKUP_PASSPHRASE" -AsSecureString
   $pointer = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
   try {
       $env:BACKUP_PASSPHRASE = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
       npm run restore -- "đường-dẫn\flowerflow-....json.enc"
   }
   finally {
       Remove-Item Env:BACKUP_PASSPHRASE -ErrorAction SilentlyContinue
       [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
       $secure.Dispose()
   }
   ```

   Lệnh in ra thời điểm sao lưu và số bản ghi của từng collection. Kiểm tra cho đúng.
4. Khôi phục thật:

   ```powershell
   npm run restore -- "đường-dẫn\flowerflow-....json.enc" --dong-y --project "project-id-dich-da-xac-nhan"
   ```

   - Mọi bản ghi trong file được ghi lại: tạo mới nếu mất, ghi đè nếu đã có.
   - Bản ghi phát sinh **sau** lúc sao lưu (không có trong file) được **giữ nguyên**, không bị xóa.
   - `--project` bắt buộc khi ghi và phải khớp project trong cấu hình Firestore/credential. Lệnh từ chối trước khi ghi nếu thiếu hoặc không khớp. Có thể cố ý restore sang project staging đã cấu hình, nhưng cần đối chiếu project nguồn được in trong preview.
5. Mở trang admin, bấm Ctrl + F5, kiểm tra đơn hàng, sản phẩm, đánh giá. Ghi lại bản sao lưu đã dùng và kết quả.

## Diễn tập phục hồi

Mỗi quý, chạy bước 3 với một bản sao lưu gần đây để chắc chắn mật khẩu còn đúng và file mở được. Muốn diễn tập cả bước 4 thì làm trên Firebase Emulator, **không** làm trên dữ liệu thật. Test tự động `flower.com/tests/IntegrationTests/backup.test.js` cũng diễn tập toàn bộ vòng sao lưu → mất dữ liệu → khôi phục trên emulator mỗi lần CI chạy.

Preview không cần credential và không kết nối Firestore; nó chỉ giải mã, kiểm tra cấu trúc và đếm document. Bài diễn tập còn kiểm tra 400+ document, subcollection, cha bị thiếu, giữ document ngoài archive, sai mật khẩu/file sửa, và CLI với project đích sai.
Log/preview gộp số document theo collection gốc, gồm cả collection con; không in ID document cha trong đường dẫn subcollection lên workflow công khai. Archive mã hóa vẫn lưu đường dẫn đầy đủ để restore đúng vị trí.

## Giới hạn và trạng thái vận hành

- Ngày 17/11/2026: repository chưa có hai secret backup; các lượt theo lịch gần nhất thất bại ở preflight. **Chưa có bằng chứng backup production tự động đang hoạt động.** Phần cấu hình và theo dõi lịch thật tiếp tục ở issue #118; báo cáo kiểm thử #165 ghi riêng kết quả Emulator.
- Export duyệt nhiều collection, không phải snapshot toàn database tại cùng một thời điểm. Tạm dừng các thao tác ghi quan trọng trong maintenance window nếu cần khôi phục nhất quán kho/đơn/thanh toán.
- Import chia batch 400; mỗi batch nguyên tử, toàn archive không phải một transaction. Lỗi mạng/quyền giữa chừng có thể để lại bản restore một phần; dừng ứng dụng, xử lý nguyên nhân rồi chạy lại cùng archive. Không tự replay callback thanh toán.
- Restore giữ document ngoài archive: phải đối soát các đơn/giao dịch phát sinh sau thời điểm backup với tồn kho cũ trước khi mở ghi lại.
- Không bao gồm Firebase Auth, file Cloud Storage, Rules, indexes, IAM hay secret. DocumentReference được phục hồi theo đường dẫn trong project đích; timestamp v1 giữ độ chính xác mili giây. Không coi test Timestamp mili giây là bằng chứng bảo toàn nano giây hoặc mọi kiểu dữ liệu Firestore.
- Duyệt subcollection tăng số lần gọi/read và thời gian theo kích thước dữ liệu. Bộ dữ liệu test không chứng minh workflow 15 phút phù hợp mọi quy mô; cần đo lại trên staging đại diện.

## Tùy chọn khi có gói Blaze

Nếu sau này bật gói trả phí Blaze, có thể bật thêm Firestore Scheduled Backups bằng `./scripts/setup-firestore-backup.ps1`. Bản sao lưu loại này lưu trên Google Cloud và khôi phục bằng `gcloud firestore databases restore`. Cách miễn phí ở trên vẫn dùng được song song.
