using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Kreoda.QuestFoundation;
using UnityEngine;

namespace Kreoda.QuestRuntime
{
    public sealed class QuestEditHandle : MonoBehaviour
    {
        public SpatialEditIntent Intent;
    }

    public sealed class QuestDimensions : MonoBehaviour
    {
        public Font Font;
        public Material HandleMaterial;
        public Camera Viewer;
        sealed class Entry
        {
            public QuestEditHandle Handle;
            public TextMesh Label;
            public Vector3 Anchor;
        }
        readonly List<Entry> _entries = new List<Entry>();
        SpatialEditIntent _selected;
        public void SetIntents(IEnumerable<SpatialEditIntent> intents, double[] bodyBoundsMetres = null)
        {
            Clear();
            foreach (var intent in intents.Take(12))
            {
                var handle = GameObject.CreatePrimitive(PrimitiveType.Sphere);
                handle.name = "CAD edit " + intent.ManipulatorId;handle.transform.SetParent(transform, false);
                handle.transform.localScale = Vector3.one * (.014f / Mathf.Max(.00001f, transform.lossyScale.x));
                var anchor = CadPoint(intent.Origin);
                if (intent.Type == "planar") anchor += Vector3.up * (.02f / Mathf.Max(.00001f, transform.lossyScale.x));
                double Outside(CadVector direction, double fallback)
                {
                    if (bodyBoundsMetres == null || bodyBoundsMetres.Length != 6) return fallback;
                    double maximum = 0;
                    for (var i = 0; i < 8; i++)
                    {
                        var p = new CadVector(bodyBoundsMetres[(i & 1) == 0 ? 0 : 3] * 1000,
                            bodyBoundsMetres[(i & 2) == 0 ? 2 : 5] * 1000, bodyBoundsMetres[(i & 4) == 0 ? 1 : 4] * 1000);
                        maximum = Math.Max(maximum, (p - intent.Origin).Dot(direction));
                    }
                    return maximum + 9 / Math.Max(.01, transform.lossyScale.x);
                }
                if (intent.Type == "linear") anchor = CadPoint(intent.Origin + intent.Axis.Value * Outside(intent.Axis.Value, 0));
                if (intent.Type == "radial" || intent.Type == "angular")
                {
                    var axis = intent.Axis ?? new CadVector(0, 0, 1);
                    var side = Math.Abs(axis.X) < .9 ? new CadVector(1, 0, 0) : new CadVector(0, 1, 0);
                    side = (side - axis * side.Dot(axis)).Normalized();
                    var radius = intent.Type == "angular" ? 30 : Math.Abs(intent.InitialValues[intent.Parameters[0]]) /
                        (intent.Parameters[0] == "diameterMm" ? 2 : 1);
                    anchor = CadPoint(intent.Origin + side * Outside(side, Math.Max(5, radius)));
                }
                handle.transform.localPosition = anchor;
                handle.GetComponent<MeshRenderer>().sharedMaterial = HandleMaterial;
                var semantic = handle.AddComponent<QuestEditHandle>();semantic.Intent = intent;
                var label = new GameObject("CAD quote " + intent.ManipulatorId).AddComponent<TextMesh>();
                label.transform.SetParent(transform, false);label.font = Font;label.fontSize = 64;
                label.characterSize = .014f * 10 / 64;label.anchor = TextAnchor.UpperLeft;
                label.GetComponent<MeshRenderer>().sharedMaterial = Font.material;label.color = Color.white;
                label.text = Format(intent, intent.InitialValues);
                _entries.Add(new Entry { Handle = semantic, Label = label, Anchor = anchor });
            }
        }
        public static Vector3 CadPoint(CadVector p) => new Vector3((float)p.X, (float)p.Z, (float)p.Y) * .001f;
        static string Format(SpatialEditIntent intent, IReadOnlyDictionary<string, double> values) =>
            intent.ManipulatorId + "\n" + string.Join(" / ", intent.Parameters.Select(p => values[p].ToString("0.##", CultureInfo.InvariantCulture))) + " " + intent.Unit;
        public void Select(SpatialEditIntent intent) => _selected = intent;
        public void Draft(SpatialEditIntent intent, IReadOnlyDictionary<string, double> values)
        {
            var entry = _entries.FirstOrDefault(e => ReferenceEquals(e.Handle.Intent, intent));
            if (entry != null) entry.Label.text = Format(intent, values);
        }
        public void Layout(Camera viewer)
        {
            if (viewer == null) return;
            var occupied = new List<Rect>();
            var scale = Mathf.Max(.00001f, transform.lossyScale.x);
            foreach (var entry in _entries.OrderByDescending(e => ReferenceEquals(e.Handle.Intent, _selected)))
            {
                entry.Handle.transform.localScale = Vector3.one * (.014f / scale);
                entry.Label.transform.localScale = Vector3.one / scale;
                var renderer = entry.Label.GetComponent<MeshRenderer>();renderer.enabled = true;
                var anchor = transform.TransformPoint(entry.Anchor);
                bool placed = false;
                for (var row = 0; row < 8; row++)
                {
                    entry.Label.transform.position = anchor + viewer.transform.up * (.025f + row * .04f) + viewer.transform.right * .015f;
                    entry.Label.transform.rotation = Quaternion.LookRotation(entry.Label.transform.position - viewer.transform.position, viewer.transform.up);
                    var bounds = Project(renderer.bounds, viewer);
                    if (bounds.HasValue && !occupied.Any(r => r.Overlaps(bounds.Value)))
                    { occupied.Add(bounds.Value);placed = true;break; }
                }
                renderer.enabled = placed;
            }
        }
        static Rect? Project(Bounds bounds, Camera viewer)
        {
            var min = new Vector2(float.PositiveInfinity, float.PositiveInfinity);var max = -min;
            for (var i = 0; i < 8; i++)
            {
                var p = viewer.WorldToViewportPoint(new Vector3((i & 1) == 0 ? bounds.min.x : bounds.max.x,
                    (i & 2) == 0 ? bounds.min.y : bounds.max.y, (i & 4) == 0 ? bounds.min.z : bounds.max.z));
                if (p.z <= 0) return null;
                min = Vector2.Min(min, new Vector2(p.x, p.y));max = Vector2.Max(max, new Vector2(p.x, p.y));
            }
            return Rect.MinMaxRect(min.x - .004f, min.y - .004f, max.x + .004f, max.y + .004f);
        }
        public void Clear()
        {
            foreach (var entry in _entries)
            {
                Remove(entry.Handle.gameObject);Remove(entry.Label.gameObject);
            }
            _entries.Clear();_selected = null;
        }
        static void Remove(GameObject owned) { if (Application.isPlaying) Destroy(owned);else DestroyImmediate(owned); }
        void LateUpdate() => Layout(Viewer != null ? Viewer : Camera.main);
        void OnDestroy() => Clear();
    }
}
