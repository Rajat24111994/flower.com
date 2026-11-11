# Bảo vệ nhánh main — issue #127

## Cấu hình

File [main-branch-protection.json](../.github/main-branch-protection.json) yêu cầu PR, một approval, review từ Code Owner, hủy approval cũ khi thay đổi code, approval của người khác sau lần push mới nhất, giải quyết thảo luận và cả bốn job CI xanh (unit, integration, trình duyệt và **Critical module coverage** được thêm ở #125). Áp dụng cả với admin; cấm force push và xóa nhánh. Tên status check lấy từ `.github/workflows/ci.yml`.

Comment review cần có góp ý thực chất từ thành viên khác; comment không thỏa điều kiện một approval của branch protection. GitHub không tự đánh giá chất lượng góp ý, nên reviewer vẫn phải kiểm tra theo `CONTRIBUTING.md`.

## Áp dụng trên GitHub

Cần GitHub CLI đã đăng nhập bằng tài khoản có quyền quản trị repo. Chạy từ thư mục gốc repository:

```sh
gh api --method PUT repos/Longg5048/flower.com/branches/main/protection --input .github/main-branch-protection.json
gh api repos/Longg5048/flower.com/branches/main/protection
```

Trước khi PUT, đọc cấu hình hiện tại bằng lệnh GET ở trên và giữ lại mọi hạn chế bổ sung nếu repo đã có quy định chặt hơn. PUT thay thế cấu hình branch protection của nhánh. Nếu repo dùng ruleset, kiểm tra cả Settings → Rules → Rulesets để không bỏ sót quy tắc đang áp dụng.

Nếu thao tác bằng giao diện, vào Settings → Branches → Branch protection rule cho `main`, chọn các điều kiện tương ứng với file JSON. Nếu GitHub yêu cầu nâng gói cho loại repo hiện tại, quản trị viên cần xử lý trước khi có thể bật bảo vệ.

`.github/CODEOWNERS` hiện chỉ định `Longg5048`. PR do chính tài khoản này mở cần một Code Owner khác có quyền write đã đồng ý nhận trách nhiệm để đáp ứng quy tắc; cập nhật CODEOWNERS sau khi xác nhận, không dùng tài khoản phụ để tự duyệt.

## Kiểm tra hoàn thành

- GET protection trả về các điều kiện trong file JSON; không coi việc commit file cấu hình là đã bật bảo vệ.
- Trên PR thật tiếp theo, kiểm tra merge bị chặn khi thiếu approval hoặc một trong bốn check chưa xanh; không merge thử chỉ để kiểm tra.
- Có review của thành viên khác, ít nhất một approval hợp lệ trên thay đổi mới nhất và mọi thảo luận đã giải quyết trước khi merge.
- Hoàn thành đối chiếu danh tính trong [TEAM.md](TEAM.md).

Trong phiên thực hiện issue #127, API đọc protection trả HTTP 401 do chưa có xác thực quản trị. Vì vậy chưa xác minh hoặc thay đổi được bảo vệ nhánh từ phiên này.
