using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace Kreoda.Session;

/// <summary>The caller stores the credential securely for later device connections.</summary>
public sealed record PairedSession(SessionClient Client, string DeviceId, string Credential);

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
    private sealed record PendingCall(string Method, TaskCompletionSource<JsonElement> Completion);
    private readonly ConcurrentDictionary<string, PendingCall> _pending = new();
    private readonly SemaphoreSlim _sendGate = new(1, 1);
    private readonly object _updateGate = new();
    private Task _updates = Task.CompletedTask;
    private SessionModelState? _model;
    private readonly CancellationTokenSource _loopCts = new();
    private Task? _loop;
    private int _seq;
    private int _disposed;

    public string? ClientId { get; private set; }
    public string? DeviceId { get; private set; }
    public string? LogicalClientId { get; private set; }
    public string? SessionId { get; private set; }
    public IReadOnlySet<string> ServerCapabilities { get; private set; } =
        new HashSet<string>(StringComparer.Ordinal);

    public event Action<JsonElement>? Delta;
    public SessionModelState? Model => Volatile.Read(ref _model);
    public event Action<SessionModelUpdate>? ModelChanged;
    public event Action<SessionException>? ModelError;
    public event Action<JsonElement>? Selection;
    public event Action? CoreRestarted;

    private SessionClient()
    {
    }

    /// <summary>Connect; supply logicalClientId after ct to resume a logical client.</summary>
    public static async Task<SessionClient> ConnectAsync(
        Uri wsUri,
        string token,
        string clientType,
        CancellationToken ct = default,
        string? logicalClientId = null)
    {
        var client = await OpenAsync(wsUri, logicalClientId, ct).ConfigureAwait(false);
        try
        {
            await client.HelloAsync(token, clientType, null, ct).ConfigureAwait(false);
            return client;
        }
        catch
        {
            await client.DisposeAsync().ConfigureAwait(false);
            throw;
        }
    }

    public static async Task<PairedSession> PairAsync(Uri wsUri, string pairingToken, string deviceName,
        string clientType, CancellationToken ct = default, string? logicalClientId = null)
    {
        var client = await OpenAsync(wsUri, logicalClientId, ct).ConfigureAwait(false);
        try
        {
            var raw = await client.CallAsync(SessionMethods.Pair, GeneratedControl.Parameters(new Generated.PairParams
                { PairingToken = pairingToken, DeviceName = deviceName }), ct).ConfigureAwait(false);
            var paired = GeneratedControl.Read<Generated.PairReply>(raw, "PairReply");
            await client.HelloAsync(paired.SessionToken, clientType, paired.DeviceId, ct).ConfigureAwait(false);
            return new PairedSession(client, paired.DeviceId, paired.Credential);
        }
        catch { await client.DisposeAsync().ConfigureAwait(false); throw; }
    }

    public static async Task<SessionClient> ConnectDeviceAsync(Uri wsUri, string deviceId, string credential,
        string clientType, CancellationToken ct = default, string? logicalClientId = null)
    {
        var client = await OpenAsync(wsUri, logicalClientId, ct).ConfigureAwait(false);
        try
        {
            var raw = await client.CallAsync(SessionMethods.Authenticate, GeneratedControl.Parameters(new Generated.AuthenticateParams
                { DeviceId = deviceId, Credential = credential }), ct).ConfigureAwait(false);
            var authenticated = GeneratedControl.Read<Generated.AuthenticateReply>(raw, "AuthenticateReply");
            if (authenticated.DeviceId != deviceId) throw new SessionException("UNAUTHORIZED", "device identity mismatch");
            await client.HelloAsync(authenticated.SessionToken, clientType, deviceId, ct).ConfigureAwait(false);
            return client;
        }
        catch { await client.DisposeAsync().ConfigureAwait(false); throw; }
    }

    private static async Task<SessionClient> OpenAsync(Uri wsUri, string? logicalClientId, CancellationToken ct)
    {
        var client = new SessionClient
            { LogicalClientId = (logicalClientId ?? $"client-{Guid.NewGuid():D}").ToLowerInvariant() };
        try
        {
            await client._ws.ConnectAsync(wsUri, ct).ConfigureAwait(false);
            client._loop = Task.Run(() => client.ReceiveLoopAsync(client._loopCts.Token));
            return client;
        }
        catch { await client.DisposeAsync().ConfigureAwait(false); throw; }
    }

    private async Task HelloAsync(string token, string clientType, string? deviceId, CancellationToken ct)
    {
        var hello = await CallAsync(SessionMethods.Hello, GeneratedControl.Parameters(new Generated.HelloParams
        {
            ClientType = clientType, ProtocolVersion = SessionMethods.ProtocolVersion,
            Token = token, DeviceId = deviceId, ClientId = LogicalClientId,
            Capabilities = new[] { SessionMethods.OperationReplayCapability, "incremental-deltas" },
        }), ct).ConfigureAwait(false);
        ClientId = hello.TryGetProperty("clientId", out var id) ? id.GetString() : null;
        DeviceId = deviceId;
        SessionId = hello.TryGetProperty("sessionId", out var sessionId) ? sessionId.GetString() : null;
        ServerCapabilities = hello.TryGetProperty("capabilities", out var capabilities) && capabilities.ValueKind == JsonValueKind.Array
            ? capabilities.EnumerateArray().Where(capability => capability.ValueKind == JsonValueKind.String)
                .Select(capability => capability.GetString()!).ToHashSet(StringComparer.Ordinal)
            : new HashSet<string>(StringComparer.Ordinal);
        if (ServerCapabilities.Contains("incremental-deltas"))
            await SnapshotAsync(hello.TryGetProperty("documentId", out var document) ? document.GetString()! : "doc-phase1", ct).ConfigureAwait(false);
    }

    public async Task<JsonElement> SnapshotAsync(
        string documentId = "doc-phase1",
        CancellationToken ct = default)
    {
        var reply = await CallAsync(SessionMethods.Snapshot, GeneratedControl.Parameters(new Generated.SnapshotParams
            { DocumentId = documentId }), ct).ConfigureAwait(false);
        if (ServerCapabilities.Contains("incremental-deltas"))
        {
            Task updates;
            lock (_updateGate) updates = _updates;
            await updates.WaitAsync(ct).ConfigureAwait(false);
        }
        return reply;
    }

    public async Task<Generated.SessionInfoPayload> SessionInfoAsync(CancellationToken ct = default)
    {
        var reply = await CallAsync(SessionMethods.GetSessionInfo, new Dictionary<string, object?>(), ct).ConfigureAwait(false);
        return GeneratedControl.Read<Generated.SessionInfoPayload>(reply.GetProperty("result"), "SessionInfoPayload");
    }

    public Task<JsonElement> InvokeAsync(
        InvokeRequest request,
        CancellationToken ct = default) =>
        CallAsync(SessionMethods.Invoke, request.ToDictionary(), ct);

    public Task<JsonElement> CommandAsync(string commandId, IDictionary<string, object?> parameters,
        string documentId = "doc-phase1", string? featureId = null, double? baseRevision = null,
        string? transactionId = null, CancellationToken ct = default)
    {
        return CallAsync(SessionMethods.Command, GeneratedControl.Parameters(new Generated.NamedCommandParams
        {
            CommandId = commandId, Parameters = GeneratedControl.Fields(parameters), DocumentId = documentId,
            FeatureId = featureId, BaseRevision = GeneratedControl.Revision(baseRevision), TransactionId = transactionId,
        }), ct);
    }

    public Task<JsonElement> InvokeAsync(
        int type,
        IDictionary<string, object?> fields,
        string documentId = "doc-phase1",
        double? baseRevision = null,
        string? transactionId = null,
        CancellationToken ct = default)
    {
        return InvokeAsync(new InvokeRequest(type, fields, documentId, baseRevision, transactionId), ct);
    }

    public Task<JsonElement> TxnBeginAsync(
        string transactionId,
        string documentId = "doc-phase1",
        CancellationToken ct = default) =>
        CallAsync(SessionMethods.TxnBegin, new TxnRequest(transactionId, documentId).ToDictionary(), ct);

    public Task<JsonElement> TxnCommitAsync(
        string transactionId,
        string documentId = "doc-phase1",
        CancellationToken ct = default) =>
        CallAsync(SessionMethods.TxnCommit, new TxnRequest(transactionId, documentId).ToDictionary(), ct);

    public Task<JsonElement> TxnRollbackAsync(
        string transactionId,
        string documentId = "doc-phase1",
        CancellationToken ct = default) =>
        CallAsync(SessionMethods.TxnRollback, new TxnRequest(transactionId, documentId).ToDictionary(), ct);

    public Task<JsonElement> TxnForceRollbackAsync(
        string transactionId,
        string documentId = "doc-phase1",
        CancellationToken ct = default) =>
        CallAsync(SessionMethods.TxnForceRollback, new TxnRequest(transactionId, documentId).ToDictionary(), ct);

    public Task<JsonElement> TxnStatusAsync(
        string documentId = "doc-phase1",
        CancellationToken ct = default) =>
        CallAsync(SessionMethods.TxnStatus, new Dictionary<string, object?>
        {
            ["documentId"] = documentId,
        }, ct);

    public async Task<JsonElement> CallAsync(
        string method,
        IDictionary<string, object?> @params,
        CancellationToken ct = default,
        string? operationId = null,
        string? expectedSessionId = null)
    {
        bool open;
        try
        {
            open = _disposed == 0 && _ws.State == WebSocketState.Open;
        }
        catch (ObjectDisposedException)
        {
            open = false;
        }
        if (!open)
            throw new SessionException("NOT_CONNECTED", "session socket is not open");
        var requestId = $"cs-{Interlocked.Increment(ref _seq)}";
        var sessionId = expectedSessionId ?? SessionId;
        if (operationId is not null && !ServerCapabilities.Contains(SessionMethods.OperationReplayCapability))
            throw new SessionException("NOT_IMPLEMENTED", "server does not support operation replay");
        if (operationId is not null && sessionId is null)
            throw new SessionException("BAD_PARAMS", "operation replay requires a session id");
        if (operationId is null && sessionId is not null &&
            ServerCapabilities.Contains(SessionMethods.OperationReplayCapability) &&
            SessionMethods.SupportsOperationReplay(method))
            operationId = Guid.NewGuid().ToString("D");
        var tcs = new TaskCompletionSource<JsonElement>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        _pending[requestId] = new(method, tcs);
        try
        {
            var envelope = new Dictionary<string, object?>
            {
                ["requestId"] = requestId,
                ["method"] = method,
                ["params"] = @params,
            };
            if (operationId is not null) envelope["operationId"] = operationId;
            if (sessionId is not null) envelope["sessionId"] = sessionId;
            var text = JsonSerializer.Serialize(envelope);
            await _sendGate.WaitAsync(ct).ConfigureAwait(false);
            try
            {
                await _ws.SendAsync(Encoding.UTF8.GetBytes(text), WebSocketMessageType.Text, endOfMessage: true, ct).ConfigureAwait(false);
            }
            finally { _sendGate.Release(); }
        }
        catch (Exception ex)
        {
            _pending.TryRemove(requestId, out _);
            throw new SessionException("SEND_FAILED", ex.Message);
        }
        using (ct.Register(() =>
        {
            if (_pending.TryRemove(requestId, out var p))
                p.Completion.TrySetException(new SessionException("CANCELLED", "session call cancelled"));
        }))
        {
            return await tcs.Task.ConfigureAwait(false);
        }
    }

    /// <summary>Resend one mutation with its original operation and session identity.</summary>
    public Task<JsonElement> ReplayOperationAsync(
        string method,
        IDictionary<string, object?> @params,
        string operationId,
        string expectedSessionId,
        CancellationToken ct = default)
    {
        if (!SessionMethods.SupportsOperationReplay(method))
            throw new ArgumentException("method does not support operation replay", nameof(method));
        if (!ServerCapabilities.Contains(SessionMethods.OperationReplayCapability))
            throw new SessionException("NOT_IMPLEMENTED", "server does not support operation replay");
        return CallAsync(method, @params, ct, operationId, expectedSessionId);
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
                _pending.TryRemove(idProp.GetString()!, out var pending))
            {
                if (root.TryGetProperty("ok", out var ok) &&
                    ok.ValueKind == JsonValueKind.True)
                {
                    var cloned = root.Clone();
                    if (pending.Method == SessionMethods.Snapshot && ServerCapabilities.Contains("incremental-deltas"))
                        QueueUpdate(() => { ApplySnapshot(cloned); return Task.CompletedTask; });
                    pending.Completion.TrySetResult(cloned);
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
                    pending.Completion.TrySetException(new SessionException(code, message));
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
                        QueueUpdate(async () =>
                        {
                            if (ServerCapabilities.Contains("incremental-deltas"))
                            {
                                var update = Model?.Apply(cloned);
                                if (update is null || update.Kind == SessionModelUpdateKind.NeedsSnapshot)
                                    await RecoverModelAsync(cloned.GetProperty("documentId").GetString()!).ConfigureAwait(false);
                                else if (update.Kind == SessionModelUpdateKind.Applied) PublishModel(update);
                            }
                            Delta?.Invoke(cloned);
                        });
                        break;
                    case "snapshot-required":
                        if (ServerCapabilities.Contains("incremental-deltas"))
                            QueueUpdate(() => RecoverModelAsync(cloned.GetProperty("documentId").GetString()!));
                        break;
                    case "selection":
                        QueueUpdate(() => { Selection?.Invoke(cloned); return Task.CompletedTask; });
                        break;
                    case "core-restarted":
                        QueueUpdate(() =>
                        {
                            Volatile.Write(ref _model, null);
                            if (cloned.TryGetProperty("sessionId", out var restartedSession) && restartedSession.ValueKind == JsonValueKind.String)
                                SessionId = restartedSession.GetString();
                            CoreRestarted?.Invoke();
                            return Task.CompletedTask;
                        });
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
                tcs.Completion.TrySetException(ex);
        }
    }

    private void QueueUpdate(Func<Task> update)
    {
        lock (_updateGate)
            _updates = _updates.ContinueWith(async _ =>
            {
                if (_disposed != 0) return;
                try { await update().ConfigureAwait(false); }
                catch (Exception error)
                {
                    Volatile.Write(ref _model, null);
                    if (_disposed == 0)
                    {
                        try { ModelError?.Invoke(error as SessionException ?? new SessionException("MODEL_SYNC_FAILED", error.Message)); }
                        catch { /* Subscriber errors cannot stop routing later replies. */ }
                    }
                }
            }, CancellationToken.None, TaskContinuationOptions.None, TaskScheduler.Default).Unwrap();
    }

    private async Task RecoverModelAsync(string documentId)
    {
        // CallAsync waits only for the receive loop to route the reply. The
        // separately queued snapshot application must never be awaited here.
        var reply = await CallAsync(SessionMethods.Snapshot,
            new Dictionary<string, object?> { ["documentId"] = documentId }, _loopCts.Token).ConfigureAwait(false);
        ApplySnapshot(reply);
    }

    private void ApplySnapshot(JsonElement reply)
    {
        var snapshot = SessionModelState.FromSnapshot(reply);
        var current = Model;
        if (current is not null && current.SessionId == snapshot.SessionId && current.DocumentId == snapshot.DocumentId && snapshot.Revision <= current.Revision) return;
        PublishModel(new(SessionModelUpdateKind.Applied, snapshot));
    }

    private void PublishModel(SessionModelUpdate update)
    {
        Volatile.Write(ref _model, update.Model);
        SessionId = update.Model.SessionId;
        ModelChanged?.Invoke(update);
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
                await _sendGate.WaitAsync(closeCts.Token).ConfigureAwait(false);
                try { await _ws.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "bye", closeCts.Token).ConfigureAwait(false); }
                finally { _sendGate.Release(); }
            }
        }
        catch
        {
        }
        _ws.Dispose();
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
        Task updates;
        lock (_updateGate) updates = _updates;
        await updates.ConfigureAwait(false);
        _loopCts.Dispose();
    }
}
