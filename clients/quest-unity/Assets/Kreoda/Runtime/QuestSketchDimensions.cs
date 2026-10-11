using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Kreoda.QuestFoundation;
using UnityEngine;

namespace Kreoda.QuestRuntime
{
    public sealed class QuestSketchDimensions : MonoBehaviour
    {
        public QuestConnection Connection;
        public QuestSpatialEdit Spatial;
        public Material LineMaterial;
        public SketchDimensionIntent Selected { get; private set; }
        public string Status { get; private set; } = "Seleziona uno sketch e una quota";
        public double Value { get; private set; }
        public bool Busy { get; private set; }
        public long SelectionTicket => _ticket;
        readonly ConcurrentQueue<Action> _main = new ConcurrentQueue<Action>();
        readonly List<GameObject> _lines = new List<GameObject>();
        CancellationTokenSource _run;
        int _sketch, _dimension;
        long _ticket;
        bool _previewValid, _destroyed;
        public void NextSketch() { if (!Busy) { _sketch++;_dimension = 0;Select(); } }
        public void NextDimension() { if (!Busy) { _dimension++;Select(); } }
        public void Select()
        {
            Cancel();Selected = null;ClearDrawing();
            var model = Connection.Client?.Model;
            if (model == null || model.Sketches.Count == 0) { Status = "Nessuno sketch nel documento";return; }
            var sketch = model.Sketches[_sketch % model.Sketches.Count];
            var dimensions = sketch.GetProperty("model").GetProperty("constraints").EnumerateArray()
                .Where(c => c.GetProperty("kind").GetString() is "distance" or "radius" or "diameter" or "angle").ToArray();
            ShowSketch(sketch);
            if (dimensions.Length == 0) { Status = "Sketch senza quote dimensionali";return; }
            Selected = new SketchDimensionIntent(model.SessionId, model.DocumentId, model.Revision, sketch,
                dimensions[_dimension % dimensions.Length].GetProperty("id").GetString());
            Value = Selected.Value;Status = Selected.Kind + " · " + Value.ToString("0.###", CultureInfo.InvariantCulture) + " " + Selected.Unit;
        }
        public void Preview(double value)
        {
            if (Busy || Spatial?.Busy == true || Selected == null) return;
            var intent = Selected;var client = Connection.Client;var ticket = ++_ticket;
            Value = value;Busy = true;_previewValid = false;Status = "Soluzione dello sketch…";
            _run = new CancellationTokenSource(TimeSpan.FromSeconds(15));var run = _run;
            _ = Task.Run(async () => {
                try {
                    var preview = await intent.PreviewAsync(client, value, run.Token).ConfigureAwait(false);
                    _main.Enqueue(() => {
                        if (!Current(ticket)) return;
                        try { intent.RequireCurrent(client);ShowSketch(preview);_previewValid = true;Status = "Anteprima risolta · Conferma o Annulla"; }
                        catch (Exception error) { _previewValid = false;Status = "Anteprima scaduta · " + error.Message; }
                    });
                } catch (Exception error) { Error(ticket, error); }
                finally { _main.Enqueue(() => { if (Current(ticket)) Busy = false; });run.Dispose(); }
            });
        }
        public void Confirm()
        {
            if (Busy || Spatial?.Busy == true || Selected == null || !_previewValid) return;
            var intent = Selected;var value = Value;var client = Connection.Client;var ticket = ++_ticket;
            Busy = true;Status = "Conferma quota sul PC…";
            _run = new CancellationTokenSource(TimeSpan.FromSeconds(15));var run = _run;
            _ = Task.Run(async () => {
                try {
                    await intent.CommitAsync(client, value, run.Token).ConfigureAwait(false);
                    using var refresh = new CancellationTokenSource(TimeSpan.FromSeconds(10));
                    await client.SnapshotAsync(intent.DocumentId, refresh.Token).ConfigureAwait(false);
                    _main.Enqueue(() => { if (Current(ticket)) { Busy = false;Select();Status = "Quota salvata · Undo condiviso disponibile"; } });
                } catch (Exception error) { Error(ticket, error); }
                finally { _main.Enqueue(() => { if (Current(ticket)) Busy = false; });run.Dispose(); }
            });
        }
        public void Cancel()
        {
            _ticket++;try { _run?.Cancel(); } catch (ObjectDisposedException) { }_run = null;
            Busy = false;_previewValid = false;
            if (Selected != null) ShowSketch(Selected.Sketch);
        }
        bool Current(long ticket) => !_destroyed && ticket == _ticket;
        void Error(long ticket, Exception error) => _main.Enqueue(() => { if (Current(ticket)) { _previewValid = false;Status = "Quota non confermata · " + error.Message; } });
        public void ShowSketch(JsonElement sketch)
        {
            ClearDrawing();
            var plane = sketch.GetProperty("plane");var origin = CadVector.Read(plane.GetProperty("origin"));
            var x = CadVector.Read(plane.GetProperty("xAxis"));var y = CadVector.Read(plane.GetProperty("yAxis"));
            Vector3 Position(double px, double py) => QuestDimensions.CadPoint(origin + x * px + y * py);
            var model = sketch.GetProperty("model");
            var points = model.GetProperty("points").EnumerateArray().ToDictionary(p => p.GetProperty("id").GetString(),
                p => new Vector2((float)p.GetProperty("x").GetDouble(), (float)p.GetProperty("y").GetDouble()));
            if (model.TryGetProperty("lines", out var lines)) foreach (var line in lines.EnumerateArray()) {
                var a = points[line.GetProperty("p1").GetString()];var b = points[line.GetProperty("p2").GetString()];
                Draw(new[] { Position(a.x, a.y), Position(b.x, b.y) }, false);
            }
            foreach (var collection in new[] { "circles", "arcs" }) if (model.TryGetProperty(collection, out var curves)) foreach (var curve in curves.EnumerateArray()) {
                var centre = points[curve.GetProperty("center").GetString()];var radius = curve.GetProperty("r").GetDouble();
                var start = collection == "arcs" ? curve.GetProperty("startAngleRad").GetDouble() : 0;
                var end = collection == "arcs" ? curve.GetProperty("endAngleRad").GetDouble() : Math.PI * 2;
                var vertices = Enumerable.Range(0, 65).Select(i => { var angle = start + (end - start) * i / 64;
                    return Position(centre.x + radius * Math.Cos(angle), centre.y + radius * Math.Sin(angle)); }).ToArray();
                Draw(vertices, collection == "circles");
            }
        }
        void Draw(Vector3[] vertices, bool loop)
        {
            var owned = new GameObject("Solved sketch preview line");owned.transform.SetParent(transform, false);
            var line = owned.AddComponent<LineRenderer>();line.useWorldSpace = false;line.sharedMaterial = LineMaterial;
            line.startWidth = line.endWidth = .0015f;line.positionCount = vertices.Length;line.SetPositions(vertices);line.loop = loop;_lines.Add(owned);
        }
        void ClearDrawing() { foreach (var line in _lines) { if (Application.isPlaying) Destroy(line);else DestroyImmediate(line); }_lines.Clear(); }
        void Update()
        {
            for (var i = 0; i < 2 && _main.TryDequeue(out var action); i++) if (!_destroyed) action();
            if (!Busy && Selected != null && Connection.Client?.Model is { } model &&
                (model.SessionId != Selected.SessionId || model.DocumentId != Selected.DocumentId || model.Revision != Selected.BaseRevision)) Select();
        }
        void OnApplicationFocus(bool focus) { if (!focus) Cancel(); }
        void OnApplicationPause(bool pause) { if (pause) Cancel(); }
        void OnDestroy() { _destroyed = true;Cancel();ClearDrawing(); }
    }
}
