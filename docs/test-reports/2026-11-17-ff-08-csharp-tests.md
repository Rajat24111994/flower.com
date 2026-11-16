# FF-08 — Bổ sung kiểm thử C#

Issue #163. Ngày 17/11/2026, Asia/Bangkok; thực hiện sau #162.

## Thay đổi

Thêm `FlowerFlow.Api.Tests` vào solution để host Firebase đang dùng có xUnit riêng:

- 9 tình huống unit owner guard: thiếu/sai/disabled identity, customer, claim string,
  role bị xóa/hạ, lỗi đọc role, Owner hợp lệ; kiểm tra revocation flag và không lộ provider error.
- 9 tình huống pipeline host: 7 nhánh guard qua controller thật, health/local-auth isolation,
  và chặn Origin giả trước thao tác ghi. WebApplicationFactory thay SDK identity boundary;
  không gọi Firebase production. Disabled thực tế còn được chứng minh bởi suite HTTP Emulator.
- 8 tình huống retry: không lặp commit không rõ kết quả, đọc lại sau ABORTED,
  giới hạn số lần, readonly replay và cancellation trước khi bắt đầu.

CI ASP.NET chạy project mới, lưu TRX artifact và trigger khi các test này thay đổi.
Đây là unit/HTTP integration C#, khác với 58 test host in-memory hiện hữu và contract
console; không cộng scenario console vào số test xUnit.

## Kết quả

- Project mới: **26/26 đạt**, 0 bỏ qua.
- Toàn solution: **84/84 xUnit đạt** (26 native API + 58 independent backend), 0 bỏ qua.
- Bộ HTTP/SDK hồi quy cuối: **122/122 đạt**, 0 bỏ qua; được tính riêng với xUnit.
- Contract console C# cùng Firestore Emulator 8787: **exit 0**, gồm auth/login,
  transaction/rollback/expiry, audit, stock, payment/IPN, image và backup.
- TRX local: `artifacts/ff-08` và `artifacts/ff-08-all`.

Lượt đầu có 2 lỗi ở nhánh logger error do Windows EventLog trong test process hạn chế.
Fixture nay dùng Console logger như HTTP harness hiện hữu; không thay response ứng dụng
để làm test đạt. Restore trong sandbox có NU1900 do mạng audit; đã chạy lại restore/test
với quyền mạng và thành công, không tắt NuGet audit.

## Tái chạy

```sh
dotnet test flower.com/FlowerFlow.sln --configuration Release --logger trx --results-directory artifacts/csharp-tests
```

Contract console cần Node và emulator riêng như `.github/workflows/aspnet.yml`.
Không có C# test nào trong project mới chứng minh merchant/IPN thật hoặc storage
production; SDK mock và Emulator được ghi riêng để không suy diễn quá phạm vi.
