using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace Kreoda.Session;

/// <summary>
/// Headless client for the Kreoda CAD session relay (§11): hello pairing,
/// snapshot, typed mutations, semantic queries, spatial previews and
/// multi-command transactions over a WebSocket carrying JSON frames.
/// Server-pushed model deltas arrive on <see cref="Delta"/>; shared
/// selection metadata on <see cref="Selection"/>; engine restarts on
/// <see cref="CoreRestarted"/>. A closed socket fails every pending call
/// loudly instead of hanging.
/// </summary>
public sealed class SessionClient : IAsyncDisposable
{
    private readonly ClientWebSocket _ws = new();
    private readonly ConcurrentDictionary<string, TaskCompletionSource<JsonElement>> _pending = new();
    private readonly CancellationTokenSource _loopCts = new();
    private Task? _loop;
    private int _seq;
    private int _disposed;

    public string? ClientId { get; private set; }

    public event Action<JsonElement>? Delta;
    public event Action<JsonElement>? Selection;
    public event Action? CoreRestarted;

    private SessionClient()
    {
    }

    /// <summary>Connect and pair with the relay (wrong token ⇒ socket closed).</summary>
    public static async Task<SessionClient> ConnectAsync(
        Uri wsUri,
        string token,
        string clientType,
        CancellationToken ct = default)
    {
        var client = new SessionClient();
        await client._ws.ConnectAsync(wsUri, ct).ConfigureAwait(false);
        client._loop = Task.Run(() => client.ReceiveLoopAsync(client._loopCts.Token));
        try
        {
            var hello = await client.CallAsync("hello", new Dictionary<string, object?>
            {
                ["clientType"] = clientType,
                ["protocolVersion"] = 1,
                ["token"] = token,
            }, ct).ConfigureAwait(false);
            client.ClientId = hello.TryGetProperty("clientId", out var id)
                ? id.GetString()
                : null;
            return client;
        }
        catch
        {
            await client.DisposeAsync().ConfigureAwait(false);
            throw;
        }
    }

    public Task<JsonElement> SnapshotAsync(
        string documentId = "doc-phase1",
        CancellationToken ct = default) =>
        CallAsync("snapshot", new Dictionary<string, object?>
        {
            ["documentId"] = documentId,
        }, ct);

    public Task<JsonElement> InvokeAsync(
        int type,
        IDictionary<string, object?> fields,
        string documentId = "doc-phase1",
        double? baseRevision = null,
        string? transactionId = null,
        CancellationToken ct = default)
    {
        var p = new Dictionary<string, object?>
        {
            ["documentId"] = documentId,
            ["type"] = type,
            ["fields"] = fields,
        };
        if (baseRevision.HasValue) p["baseRevision"] = baseRevision.Value;
        if (transactionId is not null) p["transactionId"] = transactionId;
        return CallAsync("invoke", p, ct);
    }

    public Task<JsonElement> QueryAsync(
        string method,
        IDictionary<string, object?>? @params = null,
        CancellationToken ct = default) =>
        CallAsync(method, @params ?? new Dictionary<string, object?>(), ct);

    public Task<JsonElement> TxnBeginAsync(
        string transactionId,
        string documentId = "doc-phase1",
        CancellationToken ct = default) =>
        CallAsync("txnBegin", new Dictionary<string, object?>
        {
            ["documentId"] = documentId,
            ["transactionId"] = transactionId,
        }, ct);

    public Task<JsonElement> TxnCommitAsync(
        string transactionId,
        string documentId = "doc-phase1",
        CancellationToken ct = default) =>
        CallAsync("txnCommit", new Dictionary<string, object?>
        {
            ["documentId"] = documentId,
            ["transactionId"] = transactionId,
        }, ct);

    public Task<JsonElement> TxnRollbackAsync(
        string transactionId,
        string documentId = "doc-phase1",
        CancellationToken ct = default) =>
        CallAsync("txnRollback", new Dictionary<string, object?>
        {
            ["documentId"] = documentId,
            ["transactionId"] = transactionId,
        }, ct);

    public async Task<JsonElement> CallAsync(
        string method,
        IDictionary<string, object?> @params,
        CancellationToken ct = default)
    {
        if (_ws.State != WebSocketState.Open)
            throw new SessionException("NOT_CONNECTED", "session socket is not open");
        var requestId = $"cs-{Interlocked.Increment(ref _seq)}";
        var tcs = new TaskCompletionSource<JsonElement>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        _pending[requestId] = tcs;
        try
        {
            var text = JsonSerializer.Serialize(new Dictionary<string, object?>
            {
                ["requestId"] = requestId,
                ["method"] = method,
                ["params"] = @params,
            });
            await _ws.SendAsync(
                Encoding.UTF8.GetBytes(text),
                WebSocketMessageType.Text,
                endOfMessage: true,
                ct).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _pending.TryRemove(requestId, out _);
            throw new SessionException("SEND_FAILED", ex.Message);
        }
        using (ct.Register(() =>
        {
            if (_pending.TryRemove(requestId, out var p))
                p.TrySetException(new SessionException("CANCELLED", "session call cancelled"));
        }))
        {
            return await tcs.Task.ConfigureAwait(false);
        }
    }

    private async Task ReceiveLoopAsync(CancellationToken ct)
    {
        var buffer = new byte[1024 * 1024];
        var text = new StringBuilder();
        try
        {
            while (!ct.IsCancellationRequested && _ws.State == WebSocketState.Open)
            {
                text.Clear();
                WebSocketReceiveResult r;
                do
                {
                    r = await _ws.ReceiveAsync(buffer, ct).ConfigureAwait(false);
                    if (r.MessageType == WebSocketMessageType.Close)
                    {
                        FailAll(new SessionException("CLOSED", "session socket closed before reply"));
                        return;
                    }
                    text.Append(Encoding.UTF8.GetString(buffer, 0, r.Count));
                } while (!r.EndOfMessage);
                Route(text.ToString());
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            FailAll(new SessionException("RECEIVE_FAILED", ex.Message));
        }
    }

    private void Route(string text)
    {
        JsonDocument doc;
        try
        {
            doc = JsonDocument.Parse(text);
        }
        catch
        {
            return;
        }
        using (doc)
        {
            var root = doc.RootElement;
            if (root.TryGetProperty("requestId", out var idProp) &&
                idProp.ValueKind == JsonValueKind.String &&
                _pending.TryRemove(idProp.GetString()!, out var tcs))
            {
                if (root.TryGetProperty("ok", out var ok) &&
                    ok.ValueKind == JsonValueKind.True)
                {
                    tcs.TrySetResult(root.Clone());
                }
                else
                {
                    var code = root.TryGetProperty("errorCode", out var c) &&
                        c.ValueKind == JsonValueKind.String
                        ? c.GetString()!
                        : "SESSION_FAILED";
                    var message = root.TryGetProperty("error", out var m) &&
                        m.ValueKind == JsonValueKind.String
                        ? m.GetString()!
                        : "session call failed";
                    tcs.TrySetException(new SessionException(code, message));
                }
                return;
            }
            if (root.TryGetProperty("event", out var ev) &&
                ev.ValueKind == JsonValueKind.String)
            {
                var cloned = root.Clone();
                switch (ev.GetString())
                {
                    case "delta":
                        Delta?.Invoke(cloned);
                        break;
                    case "selection":
                        Selection?.Invoke(cloned);
                        break;
                    case "core-restarted":
                        CoreRestarted?.Invoke();
                        break;
                }
            }
        }
    }

    private void FailAll(SessionException ex)
    {
        foreach (var key in _pending.Keys)
        {
            if (_pending.TryRemove(key, out var tcs))
                tcs.TrySetException(ex);
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0) return;
        _loopCts.Cancel();
        FailAll(new SessionException("CLOSED", "session client disposed"));
        try
        {
            if (_ws.State == WebSocketState.Open)
            {
                // Close handshake with a bound: a wedged peer must not hang
                // disposal (found by the close-rejection conformance test).
                using var closeCts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
                await _ws.CloseOutputAsync(
                    WebSocketCloseStatus.NormalClosure, "bye", closeCts.Token);
            }
        }
        catch
        {
        }
        _ws.Dispose();
        _loopCts.Dispose();
        if (_loop is not null)
        {
            try
            {
                await _loop.ConfigureAwait(false);
            }
            catch
            {
            }
        }
    }
}
