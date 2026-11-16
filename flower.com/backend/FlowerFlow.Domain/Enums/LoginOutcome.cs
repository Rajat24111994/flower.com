namespace FlowerFlow.Domain.Enums;

/// <summary>Result of one protected password check, used to update the lockout state.</summary>
public enum LoginOutcome
{
    /// <summary>Correct password: clears the failure history.</summary>
    Success,
    /// <summary>Wrong password: counts as a failure.</summary>
    Invalid,
    /// <summary>Provider outage: releases the lease without counting a failure.</summary>
    Unavailable
}
