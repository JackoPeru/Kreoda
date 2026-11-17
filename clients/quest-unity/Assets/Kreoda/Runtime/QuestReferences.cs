using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using Kreoda.QuestFoundation;
using Kreoda.Session;
using Kreoda.Session.Generated;
using UnityEngine;

namespace Kreoda.QuestRuntime
{
    public enum QuestReferenceKind { Plane, Axis, Point }
    public enum QuestReferenceValueKind { Numeric, Choice, Plane, Axis, Point, OptionalPoint }

    // Typed value kept by the form; geometry references stay references until native resolution.
    public sealed class QuestReferenceValue
    {
        public QuestReferenceKind Kind { get; private set; }
        public string Type { get; private set; }
        public string Principal { get; private set; }
        public string FeatureId { get; private set; }
        public string PersistentId { get; private set; }
        public string NativeKind { get; private set; }
        public string Status { get; private set; }
        public string Label { get; set; }
        public double[] PositionMm { get; private set; }
        public bool IsOrigin { get; private set; }
        public bool TrustedNative { get; set; }
        public QuestMeshView OwnerView { get; set; }
        public MeshSemanticHit Hit { get; set; }
        public int UploadVersion { get; set; }

        QuestReferenceValue(QuestReferenceKind kind, string type)
        { Kind = kind;Type = type; }
        internal void SetStatus(string status) => Status = status;

        public static QuestReferenceValue PrincipalPlane(string planeKind) =>
            new QuestReferenceValue(QuestReferenceKind.Plane, "principal") { Principal = planeKind, Label = "Piano " + planeKind, TrustedNative = true };
        public static QuestReferenceValue PrincipalAxis(string axis) =>
            new QuestReferenceValue(QuestReferenceKind.Axis, "principal") { Principal = axis, Label = "Asse " + axis, TrustedNative = true };
        public static QuestReferenceValue Datum(QuestReferenceKind kind, string featureId, string nativeKind, string status) =>
            new QuestReferenceValue(kind, "datum") { FeatureId = featureId, NativeKind = nativeKind, Status = status, Label = "Datum " + featureId };
        public static QuestReferenceValue Face(string featureId, string persistentFaceId) =>
            new QuestReferenceValue(QuestReferenceKind.Plane, "face") { FeatureId = featureId, PersistentId = persistentFaceId, Label = "Faccia " + persistentFaceId };
        public static QuestReferenceValue Edge(string featureId, string persistentEdgeId) =>
            new QuestReferenceValue(QuestReferenceKind.Axis, "edge") { FeatureId = featureId, PersistentId = persistentEdgeId, Label = "Bordo " + persistentEdgeId };
        public static QuestReferenceValue Coordinates(double x, double y, double z) =>
            new QuestReferenceValue(QuestReferenceKind.Point, "coordinates") { PositionMm = new[] { x, y, z }, Label = "Coordinate mm", TrustedNative = true };
        public static QuestReferenceValue PlaneOrigin() =>
            new QuestReferenceValue(QuestReferenceKind.Point, "origin") { IsOrigin = true, Label = "Origine piano", TrustedNative = true };

        internal void SetCoordinate(int axis, double value)
        {
            if (Type != "coordinates" || axis < 0 || axis > 2) throw new InvalidOperationException("not a coordinate point");
            PositionMm[axis] = value;
        }
    }

    // One small page owns typed inputs, current PC lineage, and canonical command availability.
    public sealed class QuestReferences : MonoBehaviour
    {
        const double CoordinateLimitMm = 1000000;
        const int SourcesPerPage = 2;
        static readonly string[] PlaneOperations = { "principal", "offset", "mid", "angle", "threePoint" };
        static readonly string[] AxisOperations = { "twoPoint", "planeNormal", "planeIntersection" };
        static readonly string[] PointOperations = { "coordinates", "midpoint" };

        sealed class Field
        {
            public string Key, Label, Unit;
            public QuestReferenceValueKind Kind;
            public double Minimum, Maximum;
        }

        public sealed class DatumListItem
        {
            public string FeatureId, Kind, Status, Error, Label;
        }

        public QuestConnection Connection;
        public QuestCommands Commands;
        public string Status { get; private set; } = "Scegli Piano, Asse o Punto";
        public bool IsFormOpen => _mode == Mode.Form;
        public bool IsInspecting => _mode == Mode.Inspect;
        public bool IsHome => _mode == Mode.Home;
        public bool IsEditing => _editing;
        public bool SchemaReady => _schemaReady;
        public string Operation => _operation;
        public QuestReferenceKind Kind => _kind;
        public string SelectedDatumId => _selectedDatumId;
        public long FormTicket => _formTicket;
        public long InputTicket => _inputTicket;
        public string CommandId => _commandId;
        public string ModeLabel => _mode switch
        {
            Mode.Form => (_editing ? "Modifica" : "Nuovo") + " · " + KindName(_kind),
            Mode.Inspect => "Ispezione · " + KindName(_kind),
            _ => "Riferimenti"
        };
        public string OperationLabel => OperationName(_operation);
        public string CurrentFieldLabel => CurrentFieldText(false);
        public string CurrentFieldValue => CurrentFieldText(true);
        public string CurrentFieldUnit => CurrentField()?.Unit ?? "";
        public bool CurrentFieldIsNumeric => CurrentField()?.Kind == QuestReferenceValueKind.Numeric || CoordinateValue(CurrentField()) != null;
        public bool CurrentFieldIsSource => CurrentField()?.Kind is QuestReferenceValueKind.Plane or QuestReferenceValueKind.Axis or QuestReferenceValueKind.Point or QuestReferenceValueKind.OptionalPoint;
        public bool CurrentFieldIsEnum => CurrentField()?.Kind == QuestReferenceValueKind.Choice;
        public int SourcePage => _sourcePage;
        public int SourcePageCount => Math.Max(1, (SourceChoices().Count + SourcesPerPage - 1) / SourcesPerPage);
        public int DatumPage => _datumPage;
        public int DatumPageCount => Math.Max(1, (DatumRecords().Count + SourcesPerPage - 1) / SourcesPerPage);
        public bool HasSelectedDatum => FindDatum(_selectedDatumId).ValueKind == JsonValueKind.Object;
        public bool CanEditSelected => HasSelectedDatum && Connection != null && Connection.Connected && TryDefinition(FindDatum(_selectedDatumId), out _);
        public bool CanSketchSelected => CurrentSelectedPlane() != null;

        enum Mode { Home, Form, Inspect }
        Mode _mode = Mode.Home;
        QuestReferenceKind _kind;
        string _operation = "principal", _commandId, _featureId, _selectedDatumId;
        string _recordStatus;
        bool _editing, _schemaReady, _subscribed;
        JsonElement _schema;
        ContextCommandInfo _canonicalCommand;
        readonly HashSet<string> _allowedOperations = new HashSet<string>(StringComparer.Ordinal);
        readonly Dictionary<string, object> _values = new Dictionary<string, object>(StringComparer.Ordinal);
        readonly List<Field> _fields = new List<Field>();
        int _fieldIndex, _sourcePage, _datumPage, _coordinateAxis;
        long _formTicket, _inputTicket;
        long _submissionTicket, _submissionFormTicket;
        bool _submissionPending, _submissionWasEdit;
        SessionClient _submissionClient;
        string _submissionSessionId, _submissionDocumentId;
        long _submissionGeneration;
        SessionClient _capturedClient;
        string _sessionId, _documentId;
        long _revision, _connectionGeneration;
        QuestMeshView _pickedView;
        MeshSemanticHit _pickedHit;
        bool _pickedFace;

        public void OpenHome()
        {
            if (_mode != Mode.Home) _formTicket++;
            _mode = Mode.Home;_inputTicket++;_selectedDatumId ??= CurrentSelectedDatumId();
            Status = "Scegli costruzione o un datum da ispezionare";Notify();
        }

        public bool BeginCreate(QuestReferenceKind kind)
        {
            if (!CaptureCurrent()) return false;
            InvalidateSubmission();
            _mode = Mode.Form;_kind = kind;_editing = false;_featureId = null;_recordStatus = null;
            _operation = Operations(kind)[0];_commandId = CanonicalCommandId(kind, false);_values.Clear();_allowedOperations.Clear();_schemaReady = false;
            _canonicalCommand = null;_schema = default;_fieldIndex = _sourcePage = _coordinateAxis = 0;
            SetFields(reset: true);Status = "Verifica schema e disponibilità sul PC…";
            _formTicket++;_inputTicket++;EnsureSubscribed();Commands?.PrepareReference(this, _formTicket, _commandId, null);Notify();return true;
        }

        public bool BeginEditSelected() => BeginEdit(_selectedDatumId);

        public bool BeginEdit(string featureId)
        {
            if (!CaptureCurrent()) return false;
            var datum = FindDatum(featureId);
            if (datum.ValueKind != JsonValueKind.Object || !TryDefinition(datum, out var definition))
            { Status = "Definizione assente o non leggibile";Notify();return false; }
            if (!KindFromNative(ReadText(datum, "kind"), out _kind))
            { Status = "Tipo datum non supportato";Notify();return false; }
            InvalidateSubmission();
            _mode = Mode.Form;_editing = true;_featureId = featureId;_selectedDatumId = featureId;
            _recordStatus = ReadText(datum, "status") ?? "stato assente";
            _commandId = CanonicalCommandId(_kind, true);_operation = ReadText(definition, "type");
            _schemaReady = false;_canonicalCommand = null;_schema = default;_allowedOperations.Clear();_values.Clear();
            _fieldIndex = _sourcePage = _coordinateAxis = 0;SetFields(reset: true);
            try { LoadDefinition(definition, _recordStatus == "ok"); }
            catch (Exception error) when (error is InvalidOperationException or FormatException or OverflowException or KeyNotFoundException)
            { _mode = Mode.Inspect;Status = "Definizione nativa non leggibile";Notify();return false; }
            Status = _recordStatus == "ok" ? "Caricata definizione nativa" : "Record " + _recordStatus + " · correggi sorgenti prima di confermare";
            _formTicket++;_inputTicket++;EnsureSubscribed();Commands?.PrepareReference(this, _formTicket, _commandId, featureId);Notify();return true;
        }

        public bool InspectSelected() => Inspect(_selectedDatumId);

        public bool Inspect(string featureId)
        {
            var datum = FindDatum(featureId);
            if (datum.ValueKind != JsonValueKind.Object) { Status = "Datum non presente nello snapshot corrente";Notify();return false; }
            InvalidateSubmission();
            _selectedDatumId = featureId;_mode = Mode.Inspect;_formTicket++;_inputTicket++;
            _kind = KindFromNative(ReadText(datum, "kind"), out var kind) ? kind : QuestReferenceKind.Point;
            _recordStatus = ReadText(datum, "status") ?? "stato assente";
            Status = Connection != null && Connection.Connected ? "Record PC · " + _recordStatus : "Snapshot locale · non corrente";
            Notify();return true;
        }

        public void SelectDatumPageItem(int slot)
        {
            var index = _datumPage * SourcesPerPage + slot;var records = DatumRecords();
            if (slot < 0 || slot >= SourcesPerPage || index >= records.Count) return;
            _selectedDatumId = ReadText(records[index], "featureId");_inputTicket++;
            Status = string.IsNullOrEmpty(_selectedDatumId) ? "Identità datum assente" : "Selezionato " + KindName(ReadText(records[index], "kind")) + " · " + _selectedDatumId;
            Notify();
        }

        public void SelectCurrentDatum(string featureId) { _selectedDatumId = featureId;Notify(); }

        public void NextDatumPage(int delta)
        {
            var count = DatumPageCount;_datumPage = (int)Math.Max(0, Math.Min(count - 1, _datumPage + delta));Notify();
        }

        public DatumListItem DatumAt(int slot)
        {
            var index = _datumPage * SourcesPerPage + slot;var records = DatumRecords();
            if (slot < 0 || slot >= SourcesPerPage || index >= records.Count) return null;
            var datum = records[index];var id = ReadText(datum, "featureId");var kind = ReadText(datum, "kind");
            var state = ReadText(datum, "status") ?? "stato assente";var error = ReadText(datum, "error");
            return new DatumListItem { FeatureId = id, Kind = kind, Status = state, Error = error,
                Label = KindName(kind) + " · " + id + " · " + state };
        }

        public string InspectionText
        {
            get
            {
                var datum = FindDatum(_selectedDatumId);if (datum.ValueKind != JsonValueKind.Object) return "Nessun datum selezionato";
                string definition;
                try { definition = TryDefinition(datum, out var parsed) ? FormatDefinition(parsed, KindFromNative(ReadText(datum, "kind"), out var kind) ? kind : QuestReferenceKind.Point) : "Definizione non leggibile"; }
                catch (Exception failure) when (failure is InvalidOperationException or FormatException or OverflowException or KeyNotFoundException) { definition = "Definizione non leggibile"; }
                string resolved;
                try { resolved = datum.TryGetProperty("resolved", out var result) ? FormatResolved(result, ReadText(datum, "kind")) : "Geometria risolta assente"; }
                catch (Exception failure) when (failure is InvalidOperationException or FormatException or OverflowException) { resolved = "Geometria risolta non leggibile"; }
                var error = ReadText(datum, "error");
                return "ID " + (ReadText(datum, "featureId") ?? "—") + "\nStato " + (ReadText(datum, "status") ?? "assente") +
                    (string.IsNullOrEmpty(error) ? "" : " · " + error) + "\n" + definition + "\n" + resolved;
            }
        }

        public string HomeSummary => HasSelectedDatum
            ? "Selezionato " + _selectedDatumId + " · " + (ReadText(FindDatum(_selectedDatumId), "status") ?? "stato assente")
            : "Crea piano, asse o punto. La lista mostra anche record rotti.";

        public void SetPickedMesh(QuestMeshView view, MeshSemanticHit hit, bool face)
        { _pickedView = view;_pickedHit = hit;_pickedFace = face; }

        public void ClearPickedMesh() { _pickedView = null;_pickedHit = null; }

        public void CycleKind()
        {
            if (_mode != Mode.Form || _editing) return;
            var kinds = new[] { QuestReferenceKind.Plane, QuestReferenceKind.Axis, QuestReferenceKind.Point };
            var index = Array.IndexOf(kinds, _kind);BeginCreate(kinds[(index + 1) % kinds.Length]);
        }

        public void CycleOperation()
        {
            if (_mode != Mode.Form || !_schemaReady) return;
            var operations = Operations(_kind).Where(_allowedOperations.Contains).ToArray();if (operations.Length < 2) return;
            var index = Array.IndexOf(operations, _operation);_operation = operations[(index + 1 + operations.Length) % operations.Length];
            SetFields(reset: true);_inputTicket++;Notify();
        }

        public void PreviousField() => MoveField(-1);
        public void NextField() => MoveField(1);
        void MoveField(int delta)
        {
            if (_mode != Mode.Form || _fields.Count == 0) return;
            var coordinate = CoordinateValue(CurrentField());
            if (coordinate != null)
            {
                var next = _coordinateAxis + delta;
                if (next >= 0 && next < 3) _coordinateAxis = next;
                else { _coordinateAxis = delta > 0 ? 0 : 2;_fieldIndex = (_fieldIndex + _fields.Count + delta) % _fields.Count; }
            }
            else _fieldIndex = (_fieldIndex + _fields.Count + delta) % _fields.Count;
            _sourcePage = 0;_inputTicket++;Notify();
        }

        public void NextSourcePage(int delta)
        {
            if (!CurrentFieldIsSource) return;
            _sourcePage = (int)Math.Max(0, Math.Min(SourcePageCount - 1, _sourcePage + delta));Notify();
        }

        public string SourceChoiceLabel(int slot)
        {
            var choices = SourceChoices();var index = _sourcePage * SourcesPerPage + slot;
            return slot >= 0 && slot < SourcesPerPage && index < choices.Count ? choices[index].Label + " · " + (choices[index].Status ?? "corrente") : "—";
        }

        public bool ChooseSource(int slot)
        {
            if (_mode != Mode.Form || !CurrentFieldIsSource) return false;
            var choices = SourceChoices();var index = _sourcePage * SourcesPerPage + slot;
            if (slot < 0 || slot >= SourcesPerPage || index >= choices.Count) return false;
            var choice = choices[index];if (!SourceCurrent(choice, CurrentField().Kind)) { Status = "Sorgente non più corrente";Notify();return false; }
            _values[CurrentField().Key] = choice;_sourcePage = 0;_coordinateAxis = 0;_inputTicket++;
            Status = "Sorgente selezionata · " + choice.Label;Notify();return true;
        }

        public void CycleEnumValue()
        {
            var field = CurrentField();if (field?.Kind != QuestReferenceValueKind.Choice) return;
            var choices = field.Key == "planeKind" ? new[] { "XY", "XZ", "YZ" } : Array.Empty<string>();
            if (choices.Length == 0) return;
            var current = _values.TryGetValue(field.Key, out var value) ? value as string : null;
            _values[field.Key] = choices[(Array.IndexOf(choices, current) + 1) % choices.Length];_inputTicket++;Notify();
        }

        public string NumericValue
        {
            get
            {
                var field = CurrentField();var source = CoordinateValue(field);
                var number = source != null ? source.PositionMm[_coordinateAxis] :
                    field != null && _values.TryGetValue(field.Key, out var value) && value is double parsed ? parsed : 0d;
                return number.ToString("R", CultureInfo.InvariantCulture);
            }
        }

        public string NumericInputLabel
        {
            get
            {
                var field = CurrentField();var source = CoordinateValue(field);
                return source != null ? field.Label + " · " + "XYZ"[_coordinateAxis] + " · mm" : (field?.Label ?? "Valore") + " · " + (field?.Unit ?? "mm");
            }
        }

        public bool SetNumericInput(string text, long formTicket, long inputTicket)
        {
            if (formTicket != _formTicket || inputTicket != _inputTicket || _mode != Mode.Form || !CaptureIsCurrent()) return false;
            var field = CurrentField();if (field == null) return false;
            var coordinate = CoordinateValue(field);
            var minimum = coordinate != null ? -CoordinateLimitMm : field.Minimum;
            var maximum = coordinate != null ? CoordinateLimitMm : field.Maximum;
            if (!TryParseNumber(text, minimum, maximum, out var number)) return false;
            if (coordinate != null) coordinate.SetCoordinate(_coordinateAxis, number);
            else if (field.Kind == QuestReferenceValueKind.Numeric) _values[field.Key] = number;
            else return false;
            _inputTicket++;Status = "Valore acquisito · " + number.ToString("0.###", CultureInfo.InvariantCulture) + " " + (coordinate != null ? "mm" : field.Unit);Notify();return true;
        }

        public bool TrySubmit(out string commandId, out Dictionary<string, object> parameters)
        {
            commandId = null;parameters = null;
            if (_mode != Mode.Form || !_schemaReady || _canonicalCommand?.Available != true || !CaptureIsCurrent())
            { Status = "Schema o contesto PC non corrente";Notify();return false; }
            if (!_allowedOperations.Contains(_operation)) { Status = "Costruttore non ammesso dallo schema PC";Notify();return false; }
            try
            {
                foreach (var field in _fields.Where(field => field.Kind is QuestReferenceValueKind.Plane or QuestReferenceValueKind.Axis or QuestReferenceValueKind.Point or QuestReferenceValueKind.OptionalPoint))
                    if (_values.TryGetValue(field.Key, out var raw) && raw is QuestReferenceValue source && !SourceCurrent(source, field.Kind))
                        throw new ArgumentException("Sorgente assente, rotta, di tipo errato o non corrente: " + source.Label);
                var definition = BuildDefinition(_kind, _operation, _values);
                parameters = _editing ? new Dictionary<string, object> { ["featureId"] = _featureId, ["definition"] = definition }
                    : new Dictionary<string, object> { ["definition"] = definition };
                commandId = _commandId;return true;
            }
            catch (Exception error) when (error is ArgumentException or InvalidOperationException or KeyNotFoundException or FormatException)
            { Status = error.Message;Notify();return false; }
        }

        public void Cancel()
        {
            InvalidateSubmission();
            _mode = Mode.Home;_schemaReady = false;_canonicalCommand = null;_formTicket++;_inputTicket++;
            Status = "Modifica annullata · nessun comando inviato";Notify();
        }

        public bool StartSketchOnSelected()
        {
            var view = CurrentSelectedPlane();
            if (view == null || Commands == null) { Status = "Serve un piano datum sano e corrente";Notify();return false; }
            if (!Commands.SelectDatumCommand(view, "CreateSketch")) { Status = "Il PC non offre Sketch sul piano in questo contesto";Notify();return false; }
            Status = "Sketch sul piano · supportRef richiesto al PC";Notify();return true;
        }

        internal bool IsCurrentForm(long ticket) => ticket == _formTicket && _mode == Mode.Form && CaptureIsCurrent();
        internal bool CanAcceptSchema(long ticket, string commandId, string targetFeatureId) => IsCurrentForm(ticket) &&
            _commandId == commandId && _featureId == targetFeatureId;
        internal bool CapturedContext(out SessionClient client, out string session, out string document, out long revision, out long generation)
        { client = _capturedClient;session = _sessionId;document = _documentId;revision = _revision;generation = _connectionGeneration;return CaptureIsCurrent(); }
        internal ContextCommandInfo CanonicalCommand => _canonicalCommand;

        internal void AcceptCanonical(long ticket, string commandId, ContextCommandInfo command, JsonElement schema)
        {
            if (!CanAcceptSchema(ticket, commandId, _featureId)) return;
            _canonicalCommand = command;_schema = schema.Clone();_allowedOperations.Clear();
            foreach (var operation in AllowedOperations(_schema, _kind)) _allowedOperations.Add(operation);
            if (command == null || !command.Available)
            { _schemaReady = false;Status = command?.Reason ?? "Azione non disponibile sul PC";Notify();return; }
            if (!IsOperationAllowed(_operation) && _editing)
            { _schemaReady = false;Status = "Il PC non ammette il costruttore nativo da modificare";Notify();return; }
            if (!IsOperationAllowed(_operation)) _operation = Operations(_kind).FirstOrDefault(_allowedOperations.Contains);
            _schemaReady = _allowedOperations.Count > 0 && !string.IsNullOrEmpty(_operation);
            SetFields(reset: !_editing);
            if (_editing && TryDefinition(FindDatum(_featureId), out var definition)) LoadDefinition(definition, _recordStatus == "ok");
            Status = _schemaReady ? "Comando disponibile sul PC · unità " + (_kind == QuestReferenceKind.Plane ? "mm/deg" : "mm") : "Schema PC privo di costruttori supportati";
            Notify();
        }

        bool IsOperationAllowed(string operation) => !string.IsNullOrEmpty(operation) && _allowedOperations.Contains(operation);

        internal void CanonicalError(long ticket, string commandId, Exception error)
        {
            if (!CanAcceptSchema(ticket, commandId, _featureId)) return;
            _schemaReady = false;Status = "Catalogo PC non disponibile · " + (error is SessionException session ? session.Code : "errore");Notify();
        }

        internal long MarkSubmitted(SessionClient client, string session, string document, long generation)
        {
            _submissionTicket++;_submissionPending = true;_submissionWasEdit = _editing;
            _submissionClient = client;_submissionSessionId = session;_submissionDocumentId = document;_submissionGeneration = generation;
            _mode = Mode.Home;_schemaReady = false;_formTicket++;_submissionFormTicket = _formTicket;_inputTicket++;
            Status = "Invio al PC…";Notify();return _submissionTicket;
        }

        internal string SubmissionAction => _submissionWasEdit ? "modificato" : "creato";

        internal void CompleteSubmission(long ticket, long formTicket, SessionClient client, string session,
            string document, long generation, string result)
        {
            if (!_submissionPending || ticket != _submissionTicket || formTicket != _submissionFormTicket ||
                formTicket != _formTicket || _mode != Mode.Home || !ReferenceEquals(client, _submissionClient) ||
                session != _submissionSessionId || document != _submissionDocumentId || generation != _submissionGeneration) return;
            _submissionPending = false;
            var model = client.Model;
            Status = Connection == null || !ReferenceEquals(Connection.Client, client) ||
                Connection.ConnectionGeneration != generation || model == null || model.SessionId != session || model.DocumentId != document
                ? "Esito incerto · controlla PC/documento" : result;
            Notify();
        }

        void InvalidateSubmission()
        { _submissionTicket++;_submissionPending = false;_submissionClient = null; }

        public static string CanonicalCommandId(QuestReferenceKind kind, bool editing) => editing ? "UpdateDatum" : kind switch
        { QuestReferenceKind.Plane => "CreateDatumPlane", QuestReferenceKind.Axis => "CreateDatumAxis", _ => "CreateDatumPoint" };

        public static bool TryParseNumber(string text, double minimum, double maximum, out double value)
        {
            value = 0;
            return !string.IsNullOrWhiteSpace(text) && double.TryParse(text.Replace(',', '.'), NumberStyles.Float,
                CultureInfo.InvariantCulture, out value) && !double.IsNaN(value) && !double.IsInfinity(value) && value >= minimum && value <= maximum;
        }

        public static string[] AllowedOperations(JsonElement parametersSchema, QuestReferenceKind kind)
        {
            if (parametersSchema.ValueKind != JsonValueKind.Object || !parametersSchema.TryGetProperty("properties", out var properties) ||
                !properties.TryGetProperty("definition", out var definition)) return Array.Empty<string>();
            var found = new HashSet<string>(StringComparer.Ordinal);CollectDiscriminators(definition, found, 0);
            return Operations(kind).Where(found.Contains).ToArray();
        }

        static void CollectDiscriminators(JsonElement schema, HashSet<string> result, int depth)
        {
            if (depth > 12 || schema.ValueKind != JsonValueKind.Object) return;
            if (schema.TryGetProperty("properties", out var properties) && properties.ValueKind == JsonValueKind.Object &&
                properties.TryGetProperty("type", out var discriminator) && discriminator.ValueKind == JsonValueKind.Object)
            {
                if (discriminator.TryGetProperty("const", out var constant) && constant.ValueKind == JsonValueKind.String) result.Add(constant.GetString());
                if (discriminator.TryGetProperty("enum", out var values) && values.ValueKind == JsonValueKind.Array)
                    foreach (var value in values.EnumerateArray()) if (value.ValueKind == JsonValueKind.String) result.Add(value.GetString());
            }
            foreach (var name in new[] { "oneOf", "anyOf", "allOf" })
                if (schema.TryGetProperty(name, out var branches) && branches.ValueKind == JsonValueKind.Array)
                    foreach (var branch in branches.EnumerateArray()) CollectDiscriminators(branch, result, depth + 1);
        }

        public static Dictionary<string, object> BuildCommandParameters(QuestReferenceKind kind, string operation,
            IDictionary<string, object> fields, string featureId = null)
        {
            var definition = BuildDefinition(kind, operation, fields);
            if (featureId == null) return new Dictionary<string, object> { ["definition"] = definition };
            if (string.IsNullOrWhiteSpace(featureId)) throw new ArgumentException("Feature UUID is required for edit", nameof(featureId));
            return new Dictionary<string, object> { ["featureId"] = featureId, ["definition"] = definition };
        }

        public static Dictionary<string, object> BuildDefinition(QuestReferenceKind kind, string operation, IDictionary<string, object> fields)
        {
            if (fields == null || !Operations(kind).Contains(operation, StringComparer.Ordinal)) throw new ArgumentException("Unsupported datum constructor");
            object Ref(string name, QuestReferenceKind expected) => Reference(fields, name, expected);
            double Number(string name, double min = -CoordinateLimitMm, double max = CoordinateLimitMm)
            {
                if (!fields.TryGetValue(name, out var raw) || raw == null) throw new ArgumentException("Missing numeric value: " + name);
                double number;
                try { number = Convert.ToDouble(raw, CultureInfo.InvariantCulture); }
                catch (Exception error) when (error is FormatException or InvalidCastException or OverflowException) { throw new ArgumentException("Invalid numeric value: " + name); }
                if (double.IsNaN(number) || double.IsInfinity(number) || number < min || number > max) throw new ArgumentException("Valore fuori intervallo: " + name);
                return number;
            }
            Dictionary<string, object> Result(string type, params (string key, object value)[] items)
            {
                var result = new Dictionary<string, object> { ["type"] = type };
                foreach (var item in items) result[item.key] = item.value;
                return result;
            }
            return (kind, operation) switch
            {
                (QuestReferenceKind.Plane, "principal") => Result(operation, ("planeKind", EnumValue(fields, "planeKind", "XY", "XZ", "YZ"))),
                (QuestReferenceKind.Plane, "offset") => Result(operation, ("base", Ref("base", QuestReferenceKind.Plane)), ("offsetMm", Number("offsetMm"))),
                (QuestReferenceKind.Plane, "mid") => Result(operation, ("first", Ref("first", QuestReferenceKind.Plane)), ("second", Ref("second", QuestReferenceKind.Plane))),
                (QuestReferenceKind.Plane, "angle") => Result(operation, ("base", Ref("base", QuestReferenceKind.Plane)), ("axis", Ref("axis", QuestReferenceKind.Axis)), ("angleDeg", Number("angleDeg", -360, 360))),
                (QuestReferenceKind.Plane, "threePoint") => Result(operation, ("first", Ref("first", QuestReferenceKind.Point)), ("second", Ref("second", QuestReferenceKind.Point)), ("third", Ref("third", QuestReferenceKind.Point))),
                (QuestReferenceKind.Axis, "twoPoint") => Result(operation, ("first", Ref("first", QuestReferenceKind.Point)), ("second", Ref("second", QuestReferenceKind.Point))),
                (QuestReferenceKind.Axis, "planeNormal") => PlaneNormal(Result, Ref, fields),
                (QuestReferenceKind.Axis, "planeIntersection") => Result(operation, ("first", Ref("first", QuestReferenceKind.Plane)), ("second", Ref("second", QuestReferenceKind.Plane))),
                (QuestReferenceKind.Point, "coordinates") => Result(operation, ("positionMm", new[] { Number("xMm"), Number("yMm"), Number("zMm") })),
                (QuestReferenceKind.Point, "midpoint") => Result(operation, ("first", Ref("first", QuestReferenceKind.Point)), ("second", Ref("second", QuestReferenceKind.Point))),
                _ => throw new ArgumentException("Unsupported datum constructor")
            };
        }

        static Dictionary<string, object> PlaneNormal(Func<string, (string key, object value)[], Dictionary<string, object>> result,
            Func<string, QuestReferenceKind, object> reference, IDictionary<string, object> fields)
        {
            var values = new List<(string key, object value)> { ("plane", reference("plane", QuestReferenceKind.Plane)) };
            if (fields.TryGetValue("through", out var raw))
            {
                if (raw is not QuestReferenceValue point) throw new ArgumentException("Choose plane origin or a valid through point");
                if (!point.IsOrigin) values.Add(("through", Reference(fields, "through", QuestReferenceKind.Point)));
            }
            return result("planeNormal", values.ToArray());
        }

        static string EnumValue(IDictionary<string, object> fields, string name, params string[] allowed)
        {
            if (!fields.TryGetValue(name, out var value) || !(value is string text) || !allowed.Contains(text, StringComparer.Ordinal))
                throw new ArgumentException("Choose a valid " + name);
            return text;
        }

        static Dictionary<string, object> ReferenceObject(QuestReferenceValue value, QuestReferenceKind expected)
        {
            if (value == null || value.IsOrigin || value.Kind != expected) throw new ArgumentException("Missing or wrong-kind source reference");
            switch (value.Type)
            {
                case "principal" when expected == QuestReferenceKind.Plane && new[] { "XY", "XZ", "YZ" }.Contains(value.Principal):
                    return new Dictionary<string, object> { ["type"] = "principal", ["planeKind"] = value.Principal };
                case "principal" when expected == QuestReferenceKind.Axis && new[] { "X", "Y", "Z" }.Contains(value.Principal):
                    return new Dictionary<string, object> { ["type"] = "principal", ["axis"] = value.Principal };
                case "datum" when !string.IsNullOrWhiteSpace(value.FeatureId) && value.NativeKind == NativeKind(expected):
                    return new Dictionary<string, object> { ["type"] = "datum", ["featureId"] = value.FeatureId };
                case "face" when expected == QuestReferenceKind.Plane && !string.IsNullOrWhiteSpace(value.FeatureId) && !string.IsNullOrWhiteSpace(value.PersistentId):
                    return new Dictionary<string, object> { ["type"] = "face", ["featureId"] = value.FeatureId, ["persistentFaceId"] = value.PersistentId };
                case "edge" when expected == QuestReferenceKind.Axis && !string.IsNullOrWhiteSpace(value.FeatureId) && !string.IsNullOrWhiteSpace(value.PersistentId):
                    return new Dictionary<string, object> { ["type"] = "edge", ["featureId"] = value.FeatureId, ["persistentEdgeId"] = value.PersistentId };
                case "coordinates" when expected == QuestReferenceKind.Point && value.PositionMm != null && value.PositionMm.Length == 3 &&
                    value.PositionMm.All(number => !double.IsNaN(number) && !double.IsInfinity(number) && Math.Abs(number) <= CoordinateLimitMm):
                    return new Dictionary<string, object> { ["type"] = "coordinates", ["positionMm"] = value.PositionMm.ToArray() };
                default: throw new ArgumentException("Invalid, missing, or wrong-kind source reference");
            }
        }

        static object Reference(IDictionary<string, object> fields, string name, QuestReferenceKind expected)
        {
            if (!fields.TryGetValue(name, out var raw) || raw is not QuestReferenceValue value) throw new ArgumentException("Choose source: " + name);
            return ReferenceObject(value, expected);
        }

        static string NativeKind(QuestReferenceKind kind) => kind switch
        { QuestReferenceKind.Plane => "DatumPlane", QuestReferenceKind.Axis => "DatumAxis", _ => "DatumPoint" };
        static string[] Operations(QuestReferenceKind kind) => kind switch
        { QuestReferenceKind.Plane => PlaneOperations, QuestReferenceKind.Axis => AxisOperations, _ => PointOperations };
        static string KindName(QuestReferenceKind kind) => kind switch
        { QuestReferenceKind.Plane => "Piano", QuestReferenceKind.Axis => "Asse", _ => "Punto" };
        static string KindName(string kind) => kind switch
        { "DatumPlane" => "Piano", "DatumAxis" => "Asse", "DatumPoint" => "Punto", _ => "Datum" };
        static bool KindFromNative(string kind, out QuestReferenceKind result)
        {
            result = kind switch { "DatumPlane" => QuestReferenceKind.Plane, "DatumAxis" => QuestReferenceKind.Axis, "DatumPoint" => QuestReferenceKind.Point, _ => QuestReferenceKind.Point };
            return kind is "DatumPlane" or "DatumAxis" or "DatumPoint";
        }
        static string OperationName(string operation) => operation switch
        {
            "principal" => "Principale", "offset" => "Offset piano", "mid" => "Mediano", "angle" => "Angolo",
            "threePoint" => "Tre punti", "twoPoint" => "Due punti", "planeNormal" => "Normale al piano",
            "planeIntersection" => "Intersezione piani", "coordinates" => "Coordinate", "midpoint" => "Punto medio", _ => operation ?? "Schema in attesa"
        };

        bool CaptureCurrent()
        {
            var client = Connection?.Client;var model = client?.Model;
            if (Connection == null || !Connection.Connected || client == null || model == null || string.IsNullOrEmpty(model.SessionId) || string.IsNullOrEmpty(model.DocumentId))
            { Status = "Collega un PC e attendi un modello corrente";Notify();return false; }
            _capturedClient = client;_sessionId = model.SessionId;_documentId = model.DocumentId;_revision = model.Revision;
            _connectionGeneration = Connection.ConnectionGeneration;return true;
        }

        bool CaptureIsCurrent()
        {
            var model = Connection?.Client?.Model;
            return Connection != null && Connection.Connected && ReferenceEquals(Connection.Client, _capturedClient) &&
                Connection.ConnectionGeneration == _connectionGeneration && model != null && model.SessionId == _sessionId &&
                model.DocumentId == _documentId && model.Revision == _revision;
        }

        void EnsureSubscribed()
        { if (!_subscribed && Connection != null) { Connection.SceneChanged += SceneChanged;_subscribed = true; } }
        void Update()
        { if (_mode == Mode.Form && !CaptureIsCurrent()) CancelStale(); }
        void SceneChanged()
        { if (_mode == Mode.Form && !CaptureIsCurrent()) CancelStale(); }
        void CancelStale()
        { _mode = Mode.Home;_schemaReady = false;_formTicket++;_inputTicket++;Status = "Contesto o sorgente cambiato · ricomincia";Notify(); }
        void Notify() { Changed?.Invoke(); }
        public event Action Changed;

        QuestDatumView CurrentSelectedPlane()
        {
            if (string.IsNullOrEmpty(_selectedDatumId) || Connection == null) return null;
            var view = Connection.DatumViews.FirstOrDefault(candidate => candidate.FeatureId == _selectedDatumId && candidate.NativeKind == "DatumPlane" && candidate.NativeStatus == "ok");
            return view != null && Connection.IsCurrentDatum(view) ? view : null;
        }

        string CurrentSelectedDatumId()
        {
            var model = Connection?.Client?.Model;
            if (model == null || Connection == null) return null;
            return Connection.DatumViews.FirstOrDefault(Connection.IsCurrentDatum)?.FeatureId;
        }

        List<JsonElement> DatumRecords()
        {
            var model = Connection?.Client?.Model;
            return model?.Datums?.Where(item => item.ValueKind == JsonValueKind.Object).OrderBy(item => ReadText(item, "featureId"), StringComparer.Ordinal).ToList()
                ?? new List<JsonElement>();
        }

        JsonElement FindDatum(string featureId) => string.IsNullOrEmpty(featureId) ? default :
            DatumRecords().FirstOrDefault(item => ReadText(item, "featureId") == featureId);

        static bool TryDefinition(JsonElement datum, out JsonElement definition)
        { definition = default;return datum.ValueKind == JsonValueKind.Object && datum.TryGetProperty("definition", out definition) && definition.ValueKind == JsonValueKind.Object; }
        static string ReadText(JsonElement item, string property) => item.ValueKind == JsonValueKind.Object && item.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

        void SetFields(bool reset)
        {
            _fields.Clear();
            void Numeric(string key, string label, string unit, double min = -CoordinateLimitMm, double max = CoordinateLimitMm) =>
                _fields.Add(new Field { Key = key, Label = label, Unit = unit, Kind = QuestReferenceValueKind.Numeric, Minimum = min, Maximum = max });
            void Ref(string key, string label, QuestReferenceValueKind kind) =>
                _fields.Add(new Field { Key = key, Label = label, Unit = "sorgente", Kind = kind });
            switch (_kind, _operation)
            {
                case (QuestReferenceKind.Plane, "principal"): _fields.Add(new Field { Key = "planeKind", Label = "Piano base", Unit = "", Kind = QuestReferenceValueKind.Choice }); break;
                case (QuestReferenceKind.Plane, "offset"): Ref("base", "Piano base", QuestReferenceValueKind.Plane);Numeric("offsetMm", "Scostamento", "mm");break;
                case (QuestReferenceKind.Plane, "mid"): Ref("first", "Primo piano", QuestReferenceValueKind.Plane);Ref("second", "Secondo piano", QuestReferenceValueKind.Plane);break;
                case (QuestReferenceKind.Plane, "angle"): Ref("base", "Piano base", QuestReferenceValueKind.Plane);Ref("axis", "Asse", QuestReferenceValueKind.Axis);Numeric("angleDeg", "Angolo", "deg", -360, 360);break;
                case (QuestReferenceKind.Plane, "threePoint"): Ref("first", "Primo punto", QuestReferenceValueKind.Point);Ref("second", "Secondo punto", QuestReferenceValueKind.Point);Ref("third", "Terzo punto", QuestReferenceValueKind.Point);break;
                case (QuestReferenceKind.Axis, "twoPoint"): Ref("first", "Primo punto", QuestReferenceValueKind.Point);Ref("second", "Secondo punto", QuestReferenceValueKind.Point);break;
                case (QuestReferenceKind.Axis, "planeNormal"): Ref("plane", "Piano", QuestReferenceValueKind.Plane);Ref("through", "Passa per (origine o punto)", QuestReferenceValueKind.OptionalPoint);break;
                case (QuestReferenceKind.Axis, "planeIntersection"): Ref("first", "Primo piano", QuestReferenceValueKind.Plane);Ref("second", "Secondo piano", QuestReferenceValueKind.Plane);break;
                case (QuestReferenceKind.Point, "coordinates"): Numeric("xMm", "X", "mm");Numeric("yMm", "Y", "mm");Numeric("zMm", "Z", "mm");break;
                case (QuestReferenceKind.Point, "midpoint"): Ref("first", "Primo punto", QuestReferenceValueKind.Point);Ref("second", "Secondo punto", QuestReferenceValueKind.Point);break;
            }
            if (reset)
            {
                _values.Clear();
                foreach (var field in _fields)
                {
                    if (field.Kind == QuestReferenceValueKind.Numeric) _values[field.Key] = 0d;
                    else if (field.Kind == QuestReferenceValueKind.Choice) _values[field.Key] = "XY";
                    else if (field.Kind == QuestReferenceValueKind.OptionalPoint) _values[field.Key] = QuestReferenceValue.PlaneOrigin();
                }
            }
            _fieldIndex = Math.Min(_fieldIndex, Math.Max(0, _fields.Count - 1));
        }

        Field CurrentField() => _fields.Count == 0 ? null : _fields[_fieldIndex % _fields.Count];
        QuestReferenceValue CoordinateValue(Field field) => field != null && _values.TryGetValue(field.Key, out var raw) && raw is QuestReferenceValue value && value.Type == "coordinates" ? value : null;

        string CurrentFieldText(bool value)
        {
            var field = CurrentField();if (field == null) return _mode == Mode.Form ? "Schema in attesa" : ModeLabel;
            var coordinate = CoordinateValue(field);
            if (coordinate != null) return (value ? NumericValue + " mm" : field.Label + " · " + "XYZ"[_coordinateAxis] + " · mm");
            if (!_values.TryGetValue(field.Key, out var raw)) return field.Label + " · scegli valore";
            if (raw is QuestReferenceValue source) return value ? source.Label + " · " + source.Status : field.Label + " · sorgente";
            if (raw is double number) return value ? number.ToString("0.###", CultureInfo.InvariantCulture) + " " + field.Unit : field.Label + " · " + field.Unit;
            return value ? raw.ToString() : field.Label;
        }

        List<QuestReferenceValue> SourceChoices()
        {
            var field = CurrentField();if (field == null || !CurrentFieldIsSource) return new List<QuestReferenceValue>();
            var expected = field.Kind == QuestReferenceValueKind.OptionalPoint ? QuestReferenceKind.Point : field.Kind switch
            { QuestReferenceValueKind.Plane => QuestReferenceKind.Plane, QuestReferenceValueKind.Axis => QuestReferenceKind.Axis, _ => QuestReferenceKind.Point };
            var choices = new List<QuestReferenceValue>();
            if (field.Kind == QuestReferenceValueKind.Plane)
                choices.AddRange(new[] { "XY", "XZ", "YZ" }.Select(QuestReferenceValue.PrincipalPlane));
            else if (field.Kind == QuestReferenceValueKind.Axis)
                choices.AddRange(new[] { "X", "Y", "Z" }.Select(QuestReferenceValue.PrincipalAxis));
            else
            {
                if (field.Kind == QuestReferenceValueKind.OptionalPoint) choices.Add(QuestReferenceValue.PlaneOrigin());
                var coordinate = QuestReferenceValue.Coordinates(0, 0, 0);choices.Add(coordinate);
            }
            IEnumerable<QuestDatumView> views = Connection != null ? Connection.DatumViews : Array.Empty<QuestDatumView>();
            foreach (var view in views)
            {
                if (!Connection.IsCurrentDatum(view) || view.NativeStatus != "ok" || view.NativeKind != NativeKind(expected)) continue;
                var source = QuestReferenceValue.Datum(expected, view.FeatureId, view.NativeKind, "ok");
                source.TrustedNative = true;source.Label = KindName(view.NativeKind) + " · " + view.FeatureId;choices.Add(source);
            }
            if (expected == QuestReferenceKind.Plane && _pickedFace || expected == QuestReferenceKind.Axis && !_pickedFace)
            {
                var picked = PickedChoice(expected);
                if (picked != null) choices.Add(picked);
            }
            if (_values.TryGetValue(field.Key, out var current) && current is QuestReferenceValue selected &&
                !choices.Any(item => item.Type == selected.Type && item.FeatureId == selected.FeatureId && item.PersistentId == selected.PersistentId && item.Principal == selected.Principal))
                choices.Add(selected);
            return choices;
        }

        QuestReferenceValue PickedChoice(QuestReferenceKind expected)
        {
            if (_pickedView == null || _pickedHit == null || _pickedHit.ReferenceAmbiguous || _pickedView.InstanceId != null ||
                !Connection.IsCurrentView(_pickedView) || string.IsNullOrWhiteSpace(_pickedHit.PersistentId)) return null;
            QuestReferenceValue choice = expected == QuestReferenceKind.Plane
                ? QuestReferenceValue.Face(_pickedView.FeatureId, _pickedHit.PersistentId)
                : QuestReferenceValue.Edge(_pickedView.FeatureId, _pickedHit.PersistentId);
            choice.OwnerView = _pickedView;choice.Hit = _pickedHit;choice.UploadVersion = _pickedView.UploadVersion;
            choice.SetStatus("selezione corrente · planarità/linearità validate dal PC");choice.TrustedNative = true;
            return choice;
        }

        bool SourceCurrent(QuestReferenceValue source, QuestReferenceValueKind fieldKind)
        {
            if (source == null) return false;
            if (source.IsOrigin) return fieldKind == QuestReferenceValueKind.OptionalPoint;
            if (source.Type == "principal") return source.TrustedNative &&
                (fieldKind == QuestReferenceValueKind.Plane && source.Kind == QuestReferenceKind.Plane || fieldKind == QuestReferenceValueKind.Axis && source.Kind == QuestReferenceKind.Axis);
            if (source.Type == "coordinates") return source.Kind == QuestReferenceKind.Point && source.PositionMm != null && source.PositionMm.Length == 3 &&
                source.PositionMm.All(number => !double.IsNaN(number) && !double.IsInfinity(number) && Math.Abs(number) <= CoordinateLimitMm);
            if (source.OwnerView != null)
                return source.TrustedNative && source.OwnerView.InstanceId == null && source.OwnerView.UploadVersion == source.UploadVersion &&
                    Connection.IsCurrentView(source.OwnerView) && source.Hit != null && !source.Hit.ReferenceAmbiguous && source.Hit.PersistentId == source.PersistentId &&
                    (source.Type == "face" && fieldKind == QuestReferenceValueKind.Plane || source.Type == "edge" && fieldKind == QuestReferenceValueKind.Axis);
            if (source.Type == "datum")
            {
                var view = Connection?.DatumViews.FirstOrDefault(candidate => candidate.FeatureId == source.FeatureId);
                return source.TrustedNative && source.Status == "ok" && source.NativeKind == NativeKind(source.Kind) && view != null &&
                    view.NativeKind == source.NativeKind && view.NativeStatus == "ok" && Connection.IsCurrentDatum(view) &&
                    (fieldKind == QuestReferenceValueKind.OptionalPoint || source.Kind == FieldExpected(fieldKind));
            }
            if (source.Type is "face" or "edge") return source.TrustedNative && _recordStatus == "ok" && CaptureIsCurrent() &&
                (source.Type == "face" && fieldKind == QuestReferenceValueKind.Plane || source.Type == "edge" && fieldKind == QuestReferenceValueKind.Axis) &&
                !string.IsNullOrWhiteSpace(source.FeatureId) && !string.IsNullOrWhiteSpace(source.PersistentId);
            return false;
        }

        static QuestReferenceKind FieldExpected(QuestReferenceValueKind field) => field switch
        { QuestReferenceValueKind.Plane => QuestReferenceKind.Plane, QuestReferenceValueKind.Axis => QuestReferenceKind.Axis, _ => QuestReferenceKind.Point };

        void LoadDefinition(JsonElement definition, bool trusted)
        {
            foreach (var field in _fields)
            {
                if (field.Kind == QuestReferenceValueKind.OptionalPoint && !definition.TryGetProperty(field.Key, out _))
                { _values[field.Key] = QuestReferenceValue.PlaneOrigin();continue; }
                if (!definition.TryGetProperty(field.Key, out var value)) continue;
                if (field.Kind == QuestReferenceValueKind.Numeric && value.ValueKind == JsonValueKind.Number) _values[field.Key] = value.GetDouble();
                else if (field.Kind == QuestReferenceValueKind.Choice && value.ValueKind == JsonValueKind.String) _values[field.Key] = value.GetString();
                else if (field.Kind is QuestReferenceValueKind.Plane or QuestReferenceValueKind.Axis or QuestReferenceValueKind.Point or QuestReferenceValueKind.OptionalPoint)
                    _values[field.Key] = ParseReference(value, field.Kind == QuestReferenceValueKind.OptionalPoint ? QuestReferenceKind.Point : FieldExpected(field.Kind), trusted);
            }
            if (_kind == QuestReferenceKind.Point && _operation == "coordinates" && definition.TryGetProperty("positionMm", out var position) && position.ValueKind == JsonValueKind.Array && position.GetArrayLength() == 3)
            { _values["xMm"] = position[0].GetDouble();_values["yMm"] = position[1].GetDouble();_values["zMm"] = position[2].GetDouble(); }
        }

        QuestReferenceValue ParseReference(JsonElement value, QuestReferenceKind expected, bool trusted)
        {
            var type = ReadText(value, "type");QuestReferenceValue source;
            switch (type)
            {
                case "principal": source = expected == QuestReferenceKind.Plane
                    ? QuestReferenceValue.PrincipalPlane(ReadText(value, "planeKind")) : QuestReferenceValue.PrincipalAxis(ReadText(value, "axis"));break;
                case "datum":
                    var id = ReadText(value, "featureId");var datum = FindDatum(id);
                    source = QuestReferenceValue.Datum(expected, id, ReadText(datum, "kind"), ReadText(datum, "status"));break;
                case "face": source = QuestReferenceValue.Face(ReadText(value, "featureId"), ReadText(value, "persistentFaceId"));break;
                case "edge": source = QuestReferenceValue.Edge(ReadText(value, "featureId"), ReadText(value, "persistentEdgeId"));break;
                case "coordinates":
                    if (!value.TryGetProperty("positionMm", out var position) || position.ValueKind != JsonValueKind.Array || position.GetArrayLength() != 3)
                        throw new FormatException("Coordinate source requires X, Y, Z");
                    source = QuestReferenceValue.Coordinates(position[0].GetDouble(), position[1].GetDouble(), position[2].GetDouble());break;
                default: throw new FormatException("Unknown native source reference");
            }
            source.TrustedNative = trusted;source.SetStatus(source.Type == "datum" ? (source.Status ?? "missing/broken") : trusted ? "record PC sano" : "record rotto");
            return source;
        }

        string FormatDefinition(JsonElement definition, QuestReferenceKind kind)
        {
            var type = ReadText(definition, "type") ?? "costruzione sconosciuta";
            var parts = new List<string> { KindName(kind) + " · " + OperationName(type) };
            foreach (var field in new[] { "planeKind", "offsetMm", "angleDeg", "base", "axis", "plane", "through", "first", "second", "third", "positionMm" })
            {
                if (!definition.TryGetProperty(field, out var value)) continue;
                var name = field switch { "planeKind" => "piano", "offsetMm" => "scostamento", "angleDeg" => "angolo", "positionMm" => "posizione", _ => field };
                var formatted = value.ValueKind == JsonValueKind.Object ? FormatSource(value) : value.ValueKind == JsonValueKind.Array
                    ? string.Join(", ", value.EnumerateArray().Select(item => item.GetDouble().ToString("0.###", CultureInfo.InvariantCulture))) + " mm"
                    : value.ValueKind == JsonValueKind.Number ? value.GetDouble().ToString("0.###", CultureInfo.InvariantCulture) + (field == "angleDeg" ? " deg" : field == "offsetMm" ? " mm" : "")
                    : value.ToString();
                parts.Add(name + ": " + formatted);
            }
            return string.Join("\n", parts);
        }

        string FormatSource(JsonElement source)
        {
            var type = ReadText(source, "type");
            if (type == "principal") return "principale " + (ReadText(source, "planeKind") ?? ReadText(source, "axis"));
            if (type == "datum") return "datum " + (ReadText(source, "featureId") ?? "ID assente");
            if (type == "face") return "faccia " + ReadText(source, "featureId") + " / " + ReadText(source, "persistentFaceId");
            if (type == "edge") return "bordo " + ReadText(source, "featureId") + " / " + ReadText(source, "persistentEdgeId");
            if (type == "coordinates" && source.TryGetProperty("positionMm", out var position) && position.ValueKind == JsonValueKind.Array)
                return "coordinate " + string.Join(", ", position.EnumerateArray().Select(item => item.GetDouble().ToString("0.###", CultureInfo.InvariantCulture))) + " mm";
            return type ?? "sorgente non leggibile";
        }

        static string FormatResolved(JsonElement resolved, string kind)
        {
            string Vector(string key) => resolved.TryGetProperty(key, out var vector) && vector.ValueKind == JsonValueKind.Array
                ? string.Join(", ", vector.EnumerateArray().Select(item => item.GetDouble().ToString("0.###", CultureInfo.InvariantCulture))) : "—";
            if (kind == "DatumPlane") return "Risolto mm · origine [" + Vector("originMm") + "]\nx [" + Vector("xAxis") + "] · y [" + Vector("yAxis") + "] · normale [" + Vector("normal") + "]";
            if (kind == "DatumAxis") return "Risolto mm · origine [" + Vector("originMm") + "]\ndirezione [" + Vector("direction") + "]";
            if (kind == "DatumPoint") return "Risolto mm · posizione [" + Vector("positionMm") + "]";
            return "Tipo geometria sconosciuto";
        }

        public void OnApplicationFocus(bool focus) { if (!focus && _mode == Mode.Form) Cancel(); }
        public void OnApplicationPause(bool pause) { if (pause && _mode == Mode.Form) Cancel(); }
        void OnDestroy() { if (_subscribed && Connection != null) Connection.SceneChanged -= SceneChanged; }
    }
}
