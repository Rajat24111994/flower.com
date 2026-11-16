namespace FlowerFlow.Domain.Entities;

/// <summary>Bản ghi nhật ký quản trị trong collection <c>adminAudit</c>; các trường chuỗi bị cắt theo giới hạn dưới đây.</summary>
public static class AdminAudit
{
    public const string Collection = "adminAudit";
    public const int ActorUidMaxLength = 128;
    public const int ActorEmailMaxLength = 320;
    public const int ActionMaxLength = 80;
    public const int ResourceTypeMaxLength = 80;
    public const int ResourceIdMaxLength = 128;
}
