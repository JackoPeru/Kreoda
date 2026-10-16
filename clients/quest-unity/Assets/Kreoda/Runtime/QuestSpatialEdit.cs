using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Kreoda.QuestFoundation;
using Kreoda.Session;
using UnityEngine;

namespace Kreoda.QuestRuntime
{
    public sealed class QuestSpatialEdit : MonoBehaviour
    {
        public QuestConnection Connection;
        public QuestDimensions Dimensions;
        public QuestPreviewView Preview;
        public bool EditMode { get; private set; }
        public bool SnapEnabled;
        public bool Busy => _worker != null;
        public bool Holding => _held;
        public string Status { get; private set; } = "Modello · sposta la vista con due mani";
        public SpatialEditIntent SelectedIntent { get; private set; }
        public IReadOnlyDictionary<string, double> DraftValues { get; private set; }
        readonly ConcurrentQueue<Action> _main = new ConcurrentQueue<Action>();
        SpatialEditWorker _worker;
        QuestMeshView _view;
        CadDisplayFrame _frame;
        CadVector _start;
        Quaternion _startRotation;
        float _distance;
        long _load, _previewTicket;
        bool _held, _destroyed;
        string _owner;

        public static CadDisplayFrame CaptureFrame(Transform root)
        {
            var scale = root.lossyScale;
            if (scale.x <= 0 || Mathf.Abs(scale.x - scale.y) > .00001f || Mathf.Abs(scale.x - scale.z) > .00001f)
                throw new ArgumentException("display requires positive uniform scale");
            CadVector V(Vector3 v) => new CadVector(v.x, v.y, v.z);
            return new CadDisplayFrame(V(root.position), V(root.right), V(root.forward), V(root.up), scale.x);
        }
        public void SetMode(bool edit)
        {
            Cancel();EditMode = edit;SelectedIntent = null;Dimensions.Clear();
            Status = edit ? "Modifica · seleziona corpo e quota" : "Modello · sposta la vista con due mani";
            if (edit && _view != null) Select(_view, _owner);
        }
        public void Select(QuestMeshView view, string owner = null)
        {
            Cancel();_view = view;_owner = owner;SelectedIntent = null;Dimensions.Clear();
            var ticket = ++_load;
            if (EditMode && view != null) _ = Load(view, owner, ticket);
        }
        async Task Load(QuestMeshView view, string owner, long ticket)
        {
            try
            {
                var intents = await Connection.EditIntentsAsync(view, owner).ConfigureAwait(false);
                _main.Enqueue(() => {
                    if (ticket != _load || !EditMode || !Connection.IsCurrentView(view)) return;
                    Dimensions.SetIntents(intents, view.BboxMetres);SelectedIntent = intents.FirstOrDefault();
                    DraftValues = SelectedIntent?.InitialValues;Dimensions.Select(SelectedIntent);
                    Status = intents.Length == 0 ? "Nessuna quota modificabile per questa feature" : "Trascina una quota · oppure Valore esatto";
                });
            }
            catch (Exception error) { _main.Enqueue(() => { if (ticket == _load) Status = "Quote non disponibili · " + Code(error); }); }
        }
        public void NextOwner()
        {
            if (_view == null || Busy) return;
            var model = Connection.Client?.Model;
            if (model == null) return;
            var body = model.Bodies.FirstOrDefault(b => b.GetProperty("bodyId").GetString() == _view.BodyId);
            if (_view.InstanceId == null && body.ValueKind != System.Text.Json.JsonValueKind.Object) return;
            var owners = _view.InstanceId != null ? new[] { _view.InstanceId } : body.GetProperty("history").EnumerateArray().Select(x => x.GetString()).ToArray();
            if (owners.Length == 0) return;
            var index = Array.IndexOf(owners, _owner ?? _view.FeatureId);
            Select(_view, owners[(index + 1) % owners.Length]);
        }
        public bool Begin(QuestEditHandle handle, Ray ray, Vector3 hit, Quaternion orientation)
        {
            if (!EditMode || Busy || handle == null || !Connection.IsCurrentView(_view)) return false;
            SelectedIntent = handle.Intent;DraftValues = SelectedIntent.InitialValues;Dimensions.Select(SelectedIntent);
            _frame = CaptureFrame(Connection.DisplayRoot);_distance = Mathf.Clamp(Vector3.Distance(ray.origin, hit), .1f, 5);
            _start = ToCad(ray.GetPoint(_distance));_startRotation = orientation;
            _held = StartWorker();return _held;
        }
        bool StartWorker()
        {
            try
            {
                _worker = new SpatialEditWorker(Connection.Client, SelectedIntent);
                var worker = _worker;_previewTicket = Preview.Begin(SelectedIntent, _view.GetComponent<MeshFilter>().sharedMesh);var ticket = _previewTicket;
                worker.PreviewReady += mesh => _main.Enqueue(() => {
                    if (ReferenceEquals(_worker, worker) && Preview.TryUpload(ticket, mesh, () => worker.IsPreviewCurrent(mesh)))
                        Status = "Anteprima aggiornata";
                });
                _ = Observe(worker, worker.BeginAsync());Status = "Anteprima · rilascia per confermare";return true;
            }
            catch (Exception error) { _worker = null;Status = "Modifica non avviata · " + Code(error);return false; }
        }
        async Task Observe(SpatialEditWorker worker, Task ready)
        {
            try { await ready.ConfigureAwait(false); } catch { /* Completion carries the authoritative failure. */ }
            var result = await worker.Completion.ConfigureAwait(false);
            _main.Enqueue(() => {
                if (!ReferenceEquals(_worker, worker)) return;
                _worker = null;_held = false;Preview.Clear();
                Status = result.Status == SpatialEditStatus.Committed ? "Modifica salvata sul PC" :
                    result.Status == SpatialEditStatus.Cancelled ? "Modifica annullata" : "Modifica non confermata · " + result.ErrorCode;
                if (EditMode && Connection.IsCurrentView(_view)) Select(_view, _owner);
            });
            await worker.DisposeAsync().ConfigureAwait(false);
        }
        CadVector ToCad(Vector3 world) => _frame.ToCad(new CadVector(world.x, world.y, world.z));
        public void Drag(Ray ray, Quaternion orientation, bool pressed, bool tracked)
        {
            if (!_held || _worker == null) return;
            if (!tracked || !Connection.IsCurrentView(_view)) { Cancel();return; }
            try
            {
                var point = ray.GetPoint(_distance);
                IReadOnlyDictionary<string, double> draft;
                if (SelectedIntent.Type == "angular" && SelectedIntent.Parameters.Count == 3)
                {
                    var m = Matrix4x4.Rotate(orientation * Quaternion.Inverse(_startRotation));
                    var rotation = new double[] { m.m00, m.m01, m.m02, m.m10, m.m11, m.m12, m.m20, m.m21, m.m22 };
                    draft = SelectedIntent.PredictRotationMatrix(_frame.ToCadRotationMatrix(rotation));
                }
                else draft = SelectedIntent.PredictDrag(_start, ToCad(point));
                if (SnapEnabled) draft = SelectedIntent.Exact(draft.ToDictionary(p => p.Key,
                    p => SpatialEditIntent.Snap(p.Value, SelectedIntent.Unit == "deg" ? 5 : .1)));
                if (DraftValues == null || draft.Any(p => p.Value != DraftValues[p.Key]))
                {
                    DraftValues = draft;_worker.Submit(draft);Dimensions.Draft(SelectedIntent, draft);
                    var projected = SelectedIntent.ProjectedPoint(_start, ToCad(point), draft);
                    Preview.Predict(_previewTicket, Connection.DisplayRoot.TransformPoint(QuestDimensions.CadPoint(SelectedIntent.Origin)),
                        Connection.DisplayRoot.TransformPoint(QuestDimensions.CadPoint(projected)));
                    Status = "Quota locale · solido precedente";
                }
                if (!pressed) { _held = false;_ = _worker.ReleaseAsync(); }
            }
            catch (Exception error) { Status = "Quota non valida · " + Code(error);Cancel(); }
        }
        public bool Exact(IReadOnlyDictionary<string, double> values)
        {
            if (!EditMode || Busy || SelectedIntent == null || !Connection.IsCurrentView(_view)) return false;
            var draft = SelectedIntent.Exact(values);
            if (!StartWorker()) return false;
            DraftValues = draft;Dimensions.Draft(SelectedIntent, draft);_worker.Submit(draft);_ = _worker.ReleaseAsync();return true;
        }
        public void Cancel() { _held = false;if (_worker != null) _ = _worker.CancelAsync();if (Preview != null) Preview.Clear(); }
        static string Code(Exception error) => error is SessionException session ? session.Code : "INVALID_EDIT";
        void Start() { Connection.SceneChanged += SceneChanged; }
        void SceneChanged() { if (!Busy && EditMode && _view != null) Select(_view, _owner); }
        void Update() { for (var i = 0; i < 2 && _main.TryDequeue(out var action); i++) if (!_destroyed) action(); }
        void OnApplicationFocus(bool focus) { if (!focus) Cancel(); }
        void OnApplicationPause(bool pause) { if (pause) Cancel(); }
        void OnDestroy() { _destroyed = true;_load++;Cancel();if (Connection != null) Connection.SceneChanged -= SceneChanged; }
    }
}
