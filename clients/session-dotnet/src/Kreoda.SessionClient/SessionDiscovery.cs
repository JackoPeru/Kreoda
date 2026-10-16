using System.Net;
using System.Net.Http;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Kreoda.Session;

public sealed record DiscoveredSessionPc(string PcId, string Name, Uri Endpoint, Uri Bootstrap);

/// <summary>Native LAN discovery. No credentials in broadcasts and no advertised host is trusted.</summary>
public static class SessionDiscovery
{
    public const int Port = 9843;
    public static string CreateCredential()
    {
        using var random = RandomNumberGenerator.Create();
        var bytes = new byte[32];random.GetBytes(bytes);
        return Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }
    public static bool IsPrivate(IPAddress address, bool allowLoopback = false)
    {
        if (address.AddressFamily != AddressFamily.InterNetwork) return false;
        var bytes = address.GetAddressBytes();
        return (allowLoopback && bytes[0] == 127) || bytes[0] == 10 ||
            (bytes[0] == 172 && bytes[1] >= 16 && bytes[1] <= 31) || (bytes[0] == 192 && bytes[1] == 168);
    }
    public static DiscoveredSessionPc? Decode(byte[] packet, IPEndPoint peer, string nonce, bool allowLoopback = false)
    {
        if (packet.Length > 4096 || !IsPrivate(peer.Address, allowLoopback)) return null;
        try
        {
            using var json = JsonDocument.Parse(packet);
            var value = json.RootElement;
            if (value.GetProperty("protocol").GetString() != "kreoda-discovery" || value.GetProperty("version").GetInt32() != 1 ||
                value.GetProperty("nonce").GetString() != nonce) return null;
            var id = value.GetProperty("pcId").GetString();
            var name = value.GetProperty("name").GetString();
            var session = value.GetProperty("sessionPort").GetInt32();
            var bootstrap = value.GetProperty("bootstrapPort").GetInt32();
            if (!Guid.TryParseExact(id, "D", out _) || string.IsNullOrWhiteSpace(name) || name!.Length > 80 ||
                name.Any(char.IsControl) || session < 1 || session > 65535 || bootstrap < 1 || bootstrap > 65535) return null;
            return new DiscoveredSessionPc(id!, name, new Uri($"ws://{peer.Address}:{session}"), new Uri($"http://{peer.Address}:{bootstrap}/pair"));
        }
        catch (Exception error) when (error is JsonException || error is InvalidOperationException || error is KeyNotFoundException || error is FormatException)
        { return null; }
    }
    public static DiscoveredSessionPc? Choose(IReadOnlyList<DiscoveredSessionPc> peers, string? preferredPcId)
    {
        var unique = peers.GroupBy(peer => peer.PcId).Select(group => group.First()).ToArray();
        if (!string.IsNullOrEmpty(preferredPcId)) return unique.FirstOrDefault(peer => peer.PcId == preferredPcId);
        return unique.Length == 1 ? unique[0] : null;
    }
    public static async Task<DiscoveredSessionPc[]> FindAsync(CancellationToken ct, IPEndPoint? testTarget = null)
    {
        using var udp = new UdpClient(new IPEndPoint(IPAddress.Any, 0));
        udp.EnableBroadcast = true;
        var nonce = Guid.NewGuid().ToString("D");
        var packet = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { protocol = "kreoda-discovery", version = 1, nonce }));
        var targets = new HashSet<IPAddress> { IPAddress.Broadcast };
        if (testTarget == null)
        {
            foreach (var adapter in NetworkInterface.GetAllNetworkInterfaces().Where(item => item.OperationalStatus == OperationalStatus.Up))
                foreach (var local in adapter.GetIPProperties().UnicastAddresses)
                    if (IsPrivate(local.Address) && local.IPv4Mask != null)
                    {
                        var ip = local.Address.GetAddressBytes();var mask = local.IPv4Mask.GetAddressBytes();
                        targets.Add(new IPAddress(ip.Select((value, index) => (byte)(value | ~mask[index])).ToArray()));
                    }
        }
        else { targets.Clear();targets.Add(testTarget.Address); }
        ct.ThrowIfCancellationRequested();
        foreach (var target in targets)
        {
            try { await udp.SendAsync(packet, packet.Length, new IPEndPoint(target, testTarget?.Port ?? Port)).ConfigureAwait(false); }
            catch (SocketException) { /* Another assigned adapter may remain reachable. */ }
        }
        var peers = new Dictionary<string, DiscoveredSessionPc>(StringComparer.Ordinal);
        using var window = CancellationTokenSource.CreateLinkedTokenSource(ct);
        window.CancelAfter(TimeSpan.FromMilliseconds(1200));
        using var close = window.Token.Register(() => udp.Close());
        try
        {
            while (!window.IsCancellationRequested)
            {
                var message = await udp.ReceiveAsync().ConfigureAwait(false);
                var peer = Decode(message.Buffer, message.RemoteEndPoint, nonce, testTarget != null);
                if (peer != null && peers.Count < 32) peers[peer.PcId] = peer;
            }
        }
        // Windows/Mono may deliver ICMP "port unreachable" as SocketException for a quiet loopback probe.
        // No discovery responder is a normal offline result; saved WebSocket credentials may still work.
        catch (SocketException) { }
        catch (ObjectDisposedException) when (window.IsCancellationRequested) { }
        ct.ThrowIfCancellationRequested();
        return peers.Values.OrderBy(peer => peer.Name, StringComparer.Ordinal).ThenBy(peer => peer.PcId, StringComparer.Ordinal).ToArray();
    }
    public static async Task<string> PairAsync(DiscoveredSessionPc pc, string installationId, string credential,
        CancellationToken ct, bool allowLoopback = false)
    {
        if (!IPAddress.TryParse(pc.Bootstrap.Host, out var address) || !IsPrivate(address, allowLoopback) ||
            pc.Bootstrap.Scheme != "http" || pc.Bootstrap.AbsolutePath != "/pair" || pc.Endpoint.Host != pc.Bootstrap.Host)
            throw new SessionException("BAD_PARAMS", "invalid discovered endpoint");
        using var handler = new HttpClientHandler { AllowAutoRedirect = false, UseProxy = false };
        using var client = new HttpClient(handler);
        using var content = new StringContent(JsonSerializer.Serialize(new { version = 1, pcId = pc.PcId,
            installationId, credential, name = "Quest 3" }), Encoding.UTF8, "application/json");
        using var request = new HttpRequestMessage(HttpMethod.Post, pc.Bootstrap) { Content = content };
        using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct).ConfigureAwait(false);
        if ((int)response.StatusCode == 403) throw new SessionException("UNAUTHORIZED", "automatic device revoked");
        response.EnsureSuccessStatusCode();
        // Read a bounded response instead of accepting an arbitrary HTTP body into memory.
        using var stream = await response.Content.ReadAsStreamAsync().ConfigureAwait(false);
        var buffer = new byte[8193];var count = 0;
        while (count < buffer.Length)
        {
            var read = await stream.ReadAsync(buffer, count, buffer.Length - count, ct).ConfigureAwait(false);
            if (read == 0) break;count += read;
        }
        if (count > 8192) throw new SessionException("BAD_PARAMS", "oversized bootstrap response");
        using var result = JsonDocument.Parse(new ReadOnlyMemory<byte>(buffer, 0, count));
        var value = result.RootElement;
        var deviceId = value.GetProperty("deviceId").GetString();
        if (value.GetProperty("version").GetInt32() != 1 || value.GetProperty("pcId").GetString() != pc.PcId ||
            deviceId == null || !deviceId.StartsWith("device-", StringComparison.Ordinal) || !Guid.TryParseExact(deviceId.Substring(7), "D", out _))
            throw new SessionException("BAD_PARAMS", "bootstrap identity mismatch");
        return deviceId;
    }
}
