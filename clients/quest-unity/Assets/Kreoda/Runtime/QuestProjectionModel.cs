using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Text;
using System.Text.Json.Serialization;
using Kreoda.Session;
using Kreoda.Session.Generated;

namespace Kreoda.QuestRuntime
{
    internal enum QuestProjectionOperation { ProjectEdges, Silhouette, Section }

    internal sealed class QuestProjectionModel
    {
        internal sealed class Fence : IEquatable<Fence>
        {
            public readonly string SessionId, DocumentId;
            public readonly long Revision, ConnectionGeneration;
            public Fence(string sessionId, string documentId, long revision, long connectionGeneration)
            { SessionId = sessionId; DocumentId = documentId; Revision = revision; ConnectionGeneration = connectionGeneration; }
            public bool Equals(Fence other) => other != null && SessionId == other.SessionId && DocumentId == other.DocumentId &&
                Revision == other.Revision && ConnectionGeneration == other.ConnectionGeneration;
        }

        internal sealed class Group
        {
            public string Id, Status, Error;
            public string[] BlockingSourceIds;
            public long? Generation;
            public JsonElement Definition;
            public bool HasDefinition;
        }

        internal sealed class Target
        {
            public string FeatureId;
            public Group[] Groups;
        }

        internal sealed class Source
        {
            public int Token;
            public string Type, FeatureId, PersistentEdgeId;
            public string[] EntityIds;
            public Fence Fence;
        }

        internal sealed class AuthoredCurve
        {
            public string Id, Kind;
        }

        sealed class AuthoredSketch
        {
            public string FeatureId, Status;
            public bool GeometryCurrent;
            public string[] BlockingSourceIds;
            public JsonElement Model;
            public AuthoredCurve[] Curves;
        }

        internal sealed class SourceCandidate
        {
            public Fence Fence;
            public string TargetFeatureId, OwnerFeatureId, PersistentEdgeId;
            public int UploadVersion, ExpectedUploadVersion;
            public int SelectionMode, CurrentSelectionMode;
            public bool ViewCurrent, IsDatum, IsInstance, InstanceResolved, HasHit, HasEdgeHit, ReferenceAmbiguous;
        }

        internal sealed class QueryToken
        {
            internal long Id;
            internal Fence Fence;
            internal string FeatureId;
        }

        sealed class DefinitionDto
        {
            [JsonPropertyName("version")] public int Version { get; set; }
            [JsonPropertyName("operation")] public string Operation { get; set; }
            [JsonPropertyName("sources")] public DefinitionSourceDto[] Sources { get; set; }
        }

        sealed class DefinitionSourceDto
        {
            [JsonPropertyName("type")] public string Type { get; set; }
            [JsonPropertyName("featureId")] public string FeatureId { get; set; }
            [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
            [JsonPropertyName("persistentEdgeId")] public string PersistentEdgeId { get; set; }
            [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
            [JsonPropertyName("entityIds")] public string[] EntityIds { get; set; }
        }

        readonly List<Target> _targets = new List<Target>();
        readonly List<Source> _sources = new List<Source>();
        readonly List<AuthoredSketch> _authoredSketches = new List<AuthoredSketch>();
        readonly List<string> _pendingAuthoredEntityIds = new List<string>();
        int _targetIndex = -1, _groupIndex = -1, _nextSourceToken;
        int _authoredEntityIndex = -1;
        string _authoredSketchFeatureId;
        long _requestId;
        long _bindingVersion;
        string _preferredGroupId;
        SketchProjectionResult _latest;
        Fence _latestFence;
        string _latestFeatureId;

        public Fence Lineage { get; private set; }
        public long BindingVersion => _bindingVersion;
        public QuestProjectionOperation Operation { get; private set; }
        public string Status { get; private set; } = "Collega un PC con sketch corrente";
        public IReadOnlyList<Target> Targets => _targets;
        public IReadOnlyList<Source> Sources => _sources;
        public int AuthoredSketchSourceCount => AvailableAuthoredSketches().Length;
        public string SelectedAuthoredSketchFeatureId => ActiveAuthoredSketch()?.FeatureId;
        public int AuthoredCurveCount => ActiveAuthoredSketch()?.Curves.Length ?? 0;
        public string SelectedAuthoredEntityId => ActiveAuthoredCurve()?.Id;
        public string SelectedAuthoredEntityLabel
        {
            get
            {
                var curve = ActiveAuthoredCurve();
                if (curve == null) return "Nessuna curva authored";
                var kind = curve.Kind == "line" ? "Linea" : curve.Kind == "circle" ? "Cerchio" : "Arco";
                return kind + " · " + curve.Id;
            }
        }
        public int PendingAuthoredEntityCount => _pendingAuthoredEntityIds.Count;
        public bool SelectedAuthoredEntityPending => !string.IsNullOrEmpty(SelectedAuthoredEntityId) &&
            _pendingAuthoredEntityIds.Contains(SelectedAuthoredEntityId, StringComparer.Ordinal);
        public Target SelectedTarget => _targetIndex >= 0 && _targetIndex < _targets.Count ? _targets[_targetIndex] : null;
        public Group SelectedGroup => SelectedTarget != null && _groupIndex >= 0 && _groupIndex < SelectedTarget.Groups.Length
            ? SelectedTarget.Groups[_groupIndex] : null;
        public string OperationName => OperationText(Operation);
        public bool HasCurrentModel => Lineage != null && SelectedTarget != null;

        public bool Bind(SessionModelState model, long connectionGeneration)
        {
            if (model == null || string.IsNullOrEmpty(model.SessionId) || string.IsNullOrEmpty(model.DocumentId) ||
                model.Revision < 0 || connectionGeneration < 0)
            {
                ClearModel("Modello CAD non disponibile");
                return false;
            }

            Target[] next;
            AuthoredSketch[] nextAuthored;
            try { next = ReadTargets(model.Sketches); nextAuthored = ReadAuthoredSketches(model.Sketches); }
            catch (Exception error) when (error is JsonException || error is InvalidOperationException || error is KeyNotFoundException)
            {
                ClearModel("Modello sketch non valido");
                return false;
            }

            var nextFence = new Fence(model.SessionId, model.DocumentId, model.Revision, connectionGeneration);
            var lineageChanged = !nextFence.Equals(Lineage);
            var oldTargetId = SelectedTarget?.FeatureId;
            var oldGroupId = SelectedGroup?.Id;
            var sourceModelChanged = !AuthoredSketchesEqual(_authoredSketches, nextAuthored);
            var modelChanged = !TargetsEqual(_targets, next) || sourceModelChanged;
            if (lineageChanged)
            {
                _sources.Clear();
                Status = "Selezioni azzerate · documento o versione cambiati";
            }
            if (lineageChanged || modelChanged)
            {
                InvalidateQuery();
                _bindingVersion++;
            }
            _targets.Clear();
            _targets.AddRange(next);
            _authoredSketches.Clear();
            _authoredSketches.AddRange(nextAuthored);
            Lineage = nextFence;
            _targetIndex = FindTarget(oldTargetId);
            if (_targetIndex < 0 && _targets.Count > 0) _targetIndex = 0;
            _groupIndex = FindGroup(SelectedTarget, _preferredGroupId ?? oldGroupId);
            if (_groupIndex < 0 && SelectedTarget != null && SelectedTarget.Groups.Length > 0) _groupIndex = 0;
            if (_preferredGroupId != null && _groupIndex >= 0 && SelectedGroup.Id == _preferredGroupId)
                _preferredGroupId = null;
            if (lineageChanged || modelChanged)
            {
                ClearPendingAuthoredSelection(resetSource: true);
                if (sourceModelChanged && _sources.RemoveAll(source => source.Type == "sketchEntities") > 0)
                    Status = "Sketch sorgente cambiato · acquisisci di nuovo";
            }
            if (SelectedTarget == null) Status = "Nessuno sketch nel documento corrente";
            else if (!lineageChanged && !modelChanged && string.IsNullOrEmpty(_latestFeatureId))
                Status = "Sketch corrente · aggiorna per leggere le proiezioni";
            return true;
        }

        public bool SelectTarget(string featureId)
        {
            var index = FindTarget(featureId);
            return index >= 0 && SelectTargetIndex(index);
        }

        public bool CycleTarget(int step)
        {
            if (_targets.Count == 0 || step == 0) return false;
            var next = (_targetIndex + Math.Sign(step) + _targets.Count) % _targets.Count;
            return SelectTargetIndex(next);
        }

        bool SelectTargetIndex(int index)
        {
            if (index < 0 || index >= _targets.Count || index == _targetIndex) return false;
            _targetIndex = index;
            _groupIndex = SelectedTarget.Groups.Length > 0 ? 0 : -1;
            _sources.Clear();
            ClearPendingAuthoredSelection(resetSource: true);
            InvalidateQuery();
            Status = "Sketch selezionato · aggiorna per leggere le proiezioni";
            return true;
        }

        public bool CycleGroup(int step)
        {
            var groups = SelectedTarget?.Groups;
            if (groups == null || groups.Length == 0 || step == 0) return false;
            var next = (_groupIndex + Math.Sign(step) + groups.Length) % groups.Length;
            if (next == _groupIndex) return false;
            _groupIndex = next;
            Status = GroupStatus(SelectedGroup);
            return true;
        }

        public void PreferGroup(string groupId) => _preferredGroupId = groupId;

        public bool CycleOperation()
        {
            Operation = (QuestProjectionOperation)(((int)Operation + 1) % 3);
            _sources.Clear();
            ClearPendingAuthoredSelection(resetSource: true);
            Status = OperationName + " · acquisisci una sorgente corrente";
            return true;
        }

        public void ClearSources()
        {
            _sources.Clear();
            ClearPendingAuthoredSelection(resetSource: false);
            Status = "Sorgenti acquisite cancellate";
        }

        public bool BeginAuthoredSourceSelection(Fence fence, string targetFeatureId, out string error)
        {
            if (!AuthoredSelectionContextCurrent(fence, targetFeatureId, out error)) return false;
            if (Operation != QuestProjectionOperation.ProjectEdges)
                return Reject("Le curve sketch authored sono disponibili solo per projectEdges", out error);
            var available = AvailableAuthoredSketches();
            if (available.Length == 0)
            {
                ClearPendingAuthoredSelection(resetSource: true);
                return Reject("Nessuno sketch sorgente corrente con linee, cerchi o archi", out error);
            }
            if (!available.Any(sketch => sketch.FeatureId == _authoredSketchFeatureId))
            {
                _authoredSketchFeatureId = available[0].FeatureId;
                _authoredEntityIndex = 0;
                _pendingAuthoredEntityIds.Clear();
            }
            Status = "Sketch sorgente " + _authoredSketchFeatureId + " · seleziona curve authored";
            return true;
        }

        public bool CycleAuthoredSource(int step, Fence fence, string targetFeatureId, out string error)
        {
            if (!AuthoredSelectionContextCurrent(fence, targetFeatureId, out error)) return false;
            if (Operation != QuestProjectionOperation.ProjectEdges)
                return Reject("Le curve sketch authored sono disponibili solo per projectEdges", out error);
            if (_pendingAuthoredEntityIds.Count > 0)
                return Reject("Aggiungi o azzera la scelta prima di cambiare sketch", out error);
            if (step == 0) return Reject("Scegli uno sketch sorgente", out error);
            var available = AvailableAuthoredSketches();
            if (available.Length == 0) return Reject("Nessuno sketch sorgente corrente con curve authored", out error);
            var current = Array.FindIndex(available, sketch => sketch.FeatureId == _authoredSketchFeatureId);
            var direction = Math.Sign(step);
            var next = current < 0 ? (direction > 0 ? 0 : available.Length - 1) :
                (current + direction + available.Length) % available.Length;
            _authoredSketchFeatureId = available[next].FeatureId;
            _authoredEntityIndex = 0;
            Status = "Sketch sorgente " + _authoredSketchFeatureId;
            error = "";
            return true;
        }

        public bool CycleAuthoredEntity(int step, Fence fence, string targetFeatureId, out string error)
        {
            if (!AuthoredSelectionContextCurrent(fence, targetFeatureId, out error)) return false;
            if (Operation != QuestProjectionOperation.ProjectEdges)
                return Reject("Le curve sketch authored sono disponibili solo per projectEdges", out error);
            var sketch = ActiveAuthoredSketch();
            if (sketch == null || sketch.Curves.Length == 0 || step == 0)
                return Reject("Nessuna curva authored corrente", out error);
            _authoredEntityIndex = (_authoredEntityIndex + Math.Sign(step) + sketch.Curves.Length) % sketch.Curves.Length;
            Status = SelectedAuthoredEntityLabel;
            error = "";
            return true;
        }

        public bool ToggleAuthoredEntity(Fence fence, string targetFeatureId, out string error)
        {
            if (!AuthoredSelectionContextCurrent(fence, targetFeatureId, out error)) return false;
            if (Operation != QuestProjectionOperation.ProjectEdges)
                return Reject("Le curve sketch authored sono disponibili solo per projectEdges", out error);
            var id = SelectedAuthoredEntityId;
            if (string.IsNullOrEmpty(id)) return Reject("Nessuna curva authored corrente", out error);
            var selected = _pendingAuthoredEntityIds.FindIndex(value => value == id);
            if (selected >= 0)
            {
                _pendingAuthoredEntityIds.RemoveAt(selected);
                Status = "Esclusa " + SelectedAuthoredEntityLabel;
                error = "";
                return true;
            }
            if (_pendingAuthoredEntityIds.Count >= 128)
                return Reject("Limite nativo di 128 entityIds per sketch · scegli un subset", out error);
            _pendingAuthoredEntityIds.Add(id);
            Status = "Selezionata " + SelectedAuthoredEntityLabel;
            error = "";
            return true;
        }

        public bool SelectAllAuthoredEntities(Fence fence, string targetFeatureId, out string error)
        {
            if (!AuthoredSelectionContextCurrent(fence, targetFeatureId, out error)) return false;
            if (Operation != QuestProjectionOperation.ProjectEdges)
                return Reject("Le curve sketch authored sono disponibili solo per projectEdges", out error);
            var sketch = ActiveAuthoredSketch();
            if (sketch == null) return Reject("Nessuno sketch sorgente corrente", out error);
            if (sketch.Curves.Length > 128)
                return Reject("Sketch con " + sketch.Curves.Length.ToString(System.Globalization.CultureInfo.InvariantCulture) +
                    " curve · tutte superano il limite nativo di 128 entityIds · scegli un subset", out error);
            _pendingAuthoredEntityIds.Clear();
            _pendingAuthoredEntityIds.AddRange(sketch.Curves.Select(curve => curve.Id));
            Status = "Selezionate tutte le curve · " + _pendingAuthoredEntityIds.Count.ToString(System.Globalization.CultureInfo.InvariantCulture);
            error = "";
            return true;
        }

        public bool ClearPendingAuthoredEntities(Fence fence, string targetFeatureId, out string error)
        {
            if (!AuthoredSelectionContextCurrent(fence, targetFeatureId, out error)) return false;
            _pendingAuthoredEntityIds.Clear();
            Status = "Scelta authored azzerata";
            error = "";
            return true;
        }

        public bool AddAuthoredSource(Fence fence, string targetFeatureId, out string error)
        {
            if (!AuthoredSelectionContextCurrent(fence, targetFeatureId, out error)) return false;
            if (Operation != QuestProjectionOperation.ProjectEdges)
                return Reject("Le curve sketch authored sono disponibili solo per projectEdges", out error);
            var sketch = ActiveAuthoredSketch();
            if (sketch == null || _pendingAuthoredEntityIds.Count == 0)
                return Reject("Seleziona almeno una linea, un cerchio o un arco", out error);

            var currentIds = new HashSet<string>(sketch.Curves.Select(curve => curve.Id), StringComparer.Ordinal);
            if (_pendingAuthoredEntityIds.Count > 128 || _pendingAuthoredEntityIds.Any(id => !BoundedAuthoredEntityId(id) || !currentIds.Contains(id)))
                return Reject("Modello sketch cambiato · seleziona di nuovo le curve", out error);

            var existing = _sources.FindIndex(source => source.Type == "sketchEntities" && source.FeatureId == sketch.FeatureId);
            var prior = existing >= 0 ? _sources[existing] : null;
            var merged = (prior?.EntityIds ?? Array.Empty<string>()).Concat(_pendingAuthoredEntityIds)
                .Distinct(StringComparer.Ordinal).ToArray();
            if (merged.Length > 128)
                return Reject("Limite nativo di 128 entityIds per sketch · nessun ID aggiunto", out error);
            if (prior != null && merged.Length == (prior.EntityIds?.Length ?? 0))
                return Reject("Curve già acquisite per questo sketch", out error);
            if (prior == null && _sources.Count >= 128)
                return Reject("Limite di 128 sorgenti raggiunto", out error);

            var candidate = new Source
            {
                Token = prior?.Token ?? (_nextSourceToken + 1), Type = "sketchEntities", FeatureId = sketch.FeatureId,
                EntityIds = merged, Fence = Lineage
            };
            var candidateSources = _sources.ToList();
            if (existing >= 0) candidateSources[existing] = candidate;
            else candidateSources.Add(candidate);
            var json = SerializeDefinition(candidateSources, Operation);
            if (Encoding.UTF8.GetByteCount(json) > 65536)
                return Reject("Definizione oltre il limite di 65536 byte · nessun ID aggiunto", out error);

            _sources.Clear();
            _sources.AddRange(candidateSources);
            if (prior == null) _nextSourceToken++;
            var added = merged.Length - (prior?.EntityIds?.Length ?? 0);
            _pendingAuthoredEntityIds.Clear();
            Status = "Acquisite " + added.ToString(System.Globalization.CultureInfo.InvariantCulture) +
                " curve da " + sketch.FeatureId;
            error = "";
            return true;
        }

        public bool IsCurrentAuthoredSource(Source source)
        {
            if (source == null || source.Type != "sketchEntities" || source.EntityIds == null ||
                source.EntityIds.Length == 0 || source.EntityIds.Length > 128 || Lineage == null || !Lineage.Equals(source.Fence)) return false;
            var sketch = _authoredSketches.SingleOrDefault(item => item.FeatureId == source.FeatureId);
            if (sketch == null || source.FeatureId == SelectedTarget?.FeatureId) return false;
            var current = new HashSet<string>(sketch.Curves.Select(curve => curve.Id), StringComparer.Ordinal);
            return source.EntityIds.All(id => BoundedAuthoredEntityId(id) && current.Contains(id)) &&
                source.EntityIds.Distinct(StringComparer.Ordinal).Count() == source.EntityIds.Length;
        }

        public bool TryCapture(SourceCandidate candidate, out string error)
        {
            error = "";
            var target = SelectedTarget;
            if (candidate == null || Lineage == null || target == null || !candidate.ViewCurrent)
                return Reject("Selezione CAD non corrente", out error);
            if (!Lineage.Equals(candidate.Fence) || candidate.TargetFeatureId != target.FeatureId)
                return Reject("Sessione, sketch o revisione cambiati", out error);
            if (candidate.SelectionMode < 0 || candidate.SelectionMode != candidate.CurrentSelectionMode)
                return Reject("Modalità di selezione cambiata · seleziona di nuovo", out error);
            if (candidate.UploadVersion < 0 || candidate.UploadVersion != candidate.ExpectedUploadVersion)
                return Reject("Mesh aggiornata · seleziona di nuovo", out error);
            if (candidate.IsDatum || (candidate.IsInstance && !candidate.InstanceResolved) ||
                string.IsNullOrWhiteSpace(candidate.OwnerFeatureId) || candidate.OwnerFeatureId == target.FeatureId ||
                !StableFeatureId(candidate.OwnerFeatureId))
                return Reject("Sorgente non valida per questo sketch", out error);

            if (Operation == QuestProjectionOperation.ProjectEdges)
            {
                if (candidate.SelectionMode != 2 || !candidate.HasEdgeHit || candidate.ReferenceAmbiguous ||
                    string.IsNullOrWhiteSpace(candidate.PersistentEdgeId) ||
                    !candidate.PersistentEdgeId.StartsWith(candidate.OwnerFeatureId + ":", StringComparison.Ordinal))
                    return Reject(candidate.ReferenceAmbiguous ? "Bordo ambiguo · selezione rifiutata" : "Acquisisci un bordo persistente corrente", out error);
                if (candidate.PersistentEdgeId.Length > 512 || Encoding.UTF8.GetByteCount(candidate.PersistentEdgeId) > 512)
                    return Reject("ID bordo oltre il limite di 512 caratteri/byte", out error);
                if (_sources.Any(source => source.Type == "edge" && source.FeatureId == candidate.OwnerFeatureId &&
                    source.PersistentEdgeId == candidate.PersistentEdgeId))
                    return Reject("Bordo già acquisito", out error);
                if (_sources.Count >= 128) return Reject("Limite di 128 sorgenti raggiunto", out error);
                _sources.Add(new Source { Token = ++_nextSourceToken, Type = "edge", FeatureId = candidate.OwnerFeatureId,
                    PersistentEdgeId = candidate.PersistentEdgeId, Fence = candidate.Fence });
            }
            else
            {
                if (candidate.SelectionMode != 0 || candidate.HasHit || candidate.HasEdgeHit ||
                    !string.IsNullOrEmpty(candidate.PersistentEdgeId) || candidate.ReferenceAmbiguous)
                    return Reject("Seleziona un proprietario geometrico intero", out error);
                _sources.Clear();
                _sources.Add(new Source { Token = ++_nextSourceToken, Type = "shape", FeatureId = candidate.OwnerFeatureId,
                    Fence = candidate.Fence });
            }
            var captured = _sources[_sources.Count - 1];
            Status = "Acquisito " + (captured.Type == "edge" ? captured.PersistentEdgeId : captured.FeatureId) +
                " · " + _sources.Count.ToString(System.Globalization.CultureInfo.InvariantCulture) + " sorgente/i";
            return true;
        }

        public bool TryBuildDefinition(out JsonElement definition, out string error)
        {
            definition = default;
            error = "";
            var target = SelectedTarget;
            if (Lineage == null || target == null) return Reject("Sketch non corrente", out error);
            if (_sources.Count == 0 || _sources.Any(source => !Lineage.Equals(source.Fence) || source.FeatureId == target.FeatureId))
                return Reject("Acquisisci sorgenti correnti prima dell'operazione", out error);
            if (Operation == QuestProjectionOperation.ProjectEdges && _sources.Any(source =>
                source.Type == "edge" ? string.IsNullOrEmpty(source.PersistentEdgeId) ||
                    !source.PersistentEdgeId.StartsWith(source.FeatureId + ":", StringComparison.Ordinal) ||
                    source.PersistentEdgeId.Length > 512 || Encoding.UTF8.GetByteCount(source.PersistentEdgeId) > 512 :
                source.Type == "sketchEntities" ? !IsCurrentAuthoredSource(source) : true))
                return Reject("projectEdges richiede bordi persistenti o curve sketch authored correnti", out error);
            if (Operation != QuestProjectionOperation.ProjectEdges && (_sources.Count != 1 || _sources[0].Type != "shape"))
                return Reject(OperationName + " richiede un solo proprietario geometrico", out error);

            var json = SerializeDefinition(_sources, Operation);
            if (Encoding.UTF8.GetByteCount(json) > 65536)
                return Reject("Definizione oltre il limite di 65536 byte", out error);
            using (var document = JsonDocument.Parse(json)) definition = document.RootElement.Clone();
            return true;
        }

        public bool TryGetRepair(out string featureId, out string groupId, out JsonElement definition, out string error)
        {
            featureId = SelectedTarget?.FeatureId;
            groupId = SelectedGroup?.Id;
            definition = default;
            if (SelectedGroup == null || SelectedGroup.Status != "broken" || !SelectedGroup.HasDefinition ||
                SelectedGroup.Definition.ValueKind != JsonValueKind.Object)
                return Reject("Seleziona un gruppo con definizione originale", out error);
            definition = SelectedGroup.Definition.Clone();
            error = "";
            return true;
        }

        public bool TryGetRemove(out string featureId, out string groupId, out string error)
        {
            featureId = SelectedTarget?.FeatureId;
            groupId = SelectedGroup?.Id;
            if (string.IsNullOrEmpty(featureId) || string.IsNullOrEmpty(groupId))
                return Reject("Seleziona un gruppo esistente", out error);
            error = "";
            return true;
        }

        public QueryToken BeginQuery()
        {
            if (Lineage == null || SelectedTarget == null) return null;
            _latest = null;
            _latestFence = null;
            _latestFeatureId = null;
            var token = new QueryToken { Id = ++_requestId, Fence = Lineage, FeatureId = SelectedTarget.FeatureId };
            Status = "Lettura proiezioni dal PC…";
            return token;
        }

        public bool AcceptQuery(QueryToken token, GetSketchProjectionPayload payload, Fence current)
        {
            if (!Current(token, current) || payload == null || payload.Result == null || payload.Result.Groups == null ||
                payload.SessionId != token.Fence.SessionId || payload.DocumentId != token.Fence.DocumentId ||
                payload.Revision != token.Fence.Revision || payload.Result.FeatureId != token.FeatureId) return false;
            _latest = payload.Result;
            _latestFence = token.Fence;
            _latestFeatureId = token.FeatureId;
            Status = payload.Result.GeometryCurrent && payload.Result.Status == "ok"
                ? "Risultato corrente dal PC" : ResultStatus(payload.Result.Status, payload.Result.Error);
            return true;
        }

        public bool FailQuery(QueryToken token, Fence current, string error)
        {
            if (!Current(token, current)) return false;
            _latest = null;
            _latestFence = null;
            _latestFeatureId = null;
            Status = string.IsNullOrWhiteSpace(error) ? "Lettura non confermata · aggiorna dal PC" : error;
            return true;
        }

        public bool TryGetSelectedDisplay(out SketchProjectionGroupResult display, out string error)
        {
            display = null;
            var group = SelectedGroup;
            if (Lineage == null || SelectedTarget == null || group == null)
                return Reject("Nessun gruppo corrente da mostrare", out error);
            if (_latest == null || _latestFence == null || !_latestFence.Equals(Lineage) || _latestFeatureId != SelectedTarget.FeatureId)
                return Reject("Aggiorna per leggere la geometria corrente", out error);
            if (!_latest.GeometryCurrent || _latest.Status != "ok")
                return Reject(ResultStatus(_latest.Status, _latest.Error), out error);
            if (group.Status != "ok" || !group.Generation.HasValue)
                return Reject(GroupStatus(group), out error);
            var result = _latest.Groups.FirstOrDefault(item => item != null && item.GroupId == group.Id);
            if (result == null) return Reject(GroupStatus(group), out error);
            if (result.Status != SketchProjectionGroupSummaryStatus.Ok)
                return Reject(ResultStatus(result.Status.ToString().ToLowerInvariant(), result.Error), out error);
            if (result.Generation != group.Generation.Value)
                return Reject("Generazione del gruppo cambiata · aggiorna dal PC", out error);
            if (result.Edges == null || result.Edges.Length == 0)
                return Reject("Nessuna curva corrente da mostrare", out error);
            display = result;
            error = "";
            return true;
        }

        public void Invalidate(string reason)
        {
            InvalidateQuery();
            _sources.Clear();
            ClearPendingAuthoredSelection(resetSource: true);
            if (!string.IsNullOrWhiteSpace(reason)) Status = reason;
        }

        public void SetStatus(string status)
        {
            if (!string.IsNullOrWhiteSpace(status)) Status = status;
        }

        bool Current(QueryToken token, Fence current) => token != null && current != null && token.Id == _requestId &&
            token.Fence != null && token.Fence.Equals(current) && token.Fence.Equals(Lineage) && SelectedTarget != null &&
            SelectedTarget.FeatureId == token.FeatureId;

        int FindTarget(string featureId) => string.IsNullOrEmpty(featureId) ? -1 : _targets.FindIndex(target => target.FeatureId == featureId);
        static int FindGroup(Target target, string groupId) => target == null || string.IsNullOrEmpty(groupId) ? -1 :
            Array.FindIndex(target.Groups, group => group.Id == groupId);

        void InvalidateQuery()
        {
            _requestId++;
            _latest = null;
            _latestFence = null;
            _latestFeatureId = null;
        }

        void ClearModel(string status)
        {
            var hadModel = Lineage != null || _targets.Count > 0;
            _targets.Clear();
            _sources.Clear();
            _authoredSketches.Clear();
            ClearPendingAuthoredSelection(resetSource: true);
            _preferredGroupId = null;
            _targetIndex = _groupIndex = -1;
            Lineage = null;
            InvalidateQuery();
            if (hadModel) _bindingVersion++;
            Status = status;
        }

        bool AuthoredSelectionContextCurrent(Fence fence, string targetFeatureId, out string error)
        {
            if (Lineage == null || fence == null || !Lineage.Equals(fence) || SelectedTarget == null ||
                SelectedTarget.FeatureId != targetFeatureId)
                return Reject("Sessione, sketch o revisione cambiati · seleziona di nuovo", out error);
            error = "";
            return true;
        }

        AuthoredSketch[] AvailableAuthoredSketches() => _authoredSketches
            .Where(sketch => sketch.FeatureId != SelectedTarget?.FeatureId).ToArray();

        AuthoredSketch ActiveAuthoredSketch() => string.IsNullOrEmpty(_authoredSketchFeatureId) ? null :
            AvailableAuthoredSketches().FirstOrDefault(sketch => sketch.FeatureId == _authoredSketchFeatureId);

        AuthoredCurve ActiveAuthoredCurve()
        {
            var sketch = ActiveAuthoredSketch();
            return sketch != null && _authoredEntityIndex >= 0 && _authoredEntityIndex < sketch.Curves.Length
                ? sketch.Curves[_authoredEntityIndex] : null;
        }

        void ClearPendingAuthoredSelection(bool resetSource)
        {
            _pendingAuthoredEntityIds.Clear();
            if (!resetSource) return;
            _authoredSketchFeatureId = null;
            _authoredEntityIndex = -1;
        }

        static AuthoredSketch[] ReadAuthoredSketches(IReadOnlyList<JsonElement> sketches)
        {
            var result = new List<AuthoredSketch>();
            if (sketches == null) return result.ToArray();
            foreach (var sketch in sketches)
            {
                var featureId = StringValue(sketch, "featureId");
                if (!StableFeatureId(featureId) || StringValue(sketch, "type") != "Sketch" ||
                    !sketch.TryGetProperty("status", out var status) || status.ValueKind != JsonValueKind.String || status.GetString() != "ok" ||
                    !sketch.TryGetProperty("geometryCurrent", out var current) || current.ValueKind != JsonValueKind.True ||
                    !sketch.TryGetProperty("model", out var model) || model.ValueKind != JsonValueKind.Object) continue;
                var hasBlockers = sketch.TryGetProperty("blockingSourceIds", out var blockers);
                if (hasBlockers && (blockers.ValueKind != JsonValueKind.Array || blockers.GetArrayLength() != 0)) continue;

                var identities = new HashSet<string>(StringComparer.Ordinal);
                var curves = new List<AuthoredCurve>();
                if (!ReadAuthoredEntityIds(model, "points", null, identities, curves) ||
                    !ReadAuthoredEntityIds(model, "lines", "line", identities, curves) ||
                    !ReadAuthoredEntityIds(model, "circles", "circle", identities, curves) ||
                    !ReadAuthoredEntityIds(model, "arcs", "arc", identities, curves) ||
                    !ReadAuthoredEntityIds(model, "constraints", null, identities, curves) || curves.Count == 0) continue;

                result.Add(new AuthoredSketch
                {
                    FeatureId = featureId,
                    Status = status.GetString(),
                    GeometryCurrent = true,
                    BlockingSourceIds = hasBlockers
                        ? blockers.EnumerateArray().Select(item => item.ValueKind == JsonValueKind.String ? item.GetString() : null).ToArray()
                        : Array.Empty<string>(),
                    Model = model.Clone(),
                    Curves = curves.ToArray(),
                });
            }
            return result.ToArray();
        }

        static bool ReadAuthoredEntityIds(JsonElement model, string collectionName, string curveKind,
            HashSet<string> identities, List<AuthoredCurve> curves)
        {
            if (!model.TryGetProperty(collectionName, out var collection) || collection.ValueKind != JsonValueKind.Array) return false;
            foreach (var item in collection.EnumerateArray())
            {
                if (item.ValueKind != JsonValueKind.Object || !item.TryGetProperty("id", out var rawId) ||
                    rawId.ValueKind != JsonValueKind.String || !BoundedAuthoredEntityId(rawId.GetString())) return false;
                var id = rawId.GetString();
                if (!identities.Add(id)) return false;
                if (curveKind != null) curves.Add(new AuthoredCurve { Id = id, Kind = curveKind });
            }
            return true;
        }

        static bool AuthoredSketchesEqual(IReadOnlyList<AuthoredSketch> left, IReadOnlyList<AuthoredSketch> right)
        {
            if (left.Count != right.Count) return false;
            for (var i = 0; i < left.Count; i++)
            {
                var a = left[i]; var b = right[i];
                if (a.FeatureId != b.FeatureId || a.Status != b.Status || a.GeometryCurrent != b.GeometryCurrent ||
                    !a.BlockingSourceIds.SequenceEqual(b.BlockingSourceIds, StringComparer.Ordinal) || !JsonEqual(a.Model, b.Model)) return false;
            }
            return true;
        }

        static string SerializeDefinition(IReadOnlyList<Source> sources, QuestProjectionOperation operation) =>
            JsonSerializer.Serialize(new DefinitionDto
            {
                Version = 1,
                Operation = OperationText(operation),
                Sources = sources.Select(source => new DefinitionSourceDto
                {
                    Type = source.Type,
                    FeatureId = source.FeatureId,
                    PersistentEdgeId = source.Type == "edge" ? source.PersistentEdgeId : null,
                    EntityIds = source.Type == "sketchEntities" ? source.EntityIds : null,
                }).ToArray(),
            });

        static Target[] ReadTargets(IReadOnlyList<JsonElement> sketches)
        {
            var targets = new List<Target>();
            var identities = new HashSet<string>(StringComparer.Ordinal);
            if (sketches == null) return targets.ToArray();
            foreach (var sketch in sketches)
            {
                var featureId = StringValue(sketch, "featureId");
                if (string.IsNullOrWhiteSpace(featureId) || !identities.Add(featureId))
                    throw new JsonException("sketch feature identity is missing or duplicated");
                var groups = new List<Group>();
                if (sketch.TryGetProperty("projectionGroups", out var records))
                {
                    if (records.ValueKind != JsonValueKind.Array) throw new JsonException("projectionGroups must be an array");
                    var groupIds = new HashSet<string>(StringComparer.Ordinal);
                    foreach (var record in records.EnumerateArray())
                    {
                        var id = StringValue(record, "groupId");
                        if (string.IsNullOrWhiteSpace(id) || !groupIds.Add(id)) throw new JsonException("projection group identity is missing or duplicated");
                        JsonElement definition = default;
                        var hasDefinition = record.TryGetProperty("definition", out var rawDefinition) && rawDefinition.ValueKind == JsonValueKind.Object;
                        if (hasDefinition) definition = rawDefinition.Clone();
                        long? generation = record.TryGetProperty("generation", out var rawGeneration) && rawGeneration.TryGetInt64(out var value)
                            ? value : (long?)null;
                        groups.Add(new Group
                        {
                            Id = id,
                            Status = StringValue(record, "status"),
                            Error = StringValue(record, "error"),
                            BlockingSourceIds = StringArray(record, "blockingSourceIds"),
                            Generation = generation,
                            Definition = definition,
                            HasDefinition = hasDefinition,
                        });
                    }
                }
                targets.Add(new Target { FeatureId = featureId, Groups = groups.ToArray() });
            }
            return targets.ToArray();
        }

        static bool TargetsEqual(IReadOnlyList<Target> left, IReadOnlyList<Target> right)
        {
            if (left.Count != right.Count) return false;
            for (var i = 0; i < left.Count; i++)
            {
                if (left[i].FeatureId != right[i].FeatureId || left[i].Groups.Length != right[i].Groups.Length) return false;
                for (var j = 0; j < left[i].Groups.Length; j++)
                {
                    var a = left[i].Groups[j]; var b = right[i].Groups[j];
                    if (a.Id != b.Id || a.Status != b.Status || a.Error != b.Error || a.Generation != b.Generation ||
                        a.HasDefinition != b.HasDefinition || a.HasDefinition && !JsonEqual(a.Definition, b.Definition) ||
                        !a.BlockingSourceIds.SequenceEqual(b.BlockingSourceIds, StringComparer.Ordinal)) return false;
                }
            }
            return true;
        }

        static bool JsonEqual(JsonElement left, JsonElement right)
        {
            if (left.ValueKind != right.ValueKind) return false;
            switch (left.ValueKind)
            {
                case JsonValueKind.Object:
                    var leftProperties = left.EnumerateObject().ToArray();
                    if (leftProperties.Length != right.EnumerateObject().Count()) return false;
                    foreach (var property in leftProperties)
                        if (!right.TryGetProperty(property.Name, out var other) || !JsonEqual(property.Value, other)) return false;
                    return true;
                case JsonValueKind.Array:
                    var leftItems = left.EnumerateArray().ToArray();
                    var rightItems = right.EnumerateArray().ToArray();
                    if (leftItems.Length != rightItems.Length) return false;
                    for (var i = 0; i < leftItems.Length; i++) if (!JsonEqual(leftItems[i], rightItems[i])) return false;
                    return true;
                case JsonValueKind.String:
                    return left.GetString() == right.GetString();
                case JsonValueKind.Number:
                    return left.TryGetDecimal(out var leftDecimal) && right.TryGetDecimal(out var rightDecimal)
                        ? leftDecimal == rightDecimal : left.GetRawText() == right.GetRawText();
                case JsonValueKind.True:
                case JsonValueKind.False:
                case JsonValueKind.Null:
                case JsonValueKind.Undefined:
                    return true;
                default:
                    return false;
            }
        }

        static string StringValue(JsonElement value, string property) => value.ValueKind == JsonValueKind.Object &&
            value.TryGetProperty(property, out var raw) && raw.ValueKind == JsonValueKind.String ? raw.GetString() : null;

        internal static bool StableFeatureId(string value) => !string.IsNullOrEmpty(value) && value.Length <= 128 &&
            value.All(character => (character >= 'A' && character <= 'Z') || (character >= 'a' && character <= 'z') ||
                (character >= '0' && character <= '9') || character == '_' || character == '-');

        static bool BoundedAuthoredEntityId(string value) => !string.IsNullOrEmpty(value) && Encoding.UTF8.GetByteCount(value) <= 512;

        static string[] StringArray(JsonElement value, string property)
        {
            if (value.ValueKind != JsonValueKind.Object || !value.TryGetProperty(property, out var raw) || raw.ValueKind != JsonValueKind.Array)
                return Array.Empty<string>();
            return raw.EnumerateArray().Where(item => item.ValueKind == JsonValueKind.String).Select(item => item.GetString()).ToArray();
        }

        static string OperationText(QuestProjectionOperation operation) => operation == QuestProjectionOperation.ProjectEdges ? "projectEdges" :
            operation == QuestProjectionOperation.Silhouette ? "silhouette" : "section";

        static string GroupStatus(Group group)
        {
            if (group == null) return "Nessun gruppo selezionato";
            var status = string.IsNullOrWhiteSpace(group.Status) ? "stato sconosciuto" : group.Status;
            if (!string.IsNullOrWhiteSpace(group.Error)) status += " · " + group.Error;
            if (group.BlockingSourceIds != null && group.BlockingSourceIds.Length > 0)
                status += " · blocco: " + string.Join(", ", group.BlockingSourceIds);
            return status;
        }

        static string ResultStatus(string status, string error) => "Geometria non disponibile · " +
            (string.IsNullOrWhiteSpace(status) ? "stato sconosciuto" : status) +
            (string.IsNullOrWhiteSpace(error) ? "" : " · " + error);

        static bool Reject(string message, out string error) { error = message; return false; }
    }
}
