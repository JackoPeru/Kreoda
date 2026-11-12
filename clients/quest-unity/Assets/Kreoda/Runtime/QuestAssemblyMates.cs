using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Kreoda.QuestFoundation;
using Kreoda.Session;
using UnityEngine;

namespace Kreoda.QuestRuntime
{
    public sealed class QuestAssemblyMates : MonoBehaviour
    {
        public QuestConnection Connection;
        public QuestSpatialEdit Spatial;
        public QuestCommands Commands;
        public QuestDirectFaceHistory DirectFaceHistory;
        public Func<string, IDictionary<string, object?>, CancellationToken, string, Action?, Task<JsonElement>> SendOverride;

        static readonly string[] Kinds = { "ground", "coincident", "distance", "parallel", "perpendicular", "concentric", "angle" };
        static readonly string[] KindLabels = { "Fissa istanza", "Origini coincidenti", "Distanza fra origini", "Paralleli", "Perpendicolari", "Concentrico", "Angolo" };
        Slot _moving, _fixed;
        int _kind, _axis, _movingCapture, _fixedCapture, _operation, _pending;
        CancellationTokenSource _movingCancellation, _fixedCancellation, _applyCancellation;
        Func<bool> _movingCaptureCurrent, _fixedCaptureCurrent;
        SessionClient _applyClient;
        SessionModelState _applyModel;
        long _applyGeneration, _applyRevision;
        bool _applySent, _applyAccepted, _applyRejected, _applying;
        string _value = "0";
        public string Status { get; private set; } = "Collega un PC e seleziona un’istanza.";
        public string KindLabel => KindLabels[_kind];
        public string AxisLabel => "Asse " + "XYZ"[_axis];
        public string ValueLabel => "Valore " + _value + (_kind == 6 ? "°" : " mm");
        public string ValueText => _value;
        public bool UsesAngle => _kind == 6;
        public bool UsesDistance => _kind == 2;
        public string MovingLabel => _moving == null ? "Mobile: —" : "Mobile: " + _moving.DisplayName + GeometrySuffix(_moving);
        public string FixedLabel => _fixed == null ? "Fissa: —" : "Fissa: " + _fixed.DisplayName + GeometrySuffix(_fixed);
        public bool Busy => _pending > 0;

        sealed class Slot
        {
            public SessionClient Client;
            public SessionModelState Model;
            public QuestMeshView View;
            public int UploadVersion;
            public long Generation;
            public string InstanceId;
            public string DisplayName;
            public string PickId;
            public Binding Binding;
            public long CaptureRevision;
        }

        sealed class Binding
        {
            public string Type;
            public string FeatureId;
            public string PersistentId;
            public string GeometryKind;
            public IDictionary<string, object?> ToParameters() => Type == "face"
                ? new Dictionary<string, object?> { ["type"] = Type, ["featureId"] = FeatureId,
                    ["persistentFaceId"] = PersistentId, ["geometryKind"] = GeometryKind }
                : new Dictionary<string, object?> { ["type"] = Type, ["featureId"] = FeatureId,
                    ["persistentEdgeId"] = PersistentId, ["geometryKind"] = GeometryKind };
        }

        void Update() => RefreshStaleCaptures();

        public void NextKind()
        {
            _kind = (_kind + 1) % Kinds.Length;
            Status = "Tipo: " + KindLabels[_kind];
        }

        public void NextAxis() => _axis = (_axis + 1) % 3;
        public void SetValue(string value) => _value = (value ?? string.Empty).Trim();

        public async Task CaptureAsync(bool moving, QuestMeshView view, MeshSemanticHit hit,
            int selectionMode, Func<bool> selectionIsCurrent)
        {
            var slotGeneration = InvalidateCapture(moving);
            if (!TryContext(view, selectionIsCurrent, out var client, out var model, out var generation,
                    out var instanceId, out var displayName, out var message))
            { Status = message;return; }
            var geometric = IsGeometricKind(_kind);
            var expectedSelectionKind = selectionMode == 1 ? "face" : selectionMode == 2 ? "edge" : "";
            if (geometric && (hit == null || hit.ReferenceAmbiguous || expectedSelectionKind == "" ||
                !hit.PersistentId.StartsWith(instanceId + ":", StringComparison.Ordinal)))
            { Status = "Seleziona una faccia o un bordo univoco dell’istanza.";return; }

            var uploadVersion = view.UploadVersion;
            var pickId = geometric ? hit.PersistentId : null;
            Func<bool> current = () => CaptureContextCurrent(client, model, generation, view, uploadVersion, selectionIsCurrent);
            if (!current()) { Status = "Selezione non corrente; riprova.";return; }
            var cancellation = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            SetCaptureRequest(moving, cancellation, current);
            _pending++;Status = geometric ? "Acquisizione geometria…" : "Istanza acquisita…";
            try
            {
                Binding binding = null;
                if (geometric)
                {
                    var parameters = new Dictionary<string, object?>
                    {
                        ["featureId"] = instanceId, ["documentId"] = model.DocumentId,
                        ["expectedRevision"] = model.Revision,
                    };
                    var reply = await SendAsync(client, expectedSelectionKind == "edge" ? "findEdges" : "findFaces",
                        parameters, cancellation.Token, model.SessionId, () => AssertCurrent(current));
                    if (!ReplyAccepted(reply)) throw new SessionException("CORE_FAILED", "PC rejected geometry capture");
                    if (!current()) throw new SessionException("NEED_FULL_SNAPSHOT", "geometry capture is stale");
                    if (!ReplyMatches(reply, model)) throw new SessionException("NEED_FULL_SNAPSHOT", "geometry reply lineage changed");
                    binding = ResolveBinding(reply, expectedSelectionKind, instanceId, pickId, model);
                    if (!current()) throw new SessionException("NEED_FULL_SNAPSHOT", "selection changed during geometry capture");
                }
                if ((moving ? _movingCapture : _fixedCapture) != slotGeneration || !current()) return;
                var captured = new Slot { Client = client, Model = model, View = view, UploadVersion = uploadVersion,
                    Generation = generation, InstanceId = instanceId, DisplayName = displayName,
                    PickId = pickId, Binding = binding, CaptureRevision = model.Revision };
                if (moving) _moving = captured; else _fixed = captured;
                Status = (moving ? "Riferimento mobile acquisito · " : "Riferimento fisso acquisito · ") + displayName;
            }
            catch (Exception error)
            {
                if ((moving ? _movingCapture : _fixedCapture) == slotGeneration)
                    Status = "Acquisizione non riuscita: " + Short(error.Message, 105);
            }
            finally
            {
                ClearCaptureRequest(moving, cancellation);
                _pending = Math.Max(0, _pending - 1);
                cancellation.Dispose();
            }
        }

        public bool CanApply(out string reason)
        {
            reason = "";
            if (_applying) { reason = "Accoppiamento già in corso.";return false; }
            if (_pending != 0) { reason = "Attendi la fine dell’acquisizione.";return false; }
            if (Spatial?.Busy == true || Commands?.Busy == true || DirectFaceHistory?.Busy == true)
            { reason = "Un’altra operazione CAD è in corso.";return false; }
            if (_moving == null || !SlotCurrent(_moving) || (_kind != 0 && (_fixed == null || !SlotCurrent(_fixed))) ||
                (_kind != 0 && _fixed != null && _moving.InstanceId == _fixed.InstanceId))
            { reason = "Acquisisci istanze correnti e distinte.";return false; }
            if (IsGeometricKind(_kind) && (_moving.Binding == null || _fixed.Binding == null ||
                _moving.CaptureRevision != _moving.Model.Revision || _fixed.CaptureRevision != _moving.Model.Revision))
            { reason = "Acquisisci facce o bordi correnti per entrambe le istanze.";return false; }
            if (_kind == 5 && (!ConcentricBinding(_moving.Binding) || !ConcentricBinding(_fixed.Binding)))
            { reason = "Per il concentrico servono facce cilindriche o bordi circolari.";return false; }
            if (!TryNumber(out _, out reason)) return false;
            if (_moving.Model.Revision >= SessionContract.MaximumRevision)
            { reason = "Revisione CAD non incrementabile.";return false; }
            return true;
        }

        public async Task ApplyAsync()
        {
            if (!CanApply(out var readiness)) { Status = readiness;return; }
            if (!TryNumber(out var value, out readiness)) { Status = readiness;return; }
            var operation = ++_operation;

            var client = _moving.Client;
            var model = _moving.Model;
            var generation = _moving.Generation;
            var nextRevision = model.Revision + 1;
            if (nextRevision > SessionContract.MaximumRevision)
            { Status = "Revisione CAD non incrementabile.";return; }
            var parameters = BuildParameters(model.Revision, value);
            var beforeSend = new Action(() =>
            {
                if (operation != _operation || !BaseModelCurrent(client, model, generation))
                    throw new SessionException("NEED_FULL_SNAPSHOT", "assembly command belongs to an older model");
                _applySent = true;
            });
            var cancellation = new CancellationTokenSource(TimeSpan.FromSeconds(15));
            _applyCancellation = cancellation;
            _applyClient = client;_applyModel = model;_applyGeneration = generation;
            _applyRevision = nextRevision;_applySent = false;_applyAccepted = false;_applyRejected = false;_applying = true;
            _pending++;Status = "Invio vincolo al PC…";
            try
            {
                var reply = await SendAsync(client, "command", new Dictionary<string, object?>
                {
                    ["commandId"] = "DefineAssemblyConstraint", ["parameters"] = parameters,
                    ["documentId"] = model.DocumentId, ["baseRevision"] = model.Revision,
                }, cancellation.Token, model.SessionId, beforeSend);
                if (!ReplyAccepted(reply))
                { _applyRejected = true;throw new SessionException("CORE_FAILED", "PC rejected assembly constraint"); }
                _applyAccepted = true;
                if (operation != _operation || !ApplyLineageCurrent(client, model, generation, nextRevision))
                    throw new SessionException("NEED_FULL_SNAPSHOT", "assembly reply belongs to an older model");
                if (!reply.TryGetProperty("revision", out var revision) || !revision.TryGetInt64(out var accepted) || accepted != nextRevision)
                    throw new SessionException("CORE_FAILED", "PC reply did not confirm the expected assembly revision");
                await WaitForCommittedModel(client, model, generation, nextRevision, cancellation.Token);
                if (operation != _operation || !PostCommitContextCurrent(client, model, generation, nextRevision))
                    throw new SessionException("NEED_FULL_SNAPSHOT", "assembly delta belongs to an older model");
                _moving = null;_fixed = null;
                Status = "Vincolo registrato · revisione " + accepted.ToString(CultureInfo.InvariantCulture);
            }
            catch (Exception error)
            {
                if (operation == _operation)
                    Status = _applyRejected ? "Vincolo rifiutato dal PC: " + Short(error.Message, 95) :
                        _applyAccepted ? "Vincolo accettato, ma delta non confermato; verifica il modello." :
                        _applySent ? "Richiesta inviata, esito non confermato; verifica il modello." :
                        "Vincolo non applicato: " + Short(error.Message, 105);
            }
            finally
            {
                if (ReferenceEquals(_applyCancellation, cancellation))
                {
                    _applyCancellation = null;_applying = false;_applySent = false;_applyAccepted = false;_applyRejected = false;
                    _applyClient = null;_applyModel = null;_applyGeneration = 0;_applyRevision = 0;
                }
                _pending = Math.Max(0, _pending - 1);
                cancellation.Dispose();
            }
        }

        public void Cancel()
        {
            var uncertain = _applying && _applySent;
            CancelPending(uncertain
                ? "Invio interrotto; verifica il modello se la richiesta era già partita."
                : "Operazione annullata.");
            _moving = null;_fixed = null;
        }

        public void CancelPending(string reason = "Operazione interrotta.")
        {
            ++_operation;
            CancelCapture(true, reason);
            CancelCapture(false, reason);
            CancelSource(_applyCancellation);
            _moving = null;_fixed = null;
            if (!_applying)
            {
                _applyClient = null;_applyModel = null;_applyGeneration = 0;_applyRevision = 0;
                _applySent = false;_applyAccepted = false;_applyRejected = false;
            }
            Status = _applying && _applySent
                ? "Invio interrotto; esito remoto da verificare."
                : reason;
        }

        void OnApplicationFocus(bool focused) { if (!focused) CancelPending("Focus perso; acquisizioni annullate."); }
        void OnApplicationPause(bool paused) { if (paused) CancelPending("Pausa; acquisizioni annullate."); }
        void OnDisable() { CancelPending("Componente disattivato; operazioni annullate."); }
        void OnDestroy() { CancelPending("Componente chiuso; operazioni annullate."); }

        public void RefreshStaleCaptures()
        {
            if (_movingCaptureCurrent != null && !IsCurrent(_movingCaptureCurrent))
                CancelCapture(true, "Selezione cambiata; acquisizione annullata.");
            if (_fixedCaptureCurrent != null && !IsCurrent(_fixedCaptureCurrent))
                CancelCapture(false, "Selezione cambiata; acquisizione annullata.");
            if (_applying && !ApplyContextCurrent())
            { CancelPending("Connessione o modello cambiato durante l’invio.");return; }
            var changed = false;
            if (_moving != null && !SlotCurrent(_moving)) { _moving = null;_movingCapture++;changed = true; }
            if (_fixed != null && !SlotCurrent(_fixed)) { _fixed = null;_fixedCapture++;changed = true; }
            if (changed) Status = "Riferimenti scaduti; acquisiscili di nuovo.";
        }

        int InvalidateCapture(bool moving)
        {
            if (moving)
            {
                _movingCapture++;CancelSource(_movingCancellation);_movingCancellation = null;
                _movingCaptureCurrent = null;_moving = null;
                return _movingCapture;
            }
            _fixedCapture++;CancelSource(_fixedCancellation);_fixedCancellation = null;
            _fixedCaptureCurrent = null;_fixed = null;
            return _fixedCapture;
        }

        void SetCaptureRequest(bool moving, CancellationTokenSource cancellation, Func<bool> current)
        {
            if (moving) { _movingCancellation = cancellation;_movingCaptureCurrent = current; }
            else { _fixedCancellation = cancellation;_fixedCaptureCurrent = current; }
        }

        void ClearCaptureRequest(bool moving, CancellationTokenSource cancellation)
        {
            if (moving && ReferenceEquals(_movingCancellation, cancellation))
            { _movingCancellation = null;_movingCaptureCurrent = null; }
            else if (!moving && ReferenceEquals(_fixedCancellation, cancellation))
            { _fixedCancellation = null;_fixedCaptureCurrent = null; }
        }

        void CancelCapture(bool moving, string reason)
        {
            if (moving)
            {
                if (_movingCancellation == null && _movingCaptureCurrent == null) return;
                _movingCapture++;CancelSource(_movingCancellation);_movingCancellation = null;
                _movingCaptureCurrent = null;
            }
            else
            {
                if (_fixedCancellation == null && _fixedCaptureCurrent == null) return;
                _fixedCapture++;CancelSource(_fixedCancellation);_fixedCancellation = null;
                _fixedCaptureCurrent = null;
            }
            if (!_applying) Status = reason;
        }

        bool ApplyContextCurrent()
        {
            if (_applyClient == null || _applyModel == null) return false;
            if (!_applySent) return BaseModelCurrent(_applyClient, _applyModel, _applyGeneration);
            var live = _applyClient.Model;
            return Connection != null && Connection.Connected && Connection.Client == _applyClient &&
                Connection.ConnectionGeneration == _applyGeneration && live != null &&
                live.SessionId == _applyModel.SessionId && live.DocumentId == _applyModel.DocumentId &&
                live.Revision >= _applyModel.Revision && live.Revision <= _applyRevision;
        }

        bool ApplyLineageCurrent(SessionClient client, SessionModelState model, long generation, long revision)
        {
            var live = client != null ? client.Model : null;
            return Connection != null && Connection.Connected && Connection.Client == client &&
                Connection.ConnectionGeneration == generation && live != null &&
                live.SessionId == model.SessionId && live.DocumentId == model.DocumentId &&
                live.Revision >= model.Revision && live.Revision <= revision;
        }

        async Task WaitForCommittedModel(SessionClient client, SessionModelState model, long generation,
            long revision, CancellationToken cancellationToken)
        {
            if (PostCommitContextCurrent(client, model, generation, revision)) return;
            var completed = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            void OnModelChanged(SessionModelUpdate update)
            {
                var current = update?.Model;
                if (current == null) return;
                if (current.SessionId != model.SessionId || current.DocumentId != model.DocumentId || current.Revision > revision)
                    completed.TrySetException(new SessionException("NEED_FULL_SNAPSHOT", "assembly delta belongs to another model"));
                else if (update.Kind == SessionModelUpdateKind.Applied && current.Revision == revision)
                    completed.TrySetResult(true);
            }

            client.ModelChanged += OnModelChanged;
            using var cancellation = cancellationToken.Register(() => completed.TrySetCanceled());
            try
            {
                var current = client.Model;
                if (current != null && (current.SessionId != model.SessionId || current.DocumentId != model.DocumentId || current.Revision > revision))
                    throw new SessionException("NEED_FULL_SNAPSHOT", "assembly delta belongs to another model");
                if (PostCommitContextCurrent(client, model, generation, revision)) completed.TrySetResult(true);
                await completed.Task.ConfigureAwait(false);
            }
            finally { client.ModelChanged -= OnModelChanged; }
        }

        static bool IsCurrent(Func<bool> current)
        {
            try { return current != null && current(); }
            catch { return false; }
        }

        static void CancelSource(CancellationTokenSource source)
        {
            try { source?.Cancel(); }
            catch (ObjectDisposedException) { }
        }

        bool TryContext(QuestMeshView view, Func<bool> selectionIsCurrent, out SessionClient client,
            out SessionModelState model, out long generation, out string instanceId, out string displayName, out string message)
        {
            client = Connection != null ? Connection.Client : null;
            model = client != null ? client.Model : null;
            generation = Connection != null ? Connection.ConnectionGeneration : -1;
            instanceId = view != null ? view.InstanceId : null;
            displayName = "";message = "Seleziona un’istanza CAD corrente nel viewport.";
            if (Connection == null || !Connection.Connected || client == null || model == null || view == null ||
                string.IsNullOrEmpty(instanceId) || !Connection.IsCurrentView(view) || !IsCurrent(selectionIsCurrent)) return false;
            if (!FindInstance(model, instanceId, out var ordinal, out _))
            { message = "La selezione non corrisponde a un’istanza CAD corrente.";return false; }
            displayName = "Istanza " + ordinal.ToString(CultureInfo.InvariantCulture);
            return true;
        }

        bool CaptureContextCurrent(SessionClient client, SessionModelState model, long generation,
            QuestMeshView view, int uploadVersion, Func<bool> selectionIsCurrent) =>
            BaseModelCurrent(client, model, generation) && Connection.IsCurrentView(view) &&
            view.UploadVersion == uploadVersion && IsCurrent(selectionIsCurrent);

        bool BaseModelCurrent(SessionClient client, SessionModelState model, long generation)
        {
            var live = client != null ? client.Model : null;
            return Connection != null && Connection.Connected && Connection.Client == client &&
                Connection.ConnectionGeneration == generation && live != null && ReferenceEquals(live, model) &&
                live.SessionId == model.SessionId && live.DocumentId == model.DocumentId && live.Revision == model.Revision;
        }

        bool PostCommitContextCurrent(SessionClient client, SessionModelState model, long generation, long revision)
        {
            var live = client != null ? client.Model : null;
            return Connection != null && Connection.Connected && Connection.Client == client &&
                Connection.ConnectionGeneration == generation && live != null && live.SessionId == model.SessionId &&
                live.DocumentId == model.DocumentId && live.Revision == revision;
        }

        bool SlotCurrent(Slot slot) => slot != null && slot.View != null &&
            Connection != null && Connection.Connected && Connection.Client == slot.Client && Connection.ConnectionGeneration == slot.Generation &&
            slot.Client.Model != null && slot.Client.Model.SessionId == slot.Model.SessionId &&
            slot.Client.Model.DocumentId == slot.Model.DocumentId && slot.Client.Model.Revision == slot.Model.Revision &&
            ReferenceEquals(slot.Client.Model, slot.Model) && slot.View.UploadVersion == slot.UploadVersion &&
            Connection.IsCurrentView(slot.View);

        IDictionary<string, object?> BuildParameters(long revision, double value)
        {
            var parameters = new Dictionary<string, object?>
            {
                ["constraintId"] = "mate-" + Guid.NewGuid().ToString("N"),
                ["kind"] = Kinds[_kind], ["movingId"] = _moving.InstanceId,
            };
            if (_kind == 0) return parameters;
            parameters["fixedId"] = _fixed.InstanceId;
            if (_kind == 2) { parameters["axis"] = _axis;parameters["distanceMm"] = value;return parameters; }
            if (_kind == 1) return parameters;
            parameters["captureRevision"] = revision;
            parameters["movingPickId"] = _moving.PickId;
            parameters["fixedPickId"] = _fixed.PickId;
            parameters["movingSourceBinding"] = _moving.Binding.ToParameters();
            parameters["fixedSourceBinding"] = _fixed.Binding.ToParameters();
            if (_kind == 6) parameters["angleDeg"] = value;
            return parameters;
        }

        bool TryNumber(out double number, out string message)
        {
            number = 0;message = "";
            if (_kind != 2 && _kind != 6) return true;
            if (!double.TryParse(_value.Replace(',', '.'), NumberStyles.Float, CultureInfo.InvariantCulture, out number) ||
                double.IsNaN(number) || double.IsInfinity(number))
            { message = _kind == 6 ? "Inserisci un angolo finito." : "Inserisci una distanza finita.";return false; }
            if (_kind == 6 && (number < 0 || number > 180))
            { message = "L’angolo deve essere tra 0° e 180°.";return false; }
            return true;
        }

        async Task<JsonElement> SendAsync(SessionClient client, string method,
            IDictionary<string, object?> parameters, CancellationToken token, string sessionId, Action? beforeSend)
        {
            if (SendOverride != null) return await SendOverride(method, parameters, token, sessionId, beforeSend);
            return await client.CallAsync(method, parameters, token, expectedSessionId: sessionId, beforeSend: beforeSend);
        }

        static void AssertCurrent(Func<bool> current)
        { if (!current()) throw new SessionException("NEED_FULL_SNAPSHOT", "selection changed before native geometry query"); }

        static bool ReplyAccepted(JsonElement reply) => reply.ValueKind == JsonValueKind.Object &&
            reply.TryGetProperty("ok", out var ok) && ok.ValueKind == JsonValueKind.True;

        static bool ReplyMatches(JsonElement reply, SessionModelState model) =>
            reply.ValueKind == JsonValueKind.Object && reply.TryGetProperty("sessionId", out var session) && session.ValueKind == JsonValueKind.String && session.GetString() == model.SessionId &&
            reply.TryGetProperty("documentId", out var document) && document.ValueKind == JsonValueKind.String && document.GetString() == model.DocumentId &&
            reply.TryGetProperty("revision", out var revision) && revision.TryGetInt64(out var value) && value == model.Revision;

        static Binding ResolveBinding(JsonElement reply, string expectedType, string instanceId, string pickId, SessionModelState model)
        {
            var key = expectedType == "face" ? "faces" : "edges";
            if (!reply.TryGetProperty("result", out var result) || result.ValueKind != JsonValueKind.Object ||
                !result.TryGetProperty(key, out var items) || items.ValueKind != JsonValueKind.Array)
                throw new SessionException("CORE_FAILED", "native geometry reply is missing its selection list");
            var matches = items.EnumerateArray().Where(item => item.ValueKind == JsonValueKind.Object &&
                item.TryGetProperty("persistentId", out var id) && id.ValueKind == JsonValueKind.String && id.GetString() == pickId).ToArray();
            if (matches.Length != 1) throw new SessionException("AMBIGUOUS_REFERENCE", "selected geometry is not uniquely resolvable");
            var selected = matches[0];
            if (selected.TryGetProperty("selectionEntry", out _))
                throw new SessionException("BAD_PARAMS", "selection entry is not part of the public geometry DTO");
            if (!selected.TryGetProperty("ambiguous", out var ambiguous) || ambiguous.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
                throw new SessionException("BAD_PARAMS", "selected geometry ambiguity metadata is malformed");
            if (ambiguous.ValueKind == JsonValueKind.True)
                throw new SessionException("AMBIGUOUS_REFERENCE", "selected geometry is ambiguous");
            if (!selected.TryGetProperty("featureId", out var owner) || owner.ValueKind != JsonValueKind.String || owner.GetString() != instanceId)
                throw new SessionException("BAD_PARAMS", "selected geometry belongs to a different instance");
            if (!selected.TryGetProperty("captureRevision", out var capturedRevision) || !capturedRevision.TryGetInt64(out var revision) ||
                revision != model.Revision || !selected.TryGetProperty("sourceBinding", out var source) || source.ValueKind != JsonValueKind.Object)
                throw new SessionException("NEED_FULL_SNAPSHOT", "selected geometry has no current native source binding");
            var bindingType = ReadString(source, "type");
            if (!HasExactBindingFields(source, bindingType))
                throw new SessionException("BAD_PARAMS", "native source binding does not match the public DTO");
            var sourceFeatureId = ReadString(source, "featureId");
            var geometryKind = ReadString(source, "geometryKind");
            var persistentKey = bindingType == "face" ? "persistentFaceId" : bindingType == "edge" ? "persistentEdgeId" : null;
            var persistentId = persistentKey != null ? ReadString(source, persistentKey) : null;
            if (bindingType != expectedType || string.IsNullOrEmpty(sourceFeatureId) || !ValidSourceRole(persistentId) ||
                !(bindingType == "face" ? geometryKind == "plane" || geometryKind == "cylinder" : geometryKind == "circle" || geometryKind == "line"))
                throw new SessionException("BAD_PARAMS", "selected geometry type is unsupported for assembly mating");
            if (!FindInstance(model, instanceId, out _, out var dependencies) || !dependencies.Contains(sourceFeatureId) ||
                !model.Features.Any(feature => ReadString(feature, "featureId") == sourceFeatureId))
                throw new SessionException("BAD_PARAMS", "native geometry source does not belong to the selected instance");
            return new Binding { Type = bindingType, FeatureId = sourceFeatureId,
                PersistentId = persistentId, GeometryKind = geometryKind };
        }

        static bool HasExactBindingFields(JsonElement source, string bindingType)
        {
            var persistentKey = bindingType == "face" ? "persistentFaceId" : bindingType == "edge" ? "persistentEdgeId" : null;
            if (persistentKey == null || source.ValueKind != JsonValueKind.Object) return false;
            var expected = new HashSet<string>(StringComparer.Ordinal) { "type", "featureId", persistentKey, "geometryKind" };
            foreach (var property in source.EnumerateObject())
                if (!expected.Remove(property.Name)) return false;
            return expected.Count == 0;
        }

        static bool ValidSourceRole(string role) => !string.IsNullOrWhiteSpace(role) && role.Length <= 512 && !role.Contains(":");

        static bool FindInstance(SessionModelState model, string id, out int ordinal, out HashSet<string> dependencies)
        {
            ordinal = 0;dependencies = new HashSet<string>(StringComparer.Ordinal);
            var index = 0;
            foreach (var feature in model.Features)
            {
                if (ReadString(feature, "type") != "Instance") continue;
                var featureId = ReadString(feature, "featureId");
                if (featureId == id)
                {
                    ordinal = index + 1;
                    if (feature.TryGetProperty("dependsOn", out var refs) && refs.ValueKind == JsonValueKind.Array)
                        foreach (var reference in refs.EnumerateArray())
                            if (reference.ValueKind == JsonValueKind.String && !string.IsNullOrEmpty(reference.GetString()))
                                dependencies.Add(reference.GetString());
                    return true;
                }
                index++;
            }
            return false;
        }

        static string ReadString(JsonElement value, string key) => value.ValueKind == JsonValueKind.Object &&
            value.TryGetProperty(key, out var item) && item.ValueKind == JsonValueKind.String ? item.GetString() : null;
        static bool IsGeometricKind(int kind) => kind >= 3 && kind <= 6;
        static bool ConcentricBinding(Binding binding) => binding != null &&
            (binding.GeometryKind == "circle" || binding.GeometryKind == "cylinder");
        static string GeometrySuffix(Slot slot) => slot.Binding == null ? "" : " · " +
            (slot.Binding.GeometryKind == "plane" ? "piano" : slot.Binding.GeometryKind == "cylinder" ? "cilindro" :
             slot.Binding.GeometryKind == "circle" ? "cerchio" : "retta");
        static string Short(string value, int limit) => string.IsNullOrEmpty(value) || value.Length <= limit ? value : value.Substring(0, limit - 1) + "…";
    }
}
