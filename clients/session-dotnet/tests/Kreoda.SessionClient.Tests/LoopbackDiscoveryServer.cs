using System.Collections.Concurrent;
using System.Globalization;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Kreoda.Session;

namespace Kreoda.SessionClient.Tests;

/// <summary>Owned loopback-only HTTP/UDP fixture; never advertises on the LAN.</summary>
internal sealed class LoopbackDiscoveryServer : IAsyncDisposable
{
    readonly TcpListener _http = new(IPAddress.Loopback, 0);
    readonly UdpClient _udp = new(new IPEndPoint(IPAddress.Loopback, 0));
    readonly CancellationTokenSource _stop = new();
    readonly ConcurrentBag<Task> _requests = new();
    readonly Dictionary<string, (string Credential, string DeviceId)> _installations = new();
    readonly Dictionary<string, string> _devices = new();
    readonly object _gate = new();
    readonly Task _httpLoop, _udpLoop;
    public string PcId { get; } = Guid.NewGuid().ToString("D");
    public string DeviceId { get; } = "device-" + Guid.NewGuid().ToString("D");
    public string Credential { get; } = SessionDiscovery.CreateCredential();
    public int SessionPort { get; }
    public IPEndPoint DiscoveryTarget => (IPEndPoint)_udp.Client.LocalEndPoint!;
    public Uri Bootstrap => new($"http://127.0.0.1:{((IPEndPoint)_http.LocalEndpoint).Port}/pair");
    public DiscoveredSessionPc Pc => new(PcId, "Fixture PC", new Uri($"ws://127.0.0.1:{SessionPort}"), Bootstrap);
    public bool LegacyProof { get; set; }
    public bool RejectAuthentication { get; set; }
    public int DropPairAcknowledgements;
    public ConcurrentQueue<JsonElement> PairRequests { get; } = new();
    public ConcurrentQueue<JsonElement> IdentifyRequests { get; } = new();

    public LoopbackDiscoveryServer(int sessionPort)
    {
        SessionPort = sessionPort;
        _devices[DeviceId] = Credential;
        _http.Start();
        _httpLoop = HttpLoop();_udpLoop = UdpLoop();
    }
    public bool Authenticate(string device, string credential)
    {
        lock (_gate) return !RejectAuthentication && _devices.TryGetValue(device, out var saved) && saved == credential;
    }
    public int DeviceCount { get { lock (_gate) return _devices.Count; } }
    async Task UdpLoop()
    {
        try {
            while (!_stop.IsCancellationRequested) {
                var request = await _udp.ReceiveAsync(_stop.Token);
                using var json = JsonDocument.Parse(request.Buffer);
                var reply = JsonSerializer.SerializeToUtf8Bytes(new { protocol = "kreoda-discovery", version = 1,
                    nonce = json.RootElement.GetProperty("nonce").GetString(), pcId = PcId,
                    name = "Fixture PC", sessionPort = SessionPort, bootstrapPort = Bootstrap.Port });
                await _udp.SendAsync(reply, request.RemoteEndPoint, _stop.Token);
            }
        } catch (Exception e) when (e is OperationCanceledException or ObjectDisposedException or SocketException) { }
    }
    async Task HttpLoop()
    {
        try {
            while (!_stop.IsCancellationRequested) {
                var client = await _http.AcceptTcpClientAsync(_stop.Token);
                _requests.Add(Serve(client));
            }
        } catch (Exception e) when (e is OperationCanceledException or ObjectDisposedException or SocketException) { }
    }
    async Task Serve(TcpClient client)
    {
        using (client)
        try {
            var stream = client.GetStream();
            using var reader = new StreamReader(stream, Encoding.UTF8, false, 4096, leaveOpen: true);
            var first = await reader.ReadLineAsync(_stop.Token) ?? "";
            var length = 0;
            string? line;
            while (!string.IsNullOrEmpty(line = await reader.ReadLineAsync(_stop.Token)))
                if (line.StartsWith("Content-Length:", StringComparison.OrdinalIgnoreCase))
                    length = int.Parse(line.Substring(15).Trim(), CultureInfo.InvariantCulture);
            if (length is < 1 or > 8192) throw new IOException("fixture body out of bounds");
            var body = new char[length];var read = 0;
            while (read < length) {
                var count = await reader.ReadAsync(body.AsMemory(read), _stop.Token);
                if (count == 0) throw new IOException("fixture body truncated");read += count;
            }
            using var json = JsonDocument.Parse(new string(body));var value = json.RootElement;
            object response;var status = 200;
            if (first.Contains(" /identify ", StringComparison.Ordinal)) {
                IdentifyRequests.Enqueue(value.Clone());
                var device = value.GetProperty("deviceId").GetString()!;
                string? secret;lock (_gate) _devices.TryGetValue(device, out secret);
                if (secret is null || RejectAuthentication) { status = 404;response = new { error = "UNKNOWN_DEVICE" }; }
                else {
                    var nonce = value.GetProperty("nonce").GetString()!;
                    var parts = new List<string> { PcId, device, nonce };
                    if (!LegacyProof) parts.AddRange(["127.0.0.1", SessionPort.ToString(CultureInfo.InvariantCulture), Bootstrap.Port.ToString(CultureInfo.InvariantCulture)]);
                    using var key = SHA256.Create();using var hmac = new HMACSHA256(key.ComputeHash(Encoding.UTF8.GetBytes(secret)));
                    var proof = Convert.ToHexString(hmac.ComputeHash(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(parts)))).ToLowerInvariant();
                    response = new { version = 1, pcId = PcId, nonce, proof, proofVersion = LegacyProof ? 1 : 2 };
                }
            } else if (first.Contains(" /pair ", StringComparison.Ordinal)) {
                PairRequests.Enqueue(value.Clone());
                var installation = value.GetProperty("installationId").GetString()!;
                var credential = value.GetProperty("credential").GetString()!;
                string device;
                lock (_gate) {
                    if (!_installations.TryGetValue(installation, out var saved)) {
                        saved = (credential, "device-" + Guid.NewGuid().ToString("D"));
                        _installations.Add(installation, saved);_devices.Add(saved.DeviceId, credential);
                    }
                    if (saved.Credential != credential) throw new IOException("fixture enrollment credential changed");
                    device = saved.DeviceId;
                }
                if (Interlocked.Decrement(ref DropPairAcknowledgements) >= 0) return;
                response = new { version = 1, pcId = PcId, deviceId = device };
            } else { status = 404;response = new { error = "NOT_FOUND" }; }
            var payload = JsonSerializer.SerializeToUtf8Bytes(response);
            var header = Encoding.ASCII.GetBytes($"HTTP/1.1 {status} Fixture\r\nContent-Type: application/json\r\nContent-Length: {payload.Length}\r\nConnection: close\r\n\r\n");
            await stream.WriteAsync(header, _stop.Token);await stream.WriteAsync(payload, _stop.Token);
        } catch (Exception e) when (e is IOException or SocketException or OperationCanceledException or ObjectDisposedException) { }
    }
    public async ValueTask DisposeAsync()
    {
        _stop.Cancel();_http.Stop();_udp.Dispose();
        await Task.WhenAll(_httpLoop, _udpLoop);await Task.WhenAll(_requests);
        _stop.Dispose();
    }
}
