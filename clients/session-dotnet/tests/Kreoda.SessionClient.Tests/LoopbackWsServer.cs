using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Kreoda.SessionClient.Tests;

/// <summary>
/// Minimal in-test WebSocket server (text frames only): accepts one client,
/// answers scripted JSON replies, can push events and close sockets. Exists
/// so the session client is conformance-tested without Electron/Unity.
/// </summary>
internal sealed class LoopbackWsServer : IAsyncDisposable
{
    private readonly TcpListener _listener;
    private readonly Func<JsonElement, string?> _handler;
    private readonly CancellationTokenSource _cts = new();
    private Task? _acceptLoop;
    private readonly object _streamGate = new();
    private NetworkStream? _lastStream;

    public int Port { get; }
    public List<string> Received { get; } = new();

    public LoopbackWsServer(Func<JsonElement, string?> handler)
    {
        _handler = handler;
        _listener = new TcpListener(IPAddress.Loopback, 0);
        _listener.Start();
        Port = ((IPEndPoint)_listener.LocalEndpoint).Port;
    }

    public void Start() => _acceptLoop = Task.Run(AcceptLoopAsync);

    private async Task AcceptLoopAsync()
    {
        while (!_cts.IsCancellationRequested)
        {
            TcpClient client;
            try
            {
                client = await _listener.AcceptTcpClientAsync(_cts.Token);
            }
            catch (OperationCanceledException)
            {
                return;
            }
            _ = Task.Run(() => ServeAsync(client, _cts.Token));
        }
    }

    private async Task ServeAsync(TcpClient client, CancellationToken ct)
    {
        using (client)
        using (var stream = client.GetStream())
        {
            var header = new StringBuilder();
            var one = new byte[1];
            while (!header.ToString().Contains("\r\n\r\n"))
            {
                var n = await stream.ReadAsync(one, ct);
                if (n == 0) return;
                header.Append((char)one[0]);
                if (header.Length > 8192) return;
            }
            string? key = null;
            foreach (var line in header.ToString().Split("\r\n"))
            {
                if (line.StartsWith("Sec-WebSocket-Key:", StringComparison.OrdinalIgnoreCase))
                    key = line.Substring("Sec-WebSocket-Key:".Length).Trim();
            }
            if (key is null) return;
            var accept = Convert.ToBase64String(
                SHA1.HashData(Encoding.ASCII.GetBytes(
                    key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")));
            var response =
                "HTTP/1.1 101 Switching Protocols\r\n" +
                "Upgrade: websocket\r\n" +
                "Connection: Upgrade\r\n" +
                $"Sec-WebSocket-Accept: {accept}\r\n\r\n";
            await stream.WriteAsync(Encoding.ASCII.GetBytes(response), ct);
            lock (_streamGate) _lastStream = stream;

            while (!ct.IsCancellationRequested && client.Connected)
            {
                var text = await ReadTextFrameAsync(stream, ct);
                if (text is null) return; // close frame or disconnect
                lock (Received) Received.Add(text);
                JsonDocument doc;
                try
                {
                    doc = JsonDocument.Parse(text);
                }
                catch
                {
                    continue;
                }
                using (doc)
                {
                    var reply = _handler(doc.RootElement.Clone());
                    if (reply == "__CLOSE__")
                    {
                        // Test hook mirroring the relay's pairing gate: close
                        // without a reply (pending calls must fail loudly).
                        await stream.WriteAsync(new byte[] { 0x88, 0x00 }, ct);
                        return;
                    }
                    if (reply is not null)
                        await SendTextAsync(stream, reply, ct);
                }
            }
        }
    }

    /// <summary>Push an unsolicited server event (delta/selection) to the
    /// last connected client. Sequential-test use only.</summary>
    public async Task PushAsync(string json)
    {
        NetworkStream? stream;
        lock (_streamGate) stream = _lastStream;
        if (stream is null) throw new InvalidOperationException("no client connected");
        await SendTextAsync(stream, json, CancellationToken.None);
    }

    private static async Task<string?> ReadTextFrameAsync(NetworkStream stream, CancellationToken ct)
    {
        // Test frames only: masked text <64KB. Control frames and 64-bit
        // lengths never occur here (sub-second JSON control frames).
        var head = new byte[2];
        await stream.ReadExactlyAsync(head, ct);
        var opcode = head[0] & 0x0F;
        if (opcode == 0x8) return null; // close
        if (opcode != 0x1 && opcode != 0x0)
            throw new InvalidOperationException($"unexpected opcode {opcode}");
        var lenByte = head[1] & 0x7F;
        if (lenByte == 127) throw new InvalidOperationException("frame too large");
        int length = lenByte;
        if (lenByte == 126)
        {
            var ext = new byte[2];
            await stream.ReadExactlyAsync(ext, ct);
            length = (ext[0] << 8) | ext[1];
        }
        if ((head[1] & 0x80) == 0) throw new InvalidOperationException("client frame must be masked");
        var maskKey = new byte[4];
        await stream.ReadExactlyAsync(maskKey, ct);
        var payload = new byte[length];
        await stream.ReadExactlyAsync(payload, ct);
        for (var i = 0; i < length; i++) payload[i] ^= maskKey[i % 4];
        return Encoding.UTF8.GetString(payload);
    }

    private static async Task SendTextAsync(NetworkStream stream, string text, CancellationToken ct)
    {
        var payload = Encoding.UTF8.GetBytes(text);
        if (payload.Length > ushort.MaxValue) throw new InvalidOperationException("frame too large");
        using var frame = new MemoryStream();
        frame.WriteByte(0x81);
        if (payload.Length < 126)
        {
            frame.WriteByte((byte)payload.Length);
        }
        else
        {
            frame.WriteByte(126);
            frame.WriteByte((byte)(payload.Length >> 8));
            frame.WriteByte((byte)(payload.Length & 0xFF));
        }
        frame.Write(payload, 0, payload.Length);
        var bytes = frame.ToArray();
        await stream.WriteAsync(bytes, ct);
    }

    public async ValueTask DisposeAsync()
    {
        _cts.Cancel();
        _listener.Stop();
        if (_acceptLoop is not null)
        {
            try
            {
                await _acceptLoop;
            }
            catch
            {
            }
        }
        _cts.Dispose();
    }
}
