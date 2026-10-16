using System.Text.Json;
using Kreoda.Session;

namespace Kreoda.HermesBridge;

public sealed record CadDeviceConfiguration(string SessionUrl, string DeviceId, string Credential, string LogicalClientId);

/// <summary>One private authenticated MCP device; credentials never enter tool descriptions.</summary>
public sealed class PrivateCadConnection(string file, string? sessionUrl, string? pairingCode)
{
    static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    public async Task<SessionClient> ConnectAsync(CancellationToken ct)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);timeout.CancelAfter(TimeSpan.FromSeconds(15));
        if (File.Exists(file)) {
            var config = JsonSerializer.Deserialize<CadDeviceConfiguration>(await File.ReadAllTextAsync(file, timeout.Token), JsonOptions)
                ?? throw new SessionException("NOT_CONNECTED", "Private CAD configuration unavailable");
            return await SessionClient.ConnectDeviceAsync(new Uri(config.SessionUrl), config.DeviceId, config.Credential, "agent", timeout.Token, config.LogicalClientId);
        }
        if (string.IsNullOrWhiteSpace(sessionUrl) || string.IsNullOrWhiteSpace(pairingCode))
            throw new SessionException("NOT_CONNECTED", "CAD pairing has not been prepared by the PC");
        var logical = "client-" + Guid.NewGuid().ToString("D");
        var pair = await SessionClient.PairAsync(new Uri(sessionUrl), pairingCode, "Hermes Kreoda MCP", "agent", timeout.Token, logical);
        try {
            await SaveAsync(file, new CadDeviceConfiguration(sessionUrl, pair.DeviceId, pair.Credential, logical));
            return pair.Client;
        } catch { await pair.Client.DisposeAsync();throw; }
    }
    internal static async Task SaveAsync<T>(string file, T value)
    {
        if (!Path.IsPathFullyQualified(file)) throw new ArgumentException("Private configuration requires an absolute path");
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        var temporary = file + ".new-" + Guid.NewGuid().ToString("N");
        try {
            await File.WriteAllTextAsync(temporary, JsonSerializer.Serialize(value, JsonOptions));
            File.Move(temporary, file, overwrite: true);
        } finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
}
