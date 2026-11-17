using System.Text;
using System.Text.Json;

namespace Kreoda.Session;

/// <summary>Session call rejected by the relay or the core (carries the
/// wire <c>errorCode</c>: BUSY, NEED_FULL_SNAPSHOT, NOT_FOUND, BAD_PARAMS,
/// TRANSACTION_* …).</summary>
public sealed class SessionException : Exception
{
    public string Code { get; }
    public JsonElement? ErrorDetails { get; }

    public SessionException(string code, string message)
        : this(code, message, null)
    {
    }

    public SessionException(string code, string message, JsonElement? errorDetails)
        : base(message)
    {
        Code = code;
        if (errorDetails is { } details && details.ValueKind is not (JsonValueKind.Undefined or JsonValueKind.Null))
        {
            try
            {
                if (Encoding.UTF8.GetByteCount(details.GetRawText()) <= 65536)
                    ErrorDetails = details.Clone();
            }
            catch (InvalidOperationException)
            {
            }
        }
    }
}
