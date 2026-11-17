using System;
using System.Collections.Generic;
using System.Text.Json;
using Kreoda.QuestFoundation;
using UnityEngine;

namespace Kreoda.QuestRuntime
{
    public sealed class QuestDatumView : MonoBehaviour
    {
        const double NativeTolerance = 1e-9;
        const double PlaneHalfSizeMm = 100;
        const double AxisHalfLengthMm = 100;
        const float PickRadius = .006f;
        const float PointDiameter = .016f;

        public Material LineMaterial;
        public Material SelectionMaterial;
        public string FeatureId { get; private set; }
        public string NativeKind { get; private set; }
        public string SelectionKind { get; private set; }
        public string NativeStatus { get; private set; }
        public string DisplayStatus { get; private set; }
        public string SessionId { get; private set; }
        public string DocumentId { get; private set; }
        public long Revision { get; private set; } = -1;
        public bool IsSelectable { get; private set; }
        string _record;
        bool _selected;

        public bool Apply(JsonElement datum, string sessionId, string documentId, long revision)
        {
            var raw = datum.ValueKind == JsonValueKind.Object ? datum.GetRawText() : "";
            var changed = raw != _record || SessionId != sessionId || DocumentId != documentId || Revision != revision;
            if (!changed) return false;
            _record = raw;SessionId = sessionId;DocumentId = documentId;Revision = revision;
            ClearGeometry();
            FeatureId = Text(datum, "featureId");
            NativeKind = Text(datum, "kind");
            NativeStatus = Text(datum, "status");
            SelectionKind = NativeKind switch
            {
                "DatumPlane" => "datumPlane",
                "DatumAxis" => "datumAxis",
                "DatumPoint" => "datumPoint",
                _ => null
            };
            IsSelectable = false;
            DisplayStatus = NativeStatus ?? "record non valido";
            if (SelectionKind == null || string.IsNullOrEmpty(FeatureId) || NativeStatus != "ok") return true;
            if (datum.TryGetProperty("type", out var type) && type.ValueKind == JsonValueKind.String && type.GetString() != NativeKind)
            { DisplayStatus = "tipo datum incoerente";return true; }

            try
            {
                var resolved = datum.GetProperty("resolved");
                if (NativeKind == "DatumPlane") ShowPlane(resolved);
                else if (NativeKind == "DatumAxis") ShowAxis(resolved);
                else ShowPoint(resolved);
                IsSelectable = true;
                ApplyMaterial();
            }
            catch (Exception error) when (error is ArgumentException or InvalidOperationException or KeyNotFoundException or FormatException or OverflowException)
            { DisplayStatus = "geometria datum non valida";ClearGeometry(); }
            return true;
        }

        public void SetSelected(bool selected)
        {
            _selected = selected;ApplyMaterial();
        }

        public void DisablePicking()
        {
            IsSelectable = false;
            foreach (var collider in GetComponentsInChildren<Collider>(true)) collider.enabled = false;
        }

        static string Text(JsonElement item, string name) =>
            item.ValueKind == JsonValueKind.Object && item.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
                ? value.GetString() : null;

        void ShowPlane(JsonElement resolved)
        {
            var origin = CadVector.Read(resolved.GetProperty("originMm"));
            var x = CadVector.Read(resolved.GetProperty("xAxis"));
            var y = CadVector.Read(resolved.GetProperty("yAxis"));
            var normal = CadVector.Read(resolved.GetProperty("normal"));
            ValidateBasis(x, y, normal);

            var halfX = x * PlaneHalfSizeMm;var halfY = y * PlaneHalfSizeMm;
            var corners = new[]
            {
                Point(origin - halfX - halfY), Point(origin + halfX - halfY),
                Point(origin + halfX + halfY), Point(origin - halfX + halfY)
            };
            for (var i = 0; i < corners.Length; i++) Segment(corners[i], corners[(i + 1) % corners.Length]);
        }

        internal static void ValidateBasis(CadVector x, CadVector y, CadVector normal)
        {
            if (Math.Abs(x.Length - 1) > NativeTolerance || Math.Abs(y.Length - 1) > NativeTolerance ||
                Math.Abs(normal.Length - 1) > NativeTolerance || Math.Abs(x.Dot(y)) > NativeTolerance ||
                Math.Abs(x.Dot(normal)) > NativeTolerance || Math.Abs(y.Dot(normal)) > NativeTolerance ||
                (x.Cross(y) - normal).Length > NativeTolerance)
                throw new ArgumentException("datum plane frame is not native orthonormal right-handed basis");

        }

        void ShowAxis(JsonElement resolved)
        {
            var origin = CadVector.Read(resolved.GetProperty("originMm"));
            var direction = CadVector.Read(resolved.GetProperty("direction"));
            if (Math.Abs(direction.Length - 1) > NativeTolerance)
                throw new ArgumentException("datum axis direction is not a native unit vector");
            Segment(Point(origin - direction * AxisHalfLengthMm), Point(origin + direction * AxisHalfLengthMm));
        }

        void ShowPoint(JsonElement resolved)
        {
            var position = Point(CadVector.Read(resolved.GetProperty("positionMm")));
            var marker = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            marker.name = "Native datum point";marker.transform.SetParent(transform, false);
            marker.transform.localPosition = position;marker.transform.localScale = Vector3.one * PointDiameter;
            var renderer = marker.GetComponent<Renderer>();renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            renderer.receiveShadows = false;
        }

        static Vector3 Point(CadVector value)
        {
            if (!value.IsFinite) throw new ArgumentException("datum point is not finite");
            var point = QuestDimensions.CadPoint(value);
            if (!float.IsNaN(point.x) && !float.IsInfinity(point.x) &&
                !float.IsNaN(point.y) && !float.IsInfinity(point.y) &&
                !float.IsNaN(point.z) && !float.IsInfinity(point.z)) return point;
            throw new ArgumentException("datum point cannot be represented by Unity coordinates");
        }

        void Segment(Vector3 first, Vector3 second)
        {
            var lineObject = new GameObject("Native datum guide");lineObject.transform.SetParent(transform, false);
            var line = lineObject.AddComponent<LineRenderer>();line.useWorldSpace = false;line.positionCount = 2;
            line.startWidth = line.endWidth = .002f;line.SetPosition(0, first);line.SetPosition(1, second);
            line.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;line.receiveShadows = false;

            var delta = second - first;
            var length = delta.magnitude;
            if (float.IsNaN(delta.x) || float.IsInfinity(delta.x) || float.IsNaN(delta.y) || float.IsInfinity(delta.y) ||
                float.IsNaN(delta.z) || float.IsInfinity(delta.z) || float.IsNaN(length) || float.IsInfinity(length) || length <= 0)
                throw new ArgumentException("datum guide is not representable by Unity coordinates");
            var picker = new GameObject("Datum guide picker");picker.transform.SetParent(transform, false);
            picker.transform.localPosition = (first + second) * .5f;
            picker.transform.localRotation = Quaternion.FromToRotation(Vector3.up, delta / length);
            var capsule = picker.AddComponent<CapsuleCollider>();capsule.direction = 1;capsule.radius = PickRadius;
            capsule.height = length + PickRadius * 2;
        }

        void ApplyMaterial()
        {
            var material = _selected ? SelectionMaterial : LineMaterial;
            if (material == null) return;
            foreach (var renderer in GetComponentsInChildren<Renderer>(true)) renderer.sharedMaterial = material;
        }

        void ClearGeometry()
        {
            DisablePicking();
            for (var i = transform.childCount - 1; i >= 0; i--)
            {
                var child = transform.GetChild(i).gameObject;
                if (Application.isPlaying) Destroy(child); else DestroyImmediate(child);
            }
        }
    }
}
