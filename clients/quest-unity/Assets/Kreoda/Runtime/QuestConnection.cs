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
        public Material SectionCapMaterial, SectionContourMaterial;
        public QuestSection Section;
        public string Status { get; private set; } = "Non connesso";
        public string SavedEndpoint { get { lock (_gate) return _saved?.Endpoint ?? ""; } }
        public bool Connected { get; private set; }
        public DiscoveredSessionPc[] AvailablePcs { get; private set; } = Array.Empty<DiscoveredSessionPc>();
        public double? RttMilliseconds { get; private set; }
        public double? MeshMilliseconds { get; private set; }
        public long TriangleCount { get; private set; }
        public int PendingMeshCount => _scene.PendingCount;
        public int TriangleBudget = 250000;
        public int DiscardedMeshes => System.Threading.Volatile.Read(ref _discardedMeshes);
        int _discardedMeshes;
        public event Action SceneChanged;
        public IReadOnlyCollection<QuestMeshView> Views => _views.Values;
        public IReadOnlyCollection<QuestDatumView> DatumViews => _datumViews.Values;
        public long ConnectionGeneration => _scene.ConnectionGeneration;
        public SessionClient Client { get { lock (_gate) return _client; } }

        public bool IsCurrentView(QuestMeshView view)
        {
            if (view == null) return false;
            if (!_views.TryGetValue(new SceneObjectKey(view.BodyId, view.InstanceId), out var applied) || !ReferenceEquals(applied, view)) return false;
            var client = Client;var model = client?.Model;
            var target = _scene.GetAppliedTarget(new SceneObjectKey(view.BodyId, view.InstanceId));
            return model != null && target != null && target.SessionId == model.SessionId &&
                target.DocumentId == model.DocumentId && target.Revision == model.Revision && target.FeatureId == view.FeatureId;
        }
        public bool IsCurrentDatum(QuestDatumView view)
        {
            if (view == null || !view.IsSelectable) return false;
            SessionClient client;
            CancellationTokenSource run;
            lock (_gate) { client = _client;run = _run; }
            var model = client?.Model;
            return run != null && !run.IsCancellationRequested && model != null &&
                _datumGeneration == _scene.ConnectionGeneration && ReferenceEquals(_datumModel, model) &&
                _datumViews.TryGetValue(view.FeatureId, out var applied) &&
                ReferenceEquals(applied, view) && view.SessionId == model.SessionId && view.DocumentId == model.DocumentId &&
                view.Revision == model.Revision && _datumSessionId == model.SessionId && _datumDocumentId == model.DocumentId;
        }
        // Capture Unity identity on the caller's frame, then query off the frame loop.
        public Task<SpatialEditIntent[]> EditIntentsAsync(QuestMeshView view, string owner = null)
        {
            if (!IsCurrentView(view)) throw new SessionException("NEED_FULL_SNAPSHOT", "visible CAD target is stale");
            var client = Client;var model = client.Model;
            var feature = owner ?? view.FeatureId;var body = view.BodyId;var tip = view.FeatureId;
            var descriptor = model.Bodies.FirstOrDefault(b => b.GetProperty("bodyId").GetString() == body);
            if (descriptor.ValueKind != JsonValueKind.Object || (view.InstanceId != null ? feature != view.InstanceId :
                !descriptor.GetProperty("history").EnumerateArray().Any(id => id.GetString() == feature)))
                throw new SessionException("BAD_PARAMS", "edit owner is unrelated to the selected body");
            return Task.Run(async () => {
                using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(10));
                var reply = await client.CallAsync(SessionMethods.GetManipulators,
                    new Dictionary<string, object> { ["featureId"] = feature }, deadline.Token,
                    expectedSessionId: model.SessionId).ConfigureAwait(false);
                if (Client != client || client.Model?.SessionId != model.SessionId ||
                    client.Model.DocumentId != model.DocumentId || client.Model.Revision != model.Revision)
                    throw new SessionException("NEED_FULL_SNAPSHOT", "manipulator query is stale");
                return reply.GetProperty("result").GetProperty("manipulators").EnumerateArray().Select(metadata => {
                    var values = metadata.GetProperty("currentValues").EnumerateObject()
                        .ToDictionary(p => p.Name, p => p.Value.GetDouble(), StringComparer.Ordinal);
                    return new SpatialEditIntent(model.SessionId, model.DocumentId, model.Revision, feature,
                        body, tip, metadata, values);
                }).ToArray();
            });
        }
        readonly QuestSceneState _scene = new QuestSceneState();
        readonly Dictionary<SceneObjectKey, QuestMeshView> _views = new Dictionary<SceneObjectKey, QuestMeshView>();
        readonly Dictionary<string, QuestDatumView> _datumViews = new Dictionary<string, QuestDatumView>(StringComparer.Ordinal);
        readonly Dictionary<SceneObjectKey, CancellationTokenSource> _jobs = new Dictionary<SceneObjectKey, CancellationTokenSource>();
        readonly Dictionary<SceneObjectKey, MeshLod> _wantedQuality = new Dictionary<SceneObjectKey, MeshLod>();
        readonly ConcurrentQueue<Action> _main = new ConcurrentQueue<Action>();
        readonly SemaphoreSlim _meshSlots = new SemaphoreSlim(2, 2);
        readonly object _gate = new object();
        CancellationTokenSource _run;
        SessionClient _client;
        Observation _latest;
        string _datumSessionId, _datumDocumentId;
        long _datumGeneration = -1;
        SessionModelState _datumModel;
        SavedDevice _saved;
        string _credentialFile;
        bool _destroyed;
        bool _applicationPaused;
        string _chosenPcId;
#if UNITY_EDITOR
        static System.Net.IPEndPoint _editorDiscoveryTestTarget;
#endif

        sealed class SavedDevice
        {
            public string Endpoint, DeviceId, Credential, LogicalId, PcId, Name, InstallationId;
            public SavedDevice Copy() => (SavedDevice)MemberwiseClone();
        }
        sealed class Observation
        {
            public SceneObservationStamp Stamp;
            public SessionModelState Model;
            public FeatureDescriptor[] Features;
            public SceneMeshTarget[] Targets;
            public JsonElement[] Datums;
            public bool Snapshot;
        }

#if UNITY_EDITOR
        internal static string ResolveEditorStorageDirectory(string fallback)
        {
            const string variable = "KREODA_EDITOR_DATA_DIR";
            var configured = Environment.GetEnvironmentVariable(variable);
            if (configured == null) return fallback;
            if (string.IsNullOrWhiteSpace(configured) || !Path.IsPathFullyQualified(configured))
                throw new ArgumentException(variable + " must name an existing absolute directory");
            var directory = Path.GetFullPath(configured);
            if (!Directory.Exists(directory))
                throw new ArgumentException(variable + " must name an existing absolute directory");
            return directory;
        }
#endif

        void Awake()
        {
            string directory;
#if UNITY_EDITOR
            directory = ResolveEditorStorageDirectory(Application.persistentDataPath);
#else
            directory = Application.persistentDataPath;
#endif
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
                using var component = intent.Call<AndroidJavaObject>("getComponent");
                var endpoint = intent.Call<string>("getStringExtra", "kreoda.endpoint");
                var code = intent.Call<string>("getStringExtra", "kreoda.pairing-code");
                // Consume one-use setup input; the existing private credential file
                // handles later reconnects without codes or headset interaction.
                intent.Call("removeExtra", "kreoda.endpoint");
                intent.Call("removeExtra", "kreoda.pairing-code");
                if (ApplyStartupConfiguration(component?.Call<string>("getClassName"), endpoint, code)) return;
            }
#endif
#if UNITY_ANDROID && !UNITY_EDITOR
            StartConnection(null, null);
#else
            if (_saved != null) StartConnection(null, null);
#endif
        }

        void OnApplicationPause(bool paused)
        {
            if (paused) { _applicationPaused = true;return; }
            ResumeFromPause("pause");
        }

        void OnApplicationFocus(bool focused)
        {
            if (focused) ResumeFromPause("focus");
        }

        void ResumeFromPause(string source)
        {
            if (!TryConsumeApplicationResume()) return;
            if (Connected && Client?.IsConnected == true)
            {
                UnityEngine.Debug.Log("KREODA_RESUME preserved_connected");
                return;
            }
            UnityEngine.Debug.Log("KREODA_RESUME kick source=" + source);
            StartConnection(null, null);
        }

        bool TryConsumeApplicationResume()
        {
            if (!_applicationPaused) return false;
            _applicationPaused = false;
            return true;
        }

        bool ApplyStartupConfiguration(string component, string endpoint, string code)
        {
            if (!QuestProvisioning.Trusted(component) || string.IsNullOrEmpty(endpoint)) return false;
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
            StartConnection(null, null);
        }

        public void SelectPc(string pcId)
        {
            if (!AvailablePcs.Any(pc => pc.PcId == pcId)) return;
            lock (_gate) _chosenPcId = pcId;
            StartConnection(null, null);
        }

        public void Forget()
        {
            bool forgotten = false;
            bool storageUpdated = true;
            lock (_gate)
            {
                _run?.Cancel();
                _run?.Dispose();
                _run = null;
                _client = null;
                _latest = null;
                _scene.InvalidateConnection();
                try
                {
                    QuestPcCredentials.Remove(CredentialCachePath, _saved?.PcId);
                    if (File.Exists(_credentialFile)) File.Delete(_credentialFile);
                }
                catch
                {
                    storageUpdated = false;
                    Status = "PC non dimenticato: archivio locale non disponibile";
                }
                // A failed cache mutation must not report successful forgetting.
                if (storageUpdated && !File.Exists(_credentialFile) &&
                    (string.IsNullOrEmpty(_saved?.PcId) ||
                     !QuestPcCredentials.Read(CredentialCachePath).ContainsKey(_saved.PcId)))
                {
                    _saved = null;
                    _chosenPcId = null;
                    forgotten = true;
                }
            }
            CancelMeshes();
            Connected = false;
            AvailablePcs = Array.Empty<DiscoveredSessionPc>();
            RttMilliseconds = null;
            Status = forgotten ? "PC dimenticato. Nuova associazione" : "PC non dimenticato: archivio locale non disponibile";
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
            // Discovery belongs to the previous connection generation. A new
            // scan must not present obsolete peers as currently reachable, or
            // allow a one-tap selection of a PC that is no longer advertised.
            // SelectPc captures the requested stable PcId before this reset.
            AvailablePcs = Array.Empty<DiscoveredSessionPc>();
            RttMilliseconds = null;
            Status = "Ricerca del PC locale…";
            UnityEngine.Debug.Log("KREODA_ATTEMPT start");
            // All socket work, timeouts and reconnect delays stay off the frame loop.
            var ct = run.Token;
            _ = Task.Run(() => ConnectionLoop(run, ct, pairingEndpoint, code));
        }

        async Task ConnectionLoop(CancellationTokenSource run, CancellationToken ct, Uri pairingEndpoint, string code)
        {
            int attempt = 0;
            bool legacyEndpointUnavailable = false;
            while (!ct.IsCancellationRequested)
            {
                SessionClient client = null;
                long generation;
                SavedDevice saved = null, activeSaved = null, activeForCache = null;
                Dictionary<string, QuestPcCredentialRecord> pcCredentials = null;
                bool commitSaved = false, cachePerPc = false, legacyIdentity = false;
                DiscoveredSessionPc[] offeredPcs = null;
                string requestedPcId = null;
                lock (_gate)
                {
                    if (!Current(run)) break;
                    generation = _scene.BeginConnection();
                }
                try
                {
                    lock (_gate) { saved = _saved?.Copy();requestedPcId = _chosenPcId; }
                    activeSaved = saved?.Copy();
                    activeForCache = activeSaved?.Copy();
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
                            commitSaved = true;
                            code = null;
                        }
                        else
                        {
                            pcCredentials = QuestPcCredentials.Read(CredentialCachePath);
                            var knownHost = KnownHostHint(requestedPcId, saved, pcCredentials);
                            var discoveryWatch = Stopwatch.StartNew();
                            var peers = await FindLocalPcsAsync(deadline.Token, knownHost).ConfigureAwait(false);
                            discoveryWatch.Stop();
                            offeredPcs = peers;
                            var selected = SessionDiscovery.Choose(peers, requestedPcId ?? saved?.PcId);
                            legacyIdentity = saved != null && !string.IsNullOrEmpty(saved.DeviceId) && string.IsNullOrEmpty(saved.PcId);
                            var discoveryMs = discoveryWatch.ElapsedMilliseconds;
                            Post(run, () => UnityEngine.Debug.Log("KREODA_DISCOVERY hint=" + (knownHost != null) +
                                " peers=" + peers.Length + " ms=" + discoveryMs +
                                " known=" + !string.IsNullOrEmpty(saved?.PcId) + " legacy=" + legacyIdentity));
                            DiscoveredSessionPc trustedLegacyPc = null;
                            if (legacyIdentity)
                            {
                                foreach (var peer in peers)
                                {
                                    if (await VerifyKnownPcAsync(peer, saved, deadline.Token).ConfigureAwait(false))
                                    { trustedLegacyPc = peer;break; }
                                }
                                selected = string.IsNullOrEmpty(requestedPcId) || trustedLegacyPc?.PcId == requestedPcId
                                    ? trustedLegacyPc ?? (legacyEndpointUnavailable ? SessionDiscovery.Choose(peers, null) : null)
                                    : SessionDiscovery.Choose(peers, requestedPcId);
                                if (!string.IsNullOrEmpty(requestedPcId) && selected != null && trustedLegacyPc == null)
                                    throw new SessionException("CHOOSE_PC", "reconnect the saved PC before switching");
                                if (trustedLegacyPc != null)
                                {
                                    activeForCache = saved.Copy();activeForCache.PcId = trustedLegacyPc.PcId;
                                    activeForCache.Name = trustedLegacyPc.Name;
                                    if (string.IsNullOrEmpty(activeForCache.InstallationId))
                                        activeForCache.InstallationId = Guid.NewGuid().ToString("D");
                                }
                            }
                            // One reconnect attempt may finish posting discovery
                            // after a later attempt has already invalidated the
                            // scene generation. Do not repopulate the list with
                            // peers from the superseded discovery attempt.
                            Post(run, () => { if (_scene.ConnectionGeneration == generation)
                                AvailablePcs = peers; });
                            if (selected == null && !string.IsNullOrEmpty(requestedPcId))
                                throw new SessionException("CHOOSE_PC", "selected PC is not available");
                            bool savedEndpointAvailable = activeSaved != null && !string.IsNullOrEmpty(activeSaved.DeviceId) &&
                                QuestConnectionInput.TryEndpoint(activeSaved.Endpoint, out _);
                            // Discovery silence must not retire a still-working trusted session address.
                            // A peer claiming that exact address but failing identity proof cannot downgrade to credential auth.
                            bool savedAddressRejected = savedEndpointAvailable && selected == null &&
                                peers.Any(peer => peer.Endpoint == new Uri(activeSaved.Endpoint));
                            if (selected == null && peers.Length != 0 && (!savedEndpointAvailable || savedAddressRejected))
                                throw new SessionException("CHOOSE_PC", "select a local PC by name");
                            if (selected != null)
                            {
                                pcCredentials.TryGetValue(selected.PcId, out var cached);
                                if (cached != null)
                                {
                                    saved = FromPcCredential(cached);
                                    if (!string.IsNullOrEmpty(saved.DeviceId) &&
                                        !await VerifyKnownPcAsync(selected, saved, deadline.Token).ConfigureAwait(false))
                                        throw new SessionException("UNAUTHORIZED", "saved PC identity rejected");
                                }
                                else if (activeSaved != null && activeSaved.PcId == selected.PcId &&
                                    !string.IsNullOrEmpty(activeSaved.DeviceId))
                                {
                                    saved = activeSaved.Copy();
                                    if (!await VerifyKnownPcAsync(selected, saved, deadline.Token).ConfigureAwait(false))
                                        throw new SessionException("UNAUTHORIZED", "saved PC identity rejected");
                                }
                                else if (legacyIdentity && trustedLegacyPc?.PcId == selected.PcId)
                                    saved = activeSaved.Copy();
                                else
                                    saved = new SavedDevice { Endpoint = "", DeviceId = "",
                                        Credential = SessionDiscovery.CreateCredential(), LogicalId = "client-" + Guid.NewGuid().ToString("D"),
                                        InstallationId = Guid.NewGuid().ToString("D") };
                                saved.PcId = selected.PcId;saved.Name = selected.Name;
                                if (string.IsNullOrEmpty(saved.InstallationId)) saved.InstallationId = Guid.NewGuid().ToString("D");
                                if (string.IsNullOrEmpty(saved.DeviceId))
                                {
                                    // Persist this PC's pending identity before bootstrap for lost-ack retries.
                                    saved.Endpoint = "";
                                    pcCredentials = PersistPendingPcCredential(run, generation, pcCredentials, activeForCache, saved);
                                    saved.DeviceId = await PairPcAsync(selected, saved, deadline.Token).ConfigureAwait(false);
                                }
                                saved.Endpoint = selected.Endpoint.AbsoluteUri;saved.PcId = selected.PcId;saved.Name = selected.Name;
                                commitSaved = true;cachePerPc = true;
                            }
                            if (selected == null) saved = activeSaved;
                            if (saved == null || string.IsNullOrEmpty(saved.Endpoint) || string.IsNullOrEmpty(saved.DeviceId))
                                throw new SessionException("SEARCHING_PC", "no local PC available");
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
                        if (client.Model == null) throw new SessionException("BAD_MODEL", "snapshot missing");
                        if (commitSaved)
                            CommitSavedDevice(run, generation, saved, pcCredentials, cachePerPc, activeForCache);
                        lock (_gate)
                        {
                            if (!Current(run) || generation != _scene.ConnectionGeneration)
                                throw new OperationCanceledException(ct);
                            _client = client;
                        }
                        // Publish the initial snapshot only after Update can observe
                        // the authenticated client; otherwise it can consume and drop
                        // this observation while _client is still null during disk commit.
                        Capture(run, client, generation, client.Model, null);
                        var connectedName = saved?.Name;
                        Post(run, () => { if (_scene.ConnectionGeneration != generation ||
                            !ReferenceEquals(_client, connectedClient)) return;
                            Connected = true; Status = string.IsNullOrEmpty(connectedName) ? "Connesso al PC" : "Connesso a " + connectedName; UnityEngine.Debug.Log("KREODA_CONNECTED"); });
                        attempt = 0;legacyEndpointUnavailable = false;
                        while (!ct.IsCancellationRequested)
                        {
                            await Task.Delay(TimeSpan.FromSeconds(3), ct).ConfigureAwait(false);
                            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
                            deadline.CancelAfter(TimeSpan.FromSeconds(5));
                            var watch = Stopwatch.StartNew();
                            await connectedClient.SessionInfoAsync(deadline.Token).ConfigureAwait(false);
                            var elapsed = watch.Elapsed.TotalMilliseconds;
                            Post(run, () => { if (_scene.ConnectionGeneration == generation &&
                                ReferenceEquals(_client, connectedClient)) RttMilliseconds = elapsed; });
                        }
                    }
                    finally { client.ModelChanged -= changed; }
                }
                catch (OperationCanceledException) when (ct.IsCancellationRequested) { break; }
                catch (Exception error)
                {
                    if (legacyIdentity && error is System.Net.WebSockets.WebSocketException)
                        legacyEndpointUnavailable = true;
                    var unauthorized = error is SessionException session && session.Code == "UNAUTHORIZED";
                    long failureGeneration = -1;
                    lock (_gate)
                    {
                        if (Current(run))
                        {
                            _client = null;
                            _latest = null;
                            _scene.InvalidateConnection();
                            failureGeneration = _scene.ConnectionGeneration;
                        }
                    }
                    Post(run, () =>
                    {
                        // This error belongs to the attempt invalidated above.
                        // A newer retry may have started in the same _run; its
                        // connection and status must not be cleared by this
                        // older, queued failure notification.
                        if (failureGeneration < 0 ||
                            _scene.ConnectionGeneration != failureGeneration) return;
                        Connected = false;
                        RttMilliseconds = null;
                        CancelMeshes();
                        // CHOOSE_PC invalidates the authentication attempt before
                        // its queued discovery result is consumed. Publish those
                        // candidates with THIS failure generation so the picker
                        // stays usable, while stale failures remain fenced above.
                        if (error is SessionException choice && choice.Code == "CHOOSE_PC" && offeredPcs != null)
                            AvailablePcs = offeredPcs;
                        Status = error is SessionException state && state.Code == "CHOOSE_PC" ? "Scegli il PC dal nome" :
                            error is SessionException searching && searching.Code == "SEARCHING_PC" ? "Ricerca del PC locale…" :
                            unauthorized ? "Accesso revocato dal PC" :
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
        string CredentialCachePath => _credentialFile + ".pcs";

        static SavedDevice FromPcCredential(QuestPcCredentialRecord value) => new SavedDevice {
            PcId = value.PcId, Name = value.Name, Endpoint = value.Endpoint, DeviceId = value.DeviceId,
            Credential = value.Credential, LogicalId = value.LogicalId, InstallationId = value.InstallationId,
        };

        static QuestPcCredentialRecord ToPcCredential(SavedDevice value) => new QuestPcCredentialRecord {
            PcId = value.PcId, Name = value.Name ?? "", Endpoint = value.Endpoint ?? "", DeviceId = value.DeviceId ?? "",
            Credential = value.Credential, LogicalId = value.LogicalId, InstallationId = value.InstallationId,
        };

        Dictionary<string, QuestPcCredentialRecord> PersistPendingPcCredential(CancellationTokenSource run,
            long generation, Dictionary<string, QuestPcCredentialRecord> records, SavedDevice active, SavedDevice pending)
        {
            lock (_gate)
            {
                EnsureCurrentConnection(run, generation);
                var next = new Dictionary<string, QuestPcCredentialRecord>(records, StringComparer.Ordinal);
                if (!string.IsNullOrEmpty(active?.PcId)) next[active.PcId] = ToPcCredential(active);
                next[pending.PcId] = ToPcCredential(pending);
                QuestPcCredentials.Write(CredentialCachePath, next.Values);
                return next;
            }
        }

        void CommitSavedDevice(CancellationTokenSource run, long generation, SavedDevice saved,
            Dictionary<string, QuestPcCredentialRecord> records, bool cachePerPc, SavedDevice active)
        {
            lock (_gate)
            {
                EnsureCurrentConnection(run, generation);
                if (cachePerPc)
                {
                    var next = new Dictionary<string, QuestPcCredentialRecord>(records, StringComparer.Ordinal);
                    if (!string.IsNullOrEmpty(active?.PcId)) next[active.PcId] = ToPcCredential(active);
                    next[saved.PcId] = ToPcCredential(saved);
                    // Active file is the commit point. A cache/write failure leaves the prior PC active.
                    QuestPcCredentials.Write(CredentialCachePath, next.Values);
                }
                WriteDevice(saved);
                _saved = saved.Copy();
            }
        }

        void EnsureCurrentConnection(CancellationTokenSource run, long generation)
        {
            if (!Current(run) || run.IsCancellationRequested || generation != _scene.ConnectionGeneration)
                throw new OperationCanceledException();
        }

        static System.Net.IPAddress KnownHostHint(string requestedPcId, SavedDevice saved,
            Dictionary<string, QuestPcCredentialRecord> records)
        {
            var targetPcId = requestedPcId ?? saved?.PcId;
            System.Net.IPAddress hint = null;
            if (!string.IsNullOrEmpty(targetPcId))
            {
                if (records != null && records.TryGetValue(targetPcId, out var record))
                    hint = ParseKnownHost(record.Endpoint);
                if (hint == null && saved?.PcId == targetPcId) hint = ParseKnownHost(saved.Endpoint);
            }
            else if (string.IsNullOrEmpty(saved?.PcId)) hint = ParseKnownHost(saved?.Endpoint);
            return hint;
        }

        static System.Net.IPAddress ParseKnownHost(string endpoint)
        {
            if (!QuestConnectionInput.TryEndpoint(endpoint, out var uri) || uri == null ||
                !System.Net.IPAddress.TryParse(uri.Host, out var host)) return null;
#if UNITY_EDITOR
            return System.Net.IPAddress.IsLoopback(host) && SessionDiscovery.IsPrivate(host, true) ? host : null;
#else
            return SessionDiscovery.IsPrivate(host) ? host : null;
#endif
        }

        static Task<DiscoveredSessionPc[]> FindLocalPcsAsync(CancellationToken ct, System.Net.IPAddress knownHost)
        {
#if UNITY_EDITOR
            // Editor verification is local-only. Normal Android startup searches assigned LANs.
            if (knownHost != null && !System.Net.IPAddress.IsLoopback(knownHost)) knownHost = null;
            var target = _editorDiscoveryTestTarget ??
                new System.Net.IPEndPoint(System.Net.IPAddress.Loopback, SessionDiscovery.Port);
            return SessionDiscovery.FindAsync(ct, target, knownHost);
#else
            return SessionDiscovery.FindAsync(ct, null, knownHost);
#endif
        }

        static Task<bool> VerifyKnownPcAsync(DiscoveredSessionPc pc, SavedDevice saved, CancellationToken ct) =>
            SessionDiscovery.VerifyKnownDeviceAsync(pc, saved.DeviceId, saved.Credential, ct,
#if UNITY_EDITOR
                true);
#else
                false);
#endif
        static Task<string> PairPcAsync(DiscoveredSessionPc pc, SavedDevice saved, CancellationToken ct) =>
            SessionDiscovery.PairAsync(pc, saved.InstallationId, saved.Credential, ct,
#if UNITY_EDITOR
                true);
#else
                false);
#endif
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
            var targets = bodies.Where(ShouldRenderBody).Select(b => new SceneMeshTarget(b.BodyId, null, b.Tip, model.SessionId,
                model.DocumentId, model.Revision)).ToList();
            foreach (var instance in features.Where(f => f.Type == "Instance"))
            {
                if (instance.DependsOn?.Length != 1) throw new SessionException("BAD_MODEL", "invalid instance source");
                var body = bodies.SingleOrDefault(b => b.History.Contains(instance.DependsOn[0]));
                if (body == null) throw new SessionException("BAD_MODEL", "instance source body missing");
                if (!ShouldRenderBody(body)) continue;
                targets.Add(new SceneMeshTarget(body.BodyId, instance.FeatureId, instance.FeatureId,
                    model.SessionId, model.DocumentId, model.Revision));
            }
            lock (_gate)
            {
                if (!Current(run)) return;
                if (!ReferenceEquals(model, client.Model)) return;
                var stamp = _scene.CaptureObservation(generation, model.SessionId, model.DocumentId, model.Revision,
                    bodies.Where(b => ChangedBodyMatches(b, changed)).Select(b => b.BodyId),
                    features.Where(f => f.Type == "Instance" && changed.Contains(f.FeatureId)).Select(f => f.FeatureId));
                if (stamp.Sequence == 0) return;
                _latest = new Observation { Stamp = stamp, Model = model, Features = features, Targets = targets.ToArray(),
                    Datums = model.Datums.Select(datum => datum.Clone()).ToArray(), Snapshot = delta == null };
            }
        }

        internal static bool IsSurfaceFeature(FeatureDescriptor[] features, string featureId)
        {
            var byId = (features ?? Array.Empty<FeatureDescriptor>())
                .Where(feature => feature != null && !string.IsNullOrEmpty(feature.FeatureId))
                .GroupBy(feature => feature.FeatureId, StringComparer.Ordinal)
                .ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);
            if (string.IsNullOrEmpty(featureId) || !byId.TryGetValue(featureId, out var feature)) return false;
            if (feature.Type == "SurfaceExtrude" || feature.Type == "SurfaceRevolve" ||
                feature.Type == "SurfaceLoft" || feature.Type == "SurfaceSew" ||
                feature.Type == "SurfaceOffset" || feature.Type == "SurfaceSweep" ||
                feature.Type == "SurfaceTrim" || feature.Type == "SurfaceExtend")
                return true;
            if (feature.Type != "Instance" || feature.DependsOn?.Length != 1 ||
                string.IsNullOrEmpty(feature.DependsOn[0]) ||
                !byId.TryGetValue(feature.DependsOn[0], out var source)) return false;
            return source.Type == "SurfaceExtrude" || source.Type == "SurfaceRevolve" ||
                source.Type == "SurfaceLoft" || source.Type == "SurfaceSew" ||
                source.Type == "SurfaceOffset" || source.Type == "SurfaceSweep" ||
                source.Type == "SurfaceTrim" || source.Type == "SurfaceExtend";
        }

        static FeatureDescriptor[] FeatureSnapshot(SessionModelState model) => model?.Features == null
            ? Array.Empty<FeatureDescriptor>()
            : model.Features.Select(feature => JsonSerializer.Deserialize<FeatureDescriptor>(feature.GetRawText()))
                .Where(feature => feature != null).ToArray();

        internal static bool ShouldRenderBody(BodyDescriptor body) => body != null && body.Visible != false;
        // The canonical delta may name the body directly or the feature whose
        // B-Rep was rebuilt. Both identities refer to the same rendered body.
        internal static bool ChangedBodyMatches(BodyDescriptor body, ISet<string> changed) =>
            body != null && changed != null &&
            (changed.Contains(body.BodyId) || body.History?.Any(changed.Contains) == true ||
             (!string.IsNullOrEmpty(body.Tip) && changed.Contains(body.Tip)));

        void Update()
        {
            // Mesh completion is bounded to two downloads; limit uploads per frame.
            for (int i = 0; i < 2 && _main.TryDequeue(out var action); i++) action();
            Observation observation;
            SessionClient client;
            CancellationTokenSource run;
            lock (_gate) { observation = _latest; _latest = null; client = _client; run = _run; }
            if (observation == null || client == null || run == null) return;
            if (!ReferenceEquals(observation.Model, client.Model)) return;
            var plan = _scene.Reconcile(observation.Stamp, observation.Targets, observation.Snapshot);
            if (plan.IgnoredStaleObservation) return;
            var datumChanged = ReconcileDatums(observation);
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
                StartMesh(run, client, ticket, (int)LodPolicy.ForBody(count, TriangleBudget, wanted), observation.Features);
            }
            if (plan.Removed.Count > 0 || datumChanged) NotifySceneChanged();
        }

        bool ReconcileDatums(Observation observation)
        {
            var model = observation.Model;
            var lineageChanged = _datumSessionId != model.SessionId || _datumDocumentId != model.DocumentId;
            var changed = lineageChanged || _datumGeneration != observation.Stamp.ConnectionGeneration;
            if (lineageChanged) ClearDatumViews();
            _datumSessionId = model.SessionId;_datumDocumentId = model.DocumentId;
            _datumGeneration = observation.Stamp.ConnectionGeneration;_datumModel = model;
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var datum in observation.Datums)
            {
                if (datum.ValueKind != JsonValueKind.Object || !datum.TryGetProperty("featureId", out var idValue) ||
                    idValue.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(idValue.GetString())) continue;
                var id = idValue.GetString();
                if (!seen.Add(id)) continue;
                if (!_datumViews.TryGetValue(id, out var view))
                {
                    var owned = new GameObject("Datum " + id);
                    owned.transform.SetParent(DisplayRoot, false);
                    view = owned.AddComponent<QuestDatumView>();
                    view.LineMaterial = EdgeMaterial;view.SelectionMaterial = SelectionMaterial;
                    _datumViews.Add(id, view);changed = true;
                }
                changed |= view.Apply(datum, model.SessionId, model.DocumentId, model.Revision);
            }
            foreach (var id in _datumViews.Keys.Where(id => !seen.Contains(id)).ToArray())
            {
                DestroyDatumView(_datumViews[id]);_datumViews.Remove(id);changed = true;
            }
            return changed;
        }

        void ClearDatumViews()
        {
            foreach (var view in _datumViews.Values) DestroyDatumView(view);
            _datumViews.Clear();
        }

        static void DestroyDatumView(QuestDatumView view)
        {
            if (view == null) return;
            view.DisablePicking();
            if (Application.isPlaying) Destroy(view.gameObject);else DestroyImmediate(view.gameObject);
        }

        void NotifySceneChanged()
        {
            TriangleCount = _views.Values.Sum(view => (long)view.TriangleCount);
            UnityEngine.Debug.Log("KREODA_MODEL objects=" + _views.Count + " triangles=" + TriangleCount);
            if (Section != null) Section.Refresh();
            SceneChanged?.Invoke();
        }

        void StartMesh(CancellationTokenSource run, SessionClient client, SceneMeshRequestTicket ticket, int quality,
            FeatureDescriptor[] featureSnapshot = null)
        {
            if (_jobs.TryGetValue(ticket.Key, out var prior)) prior.Cancel();
            var job = CancellationTokenSource.CreateLinkedTokenSource(run.Token);
            _jobs[ticket.Key] = job;
            _ = Task.Run(() => Download(run, client, ticket, job, quality,
                featureSnapshot ?? Array.Empty<FeatureDescriptor>()));
        }

        public bool RequestQuality(QuestMeshView view, MeshLod wanted)
        {
            if (view == null || wanted < MeshLod.Preview || wanted > MeshLod.Inspection || TriangleBudget <= 0) return false;
            lock (_gate)
            {
                if (_client == null || _run == null) { Status = "PC non connesso"; return false; }
                // A retained selection from a previous session can have the same
                // body/instance key as the current scene. Never let that stale
                // view request a refresh of a different CAD object.
                if (!IsCurrentView(view)) { Status = "Selezione CAD non corrente"; return false; }
                var key = new SceneObjectKey(view.BodyId, view.InstanceId);
                var ticket = _scene.RequestRefresh(key);
                if (ticket == null) { Status = "Attendi la mesh aggiornata prima di cambiare dettaglio"; return false; }
                _wantedQuality[key] = wanted;
                StartMesh(_run, _client, ticket, (int)wanted, FeatureSnapshot(_client.Model));
                Status = wanted == MeshLod.Inspection ? "Richiesta dettaglio ispezione" : "Richiesta dettaglio interattivo";
                return true;
            }
        }

        async Task Download(CancellationTokenSource run, SessionClient client, SceneMeshRequestTicket ticket,
            CancellationTokenSource job, int quality, FeatureDescriptor[] featureSnapshot)
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
                                                    view.SectionCapMaterial = SectionCapMaterial;
                                                    view.SectionContourMaterial = SectionContourMaterial;
                                                    try { view.SetSurfaceGeometry(IsSurfaceFeature(featureSnapshot, ticket.Target.FeatureId));
                                                        view.Upload(mesh); _views.Add(ticket.Key, view); }
                                                    catch { Destroy(body); throw; }
                                                }
                                                else
                                                {
                                                    view.SetSurfaceGeometry(IsSurfaceFeature(featureSnapshot, ticket.Target.FeatureId));
                                                    view.Upload(mesh);
                                                }
                                                MeshMilliseconds = watch.Elapsed.TotalMilliseconds;
                                                UnityEngine.Debug.Log(
                                                    $"KREODA_MESH_APPLIED nativeRequestId={mesh.Header.NativeRequestId} " +
                                                    $"sessionId={mesh.Header.SessionId} documentId={mesh.Header.DocumentId} revision={mesh.Header.Revision} " +
                                                    $"bodyId={mesh.Header.BodyId} featureId={mesh.Header.FeatureId} tipId={mesh.Header.TipId} " +
                                                    $"instanceId={mesh.Header.InstanceId ?? "<null>"} quality={mesh.Header.Quality} " +
                                                    $"rawPayloadSha256={mesh.RawPayloadSha256} rawByteLength={mesh.RawByteLength} " +
                                                    $"triangleCount={view.TriangleCount} uploadVersion={view.UploadVersion}");
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
                                    // Complete removes its pending ticket even
                                    // when Upload throws, so IsCurrent(ticket)
                                    // alone would incorrectly hide a REAL upload
                                    // failure. Check accepted model lineage and
                                    // generation instead, rejecting stale jobs.
                                    catch
                                    {
                                        var currentModel = client.Model;
                                        if (Current(run) && _scene.ConnectionGeneration == ticket.ConnectionGeneration &&
                                            currentModel != null && currentModel.SessionId == ticket.Target.SessionId &&
                                            currentModel.DocumentId == ticket.Target.DocumentId &&
                                            currentModel.Revision == ticket.Target.Revision)
                                            Status = "Caricamento CAD fallito: riconnetti per riprovare";
                                    }
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
            {
                if (!job.IsCancellationRequested && _scene.IsCurrent(ticket))
                    Post(run, () => { if (_scene.IsCurrent(ticket))
                        Status = "Mesh non disponibile: riconnetti per riprovare"; });
            }
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
            // A prior-session view may reuse the new model's body and feature ids.
            // Match the currently displayed view object, not just its identifiers.
            if (!IsCurrentView(view)) { Status = "Selezione CAD non corrente"; return; }
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
                            ["documentId"] = model.DocumentId, ["baseRevision"] = target.Revision }, deadline.Token,
                        expectedSessionId: model.SessionId).ConfigureAwait(false);
                    // A successful response for an older revision must not
                    // announce a selected target on the new document/session.
                    Post(run, () => { if (ReferenceEquals(client.Model, model)) Status = "Target inviato al PC"; });
                }
                catch { Post(run, () => { if (ReferenceEquals(client.Model, model))
                    Status = "Target non inviato: selezione o connessione cambiata"; }); }
            });
        }

        public void PublishTarget(QuestDatumView view)
        {
            if (!IsCurrentDatum(view)) { Status = "Attendi il datum corrente prima di inviare il target";return; }
            SessionClient client;
            CancellationTokenSource run;
            lock (_gate) { client = _client;run = _run; }
            var model = client?.Model;
            if (client == null || run == null || model == null) { Status = "PC non connesso";return; }
            var id = view.FeatureId;
            var selectionKind = view.SelectionKind;
            if (selectionKind != "datumPlane" && selectionKind != "datumAxis" && selectionKind != "datumPoint")
            { Status = "Tipo datum non valido";return; }
            var payload = new Dictionary<string, object> { ["ids"] = new[] { id }, ["publish"] = true,
                ["documentId"] = model.DocumentId, ["baseRevision"] = view.Revision };
            _ = Task.Run(async () =>
            {
                try
                {
                    using var deadline = CancellationTokenSource.CreateLinkedTokenSource(run.Token);
                    deadline.CancelAfter(TimeSpan.FromSeconds(5));
                    await client.CallAsync(SessionMethods.SetSelection, payload, deadline.Token,
                        expectedSessionId: model.SessionId).ConfigureAwait(false);
                    Post(run, () => { if (ReferenceEquals(client.Model, model)) Status = "Target datum inviato al PC"; });
                }
                catch { Post(run, () => { if (ReferenceEquals(client.Model, model))
                    Status = "Target non inviato: datum o connessione cambiata"; }); }
            });
        }

        SavedDevice ReadDevice()
        {
            try
            {
                if (!File.Exists(_credentialFile) || new FileInfo(_credentialFile).Length > 4096) return null;
                using var file = File.OpenRead(_credentialFile);
                using var reader = new BinaryReader(file);
                var version = reader.ReadInt32();
                if (version != 1 && version != 2) return null;
                var saved = new SavedDevice { Endpoint = reader.ReadString(), DeviceId = reader.ReadString(),
                    Credential = reader.ReadString(), LogicalId = reader.ReadString() };
                if (version == 2)
                {
                    saved.PcId = reader.ReadString();saved.Name = reader.ReadString();saved.InstallationId = reader.ReadString();
                    if ((!string.IsNullOrEmpty(saved.PcId) && !Guid.TryParseExact(saved.PcId, "D", out _)) ||
                        !Guid.TryParseExact(saved.InstallationId, "D", out _) || saved.Name.Length > 80) return null;
                }
                if ((saved.Endpoint.Length != 0 && !QuestConnectionInput.TryEndpoint(saved.Endpoint, out _)) ||
                    (version == 1 && (saved.Endpoint.Length == 0 || saved.DeviceId.Length == 0)) ||
                    saved.DeviceId.Length > 128 || saved.Credential.Length != 43 || saved.Credential.Any(c =>
                        !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '_' || c == '-')) ||
                    !saved.LogicalId.StartsWith("client-", StringComparison.Ordinal) ||
                    !Guid.TryParse(saved.LogicalId.Substring(7), out _) || file.Position != file.Length) return null;
                return saved;
            }
            catch (IOException) { return null; }
            catch (ArgumentException) { return null; }
        }

        void WriteDevice(SavedDevice saved)
        {
            if (string.IsNullOrEmpty(saved.InstallationId)) saved.InstallationId = Guid.NewGuid().ToString("D");
            var temporary = _credentialFile + ".tmp";
            try
            {
                using (var file = File.Open(temporary, FileMode.Create, FileAccess.Write, FileShare.None))
                using (var writer = new BinaryWriter(file))
                {
                    writer.Write(2);writer.Write(saved.Endpoint ?? "");writer.Write(saved.DeviceId ?? "");
                    writer.Write(saved.Credential);writer.Write(saved.LogicalId);
                    writer.Write(saved.PcId ?? "");writer.Write(saved.Name ?? "");writer.Write(saved.InstallationId);
                    file.Flush(true);
                }
                if (File.Exists(_credentialFile)) File.Replace(temporary, _credentialFile, null);
                else File.Move(temporary, _credentialFile);
            }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
        }

        void CancelMeshes()
        {
            foreach (var job in _jobs.Values) job.Cancel();
            _jobs.Clear();
        }

        void OnDestroy()
        {
            lock (_gate)
            {
                if (_destroyed) return;
                _destroyed = true; _run?.Cancel(); _run?.Dispose(); _client = null; _scene.InvalidateConnection();
            }
            CancelMeshes();
            foreach (var view in _views.Values) if (view != null)
            {
                if (Application.isPlaying) Destroy(view.gameObject);else DestroyImmediate(view.gameObject);
            }
            _views.Clear();
            ClearDatumViews();
            while (_main.TryDequeue(out var action)) action();
        }
    }
}
