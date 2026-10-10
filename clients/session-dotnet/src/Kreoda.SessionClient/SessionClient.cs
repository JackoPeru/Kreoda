using System.Collections.Concurrent;
using System.Buffers.Binary;
using System.Globalization;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Google.FlatBuffers;
using Kreoda.Protocol;

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
    private const int MaxControlPayloadBytes = 4 * 1024 * 1024;
    private const int MaxMeshPayloadBytes = 64 * 1024 * 1024;
    private const int MaxMeshTableCount = 1_000_000;
    private static readonly UTF8Encoding StrictUtf8 = new(false, true);
    private readonly ClientWebSocket _ws = new();
    private sealed class PendingMeshCall
    {
        public PendingMeshCall(string requestId, string sessionId, string documentId, string bodyId,
            string? instanceId, int quality, long expectedRevision, int lineageGeneration,
            TaskCompletionSource<SessionMeshResult> completion)
        {
            RequestId = requestId;
            SessionId = sessionId;
            DocumentId = documentId;
            BodyId = bodyId;
            InstanceId = instanceId;
            Quality = quality;
            ExpectedRevision = expectedRevision;
            LineageGeneration = lineageGeneration;
            Completion = completion;
        }

        public string RequestId { get; }
        public string SessionId { get; }
        public string DocumentId { get; }
        public string BodyId { get; }
        public string? InstanceId { get; }
        public int Quality { get; }
        public long ExpectedRevision { get; }
        public int LineageGeneration { get; }
        public TaskCompletionSource<SessionMeshResult> Completion { get; }
        public Generated.MeshHeader? Header { get; set; }
    }

    private sealed record PendingCall(
        string Method,
        TaskCompletionSource<JsonElement>? Completion,
        PendingMeshCall? Mesh = null,
        string? SessionAtSend = null,
        string? DocumentAtSend = null,
        int LineageGenerationAtSend = 0);
    private readonly ConcurrentDictionary<string, PendingCall> _pending = new();
    private readonly ConcurrentDictionary<string, PendingMeshCall> _meshByNativeRequestId = new(StringComparer.Ordinal);
    private readonly SemaphoreSlim _sendGate = new(1, 1);
    private readonly object _updateGate = new();
    private Task _updates = Task.CompletedTask;
    private SessionModelState? _model;
    private readonly CancellationTokenSource _loopCts = new();
    private Task? _loop;
    private int _seq;
    private int _disposed;
    private string? _knownSessionId;
    private string? _knownDocumentId;
    private long? _knownRevision;
    private int _lineageGeneration;

    public string? ClientId { get; private set; }
    public string? DeviceId { get; private set; }
    public string? LogicalClientId { get; private set; }
    public string? SessionId { get; private set; }
    public IReadOnlyCollection<string> ServerCapabilities { get; private set; } =
        Array.AsReadOnly(Array.Empty<string>());

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
            Capabilities = new[]
            {
                SessionMethods.OperationReplayCapability,
                SessionMethods.IncrementalDeltasCapability,
                SessionMethods.BinaryMeshV1Capability,
            },
        }), ct).ConfigureAwait(false);
        ClientId = hello.TryGetProperty("clientId", out var id) ? id.GetString() : null;
        DeviceId = deviceId;
        SessionId = hello.TryGetProperty("sessionId", out var sessionId) ? sessionId.GetString() : null;
        _knownSessionId = SessionId;
        _knownDocumentId = hello.TryGetProperty("documentId", out var initialDocument) ? initialDocument.GetString() : null;
        _knownRevision = hello.TryGetProperty("revision", out var initialRevision) && initialRevision.TryGetInt64(out var revision)
            ? revision
            : null;
        var advertisedCapabilities = hello.TryGetProperty("capabilities", out var capabilities) && capabilities.ValueKind == JsonValueKind.Array
            ? capabilities.EnumerateArray().Where(capability => capability.ValueKind == JsonValueKind.String)
                .Select(capability => capability.GetString()!).Distinct(StringComparer.Ordinal).ToArray()
            : Array.Empty<string>();
        ServerCapabilities = Array.AsReadOnly(advertisedCapabilities);
        if (ServerCapabilities.Contains(SessionMethods.IncrementalDeltasCapability))
            await SnapshotAsync(hello.TryGetProperty("documentId", out var document) ? document.GetString()! : "doc-phase1", ct).ConfigureAwait(false);
    }

    public async Task<JsonElement> SnapshotAsync(
        string documentId = "doc-phase1",
        CancellationToken ct = default)
    {
        var reply = await CallAsync(SessionMethods.Snapshot, GeneratedControl.Parameters(new Generated.SnapshotParams
            { DocumentId = documentId }), ct).ConfigureAwait(false);
        if (ServerCapabilities.Contains(SessionMethods.IncrementalDeltasCapability))
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
        _pending[requestId] = new(method, tcs, SessionAtSend: sessionId,
            DocumentAtSend: StringParameter(@params, "documentId"), LineageGenerationAtSend: _lineageGeneration);
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
                FailPending(p, new SessionException("CANCELLED", "session call cancelled"));
        }))
        {
            return await tcs.Task.ConfigureAwait(false);
        }
    }

    /// <summary>Request a checked native mesh at the caller's model revision.</summary>
    public async Task<SessionMeshResult> RequestMeshLodAsync(
        string bodyId,
        int quality,
        string documentId,
        long expectedRevision,
        CancellationToken ct = default,
        string? instanceId = null)
    {
        if (!ServerCapabilities.Contains(SessionMethods.BinaryMeshV1Capability))
            throw new SessionException("NOT_IMPLEMENTED", "server does not support binary-mesh-v1");
        if (string.IsNullOrWhiteSpace(bodyId) || string.IsNullOrWhiteSpace(documentId) ||
            (instanceId is not null && (instanceId.Length > 128 || instanceId.Length == 0 || instanceId.Any(ch =>
                !(ch is >= 'A' and <= 'Z' or >= 'a' and <= 'z' or >= '0' and <= '9' or '_' or '-')))) ||
            quality is < 0 or > 2 || expectedRevision < 0 || expectedRevision > SessionContract.MaximumRevision)
            throw new SessionException("BAD_PARAMS", "mesh identity, quality, or expected revision is invalid");
        var sessionId = SessionId;
        if (string.IsNullOrEmpty(sessionId))
            throw new SessionException("NOT_CONNECTED", "mesh request requires an active session");
        if (_knownSessionId != sessionId || _knownDocumentId != documentId || _knownRevision != expectedRevision)
            throw new SessionException("NEED_FULL_SNAPSHOT", "mesh request does not match the known model lineage and revision");
        if (_disposed != 0 || _ws.State != WebSocketState.Open)
            throw new SessionException("NOT_CONNECTED", "session socket is not open");

        var requestId = $"cs-{Interlocked.Increment(ref _seq)}";
        var completion = new TaskCompletionSource<SessionMeshResult>(TaskCreationOptions.RunContinuationsAsynchronously);
        var generation = _lineageGeneration;
        var mesh = new PendingMeshCall(requestId, sessionId, documentId, bodyId, instanceId,
            quality, expectedRevision, generation, completion);
        if (!_pending.TryAdd(requestId, new PendingCall(SessionMethods.RequestMeshLOD, null, mesh, sessionId, documentId, generation)))
            throw new SessionException("SEND_FAILED", "mesh request identity collision");

        using var cancellation = ct.Register(() => CancelPending(requestId));
        try
        {
            var envelope = new Dictionary<string, object?>
            {
                ["requestId"] = requestId,
                ["method"] = SessionMethods.RequestMeshLOD,
                ["params"] = GeneratedControl.Parameters(new Generated.RequestMeshLodParams
                {
                    BodyId = bodyId,
                    DocumentId = documentId,
                    ExpectedRevision = expectedRevision,
                    InstanceId = instanceId,
                    Quality = quality,
                }),
                ["sessionId"] = sessionId,
            };
            var text = JsonSerializer.Serialize(envelope);
            await _sendGate.WaitAsync(ct).ConfigureAwait(false);
            try
            {
                await _ws.SendAsync(Encoding.UTF8.GetBytes(text), WebSocketMessageType.Text, endOfMessage: true, ct).ConfigureAwait(false);
            }
            finally { _sendGate.Release(); }
        }
        catch (OperationCanceledException)
        {
            CancelPending(requestId);
        }
        catch (Exception error)
        {
            if (_pending.TryRemove(requestId, out var pending))
                FailPending(pending, new SessionException("SEND_FAILED", error.Message));
        }
        return await completion.Task.ConfigureAwait(false);
    }

    private void CancelPending(string requestId)
    {
        if (_pending.TryRemove(requestId, out var pending))
            FailPending(pending, new SessionException("CANCELLED", "session call cancelled"));
    }

    private void FailPending(PendingCall pending, SessionException error)
    {
        if (pending.Mesh is { } mesh)
        {
            RemoveMeshCorrelation(mesh);
            mesh.Completion.TrySetException(error);
        }
        else pending.Completion?.TrySetException(error);
    }

    private void RemoveMeshCorrelation(PendingMeshCall mesh)
    {
        var nativeId = mesh.Header?.NativeRequestId;
        if (nativeId is not null && _meshByNativeRequestId.TryGetValue(nativeId, out var current) && ReferenceEquals(current, mesh))
            _meshByNativeRequestId.TryRemove(nativeId, out _);
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
        var chunk = new byte[16 * 1024];
        try
        {
            while (!ct.IsCancellationRequested && _ws.State == WebSocketState.Open)
            {
                var type = WebSocketMessageType.Close;
                var received = 0;
                var bytes = new byte[16 * 1024];
                var ended = false;
                do
                {
                    var r = await _ws.ReceiveAsync(chunk, ct).ConfigureAwait(false);
                    if (r.MessageType == WebSocketMessageType.Close)
                    {
                        FailAll(new SessionException("CLOSED", "session socket closed before reply"));
                        return;
                    }
                    if (r.MessageType is not (WebSocketMessageType.Text or WebSocketMessageType.Binary))
                        throw new SessionException("INVALID_FRAME", "unsupported WebSocket message type");
                    if (type == WebSocketMessageType.Close) type = r.MessageType;
                    else if (type != r.MessageType)
                        throw new SessionException("INVALID_FRAME", "WebSocket message changed type between fragments");
                    var limit = type == WebSocketMessageType.Text ? MaxControlPayloadBytes : MaxMeshPayloadBytes;
                    if (r.Count > limit - received)
                        throw new SessionException("MESSAGE_TOO_LARGE", type == WebSocketMessageType.Text
                            ? "control message exceeds 4 MiB"
                            : "binary mesh exceeds 64 MiB");
                    var required = received + r.Count;
                    if (required > bytes.Length)
                    {
                        var capacity = Math.Min(limit, Math.Max(required, Math.Min(limit, bytes.Length * 2)));
                        Array.Resize(ref bytes, capacity);
                    }
                    Buffer.BlockCopy(chunk, 0, bytes, received, r.Count);
                    received = required;
                    if (r.EndOfMessage)
                    {
                        ended = true;
                        if (type == WebSocketMessageType.Text)
                            Route(StrictUtf8.GetString(bytes, 0, received));
                        else
                        {
                            var exact = new byte[received];
                            Buffer.BlockCopy(bytes, 0, exact, 0, received);
                            RouteBinary(exact);
                        }
                    }
                } while (!ended);
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            try { _ws.Abort(); } catch { }
            FailAll(ex as SessionException ?? new SessionException("RECEIVE_FAILED", ex.Message));
        }
    }

    private void Route(string text)
    {
        JsonDocument doc;
        try
        {
            doc = JsonDocument.Parse(text);
        }
        catch (JsonException error)
        {
            throw new SessionException("INVALID_JSON", error.Message);
        }
        using (doc)
        {
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) throw new SessionException("INVALID_JSON", "control message must be a JSON object");
            if (root.TryGetProperty("requestId", out var idProp) && idProp.ValueKind == JsonValueKind.String &&
                _pending.TryGetValue(idProp.GetString()!, out var pending))
            {
                if (!root.TryGetProperty("ok", out var ok) || ok.ValueKind != JsonValueKind.True)
                {
                    var code = root.TryGetProperty("errorCode", out var c) && c.ValueKind == JsonValueKind.String
                        ? c.GetString()!
                        : "SESSION_FAILED";
                    var message = root.TryGetProperty("error", out var m) && m.ValueKind == JsonValueKind.String
                        ? m.GetString()!
                        : "session call failed";
                    if (_pending.TryRemove(pending.Mesh?.RequestId ?? idProp.GetString()!, out var removed))
                        FailPending(removed, new SessionException(code, message));
                }
                else if (pending.Mesh is { } mesh)
                    RouteMeshHeader(root, pending, mesh);
                else
                {
                    if (!_pending.TryRemove(idProp.GetString()!, out var removed)) return;
                    if (pending.Method == SessionMethods.Snapshot && pending.LineageGenerationAtSend != _lineageGeneration)
                    {
                        FailPending(removed, new SessionException("NEED_FULL_SNAPSHOT", "snapshot reply belongs to a retired lineage"));
                        return;
                    }
                    ObserveReplyLineage(root, pending);
                    var cloned = root.Clone();
                    if (pending.Method == SessionMethods.Snapshot && ServerCapabilities.Contains(SessionMethods.IncrementalDeltasCapability))
                        QueueUpdate(() => { ApplySnapshot(cloned); return Task.CompletedTask; });
                    removed.Completion?.TrySetResult(cloned);
                }
                return;
            }
            if (root.TryGetProperty("event", out var ev) &&
                ev.ValueKind == JsonValueKind.String)
            {
                ObserveEventLineage(root, ev.GetString());
                var cloned = root.Clone();
                switch (ev.GetString())
                {
                    case "delta":
                        QueueUpdate(async () =>
                        {
                            if (ServerCapabilities.Contains(SessionMethods.IncrementalDeltasCapability))
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
                        if (ServerCapabilities.Contains(SessionMethods.IncrementalDeltasCapability))
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

    private void RouteMeshHeader(JsonElement root, PendingCall pending, PendingMeshCall mesh)
    {
        try
        {
            if (mesh.Header is not null) throw new SessionException("INVALID_HEADER", "duplicate mesh identity header");
            if (!root.TryGetProperty("result", out var raw)) throw new JsonException("missing mesh header result");
            var header = GeneratedControl.Read<Generated.MeshHeader>(raw, "MeshHeader");
            if (mesh.LineageGeneration != _lineageGeneration || _knownSessionId != mesh.SessionId ||
                _knownDocumentId != mesh.DocumentId || _knownRevision != mesh.ExpectedRevision)
                throw new SessionException("NEED_FULL_SNAPSHOT", "model lineage changed before the mesh header arrived");
            if (string.IsNullOrWhiteSpace(header.NativeRequestId) || header.NativeRequestId.Length > 256 ||
                string.IsNullOrWhiteSpace(header.SessionId) || string.IsNullOrWhiteSpace(header.DocumentId) ||
                string.IsNullOrWhiteSpace(header.BodyId) || string.IsNullOrWhiteSpace(header.FeatureId) ||
                string.IsNullOrWhiteSpace(header.TipId) || header.SessionId != mesh.SessionId ||
                header.DocumentId != mesh.DocumentId || header.BodyId != mesh.BodyId ||
                header.FeatureId != header.TipId || header.TipId.Length > 4096 ||
                header.InstanceId != mesh.InstanceId ||
                (mesh.InstanceId is not null && header.FeatureId != mesh.InstanceId) ||
                header.Quality != mesh.Quality || header.Revision != mesh.ExpectedRevision ||
                header.Revision < 0 || header.Revision > SessionContract.MaximumRevision ||
                header.ByteLength <= 0 || header.ByteLength > MaxMeshPayloadBytes)
                throw new SessionException("INVALID_HEADER", "mesh identity header does not match the pending request or current model");
            mesh.Header = header;
            if (!_meshByNativeRequestId.TryAdd(header.NativeRequestId, mesh))
                throw new SessionException("INVALID_HEADER", "native mesh request identity is already pending");
            if (!_pending.TryGetValue(mesh.RequestId, out var current) || !ReferenceEquals(current.Mesh, mesh))
                RemoveMeshCorrelation(mesh);
        }
        catch (Exception error)
        {
            if (_pending.TryRemove(mesh.RequestId, out var removed))
                FailPending(removed, error as SessionException ?? new SessionException("INVALID_HEADER", error.Message));
        }
    }

    private void RouteBinary(byte[] raw)
    {
        try
        {
            if (raw.Length == 0 || raw.Length > MaxMeshPayloadBytes)
                throw new SessionException("INVALID_MESH", "binary mesh has an invalid length");
            var verifier = new Verifier(new ByteBuffer(raw), new Options(64, MaxMeshTableCount, true, true));
            if (!verifier.VerifyBuffer(null, false, MeshUpdateVerify.Verify))
            {
                FailAllMeshes(new SessionException("INVALID_MESH", "FlatBuffer verification failed"));
                return;
            }
            var update = MeshUpdate.GetRootAsMeshUpdate(verifier.Buf);
            var nativeId = ReadFlatString(update.GetRequestIdBytes(), "native request id");
            if (!_meshByNativeRequestId.TryGetValue(nativeId, out var mesh) || mesh.Header is null) return;
            if (!_pending.TryGetValue(mesh.RequestId, out var pending) || !ReferenceEquals(pending.Mesh, mesh))
            {
                RemoveMeshCorrelation(mesh);
                return;
            }

            var result = DecodeMesh(raw, update, mesh);
            if (!_pending.TryRemove(mesh.RequestId, out var removed) || !ReferenceEquals(removed.Mesh, mesh)) return;
            RemoveMeshCorrelation(mesh);
            mesh.Completion.TrySetResult(result);
        }
        catch (Exception error)
        {
            var sessionError = error as SessionException ?? new SessionException("INVALID_MESH", error.Message);
            // If the raw identifier cannot be trusted yet, fail every pending mesh;
            // otherwise fail just the correlated query. Late canceled frames are ignored.
            PendingMeshCall? correlated = null;
            try
            {
                if (raw.Length >= 8)
                {
                    var verifier = new Verifier(new ByteBuffer(raw), new Options(64, MaxMeshTableCount, true, true));
                    if (verifier.VerifyBuffer(null, false, MeshUpdateVerify.Verify))
                    {
                        var update = MeshUpdate.GetRootAsMeshUpdate(verifier.Buf);
                        var id = ReadFlatString(update.GetRequestIdBytes(), "native request id");
                        _meshByNativeRequestId.TryGetValue(id, out correlated);
                    }
                }
            }
            catch { }
            if (correlated is not null && _pending.TryRemove(correlated.RequestId, out var pending))
                FailPending(pending, sessionError);
            else FailAllMeshes(sessionError);
        }
    }

    private SessionMeshResult DecodeMesh(byte[] raw, MeshUpdate update, PendingMeshCall mesh)
    {
        var header = mesh.Header ?? throw new SessionException("INVALID_HEADER", "mesh payload arrived before its header");
        if (raw.Length != header.ByteLength)
            throw new SessionException("INVALID_MESH", "binary mesh length does not match its header");
        var featureId = ReadFlatString(update.GetFeatureIdBytes(), "mesh feature id");
        var bodyId = ReadFlatString(update.GetBodyIdBytes(), "mesh body id");
        var requestId = ReadFlatString(update.GetRequestIdBytes(), "native request id");
        if (featureId != header.TipId || bodyId != header.TipId || requestId != header.NativeRequestId ||
            update.Lod != mesh.Quality || update.Revision != header.Revision)
            throw new SessionException("INVALID_MESH", "native mesh identity does not match its header");
        if (mesh.LineageGeneration != _lineageGeneration || _knownSessionId != header.SessionId ||
            _knownDocumentId != header.DocumentId || _knownRevision != header.Revision)
            throw new SessionException("NEED_FULL_SNAPSHOT", "native mesh belongs to a stale model lineage or revision");

        var positionsCount = (ulong)update.PositionsCount;
        var normalsCount = (ulong)update.NormalsCount;
        var indicesCount = (ulong)update.IndicesCount;
        if (positionsCount == 0 || positionsCount % 3 != 0 || normalsCount != positionsCount || indicesCount == 0 || indicesCount % 3 != 0 ||
            positionsCount * 4 != (ulong)update.PositionsLength || normalsCount * 4 != (ulong)update.NormalsLength ||
            indicesCount * 4 != (ulong)update.IndicesLength || update.EdgeVerticesLength % 12 != 0 ||
            update.FacesLength > MaxMeshTableCount || update.EdgesLength > MaxMeshTableCount || update.BboxMmLength != 6)
            throw new SessionException("INVALID_MESH", "native mesh vector sizes or counts are inconsistent");

        var vertexCount = positionsCount / 3;
        var triangleCount = indicesCount / 3;
        var edgeVertexCount = (ulong)update.EdgeVerticesLength / 12;
        var volume = update.VolumeMm3;
        if (double.IsNaN(volume) || double.IsInfinity(volume) || volume < 0)
            throw new SessionException("INVALID_MESH", "native mesh volume is invalid");
        var bbox = new double[6];
        for (var i = 0; i < bbox.Length; i++)
        {
            bbox[i] = update.BboxMm(i);
            if (double.IsNaN(bbox[i]) || double.IsInfinity(bbox[i]))
                throw new SessionException("INVALID_MESH", "native mesh bounding box is not finite");
        }
        if (bbox[0] > bbox[3] || bbox[1] > bbox[4] || bbox[2] > bbox[5])
            throw new SessionException("INVALID_MESH", "native mesh bounding box is not ordered");

        var positionsSegment = update.GetPositionsBytes();
        var normalsSegment = update.GetNormalsBytes();
        var indicesSegment = update.GetIndicesBytes();
        var edgeVerticesSegment = update.GetEdgeVerticesBytes();
        if (!positionsSegment.HasValue || !normalsSegment.HasValue || !indicesSegment.HasValue)
            throw new SessionException("INVALID_MESH", "native mesh data vector is missing");
        var positionsBytes = positionsSegment.Value.AsSpan();
        var normalsBytes = normalsSegment.Value.AsSpan();
        var indicesBytes = indicesSegment.Value.AsSpan();
        ReadOnlySpan<byte> edgeVerticesBytes = edgeVerticesSegment.HasValue
            ? edgeVerticesSegment.Value.AsSpan()
            : ReadOnlySpan<byte>.Empty;
        ValidateFloatVector(positionsBytes);
        ValidateFloatVector(normalsBytes);
        ValidateFloatVector(edgeVerticesBytes);
        ValidateIndices(indicesBytes, vertexCount);

        var faces = new List<SessionMeshFaceRange>(update.FacesLength);
        ulong previousFaceEnd = 0;
        for (var i = 0; i < update.FacesLength; i++)
        {
            var face = update.Faces(i) ?? throw new SessionException("INVALID_MESH", "native face range is missing");
            var id = ReadFlatString(face.GetPersistentFaceIdBytes(), "persistent face id");
            var end = (ulong)face.TriangleStart + face.TriangleCount;
            if (face.TriangleCount == 0 || face.TriangleStart < previousFaceEnd || end > triangleCount)
                throw new SessionException("INVALID_MESH", "native face ranges overlap or exceed triangle data");
            faces.Add(new(id, face.TriangleStart, face.TriangleCount));
            previousFaceEnd = end;
        }

        var edges = new List<SessionMeshEdgeRange>(update.EdgesLength);
        ulong previousEdgeEnd = 0;
        for (var i = 0; i < update.EdgesLength; i++)
        {
            var edge = update.Edges(i) ?? throw new SessionException("INVALID_MESH", "native edge range is missing");
            var id = ReadFlatString(edge.GetPersistentEdgeIdBytes(), "persistent edge id");
            var end = (ulong)edge.VertexStart + edge.VertexCount;
            if (edge.VertexCount == 0 || edge.VertexStart < previousEdgeEnd || end > edgeVertexCount)
                throw new SessionException("INVALID_MESH", "native edge ranges overlap or exceed edge vertex data");
            edges.Add(new(id, edge.VertexStart, edge.VertexCount));
            previousEdgeEnd = end;
        }

        var positions = DecodeFloatVector(positionsBytes);
        var normals = DecodeFloatVector(normalsBytes);
        var edgeVertices = DecodeFloatVector(edgeVerticesBytes);
        var indices = DecodeIndices(indicesBytes);
        return new SessionMeshResult(new SessionMeshHeader(header.NativeRequestId, header.SessionId, header.DocumentId,
            header.Revision, header.BodyId, header.FeatureId, header.TipId, checked((int)header.Quality),
            checked((int)header.ByteLength), header.InstanceId),
            positions, normals, indices, edgeVertices, faces.AsReadOnly(), edges.AsReadOnly(), volume, bbox, raw.Length,
            Sha256Hex(raw));
    }

    private static void ValidateFloatVector(ReadOnlySpan<byte> bytes)
    {
        if (bytes.Length % 4 != 0) throw new SessionException("INVALID_MESH", "native float vector length is invalid");
        for (var i = 0; i < bytes.Length / 4; i++)
        {
            var value = BitConverter.Int32BitsToSingle(BinaryPrimitives.ReadInt32LittleEndian(bytes.Slice(i * 4, 4)));
            if (float.IsNaN(value) || float.IsInfinity(value))
                throw new SessionException("INVALID_MESH", "native mesh contains a non-finite coordinate");
        }
    }

    private static void ValidateIndices(ReadOnlySpan<byte> bytes, ulong vertexCount)
    {
        if (bytes.Length % 4 != 0) throw new SessionException("INVALID_MESH", "native index vector length is invalid");
        for (var i = 0; i < bytes.Length / 4; i++)
            if (BinaryPrimitives.ReadUInt32LittleEndian(bytes.Slice(i * 4, 4)) >= vertexCount)
                throw new SessionException("INVALID_MESH", "native mesh index is out of bounds");
    }

    private static float[] DecodeFloatVector(ReadOnlySpan<byte> bytes)
    {
        var values = new float[bytes.Length / 4];
        for (var i = 0; i < values.Length; i++)
            values[i] = BitConverter.Int32BitsToSingle(BinaryPrimitives.ReadInt32LittleEndian(bytes.Slice(i * 4, 4)));
        return values;
    }

    private static uint[] DecodeIndices(ReadOnlySpan<byte> bytes)
    {
        var values = new uint[bytes.Length / 4];
        for (var i = 0; i < values.Length; i++)
            values[i] = BinaryPrimitives.ReadUInt32LittleEndian(bytes.Slice(i * 4, 4));
        return values;
    }

    private static string Sha256Hex(byte[] bytes)
    {
        using var sha = SHA256.Create();
        return string.Concat(sha.ComputeHash(bytes).Select(value => value.ToString("x2", CultureInfo.InvariantCulture)));
    }

    private static string ReadFlatString(ArraySegment<byte>? bytes, string name)
    {
        if (!bytes.HasValue || bytes.Value.Count == 0 || bytes.Value.Count > 4096)
            throw new SessionException("INVALID_MESH", name + " is missing or too long");
        try { return StrictUtf8.GetString(bytes.Value.Array!, bytes.Value.Offset, bytes.Value.Count); }
        catch (DecoderFallbackException error) { throw new SessionException("INVALID_MESH", name + " is not valid UTF-8: " + error.Message); }
    }

    private static string? StringParameter(IDictionary<string, object?> parameters, string name)
    {
        if (!parameters.TryGetValue(name, out var raw)) return null;
        return raw switch
        {
            string text => text,
            JsonElement { ValueKind: JsonValueKind.String } element => element.GetString(),
            _ => null,
        };
    }

    private static string? StringProperty(JsonElement value, string name) =>
        value.ValueKind == JsonValueKind.Object && value.TryGetProperty(name, out var property) && property.ValueKind == JsonValueKind.String
            ? property.GetString() : null;

    private static long? SafeRevision(JsonElement value, string name) =>
        value.ValueKind == JsonValueKind.Object && value.TryGetProperty(name, out var revision) && revision.TryGetInt64(out var parsed) &&
        parsed >= 0 && parsed <= SessionContract.MaximumRevision ? parsed : null;

    private void ObserveReplyLineage(JsonElement root, PendingCall pending)
    {
        if (root.ValueKind != JsonValueKind.Object || pending.LineageGenerationAtSend != _lineageGeneration) return;
        if (pending.Method == SessionMethods.Hello)
        {
            ObserveHello(root);
            return;
        }
        if (pending.Method == SessionMethods.Snapshot)
        {
            ObserveSnapshotReply(root, pending);
            return;
        }
        ObserveCurrentRevision(root);
        if (root.TryGetProperty("result", out var result) && result.ValueKind == JsonValueKind.Object)
            ObserveCurrentRevision(result);
    }

    private void ObserveHello(JsonElement value)
    {
        var session = StringProperty(value, "sessionId");
        if (string.IsNullOrWhiteSpace(session)) return;
        _knownSessionId = session;
        _knownDocumentId = StringProperty(value, "documentId");
        _knownRevision = SafeRevision(value, "revision");
    }

    private void ObserveSnapshotReply(JsonElement value, PendingCall pending)
    {
        var session = StringProperty(value, "sessionId");
        var document = StringProperty(value, "documentId");
        var revision = SafeRevision(value, "revision");
        if (string.IsNullOrWhiteSpace(session) || string.IsNullOrWhiteSpace(document) || !revision.HasValue ||
            pending.LineageGenerationAtSend != _lineageGeneration ||
            pending.SessionAtSend != _knownSessionId ||
            (pending.DocumentAtSend is not null && pending.DocumentAtSend != document) ||
            (pending.SessionAtSend is not null && pending.SessionAtSend != session) ||
            (_knownDocumentId is not null && _knownDocumentId != document)) return;
        _knownSessionId = session;
        _knownDocumentId = document;
        if (!_knownRevision.HasValue || revision.Value >= _knownRevision.Value) _knownRevision = revision;
    }

    private void ObserveCurrentRevision(JsonElement value)
    {
        var session = StringProperty(value, "sessionId");
        var document = StringProperty(value, "documentId");
        var revision = SafeRevision(value, "revision");
        if (session != _knownSessionId || document != _knownDocumentId || !revision.HasValue) return;
        if (!_knownRevision.HasValue || revision.Value >= _knownRevision.Value) _knownRevision = revision;
    }

    private void ObserveEventLineage(JsonElement root, string? eventName)
    {
        if (eventName == "core-restarted")
        {
            Interlocked.Increment(ref _lineageGeneration);
            _knownSessionId = StringProperty(root, "sessionId");
            _knownDocumentId = StringProperty(root, "documentId") ?? _knownDocumentId;
            _knownRevision = SafeRevision(root, "revision");
            SessionId = _knownSessionId;
            return;
        }
        if (eventName == "snapshot-required")
        {
            var replacementSession = StringProperty(root, "sessionId");
            var replacementDocument = StringProperty(root, "documentId");
            if (string.IsNullOrWhiteSpace(replacementSession) || string.IsNullOrWhiteSpace(replacementDocument)) return;
            Interlocked.Increment(ref _lineageGeneration);
            _knownSessionId = replacementSession;
            _knownDocumentId = replacementDocument;
            _knownRevision = SafeRevision(root, "revision");
            SessionId = replacementSession;
            return;
        }
        if (eventName != "delta") return;
        var session = StringProperty(root, "sessionId");
        var document = StringProperty(root, "documentId");
        var revision = SafeRevision(root, "revision");
        var baseRevision = SafeRevision(root, "baseRevision");
        var newRevision = SafeRevision(root, "newRevision");
        if (string.IsNullOrWhiteSpace(session) || string.IsNullOrWhiteSpace(document) || !revision.HasValue ||
            !baseRevision.HasValue || !newRevision.HasValue || revision != newRevision || newRevision <= baseRevision) return;
        if (session != _knownSessionId || document != _knownDocumentId)
        {
            // A zero-based delta is the first authoritative update in a new
            // document lineage; retire snapshots/meshes from the prior one.
            if (baseRevision.Value != 0) return;
            Interlocked.Increment(ref _lineageGeneration);
            _knownSessionId = session;
            _knownDocumentId = document;
            _knownRevision = revision;
            SessionId = session;
            return;
        }
        if (!_knownRevision.HasValue || revision.Value >= _knownRevision.Value) _knownRevision = revision;
    }

    private void FailAll(SessionException ex)
    {
        foreach (var key in _pending.Keys)
        {
            if (_pending.TryRemove(key, out var pending))
                FailPending(pending, ex);
        }
        _meshByNativeRequestId.Clear();
    }

    private void FailAllMeshes(SessionException ex)
    {
        foreach (var key in _pending.Keys)
        {
            if (_pending.TryGetValue(key, out var pending) && pending.Mesh is not null &&
                _pending.TryRemove(key, out var removed))
                FailPending(removed, ex);
        }
        _meshByNativeRequestId.Clear();
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
        if ((_knownSessionId is not null && snapshot.SessionId != _knownSessionId) ||
            (_knownDocumentId is not null && snapshot.DocumentId != _knownDocumentId) ||
            (_knownRevision.HasValue && snapshot.Revision < _knownRevision.Value)) return;
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
