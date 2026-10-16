using System.Text.Json;
using System.Text.Json.Serialization;
using Kreoda.ModelingAgent;
using Kreoda.Session;

namespace Kreoda.HermesBridge;

public sealed record CadCheck(string Method, JsonElement Parameters, string Path, double Expected, double Tolerance = .001);

/// <summary>A bounded transaction adapter. Hermes retains its own planning and tool loop.</summary>
public sealed class CadBridge(Func<CancellationToken, Task<SessionClient>> connect, TimeSpan? operationTimeout = null,
    Func<JsonElement, Task>? persistRecovery = null, JsonElement? initialRecovery = null) : IAsyncDisposable
{
    static readonly JsonSerializerOptions ProjectionJsonOptions = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };
    readonly SemaphoreSlim _gate = new(1, 1);
    readonly TimeSpan _operationTimeout = ValidTimeout(operationTimeout ?? TimeSpan.FromSeconds(15));
    SessionClient? _client;
    Request? _request;
    VoiceScope? _voice;
    JsonElement? _rollbackRecovery = initialRecovery?.Clone();
    bool _recoveryPersisted = initialRecovery.HasValue;
    void RequireRecovered()
    {
        if (_rollbackRecovery is JsonElement recovery) throw new CadRecoveryRequiredException(recovery, _recoveryPersisted);
    }
    sealed class VoiceScope(string id, SessionModelState model, AgentLimits limits)
    {
        public string Id { get; } = id;
        public SessionModelState Model { get; } = model;
        public bool Committed;
        public AgentBudget Budget { get; } = new(limits);
        public string? Checks;
        public int Attempts;
    }
    sealed class Request(string id, SessionModelState model, AgentCommandCatalog catalog, AgentLimits limits, CadCheck[] checks, AgentBudget? budget = null)
    {
        public string Id { get; } = id;
        public string Transaction { get; } = Guid.NewGuid().ToString("D");
        public SessionModelState Model { get; } = model;
        public AgentCommandCatalog Catalog { get; } = catalog;
        public AgentBudget Budget { get; } = budget ?? new(limits);
        public CadCheck[] Checks { get; } = checks;
        public Dictionary<string, string> Aliases { get; } = new(StringComparer.Ordinal);
        public CancellationTokenSource Expiry { get; } = new();
        public string? Origin;
        public bool ExpiryStopped;
    }
    static TimeSpan ValidTimeout(TimeSpan timeout) => timeout > TimeSpan.Zero && timeout <= TimeSpan.FromMinutes(2)
        ? timeout : throw new ArgumentOutOfRangeException(nameof(timeout));
    static JsonElement Json(object value) => JsonSerializer.SerializeToElement(value);
    async Task<SessionClient> Client(CancellationToken ct) => _client ??= await connect(ct);
    static void RequireCurrent(SessionClient client, Request request)
    {
        var model = client.Model;
        if (client.SessionId != request.Model.SessionId || model?.SessionId != request.Model.SessionId ||
            model.DocumentId != request.Model.DocumentId || model.Revision != request.Model.Revision)
            throw new SessionException("NEED_FULL_SNAPSHOT", "CAD document changed during this request");
        request.Budget.RequireTime();
    }
    Request Owned(string? id) => _request is not null && id == _request.Id ? _request
        : throw new SessionException("NOT_OWNER", "No matching active CAD request");
    static CancellationTokenSource Deadline(Request request, CancellationToken caller)
    {
        var remaining = request.Budget.Remaining;
        if (remaining <= TimeSpan.Zero) throw new AgentBudgetExceededException("time");
        var deadline = CancellationTokenSource.CreateLinkedTokenSource(caller);
        deadline.CancelAfter(remaining);
        return deadline;
    }

    public async Task<string> BeginAsync(string goal, IReadOnlyList<CadCheck> checks, AgentLimits? limits = null, CancellationToken ct = default, string? originRequestId = null)
    {
        if (string.IsNullOrWhiteSpace(goal) || goal.Length > 4096 || checks.Count is < 1 or > 32 || checks.Any(c =>
            !AgentCommandCatalog.IsReadOnlyQuery(c.Method) || c.Parameters.ValueKind != JsonValueKind.Object ||
            string.IsNullOrWhiteSpace(c.Path) || c.Path.Length > 128 || !double.IsFinite(c.Expected) ||
            !double.IsFinite(c.Tolerance) || c.Tolerance < 0 || c.Tolerance > 1000000))
            throw new ArgumentException("A request requires bounded machine-checkable goals");
        await _gate.WaitAsync(ct);
        try {
            RequireRecovered();
            if (_request is not null) throw new SessionException("LOCKED", "Another CAD request is active");
            var client = await Client(ct);
            await client.SnapshotAsync(client.Model?.DocumentId ?? "doc-phase1", ct);
            var model = client.Model ?? throw new SessionException("NEED_FULL_SNAPSHOT", "CAD snapshot unavailable");
            if (_voice is not null && (originRequestId != _voice.Id || _voice.Committed))
                throw new SessionException("LOCKED", "Voice CAD request requires its originating voiceRequestId and one Undo group");
            if (_voice is null && originRequestId is not null) throw new SessionException("NOT_OWNER", "Voice request has ended");
            if (_voice is not null && (model.SessionId != _voice.Model.SessionId || model.DocumentId != _voice.Model.DocumentId || model.Revision != _voice.Model.Revision))
                throw new SessionException("NEED_FULL_SNAPSHOT", "Voice document changed before CAD execution");
            if (_voice is not null) {
                var expectedChecks = JsonSerializer.Serialize(checks);
                if (_voice.Checks is not null && _voice.Checks != expectedChecks) throw new ArgumentException("Voice corrections must preserve original goal checks");
                if (_voice.Attempts > 0) _voice.Budget.Correction();
                _voice.Checks = expectedChecks;_voice.Attempts++;
            }
            var catalog = await AgentCommandCatalog.LoadAsync(client, ct);
            var request = new Request(Guid.NewGuid().ToString("D"), model, catalog, limits ?? new(),
                checks.Select(c => c with { Parameters = c.Parameters.Clone() }).ToArray(), _voice?.Budget);
            CancellationTokenSource deadline;
            try { deadline = Deadline(request, ct); }
            catch { request.Expiry.Dispose();throw; }
            using var ownedDeadline = deadline;
            _request = request;
            request.Origin = originRequestId;
            try {
                await client.CallAsync(SessionMethods.TxnBegin, new Dictionary<string, object?> {
                    ["transactionId"] = request.Transaction, ["documentId"] = model.DocumentId,
                }, deadline.Token, expectedSessionId: model.SessionId, beforeSend: () => RequireCurrent(client, request));
            } catch { await Rollback(request);throw; }
            _ = ExpireAsync(request);
            return request.Id;
        } finally { _gate.Release(); }
    }

    public async Task<JsonElement> DescribeAsync(CancellationToken ct = default)
    {
        await _gate.WaitAsync(ct);
        try {
            if (_rollbackRecovery is JsonElement recovery)
                return Json(new { status = "uncertain", errorCode = "ROLLBACK_UNCONFIRMED", recovery, recoveryPersisted = _recoveryPersisted });
            var client = await Client(ct);
            _voice?.Budget.Action();
            var model = _request?.Model ?? client.Model ?? throw new SessionException("NEED_FULL_SNAPSHOT", "CAD snapshot unavailable");
            return Json(new { project = "Kreoda", units = "mm; explicit degrees/radians per parameter", sessionId = model.SessionId,
                documentId = model.DocumentId, revision = model.Revision, features = model.Features, sketches = model.Sketches, datums = model.Datums,
                bodies = model.Bodies, requestActive = _request is not null, snapshotScope = "committed baseline" });
        } finally { _gate.Release(); }
    }

    public async Task<JsonElement> QueryAsync(string? requestId, string method, JsonElement parameters, CancellationToken ct = default)
    {
        if (!AgentCommandCatalog.IsReadOnlyQuery(method)) throw new ArgumentException("Method is not a permitted read-only CAD query");
        await _gate.WaitAsync(ct);
        try {
            RequireRecovered();
            var client = await Client(ct);
            Request? request = _request is null ? null : Owned(requestId);
            if (request is not null) { RequireCurrent(client, request);request.Budget.Action(); }
            else _voice?.Budget.Action();
            var fields = Fields(parameters, request);
            fields["documentId"] = request?.Model.DocumentId ?? client.Model?.DocumentId ?? "doc-phase1";
            using var deadline = request is null ? CancellationTokenSource.CreateLinkedTokenSource(ct) : Deadline(request, ct);
            if (request is null) deadline.CancelAfter(TimeSpan.FromSeconds(15));
            if (method == SessionMethods.GetSketchProjection)
            {
                if (!fields.TryGetValue("featureId", out var rawFeatureId) || rawFeatureId is not JsonElement { ValueKind: JsonValueKind.String } featureId)
                    throw new ArgumentException("getSketchProjection requires a featureId");
                string? groupId = null;
                if (fields.TryGetValue("groupId", out var rawGroupId) && rawGroupId is JsonElement groupValue && groupValue.ValueKind != JsonValueKind.Null)
                {
                    if (groupValue.ValueKind != JsonValueKind.String) throw new ArgumentException("groupId must be a string");
                    groupId = groupValue.GetString();
                }
                long? expectedRevision = null;
                if (fields.TryGetValue("expectedRevision", out var rawRevision))
                {
                    if (rawRevision is not JsonElement { ValueKind: JsonValueKind.Number } revisionValue || !revisionValue.TryGetInt64(out var parsedRevision))
                        throw new ArgumentException("expectedRevision must be an integer");
                    expectedRevision = parsedRevision;
                }
                var projection = await client.GetSketchProjectionAsync(featureId.GetString()!, groupId, expectedRevision, deadline.Token);
                return JsonSerializer.SerializeToElement(projection.Result, ProjectionJsonOptions);
            }
            var reply = await client.CallAsync(method, fields, deadline.Token, expectedSessionId: client.SessionId);
            return reply.GetProperty("result").Clone();
        } finally { _gate.Release(); }
    }

    public async Task<JsonElement> CommandAsync(string requestId, string commandId, JsonElement parameters, string? newFeatureAlias = null, CancellationToken ct = default)
    {
        await _gate.WaitAsync(ct);
        try {
            RequireRecovered();
            var request = Owned(requestId);var client = await Client(ct);RequireCurrent(client, request);
            var command = request.Catalog.Require(commandId);
            if (newFeatureAlias is not null && (newFeatureAlias.Length is < 1 or > 64 ||
                newFeatureAlias.Any(c => !char.IsAsciiLetterOrDigit(c) && c != '_') || request.Aliases.ContainsKey(newFeatureAlias)))
                throw new ArgumentException("New feature alias must be unique and bounded");
            var count = command.CreatedFeatureCount(parameters);
            if (newFeatureAlias is not null && count != 1) throw new ArgumentException("An alias identifies one new feature");
            var fields = Fields(parameters, request);
            // Observable CAD command attempts; Hermes separately bounds its native model loop.
            request.Budget.Iteration();
            request.Budget.Action(count);
            var id = command.Creation.FixedCount == 1 ? Guid.NewGuid().ToString("D") : null;
            var createdId = id ?? (count == 1 && command.Creation.IdArrayParameter is string ids
                ? parameters.GetProperty(ids)[0].GetString() : null);
            using var deadline = Deadline(request, ct);
            // References and complete parameter validation remain authoritative on the PC.
            var payload = new Dictionary<string, object?> {
                ["commandId"] = commandId, ["parameters"] = fields,
                ["documentId"] = request.Model.DocumentId, ["baseRevision"] = request.Model.Revision,
                ["transactionId"] = request.Transaction,
            };
            if (id is not null) payload["featureId"] = id;
            var reply = await client.CallAsync(SessionMethods.Command, payload, deadline.Token,
                expectedSessionId: request.Model.SessionId, beforeSend: () => RequireCurrent(client, request));
            if (reply.GetProperty("status").GetString() != "ok") throw new SessionException("COMMAND_FAILED", "CAD command failed");
            if (newFeatureAlias is not null) request.Aliases.Add(newFeatureAlias, createdId!);
            return Json(new { result = reply, featureId = createdId, alias = newFeatureAlias });
        } finally { _gate.Release(); }
    }

    public async Task<JsonElement> CommitAsync(string requestId, CancellationToken ct = default)
    {
        await _gate.WaitAsync(ct);
        try {
            RequireRecovered();
            var request = Owned(requestId);var client = await Client(ct);RequireCurrent(client, request);
            using var deadline = Deadline(request, ct);
            request.Budget.Action();
            var validation = (await client.CallAsync(SessionMethods.ValidateDocument, new Dictionary<string, object?>(), deadline.Token)).GetProperty("result");
            var passed = validation.TryGetProperty("valid", out var valid) && valid.ValueKind == JsonValueKind.True;
            var measurements = new List<object>();
            foreach (var check in request.Checks) {
                request.Budget.Action();
                var fields = Fields(check.Parameters, request);fields["documentId"] = request.Model.DocumentId;
                var result = (await client.CallAsync(check.Method, fields, deadline.Token, expectedSessionId: request.Model.SessionId)).GetProperty("result");
                var actual = NumberAt(result, check.Path);
                var ok = double.IsFinite(actual) && Math.Abs(actual - check.Expected) <= check.Tolerance;
                passed &= ok;measurements.Add(new { check.Method, check.Path, check.Expected,
                    actual = double.IsFinite(actual) ? (double?)actual : null, check.Tolerance, passed = ok });
            }
            if (!passed) { await Rollback(request);return Json(new { status = "validation_failed", measurements }); }
            var operation = Guid.NewGuid().ToString("D");var sent = false;
            var fieldsCommit = new Dictionary<string, object?> { ["transactionId"] = request.Transaction, ["documentId"] = request.Model.DocumentId };
            async Task<JsonElement> SendCommit()
            {
                using var timeout = Deadline(request, ct);
                if (request.Budget.Remaining > _operationTimeout) timeout.CancelAfter(_operationTimeout);
                return await client.CallAsync(SessionMethods.TxnCommit, fieldsCommit, timeout.Token, operation, request.Model.SessionId,
                    () => {
                        if (!sent) RequireCurrent(client, request);
                        if (client.SessionId != request.Model.SessionId || client.Model?.DocumentId != request.Model.DocumentId)
                            throw new SessionException("NEED_FULL_SNAPSHOT", "Commit lineage changed");
                        sent = true;
                    });
            }
            try {
                JsonElement reply;
                try { reply = await SendCommit(); }
                catch (SessionException error) when (sent && !ct.IsCancellationRequested && request.Budget.Remaining > TimeSpan.Zero &&
                    error.Code is "CANCELLED" or "SEND_FAILED") {
                    using var timeout = Deadline(request, ct);timeout.CancelAfter(TimeSpan.FromSeconds(5));
                    await client.SnapshotAsync(request.Model.DocumentId, timeout.Token);
                    if (client.SessionId != request.Model.SessionId || client.Model?.SessionId != request.Model.SessionId || client.Model.DocumentId != request.Model.DocumentId)
                        throw new SessionException("UNCERTAIN", "Commit reconciliation crossed a lineage change");
                    reply = await SendCommit();
                }
                if (reply.GetProperty("status").GetString() != "ok") throw new SessionException("UNCERTAIN", "CAD commit result unavailable");
                StopExpiry(request);
                if (_voice is not null && _voice.Id == request.Origin) _voice.Committed = true;
                _request = null;
                return Json(new { status = "committed", measurements, result = reply, requestId });
            } catch (Exception error) when (sent && (error is JsonException or InvalidOperationException || error is SessionException session &&
                session.Code is "CANCELLED" or "DISCONNECTED" or "SEND_FAILED" or "NOT_CONNECTED" or "UNCERTAIN" or "NEED_FULL_SNAPSHOT")) {
                // Do not guess whether a sent commit happened or issue a new transaction.
                StopExpiry(request);
                await client.DisposeAsync();_client = null;_request = null;
                return Json(new { status = "uncertain", operationId = operation, requestId, errorCode = (error as SessionException)?.Code ?? "INVALID_REPLY" });
            }
        } catch {
            if (_request is not null) await Rollback(_request);
            throw;
        } finally { _gate.Release(); }
    }

    public async Task CancelAsync(string requestId, CancellationToken ct = default)
    {
        await _gate.WaitAsync(ct);
        try { RequireRecovered();await Rollback(Owned(requestId)); } finally { _gate.Release(); }
    }
    public async Task<string> BeginVoiceAsync(JsonElement context, CancellationToken ct = default, AgentLimits? limits = null)
    {
        if (context.ValueKind != JsonValueKind.Object || !context.TryGetProperty("voiceRequestId", out var origin) || origin.ValueKind != JsonValueKind.String ||
            origin.GetString()!.Length is < 1 or > 128) throw new ArgumentException("Missing voice request identity");
        await _gate.WaitAsync(ct);
        try {
            RequireRecovered();
            if (_voice is not null || _request is not null) throw new SessionException("LOCKED", "Another CAD request is active");
            var client = await Client(ct);var model = client.Model ?? throw new SessionException("NEED_FULL_SNAPSHOT", "CAD snapshot unavailable");
            if (!context.TryGetProperty("sessionId", out var session) || session.GetString() != model.SessionId ||
                !context.TryGetProperty("documentId", out var document) || document.GetString() != model.DocumentId ||
                !context.TryGetProperty("revision", out var revision) || !revision.TryGetInt64(out var value) || value != model.Revision)
                throw new SessionException("NEED_FULL_SNAPSHOT", "Quest voice context is stale");
            _voice = new(origin.GetString()!, model, limits ?? new());return _voice.Id;
        } finally { _gate.Release(); }
    }
    public async Task<bool> EndVoiceAsync(string origin)
    {
        await _gate.WaitAsync();
        try {
            if (_voice?.Id != origin) return false;
            var unfinished = _request?.Origin == origin;
            try { if (unfinished) await Rollback(_request!);return unfinished; }
            finally { _voice = null; }
        } finally { _gate.Release(); }
    }
    async Task Rollback(Request request)
    {
        StopExpiry(request);
        try {
            if (_client is null || _client.SessionId != request.Model.SessionId)
                throw new SessionException("NEED_FULL_SNAPSHOT", "Cannot confirm rollback in the original session");
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            await _client.TxnRollbackAsync(request.Transaction, request.Model.DocumentId, timeout.Token);
        } catch (Exception error) {
            _rollbackRecovery = Json(new { requestId = request.Id, transactionId = request.Transaction,
                sessionId = request.Model.SessionId, documentId = request.Model.DocumentId,
                baseRevision = request.Model.Revision, ownerClientId = _client?.ClientId,
                causeCode = (error as SessionException)?.Code ?? error.GetType().Name });
            _recoveryPersisted = false;
            if (persistRecovery is not null) {
                try { await persistRecovery(_rollbackRecovery.Value);_recoveryPersisted = true; }
                catch { /* Caller receives recovery identity even if private persistence failed. */ }
            }
            try { if (_client is not null) await _client.DisposeAsync(); }
            catch { /* Disconnect fallback is not proof of rollback. */ }
            _client = null;
            throw new CadRecoveryRequiredException(_rollbackRecovery.Value, _recoveryPersisted);
        } finally { _request = null; }
    }
    static void StopExpiry(Request request)
    {
        if (request.ExpiryStopped) return;request.ExpiryStopped = true;
        request.Expiry.Cancel();request.Expiry.Dispose();
    }
    async Task ExpireAsync(Request request)
    {
        try { await Task.Delay(request.Budget.Remaining > TimeSpan.Zero ? request.Budget.Remaining : TimeSpan.Zero, request.Expiry.Token); }
        catch (OperationCanceledException) { return; }
        await _gate.WaitAsync();
        try { if (ReferenceEquals(_request, request)) await Rollback(request); }
        catch (CadRecoveryRequiredException) { /* Recorded and fenced; no unobserved expiry failure. */ }
        finally { _gate.Release(); }
    }
    static Dictionary<string, object?> Fields(JsonElement parameters, Request? request)
    {
        if (parameters.ValueKind != JsonValueKind.Object || parameters.GetRawText().Length > 262144)
            throw new ArgumentException("CAD parameters must be a bounded object");
        object? Resolve(JsonElement value) => value.ValueKind switch {
            JsonValueKind.Object => value.EnumerateObject().ToDictionary(p => p.Name, p => Resolve(p.Value)),
            JsonValueKind.Array => value.EnumerateArray().Select(Resolve).ToArray(),
            JsonValueKind.String when value.GetString()!.StartsWith('$') => request is not null && request.Aliases.TryGetValue(value.GetString()![1..], out var id)
                ? id : throw new ArgumentException("Unknown new-feature alias"),
            _ => value.Clone(),
        };
        return parameters.EnumerateObject().ToDictionary(p => p.Name, p => Resolve(p.Value));
    }
    static double NumberAt(JsonElement result, string path)
    {
        foreach (var part in path.Split('.')) {
            if (result.ValueKind == JsonValueKind.Object && result.TryGetProperty(part, out var property)) result = property;
            else if (result.ValueKind == JsonValueKind.Array && int.TryParse(part, out var index) && index >= 0 && index < result.GetArrayLength()) result = result[index];
            else return double.NaN;
        }
        return result.ValueKind == JsonValueKind.Number && result.TryGetDouble(out var number) ? number : double.NaN;
    }
    public async ValueTask DisposeAsync()
    {
        await _gate.WaitAsync();
        try {
            if (_request is not null) await Rollback(_request);
        } finally {
            try { if (_client is not null) await _client.DisposeAsync(); }
            finally { _client = null;_gate.Release(); }
        }
    }
}
