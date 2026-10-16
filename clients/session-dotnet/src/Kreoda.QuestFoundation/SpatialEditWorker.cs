using System.Diagnostics;
using System.Text.Json;
using Kreoda.Session;

namespace Kreoda.QuestFoundation;

public enum SpatialEditStatus { Committed, Cancelled, Failed, Uncertain }
public enum SpatialEditPhase { Dormant, Beginning, Dragging, Committing, Completed }
public sealed record SpatialEditOutcome(SpatialEditStatus Status, string? ErrorCode = null);

/// <summary>One gesture owns one serialized network loop. Submit predicts locally;
/// network work stays off the frame loop. Events run on the worker thread.</summary>
public sealed class SpatialEditWorker : IAsyncDisposable
{
    readonly SessionClient _client;
    readonly object _gate = new();
    readonly TimeSpan _timeout;
    readonly TaskCompletionSource<bool> _ready = new(TaskCreationOptions.RunContinuationsAsynchronously);
    readonly TaskCompletionSource<SpatialEditOutcome> _done = new(TaskCreationOptions.RunContinuationsAsynchronously);
    IReadOnlyDictionary<string, double> _draft;
    long _version, _processed, _generation, _lastUpdate;
    string? _previewId;
    bool _cancel, _release;
    bool _commitSent, _commitConfirmed;
    SpatialEditPhase _phase;
    public SpatialEditIntent Intent { get; }
    public SpatialEditPhase Phase { get { lock (_gate) return _phase; } }
    public Task<SpatialEditOutcome> Completion => _done.Task;
    public event Action<SessionPreviewMeshResult>? PreviewReady;
    public bool IsPreviewCurrent(SessionPreviewMeshResult mesh)
    {
        lock (_gate) return !_cancel && !_commitConfirmed && _phase is SpatialEditPhase.Dragging or SpatialEditPhase.Committing &&
            _version == _processed && mesh.Header.PreviewId == _previewId && mesh.Header.Generation == _generation &&
            mesh.Header.SessionId == Intent.SessionId && mesh.Header.DocumentId == Intent.DocumentId &&
            mesh.Header.BaseRevision == Intent.BaseRevision && _client.Model?.Revision == Intent.BaseRevision &&
            _client.Model.SessionId == Intent.SessionId && mesh.Header.FeatureId == Intent.FeatureId &&
            mesh.Header.TargetTipId == Intent.TargetTipId;
    }

    public SpatialEditWorker(SessionClient client, SpatialEditIntent intent, TimeSpan? operationTimeout = null)
    {
        _client = client;Intent = intent;_draft = intent.InitialValues;
        _timeout = operationTimeout ?? TimeSpan.FromSeconds(15);
        if (_timeout <= TimeSpan.Zero || _timeout > TimeSpan.FromMinutes(2)) throw new ArgumentException("invalid operation timeout");
        if (!_client.ServerCapabilities.Contains(SessionMethods.BinaryPreviewV1Capability))
            throw new SessionException("NOT_IMPLEMENTED", "PC does not support spatial preview meshes");
    }
    public Task BeginAsync()
    {
        lock (_gate) {
            if (_phase != SpatialEditPhase.Dormant) throw new InvalidOperationException("gesture already started");
            _phase = SpatialEditPhase.Beginning;
        }
        _client.ModelChanged += ModelChanged;
        _ = Task.Run(RunAsync);
        return _ready.Task;
    }
    public void Submit(IReadOnlyDictionary<string, double> values)
    {
        var draft = Intent.Exact(values);
        lock (_gate) {
            if (_cancel || _release || _phase is SpatialEditPhase.Dormant or SpatialEditPhase.Committing or SpatialEditPhase.Completed)
                throw new InvalidOperationException("gesture no longer accepts drafts");
            _draft = draft;_version++;
        }
    }
    public Task<SpatialEditOutcome> ReleaseAsync()
    {
        lock (_gate) {
            if (_phase == SpatialEditPhase.Dormant) throw new InvalidOperationException("gesture not started");
            _release = true;
        }
        return Completion;
    }
    public Task<SpatialEditOutcome> CancelAsync()
    {
        lock (_gate) {
            if (_phase == SpatialEditPhase.Dormant) {
                _phase = SpatialEditPhase.Completed;_ready.TrySetResult(true);
                _done.TrySetResult(new(SpatialEditStatus.Cancelled));
            } else _cancel = true;
        }
        return Completion;
    }
    void ModelChanged(SessionModelUpdate update)
    {
        lock (_gate) {
            if (_phase == SpatialEditPhase.Committing || _phase == SpatialEditPhase.Completed) return;
            if (update.Model.SessionId != Intent.SessionId || update.Model.DocumentId != Intent.DocumentId || update.Model.Revision != Intent.BaseRevision)
                _cancel = true;
        }
    }
    void RequireCurrentModel()
    {
        var model = _client.Model;
        if (_client.SessionId != Intent.SessionId || model is null || model.SessionId != Intent.SessionId ||
            model.DocumentId != Intent.DocumentId || model.Revision != Intent.BaseRevision ||
            !model.Features.Any(f => f.GetProperty("featureId").GetString() == Intent.FeatureId))
            throw new SessionException("NEED_FULL_SNAPSHOT", "gesture intent is no longer current");
    }
    Dictionary<string, object?> Values(IReadOnlyDictionary<string, double> values) => new() {
        ["valueMm"] = values[Intent.Parameters[0]],
        ["previewValues"] = values.Where(p => p.Key != Intent.Parameters[0]).ToDictionary(p => p.Key, p => p.Value),
    };
    async Task<JsonElement> Call(string method, Dictionary<string, object?> parameters, string operation)
    {
        using var timeout = new CancellationTokenSource(_timeout);
        return await _client.CallAsync(method, parameters, timeout.Token, operation, Intent.SessionId,
            method == SessionMethods.PreviewCommit ? AuthorizeCommitSend : null).ConfigureAwait(false);
    }
    void AuthorizeCommitSend()
    {
        lock (_gate) {
            // After this boundary a send may have reached the PC: cancellation
            // must resolve that same operation rather than promise rollback.
            if (_commitSent) return;
            if (_cancel) throw new SessionException("EDIT_CANCELLED", "gesture cancelled before commit send");
            RequireCurrentModel();
            _commitSent = true;
        }
    }
    static bool TransportFailure(SessionException error) => error.Code is "CANCELLED" or "SEND_FAILED" or "NOT_CONNECTED" or "DISCONNECTED";
    async Task<JsonElement> Recoverable(string method, Dictionary<string, object?> parameters)
    {
        var operation = Guid.NewGuid().ToString("D");
        try { return await Call(method, parameters, operation).ConfigureAwait(false); }
        catch (SessionException error) when (TransportFailure(error)) {
            // Reconcile first, then resend the original operation only. A new
            // lineage has no reliable old-operation ledger and is never retried.
            using var timeout = new CancellationTokenSource(_timeout);
            await _client.SnapshotAsync(Intent.DocumentId, timeout.Token).ConfigureAwait(false);
            if (_client.SessionId != Intent.SessionId || _client.Model?.SessionId != Intent.SessionId || _client.Model.DocumentId != Intent.DocumentId)
                throw new SessionException("UNCERTAIN", "operation crossed a session lineage change");
            return await Call(method, parameters, operation).ConfigureAwait(false);
        }
    }
    async Task CancelOwned()
    {
        if (_previewId is null) return;
        try { await Call(SessionMethods.PreviewCancel, new() { ["previewId"] = _previewId }, Guid.NewGuid().ToString("D")).ConfigureAwait(false); }
        catch (SessionException error) when (error.Code is "NOT_FOUND" or "NEED_FULL_SNAPSHOT" or "NOT_CONNECTED" or "DISCONNECTED") { }
    }
    async Task RunAsync()
    {
        SpatialEditOutcome outcome;
        try {
            RequireCurrentModel();
            IReadOnlyDictionary<string, double> initial;long version;
            lock (_gate) { initial = _draft;version = _version; }
            var fields = Values(initial);
            fields["featureId"] = Intent.FeatureId;fields["paramName"] = Intent.Parameters[0];
            fields["bodyId"] = Intent.BodyId;fields["targetTipId"] = Intent.TargetTipId;fields["expectedRevision"] = Intent.BaseRevision;
            var begin = (await Recoverable(SessionMethods.PreviewBegin, fields).ConfigureAwait(false)).GetProperty("result");
            lock (_gate) {
                _previewId = begin.GetProperty("previewId").GetString() ?? throw new JsonException("missing preview id");
                _generation = begin.GetProperty("generation").GetInt64();_processed = version;
                if (string.IsNullOrWhiteSpace(_previewId) || _generation != 0) throw new JsonException("invalid initial preview identity");
                _phase = SpatialEditPhase.Dragging;
            }
            _ready.TrySetResult(true);
            while (true) {
                bool cancel, release;IReadOnlyDictionary<string, double> draft;
                lock (_gate) { cancel = _cancel;release = _release;draft = _draft;version = _version; }
                if (cancel) { await CancelOwned().ConfigureAwait(false);outcome = new(SpatialEditStatus.Cancelled);break; }
                if (version != _processed) {
                    var remaining = 100 - (Stopwatch.GetTimestamp() - _lastUpdate) * 1000d / Stopwatch.Frequency;
                    if (_lastUpdate != 0 && remaining > 0) { await Task.Delay(TimeSpan.FromMilliseconds(remaining)).ConfigureAwait(false);continue; }
                    RequireCurrentModel();
                    var values = Values(draft);values["previewId"] = _previewId;
                    _lastUpdate = Stopwatch.GetTimestamp();
                    var update = (await Call(SessionMethods.PreviewUpdate, values, Guid.NewGuid().ToString("D")).ConfigureAwait(false)).GetProperty("result");
                    var generation = update.GetProperty("generation").GetInt64();
                    if (generation <= _generation) throw new SessionException("STALE_PREVIEW", "preview generation did not advance");
                    lock (_gate) { _generation = generation;_processed = version; }
                    using var timeout = new CancellationTokenSource(_timeout);
                    var mesh = await _client.RequestPreviewMeshAsync(_previewId, generation, Intent.DocumentId, Intent.BaseRevision, timeout.Token).ConfigureAwait(false);
                    if (IsPreviewCurrent(mesh)) PreviewReady?.Invoke(mesh);
                    continue;
                }
                if (release) {
                    if (draft.All(p => p.Value == Intent.InitialValues[p.Key])) {
                        await CancelOwned().ConfigureAwait(false);outcome = new(SpatialEditStatus.Cancelled);break;
                    }
                    lock (_gate) {
                        if (_cancel) continue;
                        _phase = SpatialEditPhase.Committing;
                    }
                    RequireCurrentModel();
                    var result = await Recoverable(SessionMethods.PreviewCommit, new() { ["previewId"] = _previewId }).ConfigureAwait(false);
                    if (result.GetProperty("result").GetProperty("status").GetString() != "ok")
                        throw new SessionException("UNCERTAIN", "commit did not confirm its result");
                    lock (_gate) _commitConfirmed = true;
                    var revision = result.GetProperty("result").GetProperty("revision").GetInt64();
                    if (_client.Model?.Revision < revision) {
                        using var timeout = new CancellationTokenSource(_timeout);
                        await _client.SnapshotAsync(Intent.DocumentId, timeout.Token).ConfigureAwait(false);
                    }
                    outcome = new(SpatialEditStatus.Committed);break;
                }
                await Task.Delay(10).ConfigureAwait(false);
            }
        } catch (Exception error) {
            var session = error as SessionException;
            var uncertain = _commitSent && !_commitConfirmed && (session is null || TransportFailure(session) || session.Code is "UNCERTAIN" or "NEED_FULL_SNAPSHOT");
            if (uncertain) {
                try {
                    using var timeout = new CancellationTokenSource(_timeout);
                    await _client.SnapshotAsync(_client.Model?.DocumentId ?? Intent.DocumentId, timeout.Token).ConfigureAwait(false);
                } catch { /* Reconnection refreshes the latest authoritative model. */ }
            }
            // If an uncertain begin has no owned ID, closing this connection
            // releases server reservations; the Quest connection loop reconnects.
            if (_previewId is null && session is not null && TransportFailure(session)) await _client.DisposeAsync().ConfigureAwait(false);
            else {
                try { await CancelOwned().ConfigureAwait(false); }
                catch { await _client.DisposeAsync().ConfigureAwait(false); }
            }
            outcome = new(_commitConfirmed ? SpatialEditStatus.Committed : uncertain ? SpatialEditStatus.Uncertain :
                session?.Code == "EDIT_CANCELLED" ? SpatialEditStatus.Cancelled : SpatialEditStatus.Failed,
                session?.Code ?? "INVALID_EDIT");
            _ready.TrySetException(error);
        } finally { _client.ModelChanged -= ModelChanged; }
        lock (_gate) _phase = SpatialEditPhase.Completed;
        _done.TrySetResult(outcome);
    }
    public async ValueTask DisposeAsync() => await CancelAsync().ConfigureAwait(false);
}
