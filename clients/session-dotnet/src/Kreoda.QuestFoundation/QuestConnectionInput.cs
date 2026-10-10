using System.Net;
using System.Net.Sockets;

namespace Kreoda.QuestFoundation;

public static class QuestConnectionInput
{
    public static bool TryEndpoint(string? text, out Uri? endpoint)
    {
        endpoint = null;
        if (string.IsNullOrWhiteSpace(text) || text.Length > 2048 ||
            !Uri.TryCreate(text.Trim(), UriKind.Absolute, out var candidate) ||
            candidate.Scheme != "ws" || candidate.Host.Split('.').Length != 4 ||
            candidate.UserInfo.Length != 0 || candidate.Query.Length != 0 || candidate.Fragment.Length != 0 ||
            candidate.AbsolutePath != "/" ||
            !IPAddress.TryParse(candidate.Host, out var address) || address.AddressFamily != AddressFamily.InterNetwork)
            return false;
        var bytes = address.GetAddressBytes();
        if (!(bytes[0] == 10 || (bytes[0] == 172 && bytes[1] >= 16 && bytes[1] <= 31) ||
            (bytes[0] == 192 && bytes[1] == 168))) return false;
        endpoint = candidate;
        return true;
    }

    public static bool TryPairingCode(string? text, out string? code)
    {
        code = null;
        if (text is null || text.Length > 128) return false;
        var normalized = new string(text.Where(ch => !char.IsWhiteSpace(ch)).ToArray());
        if (normalized.Length != 8 || normalized.Any(ch => ch < '0' || ch > '9')) return false;
        code = normalized;
        return true;
    }
}
