using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.Android;

namespace Kreoda.QuestRuntime
{
    public enum QuestAnchorStatus
    {
        Saved,
        Restored,
        Missing,
        InvalidContext,
        PermissionDenied,
        CorruptRecord,
        NotLocalized,
        SaveFailed,
        StorageFailed,
        Superseded
    }

    public readonly struct QuestAnchorOutcome
    {
        public readonly QuestAnchorStatus Status;
        public readonly QuestAnchorRecord Record;
        public readonly Pose DisplayWorldPose;

        public bool Success => Status == QuestAnchorStatus.Saved || Status == QuestAnchorStatus.Restored;

        public QuestAnchorOutcome(QuestAnchorStatus status, QuestAnchorRecord record = null,
            Pose displayWorldPose = default)
        {
            Status = status;
            Record = record;
            DisplayWorldPose = displayWorldPose;
        }
    }

    /// <summary>
    /// Injected seam: Editor tests never pretend the Meta SDK localized hardware.
    /// The production implementation below uses only SDK207's persistent API.
    /// </summary>
    public interface IQuestSpatialAnchorBackend
    {
        bool IsPermitted { get; }
        Task<IQuestSpatialAnchorHandle> CreateAsync(Pose anchorWorldPose, CancellationToken cancellation);
        Task<IQuestSpatialAnchorHandle> LoadAsync(Guid anchorUuid, CancellationToken cancellation);
    }

    public interface IQuestSpatialAnchorHandle : IDisposable
    {
        Guid Uuid { get; }
        bool TryGetTrackedPose(out Pose pose);
        Task<bool> SaveAsync(CancellationToken cancellation);
    }

    /// <summary>
    /// Per-PC/document/room local mapping to an on-device saved Meta anchor.
    /// Call UseSession on every session/document generation and invoke Save only
    /// from an explicit, completed physical placement user action.
    /// Does not mutate CAD and does not itself request room/camera permissions.
    /// </summary>
    public sealed class QuestSpatialAnchorStore : IDisposable
    {
        readonly IQuestSpatialAnchorBackend _backend;
        readonly string _directory;
        readonly SemaphoreSlim _singleOperation = new SemaphoreSlim(1, 1);
        readonly object _stateGate = new object();
        QuestAnchorScope _scope;
        int _epoch;
        bool _hasScope;
        IQuestSpatialAnchorHandle _bound;
        QuestAnchorRecord _boundRecord;

        public QuestSpatialAnchorStore(IQuestSpatialAnchorBackend backend, string applicationStorageDirectory)
        {
            _backend = backend ?? throw new ArgumentNullException(nameof(backend));
            if (string.IsNullOrWhiteSpace(applicationStorageDirectory))
                throw new ArgumentException("A private local storage directory is required.", nameof(applicationStorageDirectory));
            _directory = Path.GetFullPath(Path.Combine(applicationStorageDirectory, "kreoda-spatial-anchors-v1"));
        }

        public void UseSession(QuestAnchorScope scope)
        {
            lock (_stateGate)
            {
                _epoch++;
                _scope = scope;
                _hasScope = scope.IsValid;
                _bound?.Dispose();
                _bound = null;
                _boundRecord = null;
            }
        }

        public void Dispose() => UseSession(default);

        bool Current(QuestAnchorScope scope, int epoch)
        {
            lock (_stateGate)
                return _hasScope && _scope.Equals(scope) && _epoch == epoch;
        }

        bool TryCapture(QuestAnchorScope scope, out int epoch)
        {
            lock (_stateGate)
            {
                epoch = _epoch;
                return scope.IsValid && _hasScope && _scope.Equals(scope);
            }
        }

        static string ScopeFilename(QuestAnchorScope scope)
        {
            var key = scope.PcId + "\0" + scope.DocumentId + "\0" + scope.RoomId;
            using (var sha = SHA256.Create())
            {
                var bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(key));
                return BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant() + ".json";
            }
        }

        string RecordPath(QuestAnchorScope scope) => Path.Combine(_directory, ScopeFilename(scope));

        static bool SafePose(Pose pose) => QuestAnchorRecord.Finite(pose.position) &&
                                           QuestAnchorRecord.Finite(pose.rotation);

        public async Task<QuestAnchorOutcome> SaveConfirmedAsync(QuestAnchorScope scope,
            Pose chosenContactWorld, Pose displayWorld, float displayScale, Vector3 contactModelMetres,
            float heightCalibrationMetres, CancellationToken cancellation = default)
        {
            if (!TryCapture(scope, out var epoch) || !SafePose(chosenContactWorld) || !SafePose(displayWorld))
                return new QuestAnchorOutcome(QuestAnchorStatus.InvalidContext);
            if (!_backend.IsPermitted) return new QuestAnchorOutcome(QuestAnchorStatus.PermissionDenied);
            try { await _singleOperation.WaitAsync(cancellation); }
            catch (OperationCanceledException) { return new QuestAnchorOutcome(QuestAnchorStatus.Superseded); }
            IQuestSpatialAnchorHandle newAnchor = null;
            try
            {
                if (!Current(scope, epoch)) return new QuestAnchorOutcome(QuestAnchorStatus.Superseded);
                if (!_backend.IsPermitted) return new QuestAnchorOutcome(QuestAnchorStatus.PermissionDenied);
                newAnchor = await _backend.CreateAsync(chosenContactWorld, cancellation);
                if (!Current(scope, epoch) || cancellation.IsCancellationRequested)
                    return new QuestAnchorOutcome(QuestAnchorStatus.Superseded);
                if (newAnchor == null || newAnchor.Uuid == Guid.Empty ||
                    !newAnchor.TryGetTrackedPose(out var localizedPose) || !SafePose(localizedPose))
                    return new QuestAnchorOutcome(QuestAnchorStatus.NotLocalized);

                var record = QuestAnchorRecord.Create(scope, newAnchor.Uuid, localizedPose,
                    displayWorld, displayScale, contactModelMetres, heightCalibrationMetres);
                if (record == null) return new QuestAnchorOutcome(QuestAnchorStatus.InvalidContext);
                if (!await newAnchor.SaveAsync(cancellation))
                    return new QuestAnchorOutcome(QuestAnchorStatus.SaveFailed);
                if (!Current(scope, epoch) || cancellation.IsCancellationRequested)
                    return new QuestAnchorOutcome(QuestAnchorStatus.Superseded);
                if (!_backend.IsPermitted) return new QuestAnchorOutcome(QuestAnchorStatus.PermissionDenied);

                try { CommitRecord(scope, record); }
                catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException || ex is NotSupportedException)
                { return new QuestAnchorOutcome(QuestAnchorStatus.StorageFailed); }

                lock (_stateGate)
                {
                    if (!Current(scope, epoch)) return new QuestAnchorOutcome(QuestAnchorStatus.Superseded);
                    _bound?.Dispose();
                    _bound = newAnchor;
                    _boundRecord = record;
                    newAnchor = null;
                }
                return new QuestAnchorOutcome(QuestAnchorStatus.Saved, record, displayWorld);
            }
            catch (OperationCanceledException) { return new QuestAnchorOutcome(QuestAnchorStatus.Superseded); }
            catch (Exception ex)
            {
                Debug.LogWarning("Quest spatial anchor save failed: " + ex.GetType().Name + " " + ex.Message);
                return new QuestAnchorOutcome(QuestAnchorStatus.SaveFailed);
            }
            finally { newAnchor?.Dispose(); _singleOperation.Release(); }
        }

        public async Task<QuestAnchorOutcome> RestoreAsync(QuestAnchorScope scope,
            CancellationToken cancellation = default)
        {
            if (!TryCapture(scope, out var epoch)) return new QuestAnchorOutcome(QuestAnchorStatus.InvalidContext);
            if (!_backend.IsPermitted) return new QuestAnchorOutcome(QuestAnchorStatus.PermissionDenied);
            try { await _singleOperation.WaitAsync(cancellation); }
            catch (OperationCanceledException) { return new QuestAnchorOutcome(QuestAnchorStatus.Superseded); }
            IQuestSpatialAnchorHandle loaded = null;
            try
            {
                if (!Current(scope, epoch)) return new QuestAnchorOutcome(QuestAnchorStatus.Superseded);
                var path = RecordPath(scope);
                if (!File.Exists(path)) return new QuestAnchorOutcome(QuestAnchorStatus.Missing);
                QuestAnchorRecord record;
                try { record = JsonSerializer.Deserialize<QuestAnchorRecord>(File.ReadAllText(path)); }
                catch (JsonException) { return new QuestAnchorOutcome(QuestAnchorStatus.CorruptRecord); }
                catch (IOException) { return new QuestAnchorOutcome(QuestAnchorStatus.StorageFailed); }
                catch (UnauthorizedAccessException) { return new QuestAnchorOutcome(QuestAnchorStatus.StorageFailed); }
                if (record == null || !record.Matches(scope))
                    return new QuestAnchorOutcome(QuestAnchorStatus.CorruptRecord);
                if (!_backend.IsPermitted) return new QuestAnchorOutcome(QuestAnchorStatus.PermissionDenied);
                loaded = await _backend.LoadAsync(Guid.Parse(record.AnchorUuid), cancellation);
                if (!Current(scope, epoch) || cancellation.IsCancellationRequested)
                    return new QuestAnchorOutcome(QuestAnchorStatus.Superseded);
                if (!_backend.IsPermitted)
                    return new QuestAnchorOutcome(QuestAnchorStatus.PermissionDenied);
                if (loaded == null || loaded.Uuid != Guid.Parse(record.AnchorUuid) ||
                    !loaded.TryGetTrackedPose(out var localizedPose) || !SafePose(localizedPose) ||
                    !record.TryGetWorldDisplayPose(localizedPose, out var displayPose))
                    return new QuestAnchorOutcome(QuestAnchorStatus.NotLocalized);

                lock (_stateGate)
                {
                    if (!Current(scope, epoch)) return new QuestAnchorOutcome(QuestAnchorStatus.Superseded);
                    _bound?.Dispose();
                    _bound = loaded;
                    _boundRecord = record;
                    loaded = null;
                }
                return new QuestAnchorOutcome(QuestAnchorStatus.Restored, record, displayPose);
            }
            catch (OperationCanceledException) { return new QuestAnchorOutcome(QuestAnchorStatus.Superseded); }
            catch (Exception) { return new QuestAnchorOutcome(QuestAnchorStatus.NotLocalized); }
            finally { loaded?.Dispose(); _singleOperation.Release(); }
        }

        /// <summary>
        /// Re-evaluate from the *tracked Meta anchor* after relocalization/drift.
        /// Never reuse a stale Unity world-space pose when tracking is lost.
        /// </summary>
        public bool TryGetTrackedDisplayPose(out Pose pose, out QuestAnchorRecord record)
        {
            lock (_stateGate)
            {
                pose = Pose.identity;
                record = null;
                if (!_hasScope || !_backend.IsPermitted || _bound == null || _boundRecord == null ||
                    !_bound.TryGetTrackedPose(out var anchorPose) ||
                    !_boundRecord.TryGetWorldDisplayPose(anchorPose, out pose)) return false;
                record = _boundRecord;
                return true;
            }
        }

        void CommitRecord(QuestAnchorScope scope, QuestAnchorRecord record)
        {
            Directory.CreateDirectory(_directory);
            var path = RecordPath(scope);
            var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                File.WriteAllText(temporary, JsonSerializer.Serialize(record), new UTF8Encoding(false));
                if (File.Exists(path)) File.Replace(temporary, path, null);
                else File.Move(temporary, path);
            }
            finally
            {
                if (File.Exists(temporary)) File.Delete(temporary);
            }
        }
    }

    /// <summary>
    /// SDK207 implementation. No SDK calls happen until the owning application
    /// explicitly invokes SaveConfirmedAsync or RestoreAsync on Android.
    /// USE_ANCHOR_API must be declared by OVRProjectConfig before shipping.
    /// </summary>
    public sealed class OvrQuestSpatialAnchorBackend : IQuestSpatialAnchorBackend
    {
        const string AnchorPermission = "com.oculus.permission.USE_ANCHOR_API";
        const float TimeoutSeconds = 12f;

        public bool IsPermitted => Application.platform == RuntimePlatform.Android &&
                                   Permission.HasUserAuthorizedPermission(AnchorPermission);

        static async Task<T> AwaitBounded<T>(OVRTask<T> request, CancellationToken cancellation)
        {
            var deadline = Time.realtimeSinceStartup + TimeoutSeconds;
            while (!request.IsCompleted)
            {
                cancellation.ThrowIfCancellationRequested();
                if (Time.realtimeSinceStartup >= deadline) throw new TimeoutException("Meta anchor operation timed out.");
                await Task.Yield();
            }
            cancellation.ThrowIfCancellationRequested();
            return request.GetResult();
        }

        static async Task<bool> AwaitTracked(OVRSpatialAnchor anchor, CancellationToken cancellation)
        {
            var deadline = Time.realtimeSinceStartup + TimeoutSeconds;
            while (anchor != null && anchor.Created && anchor.Localized && !anchor.IsTracked)
            {
                cancellation.ThrowIfCancellationRequested();
                if (Time.realtimeSinceStartup >= deadline) return false;
                await Task.Yield();
            }
            return anchor != null && anchor.Created && anchor.Localized && anchor.IsTracked;
        }

        public async Task<IQuestSpatialAnchorHandle> CreateAsync(Pose anchorWorldPose,
            CancellationToken cancellation)
        {
            if (!IsPermitted) return null;
            var go = new GameObject("Kreoda persistent spatial contact");
            go.transform.SetPositionAndRotation(anchorWorldPose.position, anchorWorldPose.rotation);
            var transferred = false;
            try
            {
                var anchor = go.AddComponent<OVRSpatialAnchor>();
                if (!await AwaitBounded(anchor.WhenCreatedAsync(), cancellation) ||
                    !await AwaitBounded(anchor.WhenLocalizedAsync(), cancellation) ||
                    !await AwaitTracked(anchor, cancellation)) return null;
                transferred = true;
                return new Handle(go, anchor);
            }
            finally
            {
                if (!transferred) UnityEngine.Object.Destroy(go);
            }
        }

        public async Task<IQuestSpatialAnchorHandle> LoadAsync(Guid anchorUuid,
            CancellationToken cancellation)
        {
            if (!IsPermitted || anchorUuid == Guid.Empty) return null;
            var unbound = new List<OVRSpatialAnchor.UnboundAnchor>(1);
            var response = await AwaitBounded(
                OVRSpatialAnchor.LoadUnboundAnchorsAsync(new[] { anchorUuid }, unbound), cancellation);
            if (!response.Success || unbound.Count != 1 || unbound[0].Uuid != anchorUuid) return null;
            var found = unbound[0];
            if (!found.Localized && !await AwaitBounded(found.LocalizeAsync(TimeoutSeconds), cancellation))
                return null;
            if (!found.TryGetPose(out var pose)) return null;
            var go = new GameObject("Kreoda restored spatial contact");
            go.transform.SetPositionAndRotation(pose.position, pose.rotation);
            var transferred = false;
            try
            {
                // AddComponent runs Awake but the pending new-anchor Start has
                // not run: binding immediately prevents accidental creation.
                var anchor = go.AddComponent<OVRSpatialAnchor>();
                found.BindTo(anchor);
                if (!await AwaitTracked(anchor, cancellation)) return null;
                transferred = true;
                return new Handle(go, anchor);
            }
            finally
            {
                if (!transferred) UnityEngine.Object.Destroy(go);
            }
        }

        sealed class Handle : IQuestSpatialAnchorHandle
        {
            GameObject _gameObject;
            OVRSpatialAnchor _anchor;

            public Handle(GameObject gameObject, OVRSpatialAnchor anchor)
            {
                _gameObject = gameObject;
                _anchor = anchor;
            }

            public Guid Uuid => _anchor != null && _anchor.Created ? _anchor.Uuid : Guid.Empty;

            public bool TryGetTrackedPose(out Pose pose)
            {
                pose = Pose.identity;
                if (_anchor == null || !_anchor.Created || !_anchor.Localized || !_anchor.IsTracked) return false;
                pose = new Pose(_anchor.transform.position, _anchor.transform.rotation);
                return QuestAnchorRecord.Finite(pose.position) && QuestAnchorRecord.Finite(pose.rotation);
            }

            public async Task<bool> SaveAsync(CancellationToken cancellation)
            {
                if (!TryGetTrackedPose(out _)) return false;
                var response = await AwaitBounded(_anchor.SaveAnchorAsync(), cancellation);
                return response.Success;
            }

            public void Dispose()
            {
                if (_gameObject != null) UnityEngine.Object.Destroy(_gameObject);
                _gameObject = null;
                _anchor = null;
            }
        }
    }
}
