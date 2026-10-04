using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Buffers.Binary;
using System.Text;
using System.Text.Json;

namespace Kreoda.SessionClient.Tests;

internal sealed record LoopbackWsResponse(
    string? Text,
    byte[]? Binary = null,
    int FragmentSize = int.MaxValue,
    Func<Task>? AfterTextSent = null,
    Task? BeforeBinary = null,
    Func<Task>? AfterBinarySent = null);

/// <summary>
/// Minimal in-test WebSocket server: accepts one client,
/// answers scripted JSON replies, can push events and close sockets. Exists
/// so the session client is conformance-tested without Electron/Unity.
/// </summary>
internal sealed class LoopbackWsServer : IAsyncDisposable
{
    private readonly TcpListener _listener;
    private readonly Func<JsonElement, string?> _handler;
    public Func<JsonElement, Task<LoopbackWsResponse?>>? ExtendedHandler { get; set; }
    private readonly CancellationTokenSource _cts = new();
    private Task? _acceptLoop;
    private readonly object _streamGate = new();
    private readonly SemaphoreSlim _writeGate = new(1, 1);
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
                    var extended = ExtendedHandler is null
                        ? null
                        : await ExtendedHandler(doc.RootElement.Clone());
                    if (extended is not null)
                    {
                        if (extended.Text is not null) await SendTextAsync(stream, extended.Text, ct);
                        if (extended.AfterTextSent is not null) await extended.AfterTextSent();
                        if (extended.Binary is not null)
                        {
                            if (extended.BeforeBinary is not null) await extended.BeforeBinary.WaitAsync(ct);
                            await SendMessageAsync(stream, 0x2, extended.Binary, extended.FragmentSize, ct);
                            if (extended.AfterBinarySent is not null) await extended.AfterBinarySent();
                        }
                        continue;
                    }
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

    public async Task PushFragmentedAsync(string json, int fragmentSize)
    {
        NetworkStream? stream;
        lock (_streamGate) stream = _lastStream;
        if (stream is null) throw new InvalidOperationException("no client connected");
        await SendMessageAsync(stream, 0x1, Encoding.UTF8.GetBytes(json), fragmentSize, CancellationToken.None);
    }

    public async Task PushBinaryAsync(byte[] bytes, int fragmentSize = int.MaxValue)
    {
        NetworkStream? stream;
        lock (_streamGate) stream = _lastStream;
        if (stream is null) throw new InvalidOperationException("no client connected");
        await SendMessageAsync(stream, 0x2, bytes, fragmentSize, CancellationToken.None);
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

    private Task SendTextAsync(NetworkStream stream, string text, CancellationToken ct) =>
        SendMessageAsync(stream, 0x1, Encoding.UTF8.GetBytes(text), int.MaxValue, ct);

    private async Task SendMessageAsync(NetworkStream stream, byte opcode, byte[] payload, int fragmentSize, CancellationToken ct)
    {
        if (fragmentSize <= 0) throw new ArgumentOutOfRangeException(nameof(fragmentSize));
        await _writeGate.WaitAsync(ct);
        try
        {
            var offset = 0;
            do
            {
                var length = Math.Min(fragmentSize, payload.Length - offset);
                var final = offset + length == payload.Length;
                using var frame = new MemoryStream();
                frame.WriteByte((byte)((final ? 0x80 : 0) | (offset == 0 ? opcode : 0)));
                if (length < 126) frame.WriteByte((byte)length);
                else if (length <= ushort.MaxValue)
                {
                    frame.WriteByte(126);
                    frame.WriteByte((byte)(length >> 8));
                    frame.WriteByte((byte)length);
                }
                else
                {
                    frame.WriteByte(127);
                    var encodedLength = new byte[8];
                    BinaryPrimitives.WriteUInt64BigEndian(encodedLength, (ulong)length);
                    frame.Write(encodedLength);
                }
                frame.Write(payload, offset, length);
                await stream.WriteAsync(frame.ToArray(), ct);
                offset += length;
            } while (offset < payload.Length);
        }
        finally { _writeGate.Release(); }
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
        _writeGate.Dispose();
    }
}
