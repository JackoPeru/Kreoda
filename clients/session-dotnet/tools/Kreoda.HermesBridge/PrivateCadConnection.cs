using System.Text.Json;
using System.Net;
using Kreoda.Session;

namespace Kreoda.HermesBridge;

public sealed record CadDeviceConfiguration(string SessionUrl, string DeviceId, string Credential, string LogicalClientId,
    string? PcId = null, string? BootstrapUrl = null, string? InstallationId = null);

/// <summary>One private authenticated MCP device; credentials never enter tool descriptions.</summary>
public sealed class PrivateCadConnection(string file, string? sessionUrl, string? pairingCode,
    IPEndPoint? discoveryTarget = null, string? preferredPcId = null)
{
    static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    readonly SemaphoreSlim _connect = new(1, 1);
    sealed record PendingEnrollment(string PcId, string Credential, string LogicalClientId, string InstallationId, string? DeviceId = null);
    public async Task<SessionClient> ConnectAsync(CancellationToken ct)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);timeout.CancelAfter(TimeSpan.FromSeconds(15));
        await _connect.WaitAsync(timeout.Token);
        try {
            if (!Path.IsPathFullyQualified(file)) throw new ArgumentException("Private configuration requires an absolute path");
            if (discoveryTarget != null && !IPAddress.IsLoopback(discoveryTarget.Address))
                throw new ArgumentException("Fixture discovery target must be loopback");
            if (preferredPcId != null && !Guid.TryParseExact(preferredPcId, "D", out _)) throw InvalidConfiguration();
            return await ConnectCore(timeout.Token);
        } finally { _connect.Release(); }
    }

    async Task<SessionClient> ConnectCore(CancellationToken ct)
    {
        if (File.Exists(file)) {
            var config = await ReadAsync<CadDeviceConfiguration>(file, ct);
            Validate(config);
            if (preferredPcId != null && config.PcId != null && preferredPcId != config.PcId) throw InvalidConfiguration();
            var pinned = config.PcId ?? preferredPcId;
            var peers = await SessionDiscovery.FindAsync(ct, discoveryTarget);
            var candidates = peers.Where(pc => pinned == null || pc.PcId == pinned).ToList();
            if (config.PcId != null && config.BootstrapUrl != null)
                candidates.Add(new(config.PcId, "Saved PC", new Uri(config.SessionUrl), new Uri(config.BootstrapUrl)));
            var proven = await Task.WhenAll(candidates.DistinctBy(pc => (pc.PcId, pc.Endpoint, pc.Bootstrap))
                .Select(async pc => await Prove(pc, config.DeviceId, config.Credential, ct) ? pc : null));
            ct.ThrowIfCancellationRequested();
            var verified = proven.Where(pc => pc != null).Select(pc => pc!).ToArray();
            if (verified.Select(pc => pc.PcId).Distinct().Count() > 1)
                throw new SessionException("CHOOSE_PC", "More than one PC proved the configured device");
            if (verified.FirstOrDefault() is { } current)
                return await Activate(config with { SessionUrl = current.Endpoint.AbsoluteUri,
                    BootstrapUrl = current.Bootstrap.AbsoluteUri, PcId = current.PcId }, ct);
            // An explicitly saved legacy endpoint remains usable when discovery is unavailable.
            // Known PCs always require identity proof before sending their reusable credential.
            if (config.PcId == null && preferredPcId == null && peers.Length == 0)
                return await Activate(config, ct);
            throw new SessionException("NOT_CONNECTED", "Configured PC is unavailable or could not prove its identity");
        }
        if (!string.IsNullOrWhiteSpace(sessionUrl) && !string.IsNullOrWhiteSpace(pairingCode)) {
            ValidateEndpoint(sessionUrl, false);
            var logical = "client-" + Guid.NewGuid().ToString("D");
            var pair = await SessionClient.PairAsync(new Uri(sessionUrl), pairingCode, "Hermes Kreoda MCP", "agent", ct, logical);
            return await Commit(pair.Client, new(sessionUrl, pair.DeviceId, pair.Credential, logical), ct);
        }

        var pendingFile = file + ".pending.json";
        var pending = File.Exists(pendingFile) ? await ReadAsync<PendingEnrollment>(pendingFile, ct) : null;
        if (pending != null) {
            if (!Guid.TryParseExact(pending.PcId, "D", out _) || !Guid.TryParseExact(pending.InstallationId, "D", out _) ||
                !ValidSecret(pending.Credential) || !ValidId(pending.LogicalClientId, "client-") ||
                (pending.DeviceId != null && !ValidId(pending.DeviceId, "device-")) ||
                (preferredPcId != null && pending.PcId != preferredPcId)) throw InvalidConfiguration();
        }
        var found = await SessionDiscovery.FindAsync(ct, discoveryTarget);
        var pc = SessionDiscovery.Choose(found, pending?.PcId ?? preferredPcId)
            ?? throw new SessionException(found.Length > 1 && pending == null && preferredPcId == null ? "CHOOSE_PC" : "NOT_CONNECTED",
                "No unique configured PC is available on the local network");
        if (pending == null) {
            pending = new(pc.PcId, SessionDiscovery.CreateCredential(), "client-" + Guid.NewGuid().ToString("D"), Guid.NewGuid().ToString("D"));
            await SaveAsync(pendingFile, pending, ct);
        }
        if (pending.DeviceId == null) {
            var device = await SessionDiscovery.PairAsync(pc, pending.InstallationId, pending.Credential, ct,
                discoveryTarget != null, "Hermes Kreoda MCP");
            pending = pending with { DeviceId = device };
            await SaveAsync(pendingFile, pending, ct);
        }
        if (!await Prove(pc, pending.DeviceId, pending.Credential, ct))
            throw new SessionException("UNAUTHORIZED", "Enrolled PC could not prove its identity");
        var client = await Activate(new(pc.Endpoint.AbsoluteUri, pending.DeviceId, pending.Credential,
            pending.LogicalClientId, pc.PcId, pc.Bootstrap.AbsoluteUri, pending.InstallationId), ct);
        // The active file is already committed. A leftover pending file cannot replace it.
        try { File.Delete(pendingFile); } catch (IOException) { } catch (UnauthorizedAccessException) { }
        return client;
    }

    async Task<bool> Prove(DiscoveredSessionPc pc, string deviceId, string credential, CancellationToken ct)
    {
        using var proof = CancellationTokenSource.CreateLinkedTokenSource(ct);proof.CancelAfter(TimeSpan.FromSeconds(2));
        try { return await SessionDiscovery.VerifyKnownDeviceAsync(pc, deviceId, credential, proof.Token, discoveryTarget != null); }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested) { return false; }
    }
    async Task<SessionClient> Activate(CadDeviceConfiguration config, CancellationToken ct)
    {
        var client = await SessionClient.ConnectDeviceAsync(new Uri(config.SessionUrl), config.DeviceId, config.Credential,
            "agent", ct, config.LogicalClientId);
        return await Commit(client, config, ct);
    }
    async Task<SessionClient> Commit(SessionClient client, CadDeviceConfiguration config, CancellationToken ct)
    {
        try {
            if (!client.IsConnected || client.Model == null) throw new SessionException("NEED_FULL_SNAPSHOT", "CAD snapshot is unavailable");
            await SaveAsync(file, config, ct);
            return client;
        } catch { await client.DisposeAsync();throw; }
    }
    static async Task<T> ReadAsync<T>(string path, CancellationToken ct)
    {
        await using var stream = File.OpenRead(path);
        if (stream.Length > 65536) throw InvalidConfiguration();
        // Fixed-size read also bounds a file extended after it was opened.
        var bytes = new byte[65537];var count = 0;
        while (count < bytes.Length) {
            var read = await stream.ReadAsync(bytes.AsMemory(count), ct);
            if (read == 0) break;count += read;
        }
        if (count > 65536) throw InvalidConfiguration();
        try { return JsonSerializer.Deserialize<T>(bytes.AsSpan(0, count), JsonOptions) ?? throw InvalidConfiguration(); }
        catch (JsonException) { throw InvalidConfiguration(); }
    }
    static void Validate(CadDeviceConfiguration config)
    {
        ValidateEndpoint(config.SessionUrl, false);
        if (!ValidId(config.DeviceId, "device-") || !ValidId(config.LogicalClientId, "client-") || !ValidSecret(config.Credential) ||
            (config.PcId != null && !Guid.TryParseExact(config.PcId, "D", out _)) ||
            (config.InstallationId != null && !Guid.TryParseExact(config.InstallationId, "D", out _))) throw InvalidConfiguration();
        if (config.BootstrapUrl != null) {
            ValidateEndpoint(config.BootstrapUrl, true);
            if (config.PcId == null || new Uri(config.SessionUrl).Host != new Uri(config.BootstrapUrl).Host) throw InvalidConfiguration();
        }
    }
    static void ValidateEndpoint(string value, bool bootstrap)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) ||
            !(bootstrap ? uri.Scheme == "http" : uri.Scheme is "ws" or "wss") ||
            !IPAddress.TryParse(uri.Host, out var ip) || !SessionDiscovery.IsPrivate(ip, true) ||
            uri.UserInfo.Length != 0 || uri.Query.Length != 0 || uri.Fragment.Length != 0 ||
            uri.AbsolutePath != (bootstrap ? "/pair" : "/")) throw InvalidConfiguration();
    }
    static bool ValidId(string? value, string prefix) => value != null && value.StartsWith(prefix, StringComparison.Ordinal) &&
        Guid.TryParseExact(value.Substring(prefix.Length), "D", out _);
    static bool ValidSecret(string? value) => value is { Length: 43 } && value.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_');
    static SessionException InvalidConfiguration() => new("BAD_PARAMS", "Invalid private CAD configuration");

    internal static async Task SaveAsync<T>(string file, T value, CancellationToken ct = default)
    {
        if (!Path.IsPathFullyQualified(file)) throw new ArgumentException("Private configuration requires an absolute path");
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        var temporary = file + ".new-" + Guid.NewGuid().ToString("N");
        try {
            await File.WriteAllTextAsync(temporary, JsonSerializer.Serialize(value, JsonOptions), ct);
            ct.ThrowIfCancellationRequested();
            File.Move(temporary, file, overwrite: true);
        } finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
}
