## Thay đổi gì và vì sao

<!-- Mô tả ngắn. Sửa lỗi thì ghi cách tái hiện lỗi. -->

## Cách đã kiểm tra

- [ ] Viết test trước và thấy test đỏ (Red → Green → Refactor)
- [ ] `cd flower.com && npm test` đạt
- [ ] `cd tests && npm run integration` đạt (khi đổi API, `firestore.rules` hoặc luồng đơn hàng)
- [ ] Đã thử trên trình duyệt (ghi trang và thao tác):

## Checklist

- [ ] Đã mời một thành viên khác review; trước khi merge cần ít nhất 1 **Approve** trên thay đổi mới nhất và CI xanh
- [ ] Đã giải quyết các thảo luận review; comment góp ý không thay thế approval bắt buộc
- [ ] Nếu thêm thành viên/alias commit: đã cập nhật `docs/TEAM.md` với thông tin được người đó đồng ý công khai
- [ ] Có test cho hành vi mới hoặc lỗi được sửa
- [ ] Đổi `firestore.rules` có test bảo mật đi kèm
- [ ] Đổi file JS/CSS đã tăng `?v=` trong các trang `.html`
- [ ] Không đưa khóa bí mật, mật khẩu hay dữ liệu khách hàng vào code
- [ ] Cần thao tác tay sau khi gộp (ví dụ `npm run setup-firestore`) đã ghi rõ ở trên
