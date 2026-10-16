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
using Kreoda.Session.Generated;
using UnityEngine;

namespace Kreoda.QuestRuntime
{
    // Availability, schema and bound geometry parameters come from the PC registry.
    public sealed class QuestCommands : MonoBehaviour
    {
        public QuestConnection Connection;
        public QuestSpatialEdit Spatial;
        public string Status { get; private set; } = "Seleziona geometria per le azioni";
        public string CommandLabel => _command?.Label ?? "Nessuna azione";
        public string FieldLabel => _fields.Count == 0 ? "Nessun valore richiesto" : _fields[_field];
        public string FieldValue => _fields.Count == 0 ? "" : JsonSerializer.Serialize(_values.GetValueOrDefault(_fields[_field]));
        public bool Busy { get; private set; }
        public long FormTicket => _ticket;
        public string SelectedField => _fields.Count == 0 ? null : _fields[_field];
        readonly ConcurrentQueue<Action> _main = new ConcurrentQueue<Action>();
        ContextCommandsPayload _context;
        ContextCommandInfo _command;
        JsonElement _schema;
        readonly Dictionary<string, object> _values = new Dictionary<string, object>(StringComparer.Ordinal);
        readonly List<string> _fields = new List<string>();
        QuestMeshView _view;
        QuestDatumView _datum;
        long _datumRevision;
        SessionClient _selectionClient;
        SessionModelState _selectionModel;
        long _selectionGeneration;
        int _upload, _index, _field;
        long _ticket;
        CancellationTokenSource _commandRun;
        bool _destroyed;
        string _requestedCommand;

        public void Select(QuestMeshView view, MeshSemanticHit hit)
        {
            _requestedCommand = null;Invalidate();_datum = null;_view = view;_upload = view != null ? view.UploadVersion : 0;
            var ticket = _ticket;
            if (view == null || !Connection.IsCurrentView(view)) return;
            if (hit?.ReferenceAmbiguous == true) { Status = "Riferimento ambiguo: scegli altro bordo o faccia";return; }
            var ids = new[] { hit?.PersistentId ?? view.InstanceId ?? view.FeatureId };
            var client = Connection.Client;var model = client.Model;
            CaptureSelection(client);
            _ = Load(client, ids, model.DocumentId, model.Revision, ticket);
        }
        public void SelectDatum(QuestDatumView view)
        { SelectDatumCore(view, false); }

        public bool SelectDatumCommand(QuestDatumView view, string commandId)
        {
            if (string.IsNullOrWhiteSpace(commandId) || !Connection.IsCurrentDatum(view)) return false;
            _requestedCommand = commandId;SelectDatumCore(view, true);return true;
        }

        void SelectDatumCore(QuestDatumView view, bool preserveRequestedCommand)
        {
            if (!preserveRequestedCommand) _requestedCommand = null;
            Invalidate();_view = null;_datum = view;
            if (!Connection.IsCurrentDatum(view)) { Status = "Riferimento non corrente";return; }
            var client = Connection.Client;var model = client.Model;
            CaptureSelection(client);
            _datumRevision = model.Revision;
            _ = Load(client, new[] { view.FeatureId }, model.DocumentId, model.Revision, _ticket);
        }
        void CaptureSelection(SessionClient client)
        {
            _selectionClient = client;_selectionModel = client.Model;
            _selectionGeneration = Connection.ConnectionGeneration;
        }
        bool CurrentSelection()
        {
            var model = Connection.Client?.Model;
            return _selectionClient != null && ReferenceEquals(_selectionClient, Connection.Client) &&
                _selectionGeneration == Connection.ConnectionGeneration && model != null && _selectionModel != null &&
                model.SessionId == _selectionModel.SessionId && model.DocumentId == _selectionModel.DocumentId &&
                model.Revision == _selectionModel.Revision &&
                (_datum != null ? Connection.IsCurrentDatum(_datum) : Connection.IsCurrentView(_view));
        }
        async Task Load(Kreoda.Session.SessionClient client, string[] ids, string documentId, long revision, long ticket)
        {
            try
            {
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
                var context = await client.ContextCommandsAsync(ids, documentId, revision, timeout.Token).ConfigureAwait(false);
                _main.Enqueue(() => {
                    if (!Current(ticket) || Connection.Client != client || !CurrentSelection() ||
                        client.Model?.DocumentId != documentId || client.Model.Revision != revision) return;
                    _context = context;
                    if (!string.IsNullOrEmpty(_requestedCommand))
                    {
                        var requested = _requestedCommand;_requestedCommand = null;
                        _index = Array.FindIndex(context.Commands, command => command.Id == requested && command.Available);
                    }
                    else _index = Array.FindIndex(context.Commands, command => command.Available && command.BoundParameters.Count > 0);
                    if (_index < 0) _index = 0;
                    Choose();
                });
            }
            catch (Exception error) { PostError(ticket, error); }
        }
        public void NextCommand()
        {
            if (Busy || _context == null || _context.Commands.Length == 0) return;
            _requestedCommand = null;
            _index = (_index + 1) % _context.Commands.Length;Choose();
        }
        void Choose()
        {
            _schema = default;
            _fields.Clear();_values.Clear();_field = 0;
            _command = _context.Commands[_index];
            Status = _command.Available ? "Imposta valori, poi Conferma" : _command.Reason;
            if (!_command.Available) return;
            var ticket = ++_ticket;var command = _command;
            _ = Schema(command, ticket);
        }
        async Task Schema(ContextCommandInfo command, long ticket)
        {
            try
            {
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
                var client = Connection.Client;
                var raw = await client.CallAsync(SessionMethods.GetCommandSchema, new Dictionary<string, object> { ["id"] = command.Id }, timeout.Token,
                    expectedSessionId: _context.SessionId).ConfigureAwait(false);
                var schema = raw.GetProperty("result").GetProperty("parameters").Clone();
                _main.Enqueue(() => {
                    if (!Current(ticket) || !ReferenceEquals(command, _command) || !CurrentSelection()) return;
                    _schema = schema;
                    foreach (var bound in command.BoundParameters) _values[bound.Key] = bound.Value;
                    if (schema.TryGetProperty("properties", out var properties)) foreach (var property in properties.EnumerateObject())
                    {
                        if (command.BoundParameters.ContainsKey(property.Name)) continue;
                        _fields.Add(property.Name);
                        if (property.Value.TryGetProperty("default", out var value)) _values[property.Name] = value.Clone();
                        else if (property.Value.TryGetProperty("enum", out var choices)) _values[property.Name] = choices[0].Clone();
                        else if (property.Value.TryGetProperty("type", out var type) && type.GetString() is "number" or "integer") _values[property.Name] = 1d;
                    }
                });
            }
            catch (Exception error) { PostError(ticket, error); }
        }
        public void NextField() { if (!Busy && _fields.Count > 0) _field = (_field + 1) % _fields.Count; }
        public bool SetField(string name, string text)
        {
            if (Busy || !_fields.Contains(name) || _schema.ValueKind != JsonValueKind.Object) return false;
            var specification = _schema.GetProperty("properties").GetProperty(name);
            try
            {
                object value;
                var type = specification.TryGetProperty("type", out var rawType) ? rawType.GetString() : "object";
                if (type is "number" or "integer")
                {
                    if (!double.TryParse(text.Replace(',', '.'), NumberStyles.Float, CultureInfo.InvariantCulture, out var number) ||
                        double.IsNaN(number) || double.IsInfinity(number) || type == "integer" && Math.Truncate(number) != number) return false;
                    value = number;
                }
                else if (type == "string") value = text;
                else { using var parsed = JsonDocument.Parse(text);value = parsed.RootElement.Clone(); }
                _values[name] = value;return true;
            }
            catch (JsonException) { return false; }
        }
        public void Confirm()
        {
            if (Busy || Spatial?.Busy == true || _schema.ValueKind != JsonValueKind.Object || _context == null || _command?.Available != true || !CurrentSelection()) return;
            var required = _schema.TryGetProperty("required", out var names) ? names.EnumerateArray().Select(p => p.GetString()) : Enumerable.Empty<string>();
            if (required.Any(name => !_values.ContainsKey(name))) { Status = "Completa tutti i valori richiesti";return; }
            Execute(_command.Id, new Dictionary<string, object>(_values), _context.SessionId, _context.DocumentId, _context.Revision, _selectionClient, _selectionGeneration);
        }
        public void History(bool redo)
        {
            if (Busy || Spatial?.Busy == true) return;
            var client = Connection.Client;var model = client?.Model;if (model == null) return;
            Execute(redo ? "Redo" : "Undo", new Dictionary<string, object>(), model.SessionId, model.DocumentId, model.Revision, client, Connection.ConnectionGeneration);
        }

        public void PrepareReference(QuestReferences form, long formTicket, string commandId, string targetFeatureId)
        {
            if (form == null || Connection == null || !form.CanAcceptSchema(formTicket, commandId, targetFeatureId) ||
                !form.CapturedContext(out var client, out var session, out var document, out var revision, out var generation)) return;
            _ = LoadReferenceSchema(form, formTicket, commandId, targetFeatureId, client, session, document, revision, generation);
        }

        async Task LoadReferenceSchema(QuestReferences form, long ticket, string id, string targetFeatureId,
            SessionClient client, string session, string document, long revision, long generation)
        {
            try
            {
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
                var selection = targetFeatureId == null ? Array.Empty<string>() : new[] { targetFeatureId };
                var context = await client.ContextCommandsAsync(selection, document, revision, timeout.Token).ConfigureAwait(false);
                var raw = await client.CallAsync(SessionMethods.GetCommandSchema,
                    new Dictionary<string, object> { ["id"] = id }, timeout.Token, expectedSessionId: session).ConfigureAwait(false);
                var schema = raw.GetProperty("result").GetProperty("parameters").Clone();
                _main.Enqueue(() =>
                {
                    if (!form.CanAcceptSchema(ticket, id, targetFeatureId) || !form.CapturedContext(out var currentClient,
                        out var currentSession, out var currentDocument, out var currentRevision, out var currentGeneration) ||
                        !ReferenceEquals(currentClient, client) || currentSession != session || currentDocument != document ||
                        currentRevision != revision || currentGeneration != generation || context.SessionId != session ||
                        context.DocumentId != document || context.Revision != revision) return;
                    var command = context.Commands.FirstOrDefault(item => item.Id == id);
                    form.AcceptCanonical(ticket, id, command, schema);
                });
            }
            catch (Exception error)
            { _main.Enqueue(() => form.CanonicalError(ticket, id, error)); }
        }

        public bool SubmitReference(QuestReferences form)
        {
            if (Busy || Spatial?.Busy == true || form == null || !form.TrySubmit(out var id, out var values) ||
                !form.CapturedContext(out var client, out var session, out var document, out var revision, out var generation) ||
                !ReferenceEquals(Connection.Client, client) || Connection.ConnectionGeneration != generation ||
                form.CanonicalCommand?.Available != true || form.CanonicalCommand.Id != id)
                return false;
            var referenceTicket = form.MarkSubmitted(client, session, document, generation);
            Execute(id, values, session, document, revision, client, generation, form, referenceTicket, form.FormTicket);
            return true;
        }

        void Execute(string id, Dictionary<string, object> values, string session, string document, long revision,
            SessionClient client, long connectionGeneration, QuestReferences reference = null, long referenceTicket = 0, long referenceFormTicket = 0)
        {
            Busy = true;Status = "Operazione sul PC…";
            var ticket = ++_ticket;
            _commandRun = new CancellationTokenSource(TimeSpan.FromSeconds(15));var run = _commandRun;
            _ = Task.Run(async () => {
                var commandStarted = false;
                var commandAcknowledged = false;
                try
                {
                    if (!ReferenceEquals(Connection.Client, client) || Connection.ConnectionGeneration != connectionGeneration ||
                        !Connection.Connected || client.Model?.SessionId != session || client.Model.DocumentId != document || client.Model.Revision != revision)
                        throw new SessionException("NEED_FULL_SNAPSHOT", "command context is stale");
                    // One PC command; no local preview simulation or blind retry.
                    commandStarted = true;
                    await client.CommandAsync(id, values.ToDictionary(p => p.Key, p => (object)p.Value), document,
                        baseRevision: revision, ct: run.Token).ConfigureAwait(false);
                    commandAcknowledged = true;
                    using var refresh = new CancellationTokenSource(TimeSpan.FromSeconds(10));
                    await client.SnapshotAsync(document, refresh.Token).ConfigureAwait(false);
                    _main.Enqueue(() => { if (Current(ticket)) Status = "Documento PC aggiornato"; });
                    if (reference != null) PostReferenceResult(reference, referenceTicket, referenceFormTicket, client,
                        session, document, connectionGeneration, "Riferimento " + reference.SubmissionAction + " sul PC");
                }
                catch (Exception error)
                {
                    if (reference != null) PostReferenceResult(reference, referenceTicket, referenceFormTicket, client,
                        session, document, connectionGeneration, ReferenceFailure(commandStarted, commandAcknowledged, error));
                    try { using var refresh = new CancellationTokenSource(TimeSpan.FromSeconds(5));await client.SnapshotAsync(document, refresh.Token).ConfigureAwait(false); } catch { }
                    PostError(ticket, error);
                }
                finally { _main.Enqueue(() => {
                    if (!Current(ticket)) return;
                    Busy = false;
                    var currentModel = Connection.Client?.Model;
                    if (!ReferenceEquals(Connection.Client, client) || Connection.ConnectionGeneration != connectionGeneration ||
                        currentModel?.SessionId != session || currentModel.DocumentId != document) return;
                    if (_datum != null)
                    {
                        var selected = Connection.DatumViews.FirstOrDefault(view => view.FeatureId == _datum.FeatureId && Connection.IsCurrentDatum(view));
                        if (selected != null) SelectDatum(selected);
                    }
                    else if (Connection.IsCurrentView(_view)) Select(_view, null);
                });run.Dispose(); }
            });
        }
        bool Current(long ticket) => !_destroyed && ticket == _ticket;
        void PostError(long ticket, Exception error) => _main.Enqueue(() => { if (Current(ticket)) Status = "Operazione non confermata · " + (error is SessionException session ? session.Code : "INVALID_COMMAND"); });
        void PostReferenceResult(QuestReferences reference, long ticket, long formTicket, SessionClient client,
            string session, string document, long generation, string result) => _main.Enqueue(() =>
                reference.CompleteSubmission(ticket, formTicket, client, session, document, generation, result));

        static string ReferenceFailure(bool commandStarted, bool commandAcknowledged, Exception error)
        {
            var code = error is SessionException session ? session.Code : "errore";
            var message = error is SessionException failure ? failure.Message : "errore di connessione";
            if (message.Length > 100) message = message.Substring(0, 97) + "…";
            if (!commandStarted) return "Comando non inviato · contesto cambiato (" + code + ")";
            if (commandAcknowledged) return "PC ha accettato · vista non aggiornata (" + code + ")";
            if (error is SessionException rejected && IsConfirmedRejection(rejected.Code))
                return "PC ha rifiutato · " + rejected.Code + ": " + message;
            return "Esito incerto · controlla PC/documento (" + code + ")";
        }

        static bool IsConfirmedRejection(string code) => code is "BAD_PARAMS" or "BUSY" or "DATUM_FAILED" or
            "INVALID_COMMAND" or "NOT_FOUND" or "NOT_IMPLEMENTED" or "NO_TRANSACTION" ||
            code.StartsWith("TRANSACTION_", StringComparison.Ordinal);
        void Invalidate()
        {
            _ticket++;try { _commandRun?.Cancel(); } catch (ObjectDisposedException) { }
            _commandRun = null;_context = null;_command = null;_schema = default;_fields.Clear();_values.Clear();Busy = false;
            _selectionClient = null;_selectionModel = null;
        }
        void Update() { for (var i = 0; i < 2 && _main.TryDequeue(out var action); i++) if (!_destroyed) action(); }
        void Start() { Connection.SceneChanged += Changed; }
        void Changed()
        {
            if (Busy) return;
            if (_datum != null)
            {
                if (!Connection.IsCurrentDatum(_datum))
                {
                    var model = Connection.Client?.Model;
                    if (model == null) return;
                    if (model.SessionId != _datum.SessionId || model.DocumentId != _datum.DocumentId)
                    { Invalidate();_datum = null;Status = "Riferimento non corrente"; }
                    else
                    {
                        var replacement = Connection.DatumViews.FirstOrDefault(view => view.FeatureId == _datum.FeatureId && Connection.IsCurrentDatum(view));
                        if (replacement != null) SelectDatum(replacement);
                        else if (Connection.Connected) { Invalidate();_datum = null;Status = "Riferimento non corrente"; }
                    }
                }
                else if (!CurrentSelection() || _datum.Revision != _datumRevision) SelectDatum(_datum);
            }
            else if (_view != null && (!CurrentSelection() || _view.UploadVersion != _upload)) Select(_view, null);
        }
        void OnApplicationFocus(bool focus) { if (!focus) Invalidate(); }
        void OnApplicationPause(bool pause) { if (pause) Invalidate(); }
        void OnDestroy() { _destroyed = true;Invalidate();if (Connection != null) Connection.SceneChanged -= Changed; }
    }
}
