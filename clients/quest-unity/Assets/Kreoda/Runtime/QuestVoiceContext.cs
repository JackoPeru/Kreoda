using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using Kreoda.QuestFoundation;
using Kreoda.Session;
using UnityEngine;

namespace Kreoda.QuestRuntime
{
    public sealed class QuestVoiceContext : MonoBehaviour
    {
        internal const int MaxSelections = 64;

        internal readonly struct VoiceFence
        {
            readonly QuestConnection _connection;
            readonly SessionClient _client;
            readonly SessionModelState _model;
            readonly long _generation;
            readonly string _sessionId, _documentId;
            readonly long _revision;

            internal VoiceFence(QuestConnection connection, SessionClient client, SessionModelState model,
                long generation, string sessionId, string documentId, long revision)
            {
                _connection = connection;_client = client;_model = model;_generation = generation;
                _sessionId = sessionId;_documentId = documentId;_revision = revision;
            }

            internal bool IsValid => _connection != null && _client != null && _model != null &&
                !string.IsNullOrWhiteSpace(_sessionId) && !string.IsNullOrWhiteSpace(_documentId) && _revision >= 0;

            internal bool SameAs(VoiceFence other) => ReferenceEquals(_connection, other._connection) &&
                ReferenceEquals(_client, other._client) && ReferenceEquals(_model, other._model) &&
                _generation == other._generation && _revision == other._revision &&
                string.Equals(_sessionId, other._sessionId, StringComparison.Ordinal) &&
                string.Equals(_documentId, other._documentId, StringComparison.Ordinal);

            internal static VoiceFence Capture(QuestConnection connection)
            {
                if (connection == null || !connection.Connected) return default;
                var client = connection.Client;
                var model = client?.Model;
                return model == null || string.IsNullOrWhiteSpace(model.SessionId) ||
                    string.IsNullOrWhiteSpace(model.DocumentId) || model.Revision < 0 ? default :
                    new VoiceFence(connection, client, model, connection.ConnectionGeneration,
                        model.SessionId, model.DocumentId, model.Revision);
            }

            internal bool IsCurrent(QuestConnection connection)
            {
                if (!IsValid || !ReferenceEquals(connection, _connection) || !connection.Connected ||
                    !ReferenceEquals(connection.Client, _client) || connection.ConnectionGeneration != _generation)
                    return false;
                var model = _client.Model;
                return ReferenceEquals(model, _model) && model != null &&
                    model.SessionId == _sessionId && model.DocumentId == _documentId && model.Revision == _revision;
            }
        }

        internal sealed class VoiceSnapshot
        {
            readonly string[] _selectionIds;
            readonly object[] _sources;
            readonly int[] _uploads;
            readonly VoiceFence _fence;

            internal string ContextJson { get; }
            internal bool Explicit { get; }
            internal long ContextVersion { get; }
            internal string[] SelectionIds => (string[])_selectionIds.Clone();

            internal VoiceSnapshot(VoiceFence fence, string[] selectionIds, string contextJson, bool explicitContext,
                long contextVersion, object[] sources, int[] uploads)
            {
                _fence = fence;
                _selectionIds = selectionIds != null ? (string[])selectionIds.Clone() : Array.Empty<string>();
                ContextJson = contextJson;Explicit = explicitContext;ContextVersion = contextVersion;
                _sources = sources != null ? (object[])sources.Clone() : Array.Empty<object>();
                _uploads = uploads != null ? (int[])uploads.Clone() : Array.Empty<int>();
            }

            internal bool Matches(VoiceSnapshot other)
            {
                if (other == null || !_fence.SameAs(other._fence) || Explicit != other.Explicit ||
                    ContextVersion != other.ContextVersion ||
                    !string.Equals(ContextJson, other.ContextJson, StringComparison.Ordinal) ||
                    !_selectionIds.SequenceEqual(other._selectionIds, StringComparer.Ordinal) ||
                    _sources.Length != other._sources.Length || _uploads.Length != other._uploads.Length)
                    return false;
                for (var i = 0; i < _sources.Length; i++)
                    if (!ReferenceEquals(_sources[i], other._sources[i])) return false;
                return _uploads.SequenceEqual(other._uploads);
            }

            internal object SelectionContextValue()
            {
                if (ContextJson == null) return null;
                using var document = JsonDocument.Parse(ContextJson);
                return document.RootElement.Clone();
            }
        }

        sealed class Selection
        {
            public string Id;
            public Dictionary<string, object> Semantic;
            public object Source;
            public int UploadVersion;
            public Func<bool> IsCurrent;
        }

        sealed class ReferencePoint
        {
            public double[] PositionMm;
            public Vector3 WorldPosition;
            public Matrix4x4 FrameMatrix;
        }

        readonly List<Selection> _selections = new List<Selection>();
        VoiceFence? _fence;
        ReferencePoint _point;
        bool _explicitMode, _pointArmed, _awaitRelease;
        int _armSource;
        long _version;

        public bool ExplicitMode => _explicitMode;
        public bool PointArmed => _pointArmed;
        public bool HasPoint => _point != null;
        public int Count => _selections.Count;
        public long Version => _version;
        public string Status { get; private set; } = "Voce singola";
        public Vector3 PointWorldPosition => _point != null ? _point.WorldPosition : default;

        internal void Report(string status) { Status = status ?? ""; }

        internal static VoiceFence CaptureFence(QuestConnection connection) => VoiceFence.Capture(connection);

        internal void EnterExplicit(VoiceFence fence)
        {
            if (_explicitMode) return;
            _explicitMode = true;_selections.Clear();_point = null;CancelPointArm();_fence = null;_version++;
            if (fence.IsValid) Bind(fence);
            Status = fence.IsValid ? "Raccolta esplicita attiva" : "Collega il modello per raccogliere contesto";
        }

        internal void DisableExplicit()
        {
            _explicitMode = false;_selections.Clear();_point = null;CancelPointArm();_fence = null;_version++;
            Status = "Modalità voce singola";
        }

        internal bool ToggleSelection(VoiceFence fence, string id, Dictionary<string, object> semantic,
            object source, int uploadVersion, Func<bool> isCurrent)
        {
            if (!_explicitMode || !EnsureFence(fence)) return false;
            if (!SourcesCurrent()) { Invalidate("Riferimento non corrente · raccolta azzerata");return false; }
            if (string.IsNullOrWhiteSpace(id) || semantic == null || source == null || isCurrent == null ||
                !semantic.TryGetValue("persistentId", out var semanticId) ||
                !string.Equals(id, semanticId as string, StringComparison.Ordinal) || !isCurrent())
            { Status = "Riferimento CAD non corrente";return false; }

            var existing = _selections.FindIndex(item => item.Id == id);
            if (existing >= 0)
            {
                _selections.RemoveAt(existing);_version++;
                Status = "Riferimento rimosso";return true;
            }
            if (_selections.Count >= MaxSelections)
            { Status = "Limite contesto raggiunto (64)";return false; }

            var copy = new Dictionary<string, object>(semantic, StringComparer.Ordinal);
            _selections.Add(new Selection { Id = id, Semantic = copy, Source = source,
                UploadVersion = uploadVersion, IsCurrent = isCurrent });
            _version++;Status = "Riferimento aggiunto";return true;
        }

        internal void ClearCollection()
        {
            _selections.Clear();_point = null;CancelPointArm();_version++;
            Status = "Contesto cancellato · raccolta esplicita attiva";
        }

        internal bool ArmPoint(VoiceFence fence, int pointerSource)
        {
            if (_pointArmed) { CancelPointArm();Status = "Acquisizione punto annullata";return true; }
            if (!_explicitMode || pointerSource < 1 || pointerSource > 2 ||
                !EnsureFence(fence))
            { Status = "Per il punto usa una mano tracciata e un modello corrente";return false; }
            if (!SourcesCurrent()) { Invalidate("Riferimento non corrente · raccolta azzerata");return false; }
            _pointArmed = true;_awaitRelease = true;_armSource = pointerSource;
            Status = "Punto armato · rilascia e pizzica di nuovo";return true;
        }

        internal bool ObservePointGesture(VoiceFence fence, int pointerSource, bool tracked, bool pressed,
            bool clicked, bool allowed, Vector3 pointerOrigin, Transform displayRoot)
        {
            if (!_pointArmed) return false;
            if (!tracked || pointerSource != _armSource || pointerSource < 1 || pointerSource > 2)
            { CancelPointArm();Status = "Acquisizione punto annullata · tracking o mano cambiati";return false; }
            if (!EnsureFence(fence)) { CancelPointArm();return false; }
            if (!SourcesCurrent()) { Invalidate("Riferimento non corrente · raccolta azzerata");return false; }
            if (_awaitRelease)
            {
                if (!pressed) _awaitRelease = false;
                return false;
            }
            if (!clicked) return false;
            if (!allowed)
            { CancelPointArm();Status = "Acquisizione punto annullata · gesto UI o CAD";return false; }
            try
            {
                var matrix = displayRoot != null ? displayRoot.localToWorldMatrix :
                    throw new ArgumentNullException(nameof(displayRoot));
                var frame = QuestSpatialEdit.CaptureFrame(displayRoot);
                var position = ToCadPoint(frame, pointerOrigin);
                _point = new ReferencePoint { PositionMm = position, WorldPosition = pointerOrigin, FrameMatrix = matrix };
                CancelPointArm();_version++;Status = "Punto MR catturato in CAD mm";return true;
            }
            catch (Exception)
            { CancelPointArm();Status = "Punto MR non valido · controlla scala e tracciamento";return false; }
        }

        internal void PointerSourceChanged(int source)
        {
            if (_pointArmed && source != _armSource)
            { CancelPointArm();Status = "Acquisizione punto annullata · puntatore cambiato"; }
        }

        internal void CancelPointArm()
        { _pointArmed = _awaitRelease = false;_armSource = 0; }

        internal bool Refresh(VoiceFence fence, Transform displayRoot)
        {
            if (!_explicitMode) return true;
            if (!EnsureFence(fence)) return false;
            if (!SourcesCurrent())
            { Invalidate("Riferimento non corrente · raccolta azzerata");return false; }
            if (_point != null)
            {
                if (displayRoot == null || !_point.FrameMatrix.Equals(displayRoot.localToWorldMatrix))
                { _point = null;_version++;Status = "Punto invalidato · frame MR cambiato"; }
            }
            return true;
        }

        internal string[] SelectionIds() => _selections.Select(item => item.Id).ToArray();

        internal Dictionary<string, object> SemanticContext()
        {
            if (!_explicitMode) return null;
            var selections = _selections.Select(item =>
                new Dictionary<string, object>(item.Semantic, StringComparer.Ordinal)).ToList();
            var result = new Dictionary<string, object> { ["version"] = 2, ["selections"] = selections };
            if (_point != null) result["referencePoint"] = PointPayload(_point.PositionMm);
            return result;
        }

        internal bool TryCaptureSnapshot(VoiceFence fence, Transform displayRoot,
            out VoiceSnapshot snapshot, out string error)
        {
            snapshot = null;error = null;
            if (!_explicitMode) { error = "Raccolta esplicita non attiva";return false; }
            if (_pointArmed) { error = "Completa o annulla l'acquisizione del punto";return false; }
            if (!Refresh(fence, displayRoot) || !_fence.HasValue)
            { error = Status;return false; }
            if (_selections.Count == 0 && _point == null)
            { error = "Aggiungi un riferimento o cattura un punto MR";return false; }
            var selections = _selections.Select(item =>
                new Dictionary<string, object>(item.Semantic, StringComparer.Ordinal)).ToList();
            var json = SerializeVersionTwo(selections, _point != null ? _point.PositionMm : null);
            snapshot = new VoiceSnapshot(_fence.Value, SelectionIds(), json, true, _version,
                _selections.Select(item => item.Source).ToArray(), _selections.Select(item => item.UploadVersion).ToArray());
            return true;
        }

        public string Summary
        {
            get
            {
                if (!_explicitMode) return "Voce singola · selezione CAD corrente";
                var lines = new List<string> { "Raccolta · " + _selections.Count.ToString(CultureInfo.InvariantCulture) + "/64" };
                foreach (var item in _selections.Take(4))
                {
                    var kind = item.Semantic.TryGetValue("kind", out var value) ? value as string : "riferimento";
                    lines.Add(kind + " · " + ShortId(item.Id));
                }
                if (_selections.Count > 4) lines.Add("+" + (_selections.Count - 4).ToString(CultureInfo.InvariantCulture) + " altri");
                if (_point != null) lines.Add("Punto MR CAD · " + string.Join(", ", _point.PositionMm.Select(v => v.ToString("0.###", CultureInfo.InvariantCulture))) + " mm");
                else if (_pointArmed) lines.Add("Punto armato · rilascia e pizzica");
                return string.Join("\n", lines);
            }
        }

        internal static double[] ToCadPoint(CadDisplayFrame frame, Vector3 worldPoint)
        {
            if (frame == null || float.IsNaN(worldPoint.x) || float.IsInfinity(worldPoint.x) ||
                float.IsNaN(worldPoint.y) || float.IsInfinity(worldPoint.y) ||
                float.IsNaN(worldPoint.z) || float.IsInfinity(worldPoint.z))
                throw new ArgumentException("point must be finite", nameof(worldPoint));
            var cad = frame.ToCad(new CadVector(worldPoint.x, worldPoint.y, worldPoint.z));
            if (!cad.IsFinite) throw new ArgumentException("CAD point must be finite", nameof(worldPoint));
            return new[] { cad.X, cad.Y, cad.Z };
        }

        internal static string SerializeVersionTwo(IReadOnlyList<Dictionary<string, object>> selections, double[] pointMm)
        {
            if (selections == null || selections.Count > MaxSelections) throw new ArgumentException("Invalid selection count");
            var ids = selections.Select(SelectionId).ToArray();
            if (ids.Any(string.IsNullOrWhiteSpace) || ids.Distinct(StringComparer.Ordinal).Count() != ids.Length)
                throw new ArgumentException("Selection ids must be unique and nonempty");
            if (pointMm != null && (pointMm.Length != 3 || pointMm.Any(value => double.IsNaN(value) || double.IsInfinity(value))))
                throw new ArgumentException("CAD point must be a finite 3D position");
            if (ids.Length == 0 && pointMm == null) throw new ArgumentException("Context needs a selection or point");
            var payload = new Dictionary<string, object> { ["version"] = 2, ["selections"] = selections };
            if (pointMm != null) payload["referencePoint"] = PointPayload(pointMm);
            return JsonSerializer.Serialize(payload);
        }

        static Dictionary<string, object> PointPayload(double[] positionMm) => new Dictionary<string, object>
        {
            ["positionMm"] = (double[])positionMm.Clone(), ["coordinateSystem"] = "cad", ["source"] = "quest-mr"
        };

        static string SelectionId(Dictionary<string, object> item) =>
            item != null && item.TryGetValue("persistentId", out var id) ? id as string : null;

        bool EnsureFence(VoiceFence fence)
        {
            if (!_explicitMode) return false;
            if (_fence.HasValue)
            {
                if (_fence.Value.SameAs(fence)) return true;
                Invalidate("Modello cambiato · raccolta azzerata");return false;
            }
            if (!fence.IsValid)
            { Status = "Collega il modello per raccogliere contesto";return false; }
            Bind(fence);return true;
        }

        bool SourcesCurrent() => _selections.All(item => item.IsCurrent != null && item.IsCurrent());

        void Bind(VoiceFence fence)
        { _fence = fence;_version++; }

        void Invalidate(string message)
        {
            _selections.Clear();_point = null;CancelPointArm();_fence = null;_version++;Status = message;
        }

        static string ShortId(string id)
        {
            if (string.IsNullOrEmpty(id)) return "—";
            var tail = id.LastIndexOf(':');
            if (tail >= 0 && tail < id.Length - 1) id = id.Substring(tail + 1);
            return id.Length <= 28 ? id : "…" + id.Substring(id.Length - 27);
        }
    }
}
