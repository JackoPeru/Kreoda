using System;
using System.Collections.Concurrent;
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
    public sealed class QuestDirectFaceHistory : MonoBehaviour
    {
        enum Operation { Move, Offset, Delete, Replace }

        static readonly string[] OperationLabels = { "Sposta faccia", "Offset faccia", "Elimina faccia", "Sostituisci faccia" };
        static readonly string[] MoveParameters = { "tx", "ty", "tz", "rx", "ry", "rz", "px", "py", "pz" };
        static readonly string[] MoveLabels = { "Traslazione X (mm)", "Traslazione Y (mm)", "Traslazione Z (mm)",
            "Rotazione X (°)", "Rotazione Y (°)", "Rotazione Z (°)", "Pivot X (mm)", "Pivot Y (mm)", "Pivot Z (mm)" };

        public QuestConnection Connection;
        public QuestCommands Commands;
        public QuestSpatialEdit Spatial;
        public QuestAssemblyMates AssemblyMates;
        public Func<string, IDictionary<string, object?>, CancellationToken, string, Action?, Task<JsonElement>> SendOverride;
        public bool Busy => _pending > 0 || _applying;
        public bool NeedsSupport => _operation == Operation.Replace;
        public bool UsesMoveFields => _operation == Operation.Move;
        public bool UsesValue => _operation is Operation.Move or Operation.Offset;
        public string OperationLabel => OperationLabels[(int)_operation];
        public string FieldLabel => _operation == Operation.Move ? MoveLabels[_field] :
            _operation == Operation.Offset ? "Distanza con segno (mm)" : "Nessun valore richiesto";
        public string FieldValue => _operation == Operation.Move
            ? _move[_field].ToString("0.###", CultureInfo.InvariantCulture)
            : _operation == Operation.Offset ? _distance.ToString("0.###", CultureInfo.InvariantCulture) : "";
        public string SourceLabel => _source == null ? "Sorgente: —" : "Sorgente: " + _source.FeatureId;
        public string SupportLabel => _support == null ? "Supporto: —" : "Supporto: " + _support.FeatureId;
        public string Status { get; private set; } = "Scegli un’operazione e acquisisci una faccia.";

        readonly ConcurrentQueue<Action> _main = new ConcurrentQueue<Action>();
        readonly double[] _move = new double[9];
        Operation _operation;
        int _field, _pending, _sourceTicket, _supportTicket, _operationTicket;
        long _ticket;
        double _distance = 1;
        Slot _source, _support;
        CancellationTokenSource _sourceCancellation, _supportCancellation, _applyCancellation;
        Func<bool> _sourceCaptureCurrent, _supportCaptureCurrent;
        SessionClient _applyClient;
        SessionModelState _applyModel;
        long _applyGeneration, _applyRevision;
        bool _applySent, _applyAccepted, _applyRejected, _applying, _destroyed;

        sealed class Slot
        {
            public SessionClient Client;
            public SessionModelState Model;
            public QuestMeshView View;
            public int UploadVersion;
            public long Generation;
            public string FeatureId;
            public string PersistentId;
            public DirectFaceReference SourceFace;
            public string SurfaceType;
            public double[] CentroidMm;
        }

        sealed class DirectFaceReference
        {
            public string FeatureId;
            public string PersistentFaceId;

            public IDictionary<string, object?> ToParameters() => new Dictionary<string, object?>
            {
                ["type"] = "face", ["featureId"] = FeatureId, ["persistentFaceId"] = PersistentFaceId,
            };
        }

        void Update()
        {
            for (var i = 0; i < 2 && _main.TryDequeue(out var action); i++)
                if (!_destroyed) action();
            RefreshStaleCaptures();
        }

        public void NextOperation()
        {
            if (Busy) return;
            _operation = (Operation)(((int)_operation + 1) % OperationLabels.Length);
            Status = "Operazione: " + OperationLabel;
        }

        public void NextField()
        {
            if (Busy || _operation != Operation.Move) return;
            _field = (_field + 1) % MoveParameters.Length;
        }

        public bool SetFieldValue(string text)
        {
            if (Busy || _operation is not (Operation.Move or Operation.Offset) ||
                !double.TryParse((text ?? "").Replace(',', '.'), NumberStyles.Float,
                    CultureInfo.InvariantCulture, out var value) || double.IsNaN(value) || double.IsInfinity(value))
            { Status = "Inserisci un valore finito.";return false; }
            if (_operation == Operation.Offset)
            {
                if (value == 0) { Status = "L’offset deve essere diverso da zero.";return false; }
                _distance = value;
            }
            else _move[_field] = value;
            return true;
        }

        public async Task CaptureSourceAsync(QuestMeshView view, MeshSemanticHit hit,
            Func<bool> selectionIsCurrent) => await CaptureAsync(true, view, hit, selectionIsCurrent);

        public async Task CaptureSupportAsync(QuestMeshView view, MeshSemanticHit hit,
            Func<bool> selectionIsCurrent) => await CaptureAsync(false, view, hit, selectionIsCurrent);

        async Task CaptureAsync(bool source, QuestMeshView view, MeshSemanticHit hit, Func<bool> selectionIsCurrent)
        {
            var ticket = InvalidateCapture(source);
            if (!TryContext(source, view, hit, selectionIsCurrent, out var client, out var model,
                    out var generation, out var featureId, out var message))
            { Status = message;return; }

            var uploadVersion = view.UploadVersion;
            Func<bool> current = () => CaptureContextCurrent(client, model, generation, view,
                uploadVersion, featureId, selectionIsCurrent);
            if (!current()) { Status = "Selezione non corrente; riprova.";return; }
            var cancellation = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            SetCaptureRequest(source, cancellation, current);
            _pending++;Status = source ? "Acquisizione faccia sorgente…" : "Acquisizione faccia supporto…";
            try
            {
                var reply = await SendAsync(client, SessionMethods.FindFaces, new Dictionary<string, object?>
                {
                    ["featureId"] = featureId, ["documentId"] = model.DocumentId,
                    ["expectedRevision"] = model.Revision,
                }, cancellation.Token, model.SessionId, () => AssertCurrent(current));
                if (!current()) throw new SessionException("NEED_FULL_SNAPSHOT", "direct face capture is stale");
                if (!ReplyMatches(reply, model)) throw new SessionException("NEED_FULL_SNAPSHOT", "direct face reply lineage changed");
                var captured = ResolveCapture(reply, featureId, hit.PersistentId, model);
                if (!current()) throw new SessionException("NEED_FULL_SNAPSHOT", "selection changed during direct face capture");
                if ((source ? _sourceTicket : _supportTicket) != ticket) return;
                var slot = new Slot { Client = client, Model = model, View = view, UploadVersion = uploadVersion,
                    Generation = generation, FeatureId = featureId, PersistentId = hit.PersistentId,
                    SourceFace = captured.SourceFace, SurfaceType = captured.SurfaceType,
                    CentroidMm = captured.CentroidMm };
                if (source)
                {
                    _source = slot;
                    for (var i = 0; i < 3; i++) _move[6 + i] = captured.CentroidMm[i];
                }
                else _support = slot;
                Status = (source ? "Faccia sorgente acquisita · " : "Faccia supporto acquisita · ") + featureId;
            }
            catch (Exception error)
            {
                if ((source ? _sourceTicket : _supportTicket) == ticket)
                    Status = "Acquisizione non riuscita: " + Short(error.Message, 100);
            }
            finally
            {
                ClearCaptureRequest(source, cancellation);
                _pending = Math.Max(0, _pending - 1);
                cancellation.Dispose();
            }
        }

        public bool CanApply(out string reason)
        {
            reason = "";
            if (_applying) { reason = "Operazione già in corso.";return false; }
            if (_pending != 0) { reason = "Attendi la fine dell’acquisizione.";return false; }
            if (DirectFaceHistoryBusy()) { reason = "Un’altra operazione CAD è in corso.";return false; }
            if (_source == null || !SlotCurrent(_source))
            { reason = "Acquisisci una faccia sorgente corrente da un solido.";return false; }
            if (NeedsSupport && (_support == null || !SlotCurrent(_support)))
            { reason = "Acquisisci una faccia supporto corrente da un solido visibile.";return false; }
            if (NeedsSupport && _support.Model.Revision != _source.Model.Revision)
            { reason = "Sorgente e supporto devono appartenere alla stessa revisione.";return false; }
            if (_operation == Operation.Offset && (!Finite(_distance) || _distance == 0))
            { reason = "L’offset deve essere finito e diverso da zero.";return false; }
            if (_operation == Operation.Move && _move.Any(value => !Finite(value)))
            { reason = "I nove valori Move devono essere finiti.";return false; }
            if (_source.Model.Revision >= SessionContract.MaximumRevision)
            { reason = "Revisione CAD non incrementabile.";return false; }
            return true;
        }

        public async Task ApplyAsync()
        {
            if (!CanApply(out var readiness)) { Status = readiness;return; }
            var operation = ++_operationTicket;
            var source = _source;
            var support = _operation == Operation.Replace ? _support : null;
            var client = source.Client;
            var model = source.Model;
            var generation = source.Generation;
            var expectedCommit = model.Revision + 1;
            var command = CommandId(_operation);
            var parameters = BuildParameters(_operation, source, support, model.Revision, _move, _distance);
            var beforeSend = new Action(() =>
            {
                if (operation != _operationTicket || !BaseModelCurrent(client, model, generation))
                    throw new SessionException("NEED_FULL_SNAPSHOT", "direct face command belongs to an older model");
                _applySent = true;
            });
            var cancellation = new CancellationTokenSource(TimeSpan.FromSeconds(20));
            _applyCancellation = cancellation;_applyClient = client;_applyModel = model;
            _applyGeneration = generation;_applyRevision = expectedCommit;
            _applySent = false;_applyAccepted = false;_applyRejected = false;_applying = true;
            _pending++;Status = "Invio faccia diretta al PC…";
            try
            {
                JsonElement reply;
                try
                {
                    reply = await SendAsync(client, SessionMethods.Command, new Dictionary<string, object?>
                    {
                        ["commandId"] = command, ["parameters"] = parameters,
                        ["documentId"] = model.DocumentId, ["baseRevision"] = model.Revision,
                    }, cancellation.Token, model.SessionId, beforeSend);
                }
                catch (Exception error)
                {
                    if (_applySent && IsDefinitiveRejection(error)) _applyRejected = true;
                    throw;
                }
                if (!ReplyAccepted(reply))
                {
                    _applyRejected = ReplyExplicitlyRejected(reply);
                    throw new SessionException("CORE_FAILED", "PC did not accept direct face operation");
                }
                _applyAccepted = true;
                if (operation != _operationTicket || !ApplyLineageCurrent(client, model, generation))
                    throw new SessionException("NEED_FULL_SNAPSHOT", "direct face reply belongs to an older model");
                if (!ReplyMatches(reply, model) || !ReadRevision(reply, out var accepted) || accepted != expectedCommit)
                    throw new SessionException("CORE_FAILED", "PC did not confirm one direct face revision");
                await WaitForCommittedModel(client, model, generation, expectedCommit, cancellation.Token);
                if (operation != _operationTicket || !PostCommitContextCurrent(client, model, generation, expectedCommit))
                    throw new SessionException("NEED_FULL_SNAPSHOT", "direct face model update belongs to an older session");
                _source = null;_support = null;
                Status = OperationLabels[(int)_operation] + " salvata · revisione " + client.Model.Revision.ToString(CultureInfo.InvariantCulture);
            }
            catch (Exception error)
            {
                if (_applySent && !_applyRejected)
                    await RefreshAfterUncertainSend(client, model.DocumentId);
                if (operation == _operationTicket && ApplyLineageCurrent(client, model, generation))
                {
                    if (_applySent) { _source = null;_support = null; }
                    Status = _applyRejected ? "Rifiutato dal PC: " + Short(error.Message, 95) :
                        _applyAccepted ? "Accettato dal PC, aggiornamento non confermato; verifica il modello." :
                        _applySent ? "Esito non confermato; verifica il modello e acquisisci di nuovo." :
                        "Operazione non inviata: " + Short(error.Message, 100);
                }
            }
            finally
            {
                if (ReferenceEquals(_applyCancellation, cancellation))
                {
                    _applyCancellation = null;_applyClient = null;_applyModel = null;
                    _applyGeneration = 0;_applyRevision = 0;_applySent = false;
                    _applyAccepted = false;_applyRejected = false;_applying = false;
                }
                _pending = Math.Max(0, _pending - 1);
                cancellation.Dispose();
            }
        }

        public void Cancel() => CancelPending("Operazione annullata.");

        public void CancelPending(string reason = "Operazione interrotta.")
        {
            ++_operationTicket;
            CancelCapture(true);CancelCapture(false);
            CancelSource(_applyCancellation);
            _source = null;_support = null;
            Status = _applying && _applySent ? "Invio interrotto; esito remoto da verificare." : reason;
        }

        public void RefreshStaleCaptures()
        {
            if (_sourceCaptureCurrent != null && !IsCurrent(_sourceCaptureCurrent)) CancelCapture(true);
            if (_supportCaptureCurrent != null && !IsCurrent(_supportCaptureCurrent)) CancelCapture(false);
            if (_applying && !ApplyContextCurrent())
            { CancelPending("Connessione o modello cambiato durante l’invio.");return; }
            if (_applying) return;
            var changed = false;
            if (_source != null && !SlotCurrent(_source)) { _source = null;_sourceTicket++;changed = true; }
            if (_support != null && !SlotCurrent(_support)) { _support = null;_supportTicket++;changed = true; }
            if (changed) Status = "Riferimenti scaduti; acquisiscili di nuovo.";
        }

        void OnApplicationFocus(bool focused) { if (!focused) CancelPending("Focus perso; acquisizioni annullate."); }
        void OnApplicationPause(bool paused) { if (paused) CancelPending("Pausa; acquisizioni annullate."); }
        void OnDisable() { CancelPending("Componente disattivato; operazioni annullate."); }
        void OnDestroy() { _destroyed = true;CancelPending("Componente chiuso; operazioni annullate."); }

        int InvalidateCapture(bool source)
        {
            if (source)
            {
                _sourceTicket++;CancelSource(_sourceCancellation);_sourceCancellation = null;
                _sourceCaptureCurrent = null;_source = null;return _sourceTicket;
            }
            _supportTicket++;CancelSource(_supportCancellation);_supportCancellation = null;
            _supportCaptureCurrent = null;_support = null;return _supportTicket;
        }

        void SetCaptureRequest(bool source, CancellationTokenSource cancellation, Func<bool> current)
        {
            if (source) { _sourceCancellation = cancellation;_sourceCaptureCurrent = current; }
            else { _supportCancellation = cancellation;_supportCaptureCurrent = current; }
        }

        void ClearCaptureRequest(bool source, CancellationTokenSource cancellation)
        {
            if (source && ReferenceEquals(_sourceCancellation, cancellation))
            { _sourceCancellation = null;_sourceCaptureCurrent = null; }
            else if (!source && ReferenceEquals(_supportCancellation, cancellation))
            { _supportCancellation = null;_supportCaptureCurrent = null; }
        }

        void CancelCapture(bool source)
        {
            if (source)
            {
                if (_sourceCancellation == null && _sourceCaptureCurrent == null) return;
                _sourceTicket++;CancelSource(_sourceCancellation);_sourceCancellation = null;_sourceCaptureCurrent = null;
            }
            else
            {
                if (_supportCancellation == null && _supportCaptureCurrent == null) return;
                _supportTicket++;CancelSource(_supportCancellation);_supportCancellation = null;_supportCaptureCurrent = null;
            }
        }

        bool TryContext(bool source, QuestMeshView view, MeshSemanticHit hit, Func<bool> selectionIsCurrent,
            out SessionClient client, out SessionModelState model, out long generation, out string featureId, out string message)
        {
            client = Connection != null ? Connection.Client : null;model = client?.Model;
            generation = Connection != null ? Connection.ConnectionGeneration : 0;
            var selectedFeatureId = source || view?.InstanceId == null ? view?.FeatureId : view.InstanceId;
            featureId = selectedFeatureId;
            message = "Seleziona una faccia solida corrente.";
            if (DirectFaceHistoryBusy() || Connection == null || !Connection.Connected || client == null || model == null ||
                view == null || !Connection.IsCurrentView(view) || !VisibleMesh(view) || string.IsNullOrEmpty(featureId) ||
                hit == null || hit.ReferenceAmbiguous || !hit.PersistentId.StartsWith(featureId + ":", StringComparison.Ordinal) ||
                !IsCurrent(selectionIsCurrent)) return false;
            var feature = model.Features.FirstOrDefault(item => ReadString(item, "featureId") == selectedFeatureId);
            if (feature.ValueKind != JsonValueKind.Object || !FeatureHealthy(feature) ||
                !ReadNumber(feature, "volumeMm3", out var volume) || volume <= 0) return false;
            var instance = ReadString(feature, "type") == "Instance";
            if (source)
            {
                if (instance || view.InstanceId != null || !CurrentVisibleBodyTip(model, view, featureId)) return false;
            }
            else if (instance)
            {
                var mesh = view.GetComponent<MeshFilter>()?.sharedMesh;
                if (view.InstanceId != featureId || mesh == null || mesh.vertexCount == 0) return false;
            }
            else if (!CurrentVisibleBodyTip(model, view, featureId)) return false;
            message = "Acquisisci una faccia visibile, univoca e appartenente a un solido corrente.";
            return true;
        }

        static bool CurrentVisibleBodyTip(SessionModelState model, QuestMeshView view, string featureId)
        {
            if (!VisibleMesh(view)) return false;
            foreach (var body in model.Bodies)
                if (ReadString(body, "tip") == featureId && ReadString(body, "bodyId") == view.BodyId &&
                    (!body.TryGetProperty("visible", out var visible) || visible.ValueKind != JsonValueKind.False))
                    return true;
            return false;
        }

        bool CaptureContextCurrent(SessionClient client, SessionModelState model, long generation,
            QuestMeshView view, int upload, string featureId, Func<bool> selectionIsCurrent) =>
            BaseModelCurrent(client, model, generation) && Connection.IsCurrentView(view) &&
            VisibleMesh(view) && view.UploadVersion == upload &&
            (view.InstanceId ?? view.FeatureId) == featureId && IsCurrent(selectionIsCurrent);

        bool BaseModelCurrent(SessionClient client, SessionModelState model, long generation)
        {
            var live = client != null ? client.Model : null;
            return Connection != null && Connection.Connected && Connection.Client == client &&
                Connection.ConnectionGeneration == generation && live != null && ReferenceEquals(live, model) &&
                live.SessionId == model.SessionId && live.DocumentId == model.DocumentId && live.Revision == model.Revision;
        }

        bool SlotCurrent(Slot slot) => slot != null && slot.View != null && Connection != null && Connection.Connected &&
            Connection.Client == slot.Client && Connection.ConnectionGeneration == slot.Generation &&
            slot.Client.Model != null && ReferenceEquals(slot.Client.Model, slot.Model) &&
            slot.Client.Model.SessionId == slot.Model.SessionId && slot.Client.Model.DocumentId == slot.Model.DocumentId &&
            slot.Client.Model.Revision == slot.Model.Revision && slot.View.UploadVersion == slot.UploadVersion &&
            VisibleMesh(slot.View) && Connection.IsCurrentView(slot.View);

        static bool VisibleMesh(QuestMeshView view)
        {
            if (view == null || !view.gameObject.activeInHierarchy) return false;
            var mesh = view.GetComponent<MeshFilter>()?.sharedMesh;
            var renderer = view.GetComponent<MeshRenderer>();
            return mesh != null && mesh.vertexCount > 0 && renderer != null && renderer.enabled &&
                renderer.gameObject.activeInHierarchy;
        }

        bool ApplyContextCurrent()
        {
            if (_applyClient == null || _applyModel == null || Connection == null || !Connection.Connected ||
                Connection.Client != _applyClient || Connection.ConnectionGeneration != _applyGeneration) return false;
            var live = _applyClient.Model;
            return live != null && live.SessionId == _applyModel.SessionId && live.DocumentId == _applyModel.DocumentId &&
                (_applySent ? live.Revision >= _applyModel.Revision : ReferenceEquals(live, _applyModel) && live.Revision == _applyModel.Revision);
        }

        bool ApplyLineageCurrent(SessionClient client, SessionModelState model, long generation)
        {
            var live = client?.Model;
            return Connection != null && Connection.Connected && Connection.Client == client &&
                Connection.ConnectionGeneration == generation && live != null && live.SessionId == model.SessionId &&
                live.DocumentId == model.DocumentId && live.Revision >= model.Revision;
        }

        bool PostCommitContextCurrent(SessionClient client, SessionModelState model, long generation, long revision)
        {
            var live = client?.Model;
            return Connection != null && Connection.Connected && Connection.Client == client &&
                Connection.ConnectionGeneration == generation && live != null && live.SessionId == model.SessionId &&
                live.DocumentId == model.DocumentId && live.Revision >= revision;
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
                if (current.SessionId != model.SessionId || current.DocumentId != model.DocumentId)
                    completed.TrySetException(new SessionException("NEED_FULL_SNAPSHOT", "direct face delta belongs to another model"));
                else if (current.Revision >= revision) completed.TrySetResult(true);
            }
            client.ModelChanged += OnModelChanged;
            using var cancellation = cancellationToken.Register(() => completed.TrySetCanceled());
            try
            {
                if (PostCommitContextCurrent(client, model, generation, revision)) completed.TrySetResult(true);
                await completed.Task;
            }
            finally { client.ModelChanged -= OnModelChanged; }
        }

        async Task RefreshAfterUncertainSend(SessionClient client, string documentId)
        {
            try
            {
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
                await client.SnapshotAsync(documentId, timeout.Token);
            }
            catch { /* Keep the result unknown; never retry a sent command. */ }
        }

        async Task<JsonElement> SendAsync(SessionClient client, string method,
            IDictionary<string, object?> parameters, CancellationToken token, string sessionId, Action beforeSend)
        {
            if (SendOverride != null) return await SendOverride(method, parameters, token, sessionId, beforeSend);
            return await client.CallAsync(method, parameters, token, expectedSessionId: sessionId, beforeSend: beforeSend);
        }

        static DirectFaceCapture ResolveCapture(JsonElement reply, string featureId, string pickId, SessionModelState model)
        {
            if (!reply.TryGetProperty("result", out var result) || result.ValueKind != JsonValueKind.Object ||
                !result.TryGetProperty("faces", out var faces) || faces.ValueKind != JsonValueKind.Array)
                throw new SessionException("CORE_FAILED", "native face response is missing its face list");
            var matches = faces.EnumerateArray().Where(item => ReadString(item, "persistentId") == pickId).ToArray();
            if (matches.Length != 1) throw new SessionException("AMBIGUOUS_REFERENCE", "selected face is not uniquely resolvable");
            var selected = matches[0];
            if (!selected.TryGetProperty("ambiguous", out var ambiguous) || ambiguous.ValueKind != JsonValueKind.False ||
                !selected.TryGetProperty("captureRevision", out var revision) || !revision.TryGetInt64(out var capturedRevision) ||
                capturedRevision != model.Revision ||
                (selected.TryGetProperty("featureId", out var owner) && owner.ValueKind != JsonValueKind.String) ||
                (selected.TryGetProperty("featureId", out owner) && owner.GetString() != featureId) ||
                !selected.TryGetProperty("sourceFace", out var source) || !ExactFaceReference(source, featureId, out var sourceFace) ||
                !ReadVector(selected, "centroidMm", out var centroid))
                throw new SessionException("NEED_FULL_SNAPSHOT", "selected face has no exact current native reference");
            var surface = ReadString(selected, "surfaceType");
            if (string.IsNullOrWhiteSpace(surface))
                throw new SessionException("CORE_FAILED", "native face surface type is missing");
            return new DirectFaceCapture { SourceFace = sourceFace, SurfaceType = surface, CentroidMm = centroid };
        }

        static bool ExactFaceReference(JsonElement source, string owner, out DirectFaceReference reference)
        {
            reference = null;
            if (source.ValueKind != JsonValueKind.Object || source.EnumerateObject().Count() != 3 ||
                ReadString(source, "type") != "face" || ReadString(source, "featureId") != owner) return false;
            var role = ReadString(source, "persistentFaceId");
            if (string.IsNullOrEmpty(owner) || string.IsNullOrWhiteSpace(role) || role.Length > 512 || role.Contains("|")) return false;
            if (role.Contains(":"))
            {
                var prefix = owner + ":";
                if (!role.StartsWith(prefix, StringComparison.Ordinal) || role.Length == prefix.Length ||
                    role.IndexOf(':', prefix.Length) >= 0) return false;
            }
            reference = new DirectFaceReference { FeatureId = owner, PersistentFaceId = role };
            return true;
        }

        static IDictionary<string, object?> BuildParameters(Operation operation, Slot source, Slot support,
            long revision, IReadOnlyList<double> move, double distance)
        {
            var parameters = new Dictionary<string, object?>
            {
                ["sourceFeatureId"] = source.FeatureId,
                ["sourceFace"] = source.SourceFace.ToParameters(),
                ["captureRevision"] = revision,
            };
            switch (operation)
            {
                case Operation.Move:
                    parameters["translationMm"] = new[] { move[0], move[1], move[2] };
                    parameters["rotationDeg"] = new[] { move[3], move[4], move[5] };
                    parameters["pivotMm"] = new[] { move[6], move[7], move[8] };
                    break;
                case Operation.Offset: parameters["distanceMm"] = distance;break;
                case Operation.Replace: parameters["replacementFace"] = support.SourceFace.ToParameters();break;
            }
            return parameters;
        }

        bool DirectFaceHistoryBusy() => Busy || Spatial?.Busy == true || Commands?.Busy == true || AssemblyMates?.Busy == true;
        static string CommandId(Operation operation) => operation switch
        {
            Operation.Move => "CreateMoveFace", Operation.Offset => "CreateOffsetFace",
            Operation.Delete => "CreateDeleteFace", _ => "CreateReplaceFace",
        };
        static bool IsDefinitiveRejection(Exception error) => error is SessionException session &&
            (session.Code == "CORE_FAILED" || session.Code == "BAD_PARAMS" || session.Code == "NOT_IMPLEMENTED" ||
             session.Code == "NOT_FOUND" || session.Code == "AMBIGUOUS_REFERENCE");
        static bool ReplyAccepted(JsonElement reply) => reply.ValueKind == JsonValueKind.Object &&
            reply.TryGetProperty("ok", out var ok) && ok.ValueKind == JsonValueKind.True;
        static bool ReplyExplicitlyRejected(JsonElement reply) => reply.ValueKind == JsonValueKind.Object &&
            reply.TryGetProperty("ok", out var ok) && ok.ValueKind == JsonValueKind.False;
        static bool ReplyMatches(JsonElement reply, SessionModelState model) =>
            ReadString(reply, "sessionId") == model.SessionId && ReadString(reply, "documentId") == model.DocumentId;
        static bool ReadRevision(JsonElement reply, out long revision)
        {
            revision = 0;
            return reply.TryGetProperty("revision", out var value) && value.TryGetInt64(out revision);
        }
        static bool ReadVector(JsonElement item, string key, out double[] vector)
        {
            vector = null;
            if (!item.TryGetProperty(key, out var value) || value.ValueKind != JsonValueKind.Array || value.GetArrayLength() != 3) return false;
            var items = value.EnumerateArray().ToArray();
            if (items.Any(number => number.ValueKind != JsonValueKind.Number || !number.TryGetDouble(out var d) || !Finite(d))) return false;
            vector = items.Select(number => number.GetDouble()).ToArray();return true;
        }
        static bool FeatureHealthy(JsonElement feature) =>
            (!feature.TryGetProperty("geometryCurrent", out var current) || current.ValueKind == JsonValueKind.True) &&
            (!feature.TryGetProperty("status", out var status) ||
             status.ValueKind == JsonValueKind.String && status.GetString() == "ok");
        static bool ReadNumber(JsonElement item, string key, out double value)
        {
            value = 0;
            return item.TryGetProperty(key, out var number) && number.ValueKind == JsonValueKind.Number &&
                number.TryGetDouble(out value) && Finite(value);
        }
        static string ReadString(JsonElement item, string key) => item.ValueKind == JsonValueKind.Object &&
            item.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
        static bool Finite(double value) => !double.IsNaN(value) && !double.IsInfinity(value);
        static bool IsCurrent(Func<bool> current) { try { return current != null && current(); } catch { return false; } }
        static void AssertCurrent(Func<bool> current)
        { if (!IsCurrent(current)) throw new SessionException("NEED_FULL_SNAPSHOT", "direct face selection changed before query"); }
        static void CancelSource(CancellationTokenSource source) { try { source?.Cancel(); } catch (ObjectDisposedException) { } }
        static string Short(string value, int limit) => string.IsNullOrEmpty(value) || value.Length <= limit
            ? value : value.Substring(0, limit - 1) + "…";

        sealed class DirectFaceCapture
        {
            public DirectFaceReference SourceFace;
            public string SurfaceType;
            public double[] CentroidMm;
        }
    }
}
