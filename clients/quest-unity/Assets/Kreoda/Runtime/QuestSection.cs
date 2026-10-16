using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Kreoda.QuestFoundation;
using UnityEngine;

namespace Kreoda.QuestRuntime
{
    public sealed class QuestSection : MonoBehaviour
    {
        public QuestConnection Connection;
        public bool Enabled { get; private set; }
        public SectionPlane? Plane { get; private set; }
        public string Status { get; private set; } = "Sezione spenta";

        string _sessionId, _documentId;
        bool _hasIdentity, _hadViews;

        void Start()
        {
            if (Connection != null) Connection.SceneChanged += Refresh;
            Refresh();
        }

        void Update() => ObserveCurrentIdentity();

        void OnDestroy()
        {
            if (Connection != null) Connection.SceneChanged -= Refresh;
            if (Connection != null && Connection.DisplayRoot != null)
                foreach (var view in Connection.Views)
                    view.ApplySection(null, Connection.DisplayRoot, Connection.SectionCapMaterial, Connection.SectionContourMaterial);
        }

        void ObserveCurrentIdentity()
        {
            var model = Connection != null ? Connection.Client?.Model : null;
            if (model == null) return;
            ObserveModelIdentity(model.SessionId, model.DocumentId);
        }

        void ObserveModelIdentity(string sessionId, string documentId)
        {
            if (string.IsNullOrEmpty(sessionId) || string.IsNullOrEmpty(documentId)) return;
            if (_hasIdentity && (_sessionId != sessionId || _documentId != documentId))
            {
                ClearState("Nuovo documento: sezione azzerata");
                Apply();
            }
            _sessionId = sessionId;
            _documentId = documentId;
            _hasIdentity = true;
        }

        public void Refresh()
        {
            ObserveCurrentIdentity();
            if (Connection == null || Connection.DisplayRoot == null) return;
            var hasViews = Connection.Views.Any(view => view != null);
            var hasCanonicalBodies = Connection.Client?.Model?.Bodies?.Any() == true;
            if (!hasViews && _hadViews && Connection.PendingMeshCount == 0 && !hasCanonicalBodies)
            {
                ClearState("Nessun corpo CAD: sezione azzerata");
                Apply();
            }
            _hadViews = hasViews || (_hadViews && (Connection.PendingMeshCount > 0 || hasCanonicalBodies));
            Apply();
        }

        public bool TryEnable()
        {
            ObserveCurrentIdentity();
            if (!Plane.HasValue && !TryInitialize(SectionAxis.Z, false))
            {
                Status = "Carica un corpo CAD per iniziare una sezione";
                return false;
            }
            Enabled = true;
            Status = Plane.Value.Axis is SectionAxis axis
                ? $"Sezione {axis} · {Plane.Value.OffsetMm:0.###} mm"
                : $"Sezione · {Plane.Value.OffsetMm:0.###} mm";
            Apply();
            return true;
        }

        public void Disable()
        {
            Enabled = false;
            Status = Plane.HasValue ? "Sezione spenta" : "Carica un corpo CAD per iniziare una sezione";
            Apply();
        }

        public bool Toggle() => Enabled ? DisableAndSucceed() : TryEnable();

        bool DisableAndSucceed()
        {
            Disable();
            return true;
        }

        public bool TrySetAxis(SectionAxis axis)
        {
            if (!TryBoundsMidpoint(axis, out var midpoint))
            {
                Status = "Carica un corpo CAD per impostare la quota";
                return false;
            }
            Plane = SectionPlane.FromAxis(axis, midpoint, Plane?.Inverted ?? false);
            Status = Enabled ? $"Sezione {axis} · {midpoint:0.###} mm" : $"Piano {axis} · {midpoint:0.###} mm";
            Apply();
            return true;
        }

        public bool TrySetOffsetMm(double offsetMm)
        {
            if (!Plane.HasValue) return false;
            try { Plane = Plane.Value.WithOffset(offsetMm); }
            catch (ArgumentOutOfRangeException) { return false; }
            Status = $"Sezione · {offsetMm:0.###} mm";
            Apply();
            return true;
        }

        public void SetInverted(bool inverted)
        {
            if (!Plane.HasValue) return;
            Plane = Plane.Value.WithInverted(inverted);
            Status = Enabled ? "Sezione invertita" : "Lato della sezione invertito";
            Apply();
        }

        public void ResetView()
        {
            if (TryInitialize(SectionAxis.Z, false))
            {
                Enabled = false;
                Status = "Sezione azzerata";
            }
            else Status = "Carica un corpo CAD per iniziare una sezione";
            Apply();
        }

        bool TryInitialize(SectionAxis axis, bool inverted)
        {
            if (!TryBoundsMidpoint(axis, out var midpoint)) return false;
            Plane = SectionPlane.FromAxis(axis, midpoint, inverted);
            return true;
        }

        bool TryBoundsMidpoint(SectionAxis axis, out double midpoint)
        {
            midpoint = 0;
            if (Connection == null || Connection.DisplayRoot == null) return false;
            var axisPlane = SectionPlane.FromAxis(axis, 0);
            double minimum = double.PositiveInfinity, maximum = double.NegativeInfinity;
            foreach (var view in Connection.Views)
            {
                var bounds = view != null ? view.BboxMetres : null;
                if (bounds == null || bounds.Length != 6) continue;
                var toRoot = Connection.DisplayRoot.worldToLocalMatrix * view.transform.localToWorldMatrix;
                for (var corner = 0; corner < 8; corner++)
                {
                    var point = toRoot.MultiplyPoint3x4(new Vector3(
                        (corner & 1) == 0 ? (float)bounds[0] : (float)bounds[3],
                        (corner & 2) == 0 ? (float)bounds[1] : (float)bounds[4],
                        (corner & 4) == 0 ? (float)bounds[2] : (float)bounds[5]));
                    var distance = axisPlane.SignedDistanceUnityLocalMetres(point.x, point.y, point.z);
                    minimum = Math.Min(minimum, distance);
                    maximum = Math.Max(maximum, distance);
                }
            }
            if (double.IsInfinity(minimum) || double.IsInfinity(maximum)) return false;
            midpoint = (minimum + maximum) * .5d;
            return !double.IsNaN(midpoint) && !double.IsInfinity(midpoint) && Math.Abs(midpoint) <= SectionPlane.OffsetLimitMm;
        }

        void ClearState(string reason)
        {
            Enabled = false;
            Plane = null;
            Status = reason;
        }

        void Apply()
        {
            if (Connection == null || Connection.DisplayRoot == null) return;
            var activePlane = Enabled ? Plane : null;
            foreach (var view in Connection.Views)
                if (view != null) view.ApplySection(activePlane, Connection.DisplayRoot,
                    Connection.SectionCapMaterial, Connection.SectionContourMaterial);
            foreach (var preview in Connection.DisplayRoot.GetComponentsInChildren<QuestPreviewView>(true))
                preview.ApplySection(activePlane, Connection.DisplayRoot,
                    Connection.SectionCapMaterial, Connection.SectionContourMaterial);
        }

        public bool TryRaycastVisible(Ray ray, float maxDistance, out QuestMeshView view,
            out int triangleIndex, out Vector3 point, out float distance)
        {
            view = null;
            triangleIndex = -1;
            point = default;
            distance = maxDistance;
            if (Connection == null || Connection.DisplayRoot == null || maxDistance <= 0) return false;
            var plane = Enabled ? Plane : null;
            var found = false;
            foreach (var candidate in Connection.Views)
            {
                if (candidate == null || !candidate.TryRaycast(ray, plane, Connection.DisplayRoot,
                    distance, out var triangle, out var candidatePoint, out var candidateDistance)) continue;
                view = candidate;
                triangleIndex = triangle;
                point = candidatePoint;
                distance = candidateDistance;
                found = true;
            }
            return found;
        }

        public bool IsSectionCapCollider(Collider collider)
        {
            if (collider == null || Connection == null) return false;
            return Connection.Views.Any(view => view != null && view.IsSectionCapCollider(collider));
        }
    }

    internal static class SectionMaterialState
    {
        const string EnabledProperty = "_SectionEnabled";
        const string InvertedProperty = "_SectionInverted";
        const string NormalProperty = "_SectionNormalLocal";
        const string OffsetProperty = "_SectionOffsetLocal";

        internal static void Apply(Renderer renderer, SectionPlane? plane, Transform modelRoot,
            MaterialPropertyBlock block)
        {
            if (renderer == null) return;
            renderer.GetPropertyBlock(block);
            Set(block, plane, modelRoot, renderer.transform);
            renderer.SetPropertyBlock(block);
        }

        internal static void Set(MaterialPropertyBlock block, SectionPlane? plane,
            Transform modelRoot, Transform meshTransform)
        {
            if (!plane.HasValue || modelRoot == null)
            {
                block.SetFloat(EnabledProperty, 0);
                return;
            }
            var state = LocalPlane(plane.Value, modelRoot, meshTransform);
            block.SetFloat(EnabledProperty, 1);
            block.SetFloat(InvertedProperty, plane.Value.Inverted ? 1 : 0);
            block.SetVector(NormalProperty, new Vector4(state.normal.x, state.normal.y, state.normal.z, 0));
            block.SetFloat(OffsetProperty, state.offsetMetres);
        }

        internal static (Vector3 normal, float offsetMetres) LocalPlane(
            SectionPlane plane, Transform modelRoot, Transform meshTransform)
        {
            var rootNormal = new Vector3((float)plane.NormalX, (float)plane.NormalZ, (float)plane.NormalY);
            var localToRoot = modelRoot != null
                ? modelRoot.worldToLocalMatrix * meshTransform.localToWorldMatrix
                : Matrix4x4.identity;
            var normal = localToRoot.transpose.MultiplyVector(rootNormal);
            var origin = localToRoot.MultiplyPoint3x4(Vector3.zero);
            return (normal, (float)(plane.OffsetMm * .001d) - Vector3.Dot(rootNormal, origin));
        }
    }

    internal sealed class SectionCutPresentation
    {
        internal Vector3[] CapVertices = Array.Empty<Vector3>();
        internal int[] CapIndices = Array.Empty<int>();
        internal Vector3[] ContourVertices = Array.Empty<Vector3>();
        internal int[] ContourIndices = Array.Empty<int>();
    }

    internal static class SectionCutBuilder
    {
        const double PlaneToleranceMm = 1e-4d;
        const double WeldMetres = 1e-7d;

        sealed class Node
        {
            internal readonly string Key;
            internal readonly Vector3 Point;
            internal Node(Vector3 point) { Point = point; Key = KeyFor(point); }
        }
        sealed class Segment
        {
            internal Node A, B;
            internal bool Below, Above;
        }
        sealed class Loop
        {
            internal Vector3[] Points;
            internal Vector2[] Polygon;
            internal double Area;
        }
        readonly struct Crossing
        {
            internal readonly double Mid, Left, Right;
            internal Crossing(double mid, double left, double right) { Mid = mid; Left = left; Right = right; }
        }

        internal static SectionCutPresentation Build(float[] positions, uint[] indices, float[] normals,
            SectionPlane plane, Transform modelRoot, Transform meshTransform)
        {
            var empty = new SectionCutPresentation();
            if (positions == null || indices == null || positions.Length % 3 != 0 || indices.Length % 3 != 0 || indices.Length == 0)
                return empty;
            var localPlane = SectionMaterialState.LocalPlane(plane, modelRoot, meshTransform);
            var planeNormal = localPlane.normal;
            if (planeNormal.sqrMagnitude < 1e-20f) return empty;
            var signed = new double[positions.Length / 3];
            var hasBelow = false;
            var hasAbove = false;
            for (var vertex = 0; vertex < signed.Length; vertex++)
            {
                signed[vertex] = (Vector3.Dot(planeNormal, Read(positions, vertex)) - localPlane.offsetMetres) * 1000d;
                hasBelow |= signed[vertex] < -PlaneToleranceMm;
                hasAbove |= signed[vertex] > PlaneToleranceMm;
            }
            if (!hasBelow || !hasAbove) return empty;

            var segments = new Dictionary<string, Segment>();
            for (var index = 0; index < indices.Length; index += 3)
            {
                var ia = checked((int)indices[index]);
                var ib = checked((int)indices[index + 1]);
                var ic = checked((int)indices[index + 2]);
                if (ia >= signed.Length || ib >= signed.Length || ic >= signed.Length) continue;
                var points = new[] { Read(positions, ia), Read(positions, ib), Read(positions, ic) };
                var distances = new[] { signed[ia], signed[ib], signed[ic] };
                if (Math.Abs(distances[0]) <= PlaneToleranceMm && Math.Abs(distances[1]) <= PlaneToleranceMm &&
                    Math.Abs(distances[2]) <= PlaneToleranceMm) continue;
                var found = new Dictionary<string, Node>();
                for (var edge = 0; edge < 3; edge++)
                {
                    var next = (edge + 1) % 3;
                    AddIntersection(points[edge], points[next], distances[edge], distances[next], found);
                    if (Math.Abs(distances[edge]) <= PlaneToleranceMm && Math.Abs(distances[next]) <= PlaneToleranceMm)
                    {
                        var a = new Node(points[edge]); var b = new Node(points[next]);
                        found[a.Key] = a; found[b.Key] = b;
                    }
                }
                if (found.Count != 2) continue;
                var pair = found.Values.ToArray();
                var aNode = pair[0]; var bNode = pair[1];
                if (aNode.Key == bNode.Key) continue;
                var faceNormal = normals != null && normals.Length == positions.Length
                    ? Read(normals, ia) + Read(normals, ib) + Read(normals, ic)
                    : Vector3.zero;
                if (faceNormal.sqrMagnitude < 1e-20f) faceNormal = Vector3.Cross(points[1] - points[0], points[2] - points[0]);
                if (Vector3.Dot(bNode.Point - aNode.Point, Vector3.Cross(faceNormal, planeNormal)) < 0)
                    (aNode, bNode) = (bNode, aNode);
                var key = string.CompareOrdinal(aNode.Key, bNode.Key) < 0
                    ? aNode.Key + "|" + bNode.Key : bNode.Key + "|" + aNode.Key;
                var below = distances.Any(value => value < -PlaneToleranceMm);
                var above = distances.Any(value => value > PlaneToleranceMm);
                if (segments.TryGetValue(key, out var existing))
                { existing.Below |= below; existing.Above |= above; }
                else segments.Add(key, new Segment { A = aNode, B = bNode, Below = below, Above = above });
            }

            var lines = segments.Values.Where(segment => segment.Below && segment.Above).ToArray();
            if (lines.Length == 0) return empty;
            var contourVertices = new Vector3[lines.Length * 2];
            var contourIndices = new int[lines.Length * 2];
            var adjacency = new Dictionary<string, List<int>>();
            for (var i = 0; i < lines.Length; i++)
            {
                contourVertices[i * 2] = lines[i].A.Point;
                contourVertices[i * 2 + 1] = lines[i].B.Point;
                contourIndices[i * 2] = i * 2;
                contourIndices[i * 2 + 1] = i * 2 + 1;
                AddAdjacent(adjacency, lines[i].A.Key, i);
                AddAdjacent(adjacency, lines[i].B.Key, i);
            }

            var rawLoops = new List<Vector3[]>();
            var visited = new bool[lines.Length];
            for (var first = 0; first < lines.Length; first++)
            {
                if (visited[first]) continue;
                var start = lines[first].A;
                var current = lines[first].B;
                var previous = first;
                var points = new List<Vector3> { start.Point };
                visited[first] = true;
                var closed = false;
                for (var steps = 0; steps < lines.Length; steps++)
                {
                    if (current.Key == start.Key) { closed = points.Count >= 3; break; }
                    points.Add(current.Point);
                    if (!adjacency.TryGetValue(current.Key, out var connected) || connected.Count != 2) break;
                    var next = -1;
                    foreach (var candidate in connected)
                        if (candidate != previous && !visited[candidate]) { next = candidate; break; }
                    if (next < 0) break;
                    visited[next] = true;
                    var segment = lines[next];
                    current = segment.A.Key == current.Key ? segment.B : segment.A;
                    previous = next;
                }
                if (closed) rawLoops.Add(points.ToArray());
            }

            var result = new SectionCutPresentation { ContourVertices = contourVertices, ContourIndices = contourIndices };
            if (rawLoops.Count == 0) return result;
            var normal = planeNormal.normalized;
            var axis = Mathf.Abs(normal.x) < .8f ? Vector3.right : Vector3.up;
            var u = Vector3.Cross(axis, normal).normalized;
            var v = Vector3.Cross(normal, u).normalized;
            var loops = rawLoops.Select(points =>
            {
                var polygon = points.Select(point => new Vector2(Vector3.Dot(point, u), Vector3.Dot(point, v))).ToArray();
                return new Loop { Points = points, Polygon = polygon, Area = SignedArea(polygon) };
            }).Where(loop => Math.Abs(loop.Area) > 1e-18d).ToArray();
            if (loops.Length == 0) return result;
            var xCoordinates = loops.SelectMany(loop => loop.Polygon).Select(point => (double)point.x)
                .OrderBy(value => value).ToArray();
            var uniqueX = new List<double>();
            foreach (var x in xCoordinates)
                if (uniqueX.Count == 0 || Math.Abs(x - uniqueX[uniqueX.Count - 1]) > 1e-10d) uniqueX.Add(x);
            var capVertices = new List<Vector3>();
            var capIndices = new List<int>();
            var planeBase = normal * (localPlane.offsetMetres / planeNormal.magnitude);
            for (var slab = 0; slab + 1 < uniqueX.Count; slab++)
            {
                var left = uniqueX[slab]; var right = uniqueX[slab + 1];
                if (right - left <= 1e-10d) continue;
                var middle = (left + right) * .5d;
                var crossings = new List<Crossing>();
                foreach (var loop in loops)
                for (var edge = 0; edge < loop.Polygon.Length; edge++)
                {
                    var a = loop.Polygon[edge]; var b = loop.Polygon[(edge + 1) % loop.Polygon.Length];
                    if ((a.x <= middle && b.x > middle) || (b.x <= middle && a.x > middle))
                    {
                        var yMiddle = YAt(a, b, middle);
                        crossings.Add(new Crossing(yMiddle, YAt(a, b, left), YAt(a, b, right)));
                    }
                }
                crossings.Sort((a, b) => a.Mid.CompareTo(b.Mid));
                for (var row = 0; row + 1 < crossings.Count; row++)
                {
                    var bottom = crossings[row]; var top = crossings[row + 1];
                    if (top.Mid - bottom.Mid <= 1e-12d || WindingAt(middle, (bottom.Mid + top.Mid) * .5d, loops) == 0) continue;
                    var quad2 = new[]
                    {
                        new Vector2((float)left, (float)bottom.Left), new Vector2((float)right, (float)bottom.Right),
                        new Vector2((float)right, (float)top.Right), new Vector2((float)left, (float)top.Left),
                    };
                    if (PolygonArea(quad2) <= 1e-14d) continue;
                    var baseIndex = capVertices.Count;
                    foreach (var point in quad2) capVertices.Add(planeBase + u * point.x + v * point.y);
                    if (plane.Inverted)
                    {
                        capIndices.AddRange(new[] { baseIndex, baseIndex + 1, baseIndex + 2, baseIndex, baseIndex + 2, baseIndex + 3 });
                    }
                    else
                    {
                        capIndices.AddRange(new[] { baseIndex, baseIndex + 2, baseIndex + 1, baseIndex, baseIndex + 3, baseIndex + 2 });
                    }
                }
            }
            result.CapVertices = capVertices.ToArray();
            result.CapIndices = capIndices.ToArray();
            return result;
        }

        static void AddIntersection(Vector3 a, Vector3 b, double da, double db, Dictionary<string, Node> found)
        {
            if (Math.Abs(da) <= PlaneToleranceMm) Add(a, found);
            else if (Math.Abs(db) <= PlaneToleranceMm) Add(b, found);
            else if ((da < 0 && db > 0) || (da > 0 && db < 0)) Add(Vector3.LerpUnclamped(a, b, (float)(da / (da - db))), found);
        }
        static void Add(Vector3 point, Dictionary<string, Node> found)
        { var node = new Node(point); found[node.Key] = node; }
        static string KeyFor(Vector3 point) =>
            Math.Round(point.x / WeldMetres).ToString("0", CultureInfo.InvariantCulture) + "," +
            Math.Round(point.y / WeldMetres).ToString("0", CultureInfo.InvariantCulture) + "," +
            Math.Round(point.z / WeldMetres).ToString("0", CultureInfo.InvariantCulture);
        static Vector3 Read(float[] values, int vertex) => new Vector3(values[vertex * 3], values[vertex * 3 + 1], values[vertex * 3 + 2]);
        static void AddAdjacent(Dictionary<string, List<int>> adjacency, string key, int segment)
        { if (!adjacency.TryGetValue(key, out var connected)) adjacency.Add(key, connected = new List<int>(2)); connected.Add(segment); }
        static double SignedArea(Vector2[] polygon)
        {
            double area = 0;
            for (var i = 0; i < polygon.Length; i++)
            { var a = polygon[i]; var b = polygon[(i + 1) % polygon.Length]; area += (double)a.x * b.y - (double)b.x * a.y; }
            return area * .5d;
        }
        static double PolygonArea(Vector2[] polygon) => Math.Abs(SignedArea(polygon));
        static double YAt(Vector2 a, Vector2 b, double x) => a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y);
        static int WindingAt(double x, double y, Loop[] loops)
        {
            var winding = 0;
            foreach (var loop in loops)
                if (Contains(new Vector2((float)x, (float)y), loop.Polygon)) winding += Math.Sign(loop.Area);
            return winding;
        }
        static bool Contains(Vector2 point, Vector2[] polygon)
        {
            var inside = false;
            for (int i = 0, j = polygon.Length - 1; i < polygon.Length; j = i++)
            {
                var a = polygon[i]; var b = polygon[j];
                if ((a.y > point.y) != (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x)
                    inside = !inside;
            }
            return inside;
        }
    }
}
