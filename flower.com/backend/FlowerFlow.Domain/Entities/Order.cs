namespace FlowerFlow.Domain.Entities;

/// <summary>Đơn hàng trong collection <c>orders</c>. Trạng thái được lưu nguyên văn tiếng Việt như giao diện hiển thị.</summary>
public static class Order
{
    public const string Collection = "orders";

    public static class Status
    {
        public const string Pending = "Chờ xác nhận";
        public const string Delivered = "Đã giao";
        public const string Cancelled = "Đã hủy";
    }
}
