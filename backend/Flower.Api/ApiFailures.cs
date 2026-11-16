namespace Flower.Api;

public static class ApiFailures
{
    public static (string Code, string Message) For(HttpContext context) => context.Request.Path.Value switch
    {
        "/api/products" => ("product-service-unavailable", "Máy chủ chưa đọc được kho sản phẩm. Vui lòng thử lại sau."),
        "/api/flower-prices" => ("price-service-unavailable", "Chưa thể tải hoặc cập nhật giá hoa. Vui lòng thử lại."),
        "/api/bouquet-wrapping" => ("bouquet-wrapping-unavailable", context.Request.Method == "GET" ? "Chưa thể tải cấu hình phí bó hoa." : "Chưa thể lưu cấu hình phí bó hoa. Vui lòng thử lại."),
        "/api/delivery-zones" => ("delivery-zone-service-unavailable", context.Request.Method == "GET" ? "Chưa thể tải khu vực giao hàng." : "Chưa thể lưu khu vực giao hàng. Vui lòng thử lại."),
        "/api/design-requests" => ("design-request-unavailable", context.Request.Method == "GET" ? context.Request.Query["manage"] == "1" ? "Chưa thể tải danh sách yêu cầu thiết kế." : "Chưa thể tra cứu yêu cầu thiết kế." : context.Items["api-action"] as string == "respond" ? "Chưa thể cập nhật phản hồi. Vui lòng thử lại." : context.Items["api-action"] as string == "admin-update" ? "Chưa thể cập nhật yêu cầu thiết kế." : "Chưa thể lưu yêu cầu thiết kế. Vui lòng thử lại."),
        "/api/product-images" => ("photo-unavailable", "Chưa xử lý được ảnh. Hãy thử lại."),
        "/api/review-images" => ("photo-unavailable", "Chưa tải được ảnh. Hãy thử lại."),
        "/api/payments" => ("payment-service-unavailable", context.Request.Method == "GET" ? "Chưa thể kiểm tra trạng thái thanh toán." : "Chưa thể tạo liên kết thanh toán. Vui lòng thử lại sau."),
        "/api/orders" => OrderFailure(context),
        _ => ("admin-api-unavailable", "API quản trị tạm thời không khả dụng.")
    };
    private static (string Code, string Message) OrderFailure(HttpContext context) => (context.Items["api-action"] as string ?? context.Request.Query["action"].ToString()) switch
    {
        "quote" => ("order-service-unavailable", "Chưa thể kiểm tra giá đơn hàng. Vui lòng thử lại sau."),
        "lookup" => ("order-service-unavailable", "Chưa thể tra cứu đơn hàng. Vui lòng thử lại sau."),
        "expire" => ("order-service-unavailable", "Chưa thể giải phóng tồn kho đơn hết hạn."),
        "payment-audit" => ("payment-audit-unavailable", "Chưa thể tải lịch sử đối soát. Vui lòng thử lại."),
        "verify-qr-payment" or "record-late-qr-payment" => ("payment-reconciliation-unavailable", "Chưa thể ghi nhận đối soát. Vui lòng thử lại."),
        "record-payment-refund" => ("payment-refund-unavailable", "Chưa thể ghi nhận hoàn tiền. Vui lòng thử lại."),
        "review" => ("review-service-unavailable", "Chưa thể gửi đánh giá. Vui lòng thử lại sau."),
        "review-get" => ("review-unavailable", "Chưa tải được đánh giá. Hãy thử lại."),
        _ => ("order-service-unavailable", "Chưa thể xác nhận đơn hàng. Vui lòng thử lại sau.")
    };
}
