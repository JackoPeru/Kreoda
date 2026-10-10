namespace Kreoda.QuestFoundation;

public readonly record struct SceneObjectKey(string BodyId, string? InstanceId = null);

/// <summary>Identity and authoritative model revision captured when a
/// snapshot/delta arrives, before any asynchronous mesh or snapshot work.</summary>
public sealed record SceneObservationStamp(
    long ConnectionGeneration,
    long Sequence,
    string SessionId,
    string DocumentId,
    long Revision);

/// <summary>One visible source body or placed instance at a model lineage/revision.</summary>
public sealed record SceneMeshTarget(
    string BodyId,
    string? InstanceId,
    string FeatureId,
    string SessionId,
    string DocumentId,
    long Revision)
{
    public SceneObjectKey Key => new(BodyId, InstanceId);
}

public sealed record SceneMeshRequestTicket(SceneMeshTarget Target, long ConnectionGeneration, long Sequence)
{
    public SceneObjectKey Key => Target.Key;
}

public sealed record SceneReconcilePlan(
    IReadOnlyList<SceneMeshRequestTicket> Requests,
    IReadOnlyList<SceneObjectKey> Removed,
    IReadOnlyList<SceneObjectKey> Superseded,
    bool IgnoredStaleObservation = false);

public enum MeshCompletionDisposition { Apply, Duplicate, IgnoreStale }

/// <summary>
/// Pure scene freshness gate. Capture observations when model events arrive,
/// then reconcile their possibly delayed snapshot on the Unity main thread.
/// Mesh callbacks may upload only after <see cref="Complete"/> returns Apply.
/// </summary>
public sealed class QuestSceneState
{
    private readonly object _gate = new();
    private readonly Dictionary<SceneObjectKey, SceneMeshTarget> _targets = new();
    private readonly Dictionary<SceneObjectKey, SceneMeshRequestTicket> _pending = new();
    private readonly Dictionary<SceneObjectKey, (SceneMeshTarget Target, long Generation)> _applied = new();
    private readonly Dictionary<(long Generation, string SessionId, string DocumentId), CapturedChanges> _capturedChanges = new();
    private readonly Dictionary<string, long> _dirtyBodies = new(StringComparer.Ordinal);
    private readonly Dictionary<string, long> _dirtyInstances = new(StringComparer.Ordinal);
    private string? _sessionId;
    private string? _documentId;
    private long _modelRevision = -1;
    private long _observationSequence;
    private long _lastReconciledObservationSequence;
    private long _ticketSequence;
    private long _latestCapturedGeneration;
    private string? _latestCapturedSessionId;
    private string? _latestCapturedDocumentId;
    private long _latestCapturedRevision = -1;

    public long ConnectionGeneration { get; private set; }
    public int PendingCount { get { lock (_gate) return _pending.Count; } }

    public long BeginConnection()
    {
        lock (_gate)
        {
            ConnectionGeneration = checked(ConnectionGeneration + 1);
            _pending.Clear();
            _capturedChanges.Clear();
            _dirtyBodies.Clear();
            _dirtyInstances.Clear();
            _sessionId = null;
            _documentId = null;
            _modelRevision = -1;
            _observationSequence = 0;
            _lastReconciledObservationSequence = 0;
            _latestCapturedGeneration = ConnectionGeneration;
            _latestCapturedSessionId = null;
            _latestCapturedDocumentId = null;
            _latestCapturedRevision = -1;
            return ConnectionGeneration;
        }
    }

    public void InvalidateConnection()
    {
        lock (_gate)
        {
            ConnectionGeneration = checked(ConnectionGeneration + 1);
            _pending.Clear();
            _capturedChanges.Clear();
            _dirtyBodies.Clear();
            _dirtyInstances.Clear();
            _sessionId = null;
            _documentId = null;
            _modelRevision = -1;
            _observationSequence = 0;
            _lastReconciledObservationSequence = 0;
            _latestCapturedGeneration = ConnectionGeneration;
            _latestCapturedSessionId = null;
            _latestCapturedDocumentId = null;
            _latestCapturedRevision = -1;
        }
    }

    /// <summary>
    /// Capture the event's ordering before starting asynchronous work. Changed
    /// IDs accumulate per connection/document until an observation at or past
    /// that change reconciles, so skipped deltas cannot hide same-tip edits.
    /// </summary>
    public SceneObservationStamp CaptureObservation(
        long connectionGeneration,
        string sessionId,
        string documentId,
        long revision,
        IEnumerable<string>? changedBodyIds = null,
        IEnumerable<string>? changedInstanceIds = null)
    {
        lock (_gate)
        {
            if (string.IsNullOrWhiteSpace(sessionId)) throw new ArgumentException("sessionId is required", nameof(sessionId));
            if (string.IsNullOrWhiteSpace(documentId)) throw new ArgumentException("documentId is required", nameof(documentId));
            if (revision < 0) throw new ArgumentOutOfRangeException(nameof(revision));
            if (connectionGeneration != ConnectionGeneration)
                return new(connectionGeneration, 0, sessionId, documentId, revision);

            var sequence = checked(++_observationSequence);
            var sameCapturedLineage = _latestCapturedGeneration == connectionGeneration &&
                _latestCapturedSessionId == sessionId && _latestCapturedDocumentId == documentId;
            var olderRevision = sameCapturedLineage && revision < _latestCapturedRevision;
            if (!olderRevision)
            {
            var key = (ConnectionGeneration, sessionId, documentId);
            if (!_capturedChanges.TryGetValue(key, out var changes))
            {
                changes = new CapturedChanges();
                _capturedChanges.Add(key, changes);
            }
            CaptureIds(changedBodyIds, revision, changes.Bodies, nameof(changedBodyIds));
            CaptureIds(changedInstanceIds, revision, changes.Instances, nameof(changedInstanceIds));
                _latestCapturedGeneration = connectionGeneration;
                _latestCapturedSessionId = sessionId;
                _latestCapturedDocumentId = documentId;
                _latestCapturedRevision = revision;
            }
            return new(connectionGeneration, sequence, sessionId, documentId, revision);
        }
    }

    public SceneReconcilePlan Reconcile(
        SceneObservationStamp observation,
        IEnumerable<SceneMeshTarget> observed,
        bool snapshot = false)
    {
        lock (_gate)
        {
            if (observation is null) throw new ArgumentNullException(nameof(observation));
            if (observed is null) throw new ArgumentNullException(nameof(observed));
            if (observation.ConnectionGeneration != ConnectionGeneration ||
                observation.SessionId != _latestCapturedSessionId || observation.DocumentId != _latestCapturedDocumentId ||
                observation.Revision != _latestCapturedRevision ||
                observation.Sequence <= _lastReconciledObservationSequence || observation.Revision < 0 ||
                string.IsNullOrWhiteSpace(observation.SessionId) || string.IsNullOrWhiteSpace(observation.DocumentId))
                return StalePlan();

            var sameLineage = _sessionId == observation.SessionId && _documentId == observation.DocumentId;
            if (sameLineage && observation.Revision < _modelRevision) return StalePlan();

            var desired = new Dictionary<SceneObjectKey, SceneMeshTarget>();
            foreach (var target in observed)
            {
                Validate(target);
                if (target.SessionId != observation.SessionId || target.DocumentId != observation.DocumentId ||
                    target.Revision != observation.Revision)
                    throw new ArgumentException("scene target does not match its captured model observation", nameof(observed));
                if (!desired.TryAdd(target.Key, target))
                    throw new ArgumentException("scene contains duplicate object identity", nameof(observed));
            }

            var superseded = new List<SceneObjectKey>();
            if (!sameLineage)
            {
                superseded.AddRange(_pending.Keys);
                _pending.Clear();
                _dirtyBodies.Clear();
                _dirtyInstances.Clear();
                _sessionId = observation.SessionId;
                _documentId = observation.DocumentId;
                _modelRevision = -1;
            }

            MergeCapturedChanges(observation);
            _modelRevision = observation.Revision;
            _lastReconciledObservationSequence = observation.Sequence;

            var removed = new List<SceneObjectKey>();
            foreach (var key in _targets.Keys.Where(key => !desired.ContainsKey(key)).ToArray())
            {
                _targets.Remove(key);
                _pending.Remove(key);
                _applied.Remove(key);
                removed.Add(key);
            }

            var requests = new List<SceneMeshRequestTicket>();
            foreach (var (key, incoming) in desired)
            {
                _targets.TryGetValue(key, out var previous);
                var sameGeometry = previous is not null && SameGeometry(previous, incoming);
                _targets[key] = incoming;

                var hasAppliedEntry = _applied.TryGetValue(key, out var applied);
                SceneMeshTarget? appliedTarget = hasAppliedEntry ? applied.Target : null;
                var hasCurrentGeometry = appliedTarget is not null && applied.Generation == ConnectionGeneration &&
                    SameGeometry(appliedTarget, incoming);
                var explicitlyChanged = IsDirty(incoming, hasCurrentGeometry ? appliedTarget!.Revision : -1);
                var needsMesh = snapshot || explicitlyChanged || !hasCurrentGeometry || !sameGeometry;

                if (_pending.TryGetValue(key, out var pending))
                {
                    if (pending.ConnectionGeneration == ConnectionGeneration && pending.Target == incoming)
                        continue;
                    _pending.Remove(key);
                    superseded.Add(key);
                }

                if (!needsMesh)
                {
                    // Global revisions advance even for bodies whose geometry
                    // did not change. Keep the applied Unity object and promote
                    // its scene stamp without uploading the same bytes again.
                    _applied[key] = (incoming, ConnectionGeneration);
                    continue;
                }

                var ticket = new SceneMeshRequestTicket(incoming, ConnectionGeneration, checked(++_ticketSequence));
                _pending[key] = ticket;
                requests.Add(ticket);
            }

            return new(requests.AsReadOnly(), removed.AsReadOnly(), superseded.AsReadOnly());
        }
    }

    public MeshCompletionDisposition Complete(SceneMeshRequestTicket ticket)
        => Complete(ticket, null);

    /// <summary>Run the main-thread Unity upload only while the ticket is
    /// current. The freshness lock also prevents a background model callback
    /// from invalidating it midway through object allocation/replacement.</summary>
    public MeshCompletionDisposition Complete(SceneMeshRequestTicket ticket, Action? applyUpload)
    {
        lock (_gate)
        {
            if (ticket is null) throw new ArgumentNullException(nameof(ticket));
            if (!IsCurrentLocked(ticket))
                return MeshCompletionDisposition.IgnoreStale;
            try { applyUpload?.Invoke(); }
            catch
            {
                _pending.Remove(ticket.Key);
                throw;
            }
            _pending.Remove(ticket.Key);
            if (_applied.TryGetValue(ticket.Key, out var prior) && prior.Target == ticket.Target &&
                prior.Generation == ticket.ConnectionGeneration)
                return MeshCompletionDisposition.Duplicate;
            _applied[ticket.Key] = (ticket.Target, ticket.ConnectionGeneration);
            return MeshCompletionDisposition.Apply;
        }
    }

    public bool IsCurrent(SceneMeshRequestTicket ticket)
    {
        lock (_gate) return IsCurrentLocked(ticket);
    }

    /// <summary>Explicit client-local LOD change. It replaces only this object's
    /// pending ticket and requires the current, already applied model stamp.</summary>
    public SceneMeshRequestTicket? RequestRefresh(SceneObjectKey key)
    {
        lock (_gate)
        {
            if (!_targets.TryGetValue(key, out var target) || !_applied.TryGetValue(key, out var applied) ||
                applied.Generation != ConnectionGeneration || applied.Target != target ||
                _latestCapturedGeneration != ConnectionGeneration || target.SessionId != _latestCapturedSessionId ||
                target.DocumentId != _latestCapturedDocumentId || target.Revision != _latestCapturedRevision) return null;
            var ticket = new SceneMeshRequestTicket(target, ConnectionGeneration, checked(++_ticketSequence));
            _pending[key] = ticket;
            return ticket;
        }
    }

    /// <summary>Release only this failed/cancelled request. A delayed failure
    /// must never remove the replacement request for the same visible object.</summary>
    public bool Abandon(SceneMeshRequestTicket ticket)
    {
        if (ticket is null) throw new ArgumentNullException(nameof(ticket));
        lock (_gate)
        {
            if (!_pending.TryGetValue(ticket.Key, out var pending) || pending != ticket) return false;
            return _pending.Remove(ticket.Key);
        }
    }

    public SceneMeshTarget? GetAppliedTarget(SceneObjectKey key)
    {
        lock (_gate) return _applied.TryGetValue(key, out var applied) ? applied.Target : null;
    }

    private void MergeCapturedChanges(SceneObservationStamp observation)
    {
        if (!_capturedChanges.TryGetValue((observation.ConnectionGeneration, observation.SessionId, observation.DocumentId), out var changes))
            return;
        Merge(changes.Bodies, _dirtyBodies);
        Merge(changes.Instances, _dirtyInstances);
    }

    private bool IsCurrentLocked(SceneMeshRequestTicket ticket) =>
        ticket.ConnectionGeneration == ConnectionGeneration &&
        _latestCapturedGeneration == ConnectionGeneration &&
        _latestCapturedSessionId == ticket.Target.SessionId &&
        _latestCapturedDocumentId == ticket.Target.DocumentId &&
        _latestCapturedRevision == ticket.Target.Revision &&
        _targets.TryGetValue(ticket.Key, out var target) && target == ticket.Target &&
        _pending.TryGetValue(ticket.Key, out var pending) && pending.Sequence == ticket.Sequence;

    private static void Merge(Dictionary<string, long> incoming, Dictionary<string, long> current)
    {
        foreach (var (id, revision) in incoming)
            if (!current.TryGetValue(id, out var existing) || revision > existing) current[id] = revision;
    }

    private bool IsDirty(SceneMeshTarget target, long appliedRevision)
    {
        var bodyChanged = _dirtyBodies.TryGetValue(target.BodyId, out var bodyRevision) && bodyRevision > appliedRevision;
        var instanceChanged = target.InstanceId is not null &&
            _dirtyInstances.TryGetValue(target.InstanceId, out var instanceRevision) && instanceRevision > appliedRevision;
        return bodyChanged || instanceChanged;
    }

    private static void CaptureIds(IEnumerable<string>? ids, long revision, Dictionary<string, long> captured, string parameter)
    {
        if (ids is null) return;
        foreach (var id in ids)
        {
            if (string.IsNullOrWhiteSpace(id)) throw new ArgumentException("changed mesh IDs must be non-empty", parameter);
            if (!captured.TryGetValue(id, out var existing) || revision > existing) captured[id] = revision;
        }
    }

    private static SceneReconcilePlan StalePlan() => new(
        Array.Empty<SceneMeshRequestTicket>(), Array.Empty<SceneObjectKey>(), Array.Empty<SceneObjectKey>(), true);

    private static bool SameGeometry(SceneMeshTarget left, SceneMeshTarget right) =>
        left.BodyId == right.BodyId && left.InstanceId == right.InstanceId && left.FeatureId == right.FeatureId &&
        left.SessionId == right.SessionId && left.DocumentId == right.DocumentId;

    private static void Validate(SceneMeshTarget target)
    {
        if (target is null || string.IsNullOrWhiteSpace(target.BodyId) || string.IsNullOrWhiteSpace(target.FeatureId) ||
            string.IsNullOrWhiteSpace(target.SessionId) || string.IsNullOrWhiteSpace(target.DocumentId) ||
            target.Revision < 0 || (target.InstanceId is not null && target.InstanceId != target.FeatureId))
            throw new ArgumentException("invalid scene mesh target", nameof(target));
    }

    private sealed class CapturedChanges
    {
        public Dictionary<string, long> Bodies { get; } = new(StringComparer.Ordinal);
        public Dictionary<string, long> Instances { get; } = new(StringComparer.Ordinal);
    }
}
