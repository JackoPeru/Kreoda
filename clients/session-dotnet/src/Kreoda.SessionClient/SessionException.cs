namespace Kreoda.Session;

/// <summary>Session call rejected by the relay or the core (carries the
/// wire <c>errorCode</c>: BUSY, NEED_FULL_SNAPSHOT, NOT_FOUND, BAD_PARAMS,
/// TRANSACTION_* …).</summary>
public sealed class SessionException : Exception
{
    public string Code { get; }

    public SessionException(string code, string message)
        : base(message)
    {
        Code = code;
    }
}
