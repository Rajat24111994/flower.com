# FlowerFlow

FlowerFlow là website cửa hàng hoa tĩnh, xây dựng bằng HTML, CSS và JavaScript thuần. Mã nguồn website nằm trong [`flower.com/`](flower.com/); xem [`flower.com/README.md`](flower.com/README.md) để biết cách chạy, cấu hình Firebase và các giới hạn hiện tại.

## Chạy website

1. Cài Python 3 hoặc dùng máy chủ HTTP tĩnh tương đương.
2. Mở terminal tại thư mục `flower.com` và chạy `python -m http.server 8000`.
3. Mở <http://localhost:8000> trong trình duyệt.

Không mở trang trực tiếp bằng `file://`, vì website tải catalog JSON bằng `fetch`.

## Kiểm thử

Cần Node.js 24 trở lên. Tại `flower.com`, chạy:

```sh
npm test
```

Sáu bộ kiểm thử dùng API có sẵn của Node.js, không cần cài dependencies.

## Phạm vi repository

Các thư mục `core/`, `homepage/`, `inventory/` và `transactions/` cùng `manage.py`/`requirements.txt` là ứng dụng Django quản lý kho cũ, tách biệt với website FlowerFlow và không thuộc release này. App `shop/` bổ sung cơ sở dữ liệu cho cửa hàng trực tuyến (xem [`DATABASE.md`](DATABASE.md)). Để chạy ứng dụng cũ, cần đặt `DJANGO_SECRET_KEY`; `DJANGO_DEBUG` mặc định tắt và danh sách host đọc từ `DJANGO_ALLOWED_HOSTS`.

## Phát hành

Xem [`RELEASE_NOTES_v0.1.0.md`](RELEASE_NOTES_v0.1.0.md) để biết tính năng và giới hạn của bản phát hành.
