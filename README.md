# FlowerFlow

FlowerFlow là website cửa hàng hoa tĩnh, xây dựng bằng HTML, CSS và JavaScript thuần. Mã nguồn website nằm trong [`flower.com/`](flower.com/); xem [`flower.com/README.md`](flower.com/README.md) để biết cách chạy, cấu hình Firebase và các giới hạn hiện tại.

## Chạy website

1. Cài Python 3 hoặc dùng máy chủ HTTP tĩnh tương đương.
2. Mở terminal tại thư mục `flower.com` và chạy `python -m http.server 8000`.
3. Mở <https://flower-com-six.vercel.app/owner.html> trong trình duyệt.

Không mở trang trực tiếp bằng `file://`, vì website tải catalog JSON bằng `fetch`.

## Kiểm thử

Cần Node.js 24 trở lên. Tại `flower.com`, chạy:

```sh
npm test
```

Sáu bộ kiểm thử dùng API có sẵn của Node.js, không cần cài dependencies.

## Phạm vi repository

Repository chỉ chứa website FlowerFlow (`flower.com/`) và bộ kiểm thử (`tests/`). Ứng dụng Django quản lý kho cũ đã được tách sang nhánh `django-backend`. Hướng dẫn cấu hình trang quản trị trên Vercel nằm trong [`ADMIN-SETUP.md`](ADMIN-SETUP.md).

## Phát hành

Xem [`RELEASE_NOTES_v0.1.0.md`](RELEASE_NOTES_v0.1.0.md) để biết tính năng và giới hạn của bản phát hành.
