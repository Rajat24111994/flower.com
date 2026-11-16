namespace FlowerFlow.Domain.Entities;

/// <summary>One VNPay payment attempt for an order: transaction reference, amount and validity window.</summary>
public sealed record PaymentTransaction(string TxnRef, object? Amount, DateTimeOffset CreatedAt, DateTimeOffset ExpiresAt)
{
    public const string Collection = "paymentTransactions";
}
