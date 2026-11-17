using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Kreoda.Session;
using Kreoda.Session.Generated;
using UnityEngine;

namespace Kreoda.QuestRuntime
{
    public sealed class QuestProjections : MonoBehaviour
    {
        sealed class CapturedView
        {
            public QuestMeshView View;
            public int UploadVersion;
        }

        readonly QuestProjectionModel _model = new QuestProjectionModel();
        readonly QuestProjectionView _view = new QuestProjectionView();
        readonly QuestProjectionRefreshScheduler _refreshScheduler = new QuestProjectionRefreshScheduler();
        readonly Dictionary<int, CapturedView> _capturedViews = new Dictionary<int, CapturedView>();
        SessionClient _observedClient;
        SessionClient _subscribedClient;
        SessionModelState _observedModel;
        bool _observedConnected, _busy, _disposed, _authoredSourceSelectionMode;
        int _modelChangedPending;
        long _observedConnectionGeneration = -1;
        CancellationTokenSource _queryCancellation;
        string _mutationNotice;

        public QuestConnection Connection;
        public Material LineMaterial;
        public event Action Changed;

        public bool Busy => _busy;
        public bool AuthoredSourceSelectionMode => _authoredSourceSelectionMode;
        public int TargetCount => _model.Targets.Count;
        public int GroupCount => _model.SelectedTarget?.Groups.Length ?? 0;
        public int SourceCount => _model.Sources.Count;
        public int AuthoredSketchSourceCount => _model.AuthoredSketchSourceCount;
        public string SelectedAuthoredSketchFeatureId => _model.SelectedAuthoredSketchFeatureId;
        public string SelectedAuthoredEntityLabel => _model.SelectedAuthoredEntityLabel;
        public int AuthoredCurveCount => _model.AuthoredCurveCount;
        public int PendingAuthoredEntityCount => _model.PendingAuthoredEntityCount;
        public bool SelectedAuthoredEntityPending => _model.SelectedAuthoredEntityPending;
        public bool HasTarget => _model.HasCurrentModel;
        public string SelectedFeatureId => _model.SelectedTarget?.FeatureId;
        public string Primary
        {
            get
            {
                var target = _model.SelectedTarget?.FeatureId;
                return string.IsNullOrEmpty(target) ? "Nessuno sketch corrente" : target;
            }
        }
        public string Secondary
        {
            get
            {
                var group = _model.SelectedGroup;
                if (group != null)
                    return "Gruppo " + group.Id + " · " + (string.IsNullOrWhiteSpace(group.Status) ? "stato sconosciuto" : group.Status) +
                        (string.IsNullOrWhiteSpace(group.Error) ? "" : " · " + group.Error) +
                        (group.BlockingSourceIds == null || group.BlockingSourceIds.Length == 0 ? "" :
                            " · blocco: " + string.Join(", ", group.BlockingSourceIds));
                return _model.OperationName + " · " + _model.Sources.Count.ToString(System.Globalization.CultureInfo.InvariantCulture) +
                    " sorgenti · " + Status;
            }
        }
        public string Status => string.IsNullOrWhiteSpace(_mutationNotice) ? _model.Status : _mutationNotice + " · " + _model.Status;
        public string AuthoredSelectionReadout => !string.IsNullOrWhiteSpace(_mutationNotice) ? _mutationNotice :
            "Scelta " + _model.PendingAuthoredEntityCount.ToString(System.Globalization.CultureInfo.InvariantCulture) +
            "/128 · sorgenti " + _model.Sources.Count.ToString(System.Globalization.CultureInfo.InvariantCulture) + "/128";
        public bool CanRefresh => !_busy && HasTarget && Connection != null && Connection.Connected;
        public bool CanCapture => !_busy && HasTarget && Connection != null && Connection.Connected;
        public bool CanNextSketch => !_busy && TargetCount > 1;
        public bool CanNextGroup => !_busy && GroupCount > 1;
        public bool CanClearSources => !_busy && SourceCount > 0;
        public bool CanCycleAuthoredSource => HasCurrentAuthoredContext() && _model.OperationName == "projectEdges" &&
            _model.AuthoredSketchSourceCount > 0 && _model.PendingAuthoredEntityCount == 0 &&
            (_model.SelectedAuthoredSketchFeatureId == null || _model.AuthoredSketchSourceCount > 1);
        public bool CanCycleAuthoredEntity => HasCurrentAuthoredContext() && _model.OperationName == "projectEdges" &&
            _model.AuthoredCurveCount > 1;
        public bool CanToggleAuthoredEntity => HasCurrentAuthoredContext() && _model.OperationName == "projectEdges" &&
            !string.IsNullOrEmpty(_model.SelectedAuthoredEntityId);
        public bool CanSelectAllAuthoredEntities => HasCurrentAuthoredContext() && _model.OperationName == "projectEdges" &&
            !string.IsNullOrEmpty(_model.SelectedAuthoredSketchFeatureId);
        public bool CanClearPendingAuthoredEntities => HasCurrentAuthoredContext() && _model.PendingAuthoredEntityCount > 0;
        public bool CanAddAuthoredSource => HasCurrentAuthoredContext() && _model.OperationName == "projectEdges" &&
            _model.PendingAuthoredEntityCount > 0;
        public bool CanExitAuthoredSourceSelection => !_busy && _authoredSourceSelectionMode &&
            _model.PendingAuthoredEntityCount == 0;
        public bool CanCreate => !_busy && HasCurrentSources() && _model.TryBuildDefinition(out _, out _);
        public bool CanRepair => !_busy && _model.TryGetRepair(out _, out _, out _, out _);
        public bool CanReplace => !_busy && HasCurrentSources() && _model.TryGetRemove(out _, out _, out _) &&
            _model.TryBuildDefinition(out _, out _);
        public bool CanRemove => !_busy && _model.TryGetRemove(out _, out _, out _);
        public string OperationName => _model.OperationName;

        public void Initialize(QuestConnection connection, Material lineMaterial)
        {
            Connection = connection;
            LineMaterial = lineMaterial;
            ObserveState();
            NotifyChanged();
        }

        void Update()
        {
            if (_disposed) return;
            var modelEventPending = Interlocked.Exchange(ref _modelChangedPending, 0) != 0;
            var previousBindingVersion = _model.BindingVersion;
            ObserveState();
            if (modelEventPending || _model.BindingVersion != previousBindingVersion)
                _refreshScheduler.ObserveModel(_model.BindingVersion, Connection != null && Connection.Connected,
                    Time.realtimeSinceStartup);
            ValidateCapturedViews();
            if (_refreshScheduler.TryTake(Time.realtimeSinceStartup, Connection != null && Connection.Connected, _busy))
                _ = RefreshCoreAsync();
        }

        public void Open(string preferredSketchId = null)
        {
            ObserveState();
            _refreshScheduler.MarkOpened(_model.BindingVersion);
            if (!string.IsNullOrEmpty(preferredSketchId) && !_model.SelectTarget(preferredSketchId))
                _mutationNotice = "Sketch richiesto non presente nel modello PC";
            else if (string.IsNullOrEmpty(preferredSketchId)) _mutationNotice = null;
            _ = RefreshCoreAsync();
        }

        public void NextSketch()
        {
            ObserveState();
            if (!_model.CycleTarget(1)) { NotifyChanged(); return; }
            _capturedViews.Clear();
            _view.Clear();
            _mutationNotice = null;
            NotifyChanged();
            _ = RefreshCoreAsync();
        }

        public void NextGroup()
        {
            ObserveState();
            if (_model.CycleGroup(1)) ShowSelectedGroup();
            NotifyChanged();
        }

        public void NextOperation()
        {
            _model.CycleOperation();
            _capturedViews.Clear();
            NotifyChanged();
        }

        public void ClearSources()
        {
            _model.ClearSources();
            _capturedViews.Clear();
            _mutationNotice = null;
            NotifyChanged();
        }

        public void EnterAuthoredSourceSelection()
        {
            ObserveState();
            _authoredSourceSelectionMode = true;
            if (!TryCurrentAuthoredContext(out var fence, out var targetFeatureId, out var error) ||
                !_model.BeginAuthoredSourceSelection(fence, targetFeatureId, out error)) _mutationNotice = error;
            else _mutationNotice = null;
            NotifyChanged();
        }

        public void ExitAuthoredSourceSelection()
        {
            if (!_authoredSourceSelectionMode) return;
            _authoredSourceSelectionMode = false;
            _mutationNotice = null;
            NotifyChanged();
        }

        public void CycleAuthoredSource(int step) => ApplyAuthoredSelection((QuestProjectionModel.Fence fence, string target, out string error) =>
            _model.CycleAuthoredSource(step, fence, target, out error));

        public void CycleAuthoredEntity(int step) => ApplyAuthoredSelection((QuestProjectionModel.Fence fence, string target, out string error) =>
            _model.CycleAuthoredEntity(step, fence, target, out error));

        public void ToggleAuthoredEntity() => ApplyAuthoredSelection((QuestProjectionModel.Fence fence, string target, out string error) =>
            _model.ToggleAuthoredEntity(fence, target, out error));

        public void SelectAllAuthoredEntities() => ApplyAuthoredSelection((QuestProjectionModel.Fence fence, string target, out string error) =>
            _model.SelectAllAuthoredEntities(fence, target, out error));

        public void ClearPendingAuthoredEntities() => ApplyAuthoredSelection((QuestProjectionModel.Fence fence, string target, out string error) =>
            _model.ClearPendingAuthoredEntities(fence, target, out error));

        public void AddAuthoredSource() => ApplyAuthoredSelection((QuestProjectionModel.Fence fence, string target, out string error) =>
            _model.AddAuthoredSource(fence, target, out error));

        delegate bool AuthoredSelectionAction(QuestProjectionModel.Fence fence, string targetFeatureId, out string error);

        void ApplyAuthoredSelection(AuthoredSelectionAction action)
        {
            ObserveState();
            if (!TryCurrentAuthoredContext(out var fence, out var targetFeatureId, out var error) ||
                !action(fence, targetFeatureId, out error)) _mutationNotice = error;
            else _mutationNotice = null;
            NotifyChanged();
        }

        bool HasCurrentAuthoredContext() => !_busy && TryCurrentAuthoredContext(out _, out _, out _);

        bool TryCurrentAuthoredContext(out QuestProjectionModel.Fence fence, out string targetFeatureId, out string error)
        {
            fence = CurrentFence(Connection != null ? Connection.Client : null);
            targetFeatureId = _model.SelectedTarget?.FeatureId;
            if (!_authoredSourceSelectionMode || fence == null || _model.Lineage == null || !fence.Equals(_model.Lineage) ||
                string.IsNullOrEmpty(targetFeatureId))
            { error = "Sessione, sketch o revisione cambiati · seleziona di nuovo"; return false; }
            error = "";
            return true;
        }

        public bool CaptureSource(QuestMeshView view, int expectedUploadVersion, int selectionMode, int currentSelectionMode,
            bool hasHit, bool hasEdgeHit, string persistentEdgeId, bool referenceAmbiguous, bool datumSelected)
        {
            ObserveState();
            var isInstance = view != null && !string.IsNullOrEmpty(view.InstanceId);
            var candidate = new QuestProjectionModel.SourceCandidate
            {
                Fence = _model.Lineage,
                TargetFeatureId = _model.SelectedTarget?.FeatureId,
                OwnerFeatureId = view != null ? view.FeatureId : null,
                PersistentEdgeId = hasEdgeHit ? persistentEdgeId : null,
                UploadVersion = view != null ? view.UploadVersion : -1,
                ExpectedUploadVersion = expectedUploadVersion,
                SelectionMode = selectionMode,
                CurrentSelectionMode = currentSelectionMode,
                ViewCurrent = view != null && Connection != null && Connection.Connected && Connection.IsCurrentView(view),
                IsDatum = datumSelected,
                IsInstance = isInstance,
                InstanceResolved = !isInstance || IsResolvedInstanceOwner(Connection?.Client?.Model, view.FeatureId, view.InstanceId),
                HasHit = hasHit,
                HasEdgeHit = hasEdgeHit,
                ReferenceAmbiguous = referenceAmbiguous,
            };
            if (!_model.TryCapture(candidate, out var error))
            {
                _mutationNotice = error;
                NotifyChanged();
                return false;
            }
            var source = _model.Sources[_model.Sources.Count - 1];
            _capturedViews[source.Token] = new CapturedView { View = view, UploadVersion = view.UploadVersion };
            _mutationNotice = null;
            NotifyChanged();
            return true;
        }

        public void Refresh() => _ = RefreshCoreAsync();

        async Task RefreshCoreAsync()
        {
            if (_disposed) return;
            ObserveState();
            _refreshScheduler.MarkRequested(_model.BindingVersion);
            var client = Connection != null ? Connection.Client : null;
            var model = client != null ? client.Model : null;
            var fence = model != null && Connection != null && Connection.Connected
                ? new QuestProjectionModel.Fence(model.SessionId, model.DocumentId, model.Revision, Connection.ConnectionGeneration) : null;
            var request = _model.BeginQuery();
            if (request == null || client == null || fence == null || !request.Fence.Equals(fence))
            {
                _view.Clear();
                NotifyChanged();
                return;
            }

            _view.Clear();
            var previous = _queryCancellation;
            var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(12));
            _queryCancellation = timeout;
            if (previous != null) previous.Cancel();
            NotifyChanged();
            try
            {
                var payload = await client.GetSketchProjectionAsync(request.FeatureId, null,
                    expectedRevision: request.Fence.Revision, ct: timeout.Token);
                ObserveState();
                var current = CurrentFence(client);
                if (!_model.AcceptQuery(request, payload, current))
                {
                    if (_model.FailQuery(request, current, "Risposta proiezioni non coerente con lo sketch richiesto"))
                    { _view.Clear();NotifyChanged(); }
                    return;
                }
                ShowSelectedGroup();
            }
            catch (Exception error)
            {
                ObserveState();
                var current = CurrentFence(client);
                if (_model.FailQuery(request, current, ErrorText(error)))
                {
                    _view.Clear();
                    NotifyChanged();
                }
            }
            finally
            {
                if (ReferenceEquals(_queryCancellation, timeout)) _queryCancellation = null;
                timeout.Dispose();
            }
        }

        public void CreateGroup()
        {
            ObserveState();
            if (!HasCurrentSources(out var error) || !_model.TryBuildDefinition(out var definition, out error))
            { _mutationNotice = error; NotifyChanged(); return; }
            var groupId = Guid.NewGuid().ToString("N");
            _model.PreferGroup(groupId);
            RunMutation("SetSketchProjection", _model.SelectedTarget.FeatureId, groupId, definition);
        }

        public void RepairGroup()
        {
            ObserveState();
            if (!_model.TryGetRepair(out var featureId, out var groupId, out var definition, out var error))
            { _mutationNotice = error; NotifyChanged(); return; }
            _model.PreferGroup(groupId);
            RunMutation("SetSketchProjection", featureId, groupId, definition);
        }

        public void ReplaceSource()
        {
            ObserveState();
            if (!HasCurrentSources(out var error) || !_model.TryGetRemove(out var featureId, out var groupId, out error) ||
                !_model.TryBuildDefinition(out var definition, out error))
            { _mutationNotice = error; NotifyChanged(); return; }
            _model.PreferGroup(groupId);
            RunMutation("SetSketchProjection", featureId, groupId, definition);
        }

        public void RemoveGroup()
        {
            ObserveState();
            if (!_model.TryGetRemove(out var featureId, out var groupId, out var error))
            { _mutationNotice = error; NotifyChanged(); return; }
            _model.PreferGroup(null);
            RunMutation("RemoveSketchProjection", featureId, groupId, default);
        }

        async void RunMutation(string command, string featureId, string groupId, System.Text.Json.JsonElement definition)
        {
            if (_busy || _disposed) return;
            var client = Connection != null ? Connection.Client : null;
            var model = client != null ? client.Model : null;
            var fence = model != null && Connection != null && Connection.Connected
                ? new QuestProjectionModel.Fence(model.SessionId, model.DocumentId, model.Revision, Connection.ConnectionGeneration) : null;
            if (client == null || fence == null || featureId != _model.SelectedTarget?.FeatureId ||
                _model.Lineage == null || !_model.Lineage.Equals(fence))
            { _mutationNotice = "Sessione o revisione cambiati · aggiorna dal PC"; NotifyChanged(); return; }
            if (command == "SetSketchProjection" && (!definition.ValueKind.Equals(System.Text.Json.JsonValueKind.Object) || string.IsNullOrEmpty(groupId)))
            { _mutationNotice = "Definizione o gruppo non validi"; NotifyChanged(); return; }

            var parameters = new Dictionary<string, object?> { ["featureId"] = featureId, ["groupId"] = groupId };
            if (command == "SetSketchProjection") parameters["definition"] = definition;
            _busy = true;
            _mutationNotice = "";
            CancelQuery();
            _model.Invalidate("Operazione inviata al PC · verifica richiesta");
            _capturedViews.Clear();
            _view.Clear();
            NotifyChanged();
            var acknowledged = false;
            using (var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15)))
            {
                try
                {
                    await client.CommandAsync(command, parameters, fence.DocumentId,
                        baseRevision: fence.Revision, ct: timeout.Token);
                    acknowledged = true;
                    if (!SameSession(client, fence))
                    { _mutationNotice = "PC ha riconosciuto il comando · connessione cambiata"; return; }
                    using (var refresh = new CancellationTokenSource(TimeSpan.FromSeconds(10)))
                        await client.SnapshotAsync(fence.DocumentId, refresh.Token);
                    ObserveState();
                    if (!SameSession(client, fence))
                    { _mutationNotice = "Comando riconosciuto · snapshot non corrente"; return; }
                    _mutationNotice = null;
                    await RefreshCoreAsync();
                }
                catch (Exception error)
                {
                    _mutationNotice = acknowledged ? "Comando riconosciuto · aggiornamento PC non confermato · " + ErrorText(error) :
                        error is SessionException ? "PC ha rifiutato il comando · " + ErrorText(error) :
                        "Esito comando non confermato · " + ErrorText(error);
                    _view.Clear();
                    if (SameSession(client, fence))
                    {
                        try
                        {
                            using (var snapshot = new CancellationTokenSource(TimeSpan.FromSeconds(5)))
                                await client.SnapshotAsync(fence.DocumentId, snapshot.Token);
                            ObserveState();
                        }
                        catch { }
                    }
                }
                finally
                {
                    _busy = false;
                    NotifyChanged();
                }
            }
        }

        void ShowSelectedGroup()
        {
            if (!_model.TryGetSelectedDisplay(out var group, out var error))
            {
                _view.Clear();
                if (string.IsNullOrEmpty(_mutationNotice)) _model.SetStatus(error);
                NotifyChanged();
                return;
            }
            if (Connection == null || Connection.DisplayRoot == null ||
                !_view.Render(Connection.DisplayRoot, LineMaterial, group, out error))
            {
                _view.Clear();
                _model.SetStatus(error);
                NotifyChanged();
                return;
            }
            NotifyChanged();
        }

        bool HasCurrentSources() => HasCurrentSources(out _);
        bool HasCurrentSources(out string error)
        {
            error = "";
            if (_model.Sources.Count == 0) { error = "Acquisisci una sorgente corrente"; return false; }
            if (!ValidateCapturedViews()) { error = "Mesh sorgente aggiornata · acquisisci di nuovo"; return false; }
            return true;
        }

        bool ValidateCapturedViews()
        {
            if (_model.Sources.Count == 0) { _capturedViews.Clear(); return true; }
            var currentFence = CurrentFence(Connection != null ? Connection.Client : null);
            foreach (var source in _model.Sources)
            {
                if (source.Type == "sketchEntities")
                {
                    if (currentFence != null && currentFence.Equals(source.Fence) && _model.IsCurrentAuthoredSource(source)) continue;
                    _model.ClearSources();
                    _capturedViews.Clear();
                    _mutationNotice = "Sketch sorgente cambiato · acquisisci di nuovo";
                    NotifyChanged();
                    return false;
                }
                if (!_capturedViews.TryGetValue(source.Token, out var captured) || captured.View == null ||
                    Connection == null || !Connection.Connected || !Connection.IsCurrentView(captured.View) ||
                    captured.View.UploadVersion != captured.UploadVersion)
                {
                    _model.ClearSources();
                    _capturedViews.Clear();
                    _mutationNotice = "Mesh sorgente aggiornata · acquisisci di nuovo";
                    NotifyChanged();
                    return false;
                }
            }
            var live = new HashSet<int>(_model.Sources.Select(source => source.Token));
            foreach (var token in _capturedViews.Keys.Where(token => !live.Contains(token)).ToArray()) _capturedViews.Remove(token);
            return true;
        }

        void ObserveState()
        {
            if (Connection == null) ObserveModelEvents(null);
            if (Connection == null)
            {
                if (_observedClient != null || _observedConnected || _model.Lineage != null)
                {
                    _observedClient = null;
                    _observedModel = null;
                    _observedConnected = false;
                    _observedConnectionGeneration = -1;
                    _model.Bind(null, 0);
                    _capturedViews.Clear();
                    _view.Clear();
                    NotifyChanged();
                }
                return;
            }
            var client = Connection.Client;
            var connected = Connection.Connected;
            ObserveModelEvents(connected ? client : null);
            var model = connected ? client?.Model : null;
            var generation = Connection.ConnectionGeneration;
            if (ReferenceEquals(client, _observedClient) && ReferenceEquals(model, _observedModel) &&
                connected == _observedConnected && generation == _observedConnectionGeneration) return;
            var clientChanged = !ReferenceEquals(client, _observedClient);
            var oldFence = _model.Lineage;
            var nextFence = model != null ? new QuestProjectionModel.Fence(model.SessionId, model.DocumentId, model.Revision, generation) : null;
            var sameFence = oldFence != null && oldFence.Equals(nextFence);
            _observedClient = client;
            _observedModel = model;
            _observedConnected = connected;
            _observedConnectionGeneration = generation;
            var previousBindingVersion = _model.BindingVersion;
            _model.Bind(model, generation);
            var bindingChanged = _model.BindingVersion != previousBindingVersion;
            if (bindingChanged && _authoredSourceSelectionMode) _mutationNotice = _model.Status;
            if (clientChanged && sameFence)
            {
                _model.Invalidate("Connessione PC cambiata · aggiorna le proiezioni");
                if (_authoredSourceSelectionMode) _mutationNotice = _model.Status;
                _refreshScheduler.ObserveModel(_model.BindingVersion, connected, Time.realtimeSinceStartup, force: true);
            }
            if (bindingChanged || clientChanged)
            {
                CancelQuery();
                _view.Clear();
            }
            ValidateCapturedViews();
            NotifyChanged();
        }

        void ObserveModelEvents(SessionClient client)
        {
            if (ReferenceEquals(client, _subscribedClient)) return;
            if (_subscribedClient != null) _subscribedClient.ModelChanged -= OnClientModelChanged;
            _subscribedClient = client;
            if (_subscribedClient != null) _subscribedClient.ModelChanged += OnClientModelChanged;
        }

        void OnClientModelChanged(SessionModelUpdate update) => Interlocked.Exchange(ref _modelChangedPending, 1);

        internal static bool IsResolvedInstanceOwner(SessionModelState model, string featureId, string instanceId)
        {
            if (model?.Features == null || string.IsNullOrEmpty(instanceId) || featureId != instanceId ||
                !QuestProjectionModel.StableFeatureId(instanceId)) return false;
            var instances = model.Features.Where(feature => StringValue(feature, "featureId") == instanceId).ToArray();
            if (instances.Length != 1 || StringValue(instances[0], "type") != "Instance" || !FeatureCurrent(instances[0]) ||
                !instances[0].TryGetProperty("dependsOn", out var dependencies) || dependencies.ValueKind != System.Text.Json.JsonValueKind.Array ||
                dependencies.GetArrayLength() != 1) return false;
            var sourceId = dependencies[0].ValueKind == System.Text.Json.JsonValueKind.String ? dependencies[0].GetString() : null;
            if (!QuestProjectionModel.StableFeatureId(sourceId)) return false;
            var sources = model.Features.Where(feature => StringValue(feature, "featureId") == sourceId).ToArray();
            return sources.Length == 1 && StringValue(sources[0], "type") != "Instance" && FeatureCurrent(sources[0]);
        }

        static bool FeatureCurrent(System.Text.Json.JsonElement feature)
        {
            if (feature.ValueKind != System.Text.Json.JsonValueKind.Object) return false;
            if (feature.TryGetProperty("geometryCurrent", out var geometryCurrent) && geometryCurrent.ValueKind != System.Text.Json.JsonValueKind.True)
                return false;
            if (feature.TryGetProperty("status", out var status) &&
                (status.ValueKind != System.Text.Json.JsonValueKind.String || status.GetString() != "ok")) return false;
            if (feature.TryGetProperty("blockingSourceIds", out var blockers) &&
                (blockers.ValueKind != System.Text.Json.JsonValueKind.Array || blockers.GetArrayLength() != 0)) return false;
            return true;
        }

        static string StringValue(System.Text.Json.JsonElement value, string property) => value.ValueKind == System.Text.Json.JsonValueKind.Object &&
            value.TryGetProperty(property, out var raw) && raw.ValueKind == System.Text.Json.JsonValueKind.String ? raw.GetString() : null;

        QuestProjectionModel.Fence CurrentFence(SessionClient client)
        {
            if (Connection == null || !Connection.Connected || !ReferenceEquals(Connection.Client, client) || client?.Model == null) return null;
            var model = client.Model;
            return new QuestProjectionModel.Fence(model.SessionId, model.DocumentId, model.Revision, Connection.ConnectionGeneration);
        }

        bool SameSession(SessionClient client, QuestProjectionModel.Fence fence)
        {
            if (Connection == null || !Connection.Connected || !ReferenceEquals(Connection.Client, client) ||
                Connection.ConnectionGeneration != fence.ConnectionGeneration || client.Model == null) return false;
            return client.Model.SessionId == fence.SessionId && client.Model.DocumentId == fence.DocumentId;
        }

        void CancelQuery()
        {
            var pending = _queryCancellation;
            _queryCancellation = null;
            if (pending != null) pending.Cancel();
        }

        void NotifyChanged() => Changed?.Invoke();

        static string ErrorText(Exception error)
        {
            if (error is SessionException session) return Short(session.Code + " · " + session.Message, 90);
            if (error is OperationCanceledException) return "richiesta annullata";
            return Short(error?.Message ?? error?.GetType().Name ?? "errore", 90);
        }

        static string Short(string value, int limit) => string.IsNullOrWhiteSpace(value) ? "errore" :
            value.Length <= limit ? value : value.Substring(0, limit - 1) + "…";

        void OnDestroy() => Dispose();

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            _authoredSourceSelectionMode = false;
            ObserveModelEvents(null);
            _refreshScheduler.Dispose();
            CancelQuery();
            _model.Invalidate("Vista proiezioni chiusa");
            _capturedViews.Clear();
            _view.Dispose();
            Changed = null;
        }
    }

    internal sealed class QuestProjectionRefreshScheduler
    {
        const double QuietPeriodSeconds = .12;
        long _observedBindingVersion = long.MinValue;
        double _dueAt;
        bool _opened, _pending, _disposed;

        public void MarkOpened(long bindingVersion)
        {
            if (_disposed) return;
            _opened = true;
            _observedBindingVersion = bindingVersion;
            _pending = false;
        }

        public void ObserveModel(long bindingVersion, bool connected, double now, bool force = false)
        {
            if (_disposed) return;
            var changed = bindingVersion != _observedBindingVersion;
            _observedBindingVersion = bindingVersion;
            if (!_opened || (!changed && !force)) return;
            if (!connected) { _pending = false; return; }
            _pending = true;
            _dueAt = now + QuietPeriodSeconds;
        }

        public void MarkRequested(long bindingVersion)
        {
            if (_disposed) return;
            _observedBindingVersion = bindingVersion;
            _pending = false;
        }

        public bool TryTake(double now, bool connected, bool busy)
        {
            if (_disposed || !_opened || !_pending) return false;
            if (!connected) { _pending = false; return false; }
            if (busy || now < _dueAt) return false;
            _pending = false;
            return true;
        }

        public void Dispose()
        {
            _disposed = true;
            _opened = false;
            _pending = false;
        }
    }

    internal static class QuestProjectionLayout
    {
        internal readonly struct Control
        {
            internal readonly string Id, Caption;
            internal readonly float X, Y, Width, Height;
            internal Control(string id, string caption, float x, float y, float width, float height)
            { Id = id; Caption = caption; X = x; Y = y; Width = width; Height = height; }
        }

        internal static readonly Control Route = new Control("projection:open", "Proiezioni", .135f, .235f, .12f, .035f);
        internal static readonly Control[] Actions =
        {
            new Control("projection:sketch", "Sketch →", -.13f, .055f, .12f, .034f),
            new Control("projection:group", "Gruppo →", 0f, .055f, .12f, .034f),
            new Control("projection:operation", "Tipo →", .13f, .055f, .12f, .034f),
            new Control("projection:refresh", "Aggiorna", -.095f, .008f, .18f, .036f),
            new Control("projection:capture", "Acquisisci", .095f, .008f, .18f, .036f),
            new Control("projection:clear", "Pulisci sorgenti", -.095f, -.040f, .18f, .036f),
            new Control("projection:create", "Crea gruppo", .095f, -.040f, .18f, .036f),
            new Control("projection:repair", "Ripara", -.095f, -.088f, .18f, .036f),
            new Control("projection:replace", "Sostituisci fonte", .095f, -.088f, .18f, .036f),
            new Control("projection:remove", "Elimina gruppo", -.095f, -.136f, .18f, .036f),
            new Control("projection:back", "Sketch / quote", .095f, -.136f, .18f, .036f),
        };

        internal static bool Validate(out string error)
        {
            var stage = new Control("stage", "", 0, .160f, .394f, .105f);
            var controls = new List<Control>(Actions.Length + 2) { Route, stage };
            controls.AddRange(Actions);
            for (var i = 0; i < controls.Count; i++)
            {
                var control = controls[i];
                if (control.X - control.Width * .5f < -.20f || control.X + control.Width * .5f > .20f ||
                    control.Y - control.Height * .5f < -.30f || control.Y + control.Height * .5f > .27f)
                { error = "Controllo fuori dal perimetro Quest: " + control.Id; return false; }
                for (var j = i + 1; j < controls.Count; j++)
                {
                    var other = controls[j];
                    var overlapX = Mathf.Abs(control.X - other.X) < (control.Width + other.Width) * .5f - .0005f;
                    var overlapY = Mathf.Abs(control.Y - other.Y) < (control.Height + other.Height) * .5f - .0005f;
                    if (overlapX && overlapY)
                    { error = "Hitbox proiezioni sovrapposte: " + control.Id + " / " + other.Id; return false; }
                }
            }
            error = "";
            return true;
        }
    }
}
