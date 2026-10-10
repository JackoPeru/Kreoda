using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Kreoda.QuestFoundation;
using Kreoda.Session;
using Kreoda.Session.Generated;
using UnityEngine;

namespace Kreoda.QuestRuntime
{
    public sealed class QuestConnection : MonoBehaviour
    {
        public Transform DisplayRoot;
        public Material SurfaceMaterial, EdgeMaterial, SelectionMaterial, PreviewMaterial;
        public string Status { get; private set; } = "Non connesso";
        public string SavedEndpoint { get { lock (_gate) return _saved?.Endpoint ?? ""; } }
        public bool Connected { get; private set; }
        public double? RttMilliseconds { get; private set; }
        public double? MeshMilliseconds { get; private set; }
        public long TriangleCount { get; private set; }
        public int PendingMeshCount => _scene.PendingCount;
        public int TriangleBudget = 250000;
        public int DiscardedMeshes => System.Threading.Volatile.Read(ref _discardedMeshes);
        int _discardedMeshes;
        public event Action SceneChanged;
        public IReadOnlyCollection<QuestMeshView> Views => _views.Values;
        readonly QuestSceneState _scene = new QuestSceneState();
        readonly Dictionary<SceneObjectKey, QuestMeshView> _views = new Dictionary<SceneObjectKey, QuestMeshView>();
        readonly Dictionary<SceneObjectKey, CancellationTokenSource> _jobs = new Dictionary<SceneObjectKey, CancellationTokenSource>();
        readonly Dictionary<SceneObjectKey, MeshLod> _wantedQuality = new Dictionary<SceneObjectKey, MeshLod>();
        readonly ConcurrentQueue<Action> _main = new ConcurrentQueue<Action>();
        readonly SemaphoreSlim _meshSlots = new SemaphoreSlim(2, 2);
        readonly object _gate = new object();
        CancellationTokenSource _run;
        SessionClient _client;
        Observation _latest;
        SavedDevice _saved;
        string _credentialFile;
        bool _destroyed;

        sealed class SavedDevice
        {
            public string Endpoint, DeviceId, Credential, LogicalId;
        }
        sealed class Observation
        {
            public SceneObservationStamp Stamp;
            public SceneMeshTarget[] Targets;
            public bool Snapshot;
        }

        void Awake()
        {
            string directory = Application.persistentDataPath;
#if UNITY_ANDROID && !UNITY_EDITOR
            using (var player = new AndroidJavaClass("com.unity3d.player.UnityPlayer"))
            using (var activity = player.GetStatic<AndroidJavaObject>("currentActivity"))
            using (var files = activity.Call<AndroidJavaObject>("getFilesDir"))
                directory = files.Call<string>("getAbsolutePath");
#endif
            _credentialFile = Path.Combine(directory, "kreoda-device.dat");
            _saved = ReadDevice();
#if UNITY_ANDROID && !UNITY_EDITOR
            using (var player = new AndroidJavaClass("com.unity3d.player.UnityPlayer"))
            using (var activity = player.GetStatic<AndroidJavaObject>("currentActivity"))
            using (var intent = activity.Call<AndroidJavaObject>("getIntent"))
            {
                var endpoint = intent.Call<string>("getStringExtra", "kreoda.endpoint");
                var code = intent.Call<string>("getStringExtra", "kreoda.pairing-code");
                // Consume one-use setup input; the existing private credential file
                // handles later reconnects without codes or headset interaction.
                intent.Call("removeExtra", "kreoda.endpoint");
                intent.Call("removeExtra", "kreoda.pairing-code");
                if (ApplyStartupConfiguration(endpoint, code)) return;
            }
#endif
            if (_saved != null) StartConnection(null, null);
        }

        bool ApplyStartupConfiguration(string endpoint, string code)
        {
            if (string.IsNullOrEmpty(endpoint)) return false;
            Pair(endpoint, code);
            return true;
        }

        public void Pair(string endpointText, string codeText)
        {
            if (!QuestConnectionInput.TryEndpoint(endpointText, out var endpoint))
            { Status = "Indirizzo: ws://IP privato del PC:porta"; return; }
            if (!QuestConnectionInput.TryPairingCode(codeText, out var code))
            { Status = "Codice: 8 cifre dal PC"; return; }
            StartConnection(endpoint, code);
        }

        public void Reconnect()
        {
            if (_saved == null) { Status = "Associa prima il PC"; return; }
            StartConnection(null, null);
        }

        public void Forget()
        {
            lock (_gate)
            {
                _run?.Cancel();
                _run?.Dispose();
                _run = null;
                _client = null;
                _latest = null;
                _scene.InvalidateConnection();
                _saved = null;
            }
            CancelMeshes();
            if (File.Exists(_credentialFile)) File.Delete(_credentialFile);
            Connected = false;
            RttMilliseconds = null;
            Status = "PC dimenticato. Nuova associazione";
        }

        void StartConnection(Uri pairingEndpoint, string code)
        {
            CancellationTokenSource run;
            lock (_gate)
            {
                _run?.Cancel();
                _run?.Dispose();
                run = _run = new CancellationTokenSource();
                _client = null;
                _latest = null;
                _scene.InvalidateConnection();
            }
            CancelMeshes();
            Connected = false;
            RttMilliseconds = null;
            Status = "Connessione…";
            // All socket work, timeouts and reconnect delays stay off the frame loop.
            var ct = run.Token;
            _ = Task.Run(() => ConnectionLoop(run, ct, pairingEndpoint, code));
        }

        async Task ConnectionLoop(CancellationTokenSource run, CancellationToken ct, Uri pairingEndpoint, string code)
        {
            int attempt = 0;
            while (!ct.IsCancellationRequested)
            {
                SessionClient client = null;
                long generation;
                lock (_gate)
                {
                    if (!Current(run)) break;
                    generation = _scene.BeginConnection();
                }
                try
                {
                    SavedDevice saved;
                    lock (_gate) saved = _saved;
                    using (var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct))
                    {
                        deadline.CancelAfter(TimeSpan.FromSeconds(15));
                        if (code != null)
                        {
                            var logicalId = "client-" + Guid.NewGuid().ToString("D");
                            var paired = await SessionClient.PairAsync(pairingEndpoint, code, "Quest 3", "quest",
                                deadline.Token, logicalId).ConfigureAwait(false);
                            client = paired.Client;
                            saved = new SavedDevice { Endpoint = pairingEndpoint.AbsoluteUri, DeviceId = paired.DeviceId,
                                Credential = paired.Credential, LogicalId = logicalId };
                            lock (_gate)
                            {
                                if (!Current(run)) throw new OperationCanceledException(ct);
                                WriteDevice(saved);
                                _saved = saved;
                            }
                            code = null;
                        }
                        else
                        {
                            if (saved == null) throw new SessionException("UNAUTHORIZED", "no paired device");
                            client = await SessionClient.ConnectDeviceAsync(new Uri(saved.Endpoint), saved.DeviceId,
                                saved.Credential, "quest", deadline.Token, saved.LogicalId).ConfigureAwait(false);
                        }
                    }
                    var connectedClient = client;
                    Action<SessionModelUpdate> changed = update =>
                    {
                        if (update.Kind == SessionModelUpdateKind.Applied)
                            Capture(run, connectedClient, generation, update.Model, update.Delta);
                    };
                    client.ModelChanged += changed;
                    try
                    {
                        lock (_gate)
                        {
                            if (!Current(run)) throw new OperationCanceledException(ct);
                            _client = client;
                        }
                        if (client.Model == null) throw new SessionException("BAD_MODEL", "snapshot missing");
                        Capture(run, client, generation, client.Model, null);
                        Post(run, () => { Connected = true; Status = "Connesso al PC"; UnityEngine.Debug.Log("KREODA_CONNECTED"); });
                        attempt = 0;
                        while (!ct.IsCancellationRequested)
                        {
                            await Task.Delay(TimeSpan.FromSeconds(3), ct).ConfigureAwait(false);
                            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
                            deadline.CancelAfter(TimeSpan.FromSeconds(5));
                            var watch = Stopwatch.StartNew();
                            await connectedClient.SessionInfoAsync(deadline.Token).ConfigureAwait(false);
                            var elapsed = watch.Elapsed.TotalMilliseconds;
                            Post(run, () => RttMilliseconds = elapsed);
                        }
                    }
                    finally { client.ModelChanged -= changed; }
                }
                catch (OperationCanceledException) when (ct.IsCancellationRequested) { break; }
                catch (Exception error)
                {
                    var unauthorized = error is SessionException session && session.Code == "UNAUTHORIZED";
                    lock (_gate)
                    {
                        if (Current(run)) { _client = null; _latest = null; _scene.InvalidateConnection(); }
                    }
                    Post(run, () =>
                    {
                        Connected = false;
                        RttMilliseconds = null;
                        CancelMeshes();
                        Status = unauthorized ? "Associazione scaduta o revocata: riassocia" :
                            code != null ? "Associazione fallita: verifica codice e rete" : "Offline: modello conservato. Riconnessione…";
                        UnityEngine.Debug.LogWarning("KREODA_CONNECTION_ERROR " + error.GetType().Name +
                            (error is SessionException failure ? " " + failure.Code : ""));
                    });
                    // Never keep guessing a one-use pairing code or revoked credential.
                    if (code != null || unauthorized) break;
                    try { await Task.Delay(TimeSpan.FromSeconds(Math.Min(30, 1 << Math.Min(++attempt, 5))), ct).ConfigureAwait(false); }
                    catch (OperationCanceledException) { break; }
                }
                finally { if (client != null) await client.DisposeAsync().ConfigureAwait(false); }
            }
        }

        bool Current(CancellationTokenSource run) => !_destroyed && ReferenceEquals(_run, run);
        void Post(CancellationTokenSource run, Action action)
        {
            lock (_gate)
                if (Current(run)) _main.Enqueue(() => { lock (_gate) if (Current(run)) action(); });
        }

        void Capture(CancellationTokenSource run, SessionClient client, long generation, SessionModelState model, SessionIncrementalDelta delta)
        {
            var bodies = model.Bodies.Select(b => JsonSerializer.Deserialize<BodyDescriptor>(b.GetRawText())).ToArray();
            var features = model.Features.Select(f => JsonSerializer.Deserialize<FeatureDescriptor>(f.GetRawText())).ToArray();
            var changed = new HashSet<string>(delta?.ChangedMeshIds ?? Array.Empty<string>(), StringComparer.Ordinal);
            var targets = bodies.Select(b => new SceneMeshTarget(b.BodyId, null, b.Tip, model.SessionId,
                model.DocumentId, model.Revision)).ToList();
            foreach (var instance in features.Where(f => f.Type == "Instance"))
            {
                if (instance.DependsOn?.Length != 1) throw new SessionException("BAD_MODEL", "invalid instance source");
                var body = bodies.SingleOrDefault(b => b.History.Contains(instance.DependsOn[0]));
                if (body == null) throw new SessionException("BAD_MODEL", "instance source body missing");
                targets.Add(new SceneMeshTarget(body.BodyId, instance.FeatureId, instance.FeatureId,
                    model.SessionId, model.DocumentId, model.Revision));
            }
            lock (_gate)
            {
                if (!Current(run)) return;
                if (!ReferenceEquals(model, client.Model)) return;
                var stamp = _scene.CaptureObservation(generation, model.SessionId, model.DocumentId, model.Revision,
                    bodies.Where(b => b.History.Any(changed.Contains)).Select(b => b.BodyId),
                    features.Where(f => f.Type == "Instance" && changed.Contains(f.FeatureId)).Select(f => f.FeatureId));
                if (stamp.Sequence == 0) return;
                _latest = new Observation { Stamp = stamp, Targets = targets.ToArray(), Snapshot = delta == null };
            }
        }

        void Update()
        {
            // Mesh completion is bounded to two downloads; limit uploads per frame.
            for (int i = 0; i < 2 && _main.TryDequeue(out var action); i++) action();
            Observation observation;
            SessionClient client;
            CancellationTokenSource run;
            lock (_gate) { observation = _latest; _latest = null; client = _client; run = _run; }
            if (observation == null || client == null || run == null) return;
            var plan = _scene.Reconcile(observation.Stamp, observation.Targets, observation.Snapshot);
            foreach (var key in plan.Removed.Concat(plan.Superseded).Distinct())
                if (_jobs.TryGetValue(key, out var job)) { job.Cancel(); _jobs.Remove(key); }
            foreach (var key in plan.Removed)
            {
                _wantedQuality.Remove(key);
                if (_views.TryGetValue(key, out var view)) { Destroy(view.gameObject); _views.Remove(key); }
            }
            foreach (var ticket in plan.Requests)
            {
                var wanted = _wantedQuality.TryGetValue(ticket.Key, out var preference) ? preference : MeshLod.Interactive;
                var count = _views.TryGetValue(ticket.Key, out var previous) ? previous.TriangleCount : 0;
                StartMesh(run, client, ticket, (int)LodPolicy.ForBody(count, TriangleBudget, wanted));
            }
            if (plan.Removed.Count > 0) NotifySceneChanged();
        }

        void NotifySceneChanged()
        {
            TriangleCount = _views.Values.Sum(view => (long)view.TriangleCount);
            UnityEngine.Debug.Log("KREODA_MODEL objects=" + _views.Count + " triangles=" + TriangleCount);
            SceneChanged?.Invoke();
        }

        void StartMesh(CancellationTokenSource run, SessionClient client, SceneMeshRequestTicket ticket, int quality)
        {
            if (_jobs.TryGetValue(ticket.Key, out var prior)) prior.Cancel();
            var job = CancellationTokenSource.CreateLinkedTokenSource(run.Token);
            _jobs[ticket.Key] = job;
            _ = Task.Run(() => Download(run, client, ticket, job, quality));
        }

        public bool RequestQuality(QuestMeshView view, MeshLod wanted)
        {
            if (view == null || wanted < MeshLod.Preview || wanted > MeshLod.Inspection || TriangleBudget <= 0) return false;
            lock (_gate)
            {
                if (_client == null || _run == null) { Status = "PC non connesso"; return false; }
                var key = new SceneObjectKey(view.BodyId, view.InstanceId);
                var ticket = _scene.RequestRefresh(key);
                if (ticket == null) { Status = "Attendi la mesh aggiornata prima di cambiare dettaglio"; return false; }
                _wantedQuality[key] = wanted;
                StartMesh(_run, _client, ticket, (int)wanted);
                Status = wanted == MeshLod.Inspection ? "Richiesta dettaglio ispezione" : "Richiesta dettaglio interattivo";
                return true;
            }
        }

        async Task Download(CancellationTokenSource run, SessionClient client, SceneMeshRequestTicket ticket,
            CancellationTokenSource job, int quality)
        {
            var watch = Stopwatch.StartNew();
            bool queued = false;
            try
            {
                await _meshSlots.WaitAsync(job.Token).ConfigureAwait(false);
                try
                {
                    for (int attempt = 0; attempt < 3 && _scene.IsCurrent(ticket); attempt++)
                    {
                        try
                        {
                            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(job.Token);
                            deadline.CancelAfter(TimeSpan.FromSeconds(20));
                            var mesh = await client.RequestMeshLodAsync(ticket.Target.BodyId, quality, ticket.Target.DocumentId,
                                ticket.Target.Revision, deadline.Token, ticket.Target.InstanceId).ConfigureAwait(false);
                            if (!_scene.IsCurrent(ticket)) return;
                            lock (_gate)
                            {
                                if (!Current(run)) return;
                                _main.Enqueue(() =>
                                {
                                    try
                                    {
                                        lock (_gate)
                                        {
                                            if (!Current(run)) return;
                                            var disposition = _scene.Complete(ticket, () =>
                                            {
                                                if (!_views.TryGetValue(ticket.Key, out var view))
                                                {
                                                    var body = new GameObject(ticket.Key.InstanceId ?? ticket.Key.BodyId);
                                                    body.transform.SetParent(DisplayRoot, false);
                                                    view = body.AddComponent<QuestMeshView>();
                                                    view.SurfaceMaterial = SurfaceMaterial;
                                                    view.EdgeMaterial = EdgeMaterial;
                                                    view.SelectionMaterial = SelectionMaterial;
                                                    view.PreviewMaterial = PreviewMaterial;
                                                    try { view.Upload(mesh); _views.Add(ticket.Key, view); }
                                                    catch { Destroy(body); throw; }
                                                }
                                                else view.Upload(mesh);
                                                MeshMilliseconds = watch.Elapsed.TotalMilliseconds;
                                            });
                                            if (disposition == MeshCompletionDisposition.IgnoreStale) Interlocked.Increment(ref _discardedMeshes);
                                            else
                                            {
                                                NotifySceneChanged();
                                                if (TriangleBudget > 0 && TriangleCount > TriangleBudget)
                                                {
                                                    // One downgrade per current object/quality; coarse meshes
                                                    // are never retried endlessly if the budget still exceeds.
                                                    var expensive = _views.Values.Where(view => view.Quality > 0 &&
                                                        (new SceneObjectKey(view.BodyId, view.InstanceId) == ticket.Key ||
                                                         !_jobs.ContainsKey(new SceneObjectKey(view.BodyId, view.InstanceId))))
                                                        .OrderByDescending(view => view.TriangleCount).FirstOrDefault();
                                                    if (expensive != null && RequestQuality(expensive, MeshLod.Preview))
                                                        Status = "Budget triangoli superato: LOD anteprima richiesto";
                                                }
                                            }
                                        }
                                    }
                                    catch { Status = "Caricamento CAD fallito: riconnetti per riprovare"; }
                                    finally { CleanupJob(ticket, job); }
                                });
                                queued = true;
                            }
                            return;
                        }
                        catch (Exception) when (!job.IsCancellationRequested && attempt < 2 && _scene.IsCurrent(ticket))
                        { await Task.Delay(TimeSpan.FromSeconds(attempt + 1), job.Token).ConfigureAwait(false); }
                    }
                }
                finally { _meshSlots.Release(); }
            }
            catch (Exception)
            { if (!job.IsCancellationRequested) Post(run, () => Status = "Mesh non disponibile: riconnetti per riprovare"); }
            finally
            {
                if (!queued)
                {
                    if (job.IsCancellationRequested || !_scene.IsCurrent(ticket)) Interlocked.Increment(ref _discardedMeshes);
                    _scene.Abandon(ticket);
                    lock (_gate)
                        if (_destroyed) job.Dispose(); else _main.Enqueue(() => CleanupJob(ticket, job));
                }
            }
        }

        void CleanupJob(SceneMeshRequestTicket ticket, CancellationTokenSource job)
        {
            _scene.Abandon(ticket);
            if (_jobs.TryGetValue(ticket.Key, out var pending) && pending == job) _jobs.Remove(ticket.Key);
            job.Dispose();
        }

        public void PublishTarget(QuestMeshView view, MeshSemanticHit hit)
        {
            if (hit != null && hit.ReferenceAmbiguous) { Status = "Riferimento ambiguo: selezione solo locale"; return; }
            SessionClient client;
            CancellationTokenSource run;
            lock (_gate) { client = _client; run = _run; }
            if (client == null || run == null || view == null) { Status = "PC non connesso"; return; }
            var target = _scene.GetAppliedTarget(new SceneObjectKey(view.BodyId, view.InstanceId));
            var model = client.Model;
            if (target == null || model == null || target.SessionId != model.SessionId ||
                target.DocumentId != model.DocumentId || target.Revision != model.Revision || target.FeatureId != view.FeatureId)
            { Status = "Attendi la mesh aggiornata prima di inviare il target"; return; }
            var id = hit?.PersistentId ?? view.FeatureId;
            _ = Task.Run(async () =>
            {
                try
                {
                    using var deadline = CancellationTokenSource.CreateLinkedTokenSource(run.Token);
                    deadline.CancelAfter(TimeSpan.FromSeconds(5));
                    await client.CallAsync(SessionMethods.SetSelection,
                        new Dictionary<string, object> { ["ids"] = new[] { id }, ["publish"] = true,
                            ["documentId"] = model.DocumentId, ["baseRevision"] = target.Revision }, deadline.Token).ConfigureAwait(false);
                    Post(run, () => Status = "Target inviato al PC");
                }
                catch { Post(run, () => Status = "Target non inviato: selezione o connessione cambiata"); }
            });
        }

        SavedDevice ReadDevice()
        {
            try
            {
                if (!File.Exists(_credentialFile) || new FileInfo(_credentialFile).Length > 4096) return null;
                using var file = File.OpenRead(_credentialFile);
                using var reader = new BinaryReader(file);
                if (reader.ReadInt32() != 1) return null;
                var saved = new SavedDevice { Endpoint = reader.ReadString(), DeviceId = reader.ReadString(),
                    Credential = reader.ReadString(), LogicalId = reader.ReadString() };
                if (!QuestConnectionInput.TryEndpoint(saved.Endpoint, out _) || saved.DeviceId.Length == 0 ||
                    saved.DeviceId.Length > 128 || saved.Credential.Length != 43 || saved.Credential.Any(c =>
                        !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '_' || c == '-')) ||
                    !saved.LogicalId.StartsWith("client-", StringComparison.Ordinal) ||
                    !Guid.TryParse(saved.LogicalId.Substring(7), out _)) return null;
                return saved;
            }
            catch (IOException) { return null; }
            catch (ArgumentException) { return null; }
        }

        void WriteDevice(SavedDevice saved)
        {
            using var file = File.Open(_credentialFile, FileMode.Create, FileAccess.Write, FileShare.None);
            using var writer = new BinaryWriter(file);
            writer.Write(1); writer.Write(saved.Endpoint); writer.Write(saved.DeviceId);
            writer.Write(saved.Credential); writer.Write(saved.LogicalId);
            file.Flush(true);
        }

        void CancelMeshes()
        {
            foreach (var job in _jobs.Values) job.Cancel();
            _jobs.Clear();
        }

        void OnDestroy()
        {
            lock (_gate) { _destroyed = true; _run?.Cancel(); _run?.Dispose(); _client = null; _scene.InvalidateConnection(); }
            CancelMeshes();
            foreach (var view in _views.Values) if (view != null) Destroy(view.gameObject);
            _views.Clear();
            while (_main.TryDequeue(out var action)) action();
        }
    }
}
