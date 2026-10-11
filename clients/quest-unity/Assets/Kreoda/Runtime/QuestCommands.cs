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
        int _upload, _index, _field;
        long _ticket;
        CancellationTokenSource _commandRun;
        bool _destroyed;

        public void Select(QuestMeshView view, MeshSemanticHit hit)
        {
            Invalidate();_view = view;_upload = view != null ? view.UploadVersion : 0;
            var ticket = _ticket;
            if (view == null || !Connection.IsCurrentView(view)) return;
            if (hit?.ReferenceAmbiguous == true) { Status = "Riferimento ambiguo: scegli altro bordo o faccia";return; }
            var ids = new[] { hit?.PersistentId ?? view.InstanceId ?? view.FeatureId };
            var client = Connection.Client;var model = client.Model;
            _ = Load(client, ids, model.DocumentId, model.Revision, ticket);
        }
        async Task Load(Kreoda.Session.SessionClient client, string[] ids, string documentId, long revision, long ticket)
        {
            try
            {
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
                var context = await client.ContextCommandsAsync(ids, documentId, revision, timeout.Token).ConfigureAwait(false);
                _main.Enqueue(() => {
                    if (!Current(ticket) || Connection.Client != client || !Connection.IsCurrentView(_view)) return;
                    _context = context;
                    _index = Array.FindIndex(context.Commands, command => command.Available && command.BoundParameters.Count > 0);
                    if (_index < 0) _index = 0;
                    Choose();
                });
            }
            catch (Exception error) { PostError(ticket, error); }
        }
        public void NextCommand()
        {
            if (Busy || _context == null || _context.Commands.Length == 0) return;
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
                    if (!Current(ticket) || !ReferenceEquals(command, _command)) return;
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
            if (Busy || Spatial?.Busy == true || _schema.ValueKind != JsonValueKind.Object || _context == null || _command?.Available != true || !Connection.IsCurrentView(_view)) return;
            var required = _schema.TryGetProperty("required", out var names) ? names.EnumerateArray().Select(p => p.GetString()) : Enumerable.Empty<string>();
            if (required.Any(name => !_values.ContainsKey(name))) { Status = "Completa tutti i valori richiesti";return; }
            Execute(_command.Id, new Dictionary<string, object>(_values), _context.SessionId, _context.DocumentId, _context.Revision);
        }
        public void History(bool redo)
        {
            if (Busy || Spatial?.Busy == true) return;
            var model = Connection.Client?.Model;if (model == null) return;
            Execute(redo ? "Redo" : "Undo", new Dictionary<string, object>(), model.SessionId, model.DocumentId, model.Revision);
        }
        void Execute(string id, Dictionary<string, object> values, string session, string document, long revision)
        {
            Busy = true;Status = "Operazione sul PC…";
            var ticket = ++_ticket;var client = Connection.Client;
            _commandRun = new CancellationTokenSource(TimeSpan.FromSeconds(15));var run = _commandRun;
            _ = Task.Run(async () => {
                try
                {
                    if (client.Model?.SessionId != session || client.Model.DocumentId != document || client.Model.Revision != revision)
                        throw new SessionException("NEED_FULL_SNAPSHOT", "command context is stale");
                    // One canonical command, no creation-preview simulation or blind retry.
                    await client.CommandAsync(id, values.ToDictionary(p => p.Key, p => (object)p.Value), document,
                        baseRevision: revision, ct: run.Token).ConfigureAwait(false);
                    using var refresh = new CancellationTokenSource(TimeSpan.FromSeconds(10));
                    await client.SnapshotAsync(document, refresh.Token).ConfigureAwait(false);
                    _main.Enqueue(() => { if (Current(ticket)) Status = "Documento PC aggiornato"; });
                }
                catch (Exception error)
                {
                    try { using var refresh = new CancellationTokenSource(TimeSpan.FromSeconds(5));await client.SnapshotAsync(document, refresh.Token).ConfigureAwait(false); } catch { }
                    PostError(ticket, error);
                }
                finally { _main.Enqueue(() => { if (Current(ticket)) { Busy = false;if (Connection.IsCurrentView(_view)) Select(_view, null); } });run.Dispose(); }
            });
        }
        bool Current(long ticket) => !_destroyed && ticket == _ticket;
        void PostError(long ticket, Exception error) => _main.Enqueue(() => { if (Current(ticket)) Status = "Operazione non confermata · " + (error is SessionException session ? session.Code : "INVALID_COMMAND"); });
        void Invalidate()
        {
            _ticket++;try { _commandRun?.Cancel(); } catch (ObjectDisposedException) { }
            _commandRun = null;_context = null;_command = null;_schema = default;_fields.Clear();_values.Clear();Busy = false;
        }
        void Update() { for (var i = 0; i < 2 && _main.TryDequeue(out var action); i++) if (!_destroyed) action(); }
        void Start() { Connection.SceneChanged += Changed; }
        void Changed() { if (_view != null && _view.UploadVersion != _upload) { if (!Busy) Select(_view, null); } }
        void OnApplicationFocus(bool focus) { if (!focus) Invalidate(); }
        void OnApplicationPause(bool pause) { if (pause) Invalidate(); }
        void OnDestroy() { _destroyed = true;Invalidate();if (Connection != null) Connection.SceneChanged -= Changed; }
    }
}
