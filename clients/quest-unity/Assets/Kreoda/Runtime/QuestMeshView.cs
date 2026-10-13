using System;
using System.Collections.Generic;
using System.Linq;
using Kreoda.QuestFoundation;
using Kreoda.Session;
using UnityEngine;
using UnityEngine.Rendering;

namespace Kreoda.QuestRuntime
{
    public sealed class QuestMeshView : MonoBehaviour
    {
        public string BodyId { get; private set; }
        public string FeatureId { get; private set; }
        public string InstanceId { get; private set; }
        public int UploadVersion { get; private set; }
        public int Quality { get; private set; }
        public int TriangleCount => _semantic?.TriangleCount ?? 0;
        public Material SurfaceMaterial;
        public Material EdgeMaterial;
        public Material SelectionMaterial;
        public Material PreviewMaterial;
        public Material SectionCapMaterial, SectionContourMaterial;
        public double[] BboxMetres { get; private set; }
        BodyMesh _semantic;
        Mesh _surface, _edges, _selection;
        Mesh _sectionCap, _sectionContour;
        MeshFilter _edgeFilter, _selectionFilter, _sectionCapFilter, _sectionContourFilter;
        MeshRenderer _surfaceRenderer, _edgeRenderer, _selectionRenderer, _sectionCapRenderer, _sectionContourRenderer;
        MeshCollider _sectionCapCollider;
        MaterialPropertyBlock _sectionProperties;
        SectionPlane? _sectionPlane;
        Transform _sectionRoot;
        SectionPlane? _appliedPlane;
        Transform _appliedRoot;
        Material _appliedCapMaterial, _appliedContourMaterial;
        int _sectionUploadVersion = -1;
        Matrix4x4 _sectionToRoot;
        bool _hasSectionTransform;
        bool _preview;

        // Called by the connection adapter on Unity's main thread, inside the
        // scene freshness gate. Native coordinates include instance placement.
        public void Upload(SessionMeshResult source)
        {
            if (source == null) throw new ArgumentNullException(nameof(source));
            var faces = source.Faces.Select(f => new FaceRange(f.PersistentFaceId,
                checked((int)f.TriangleStart), checked((int)f.TriangleCount))).ToArray();
            var edges = source.Edges.Select(e => new EdgeRange(e.PersistentEdgeId,
                checked((int)e.VertexStart), checked((int)e.VertexCount))).ToArray();
            var data = CadMeshTransform.Convert(source.Positions, source.Normals, source.Indices,
                source.EdgeVertices, faces, edges, source.BboxMm);
            var semantic = new BodyMesh(source.Header.BodyId, data.Positions, data.Normals,
                data.Indices, data.Faces, data.Edges, data.EdgeVertices, source.Header.InstanceId);
            Mesh surface = null, lines = null;
            try
            {
                surface = NewMesh("CAD surface", data.Positions);
                surface.normals = Vectors(data.Normals);
                surface.triangles = data.Indices.Select(i => checked((int)i)).ToArray();
                surface.RecalculateBounds();
                lines = NewMesh("CAD edges", data.EdgeVertices);
                var segments = new List<int>();
                foreach (var edge in data.Edges)
                    for (var v = edge.VertexStart; v + 1 < edge.VertexStart + edge.VertexCount; v++)
                    { segments.Add(v); segments.Add(v + 1); }
                lines.SetIndices(segments.ToArray(), MeshTopology.Lines, 0);
                lines.RecalculateBounds();

                var filter = GetComponent<MeshFilter>();
                if (filter == null) filter = gameObject.AddComponent<MeshFilter>();
                _surfaceRenderer = GetComponent<MeshRenderer>();
                if (_surfaceRenderer == null) _surfaceRenderer = gameObject.AddComponent<MeshRenderer>();
                var collider = GetComponent<MeshCollider>();
                if (collider == null) collider = gameObject.AddComponent<MeshCollider>();
                if (_edgeFilter == null) _edgeFilter = Child("Edges", EdgeMaterial);
                if (_selectionFilter == null) _selectionFilter = Child("Selection", SelectionMaterial);
                _edgeRenderer = _edgeFilter.GetComponent<MeshRenderer>();
                _selectionRenderer = _selectionFilter.GetComponent<MeshRenderer>();
                // Avoid welding/cleaning that could renumber semantic triangles.
                collider.cookingOptions = MeshColliderCookingOptions.None;
                try { collider.sharedMesh = surface; }
                catch { collider.sharedMesh = _surface; throw; }
                filter.sharedMesh = surface;
                _surfaceRenderer.sharedMaterial = _preview && PreviewMaterial != null ? PreviewMaterial : SurfaceMaterial;
                _edgeFilter.sharedMesh = lines;
                _edgeRenderer.sharedMaterial = EdgeMaterial;
                _selectionRenderer.sharedMaterial = SelectionMaterial;
                DisposeMesh(_surface);
                DisposeMesh(_edges);
                ClearSelection();
                _surface = surface;
                _edges = lines;
                surface = lines = null;
                _semantic = semantic;
                BodyId = source.Header.BodyId;
                FeatureId = source.Header.FeatureId;
                InstanceId = source.Header.InstanceId;
                BboxMetres = data.BboxMetres;
                UploadVersion++;
                Quality = source.Header.Quality;
                ApplySection(_sectionPlane, _sectionRoot, SectionCapMaterial, SectionContourMaterial);
            }
            finally { DisposeMesh(surface); DisposeMesh(lines); }
        }

        public MeshSemanticHit ResolveFace(int triangle) => _semantic?.ResolveFaceHit(triangle);

        // Client-local placement preview uses the same immutable geometry and
        // semantic map. Shared referenced materials are never owned/disposed here.
        public void SetPreview(bool active)
        {
            _preview = active;
            if (_surfaceRenderer == null) _surfaceRenderer = GetComponent<MeshRenderer>();
            if (_surfaceRenderer != null) _surfaceRenderer.sharedMaterial = active && PreviewMaterial != null ? PreviewMaterial : SurfaceMaterial;
        }

        public void ApplySection(SectionPlane? plane, Transform sectionRoot, Material capMaterial, Material contourMaterial)
        {
            _sectionPlane = plane;
            _sectionRoot = sectionRoot;
            SectionCapMaterial = capMaterial;
            SectionContourMaterial = contourMaterial;
            if (_surface == null || _semantic == null) return;
            var toRoot = sectionRoot != null ? sectionRoot.worldToLocalMatrix * transform.localToWorldMatrix : Matrix4x4.identity;
            if (_sectionUploadVersion == UploadVersion && Nullable.Equals(_appliedPlane, plane) &&
                _appliedRoot == sectionRoot && _appliedCapMaterial == capMaterial &&
                _appliedContourMaterial == contourMaterial && _hasSectionTransform && MatrixEqual(_sectionToRoot, toRoot)) return;
            if (_sectionProperties == null) _sectionProperties = new MaterialPropertyBlock();
            SectionMaterialState.Apply(_surfaceRenderer, plane, sectionRoot, _sectionProperties);
            SectionMaterialState.Apply(_edgeRenderer, plane, sectionRoot, _sectionProperties);
            SectionMaterialState.Apply(_selectionRenderer, plane, sectionRoot, _sectionProperties);
            _sectionCapRenderer = _sectionCapFilter != null ? _sectionCapFilter.GetComponent<MeshRenderer>() : null;
            _sectionContourRenderer = _sectionContourFilter != null ? _sectionContourFilter.GetComponent<MeshRenderer>() : null;
            SectionMaterialState.Apply(_sectionCapRenderer, plane, sectionRoot, _sectionProperties);
            SectionMaterialState.Apply(_sectionContourRenderer, plane, sectionRoot, _sectionProperties);
            if (plane.HasValue)
            {
                var cut = SectionCutBuilder.Build(_semantic.Positions, _semantic.Indices, _semantic.Normals,
                    plane.Value, sectionRoot, transform);
                ApplyCut(cut);
            }
            else ClearCut();
            _appliedPlane = plane;
            _appliedRoot = sectionRoot;
            _appliedCapMaterial = capMaterial;
            _appliedContourMaterial = contourMaterial;
            _sectionUploadVersion = UploadVersion;
            _sectionToRoot = toRoot;
            _hasSectionTransform = true;
        }

        public bool IsSectionCapCollider(Collider collider) => collider != null && collider == _sectionCapCollider;

        void LateUpdate()
        {
            if (!_sectionPlane.HasValue || _sectionRoot == null || _semantic == null) return;
            var toRoot = _sectionRoot.worldToLocalMatrix * transform.localToWorldMatrix;
            if (!_hasSectionTransform || !MatrixEqual(_sectionToRoot, toRoot))
                ApplySection(_sectionPlane, _sectionRoot, SectionCapMaterial, SectionContourMaterial);
        }

        static bool MatrixEqual(Matrix4x4 left, Matrix4x4 right)
        {
            for (var i = 0; i < 16; i++) if (Mathf.Abs(left[i] - right[i]) > 1e-6f) return false;
            return true;
        }

        void ApplyCut(SectionCutPresentation cut)
        {
            if (cut.CapIndices.Length > 0)
            {
                if (_sectionCapFilter == null)
                {
                    _sectionCapFilter = Child("Section cap", SectionCapMaterial);
                    _sectionCapRenderer = _sectionCapFilter.GetComponent<MeshRenderer>();
                    _sectionCapCollider = _sectionCapFilter.gameObject.AddComponent<MeshCollider>();
                }
                var mesh = new Mesh { name = "Render-only section cap", indexFormat = cut.CapVertices.Length > 65535 ? IndexFormat.UInt32 : IndexFormat.UInt16 };
                mesh.vertices = cut.CapVertices;
                mesh.triangles = cut.CapIndices;
                mesh.RecalculateBounds();
                _sectionCapCollider.sharedMesh = null;
                DisposeMesh(_sectionCap);
                _sectionCap = mesh;
                _sectionCapFilter.sharedMesh = mesh;
                _sectionCapCollider.sharedMesh = mesh;
                _sectionCapRenderer.sharedMaterial = SectionCapMaterial;
                _sectionCapRenderer.enabled = true;
            }
            else ClearCap();

            if (cut.ContourIndices.Length > 0)
            {
                if (_sectionContourFilter == null)
                {
                    _sectionContourFilter = Child("Section contour", SectionContourMaterial);
                    _sectionContourRenderer = _sectionContourFilter.GetComponent<MeshRenderer>();
                }
                var mesh = new Mesh { name = "Render-only section contour", indexFormat = cut.ContourVertices.Length > 65535 ? IndexFormat.UInt32 : IndexFormat.UInt16 };
                mesh.vertices = cut.ContourVertices;
                mesh.SetIndices(cut.ContourIndices, MeshTopology.Lines, 0);
                mesh.RecalculateBounds();
                DisposeMesh(_sectionContour);
                _sectionContour = mesh;
                _sectionContourFilter.sharedMesh = mesh;
                _sectionContourRenderer.sharedMaterial = SectionContourMaterial;
                _sectionContourRenderer.enabled = true;
            }
            else ClearContour();
        }

        void ClearCut() { ClearCap(); ClearContour(); }
        void ClearCap()
        {
            if (_sectionCapCollider != null) _sectionCapCollider.sharedMesh = null;
            if (_sectionCapFilter != null) _sectionCapFilter.sharedMesh = null;
            if (_sectionCapRenderer != null) _sectionCapRenderer.enabled = false;
            DisposeMesh(_sectionCap); _sectionCap = null;
        }
        void ClearContour()
        {
            if (_sectionContourFilter != null) _sectionContourFilter.sharedMesh = null;
            if (_sectionContourRenderer != null) _sectionContourRenderer.enabled = false;
            DisposeMesh(_sectionContour); _sectionContour = null;
        }

        public void SelectBody()
        {
            if (_semantic != null) SelectFace(new MeshSemanticHit(FeatureId, 0, _semantic.TriangleCount, false));
        }

        // Only the clicked body's polylines are examined, once per selection.
        public MeshSemanticHit ResolveNearestEdge(Vector3 worldPoint, float toleranceMetres) =>
            ResolveNearestEdge(worldPoint, toleranceMetres, null, null);

        public MeshSemanticHit ResolveNearestEdge(Vector3 worldPoint, float toleranceMetres,
            SectionPlane? plane, Transform sectionRoot)
        {
            if (_semantic == null || toleranceMetres <= 0) return null;
            float nearest = toleranceMetres * toleranceMetres;
            int vertex = -1;
            var positions = _semantic.EdgeVertices;
            var toRoot = sectionRoot != null ? sectionRoot.worldToLocalMatrix * transform.localToWorldMatrix : Matrix4x4.identity;
            foreach (var edge in _semantic.Edges)
                for (var v = edge.VertexStart; v + 1 < edge.VertexStart + edge.VertexCount; v++)
                {
                    var aLocal = Read(positions, v);
                    var bLocal = Read(positions, v + 1);
                    if (plane.HasValue)
                    {
                        var planeA = toRoot.MultiplyPoint3x4(aLocal);
                        var planeB = toRoot.MultiplyPoint3x4(bLocal);
                        var da = plane.Value.SignedDistanceUnityLocalMetres(planeA.x, planeA.y, planeA.z);
                        var db = plane.Value.SignedDistanceUnityLocalMetres(planeB.x, planeB.y, planeB.z);
                        if (da < -SectionPlane.PickToleranceMm && db < -SectionPlane.PickToleranceMm) continue;
                        if (da < -SectionPlane.PickToleranceMm)
                            aLocal = Vector3.LerpUnclamped(aLocal, bLocal, (float)(da / (da - db)));
                        else if (db < -SectionPlane.PickToleranceMm)
                            bLocal = Vector3.LerpUnclamped(aLocal, bLocal, (float)(da / (da - db)));
                    }
                    var a = transform.TransformPoint(aLocal);
                    var b = transform.TransformPoint(bLocal);
                    var ab = b - a;
                    var t = ab.sqrMagnitude == 0 ? 0 : Mathf.Clamp01(Vector3.Dot(worldPoint - a, ab) / ab.sqrMagnitude);
                    var distance = (worldPoint - a - t * ab).sqrMagnitude;
                    if (distance < nearest) { nearest = distance; vertex = v; }
                }
            return _semantic.ResolveEdgeByNativeVertexIndex(vertex);
        }

        public bool TryRaycast(Ray worldRay, SectionPlane? plane, Transform sectionRoot, float maxDistance,
            out int triangleIndex, out Vector3 worldPoint, out float worldDistance)
        {
            triangleIndex = -1;
            worldPoint = default;
            worldDistance = maxDistance;
            if (_semantic == null || maxDistance <= 0) return false;
            var direction = worldRay.direction.normalized;
            var localOrigin = transform.InverseTransformPoint(worldRay.origin);
            var localDirection = transform.InverseTransformVector(direction);
            if (localDirection.sqrMagnitude < 1e-20f) return false;
            var toRoot = sectionRoot != null ? sectionRoot.worldToLocalMatrix * transform.localToWorldMatrix : Matrix4x4.identity;
            var positions = _semantic.Positions;
            var indices = _semantic.Indices;
            var nearest = maxDistance;
            var found = false;
            for (var triangle = 0; triangle < indices.Length / 3; triangle++)
            {
                var offset = triangle * 3;
                var a = Read(positions, checked((int)indices[offset]));
                var b = Read(positions, checked((int)indices[offset + 1]));
                var c = Read(positions, checked((int)indices[offset + 2]));
                if (!IntersectTriangle(localOrigin, localDirection, a, b, c, out var distance) ||
                    distance < 0 || distance >= nearest) continue;
                var point = localOrigin + localDirection * distance;
                if (plane.HasValue)
                {
                    var modelPoint = toRoot.MultiplyPoint3x4(point);
                    if (!plane.Value.IsVisibleUnityLocalMetres(modelPoint.x, modelPoint.y, modelPoint.z)) continue;
                }
                var world = transform.TransformPoint(point);
                var alongRay = Vector3.Dot(world - worldRay.origin, direction);
                if (alongRay < 0 || alongRay > nearest) continue;
                nearest = alongRay;
                triangleIndex = triangle;
                worldPoint = world;
                worldDistance = alongRay;
                found = true;
            }
            return found;
        }

        static bool IntersectTriangle(Vector3 origin, Vector3 direction, Vector3 a, Vector3 b, Vector3 c, out float distance)
        {
            const float epsilon = 1e-8f;
            var edge1 = b - a;
            var edge2 = c - a;
            var p = Vector3.Cross(direction, edge2);
            var determinant = Vector3.Dot(edge1, p);
            if (Mathf.Abs(determinant) <= epsilon) { distance = 0; return false; }
            var inverse = 1f / determinant;
            var t = origin - a;
            var u = Vector3.Dot(t, p) * inverse;
            if (u < -epsilon || u > 1 + epsilon) { distance = 0; return false; }
            var q = Vector3.Cross(t, edge1);
            var v = Vector3.Dot(direction, q) * inverse;
            if (v < -epsilon || u + v > 1 + epsilon) { distance = 0; return false; }
            distance = Vector3.Dot(edge2, q) * inverse;
            return distance >= -epsilon;
        }

        static Vector3 Read(float[] values, int vertex) => new Vector3(values[vertex * 3], values[vertex * 3 + 1], values[vertex * 3 + 2]);

        public void SelectFace(MeshSemanticHit hit)
        {
            ClearSelection();
            if (hit == null || _surface == null) return;
            var selected = new int[checked(hit.RangeCount * 3)];
            for (var i = 0; i < selected.Length; i++) selected[i] = checked((int)_semantic.Indices[hit.RangeStart * 3 + i]);
            _selection = new Mesh { name = "Selected CAD face", indexFormat = _surface.indexFormat };
            _selection.vertices = Vectors(_semantic.Positions);
            _selection.normals = Vectors(_semantic.Normals);
            _selection.triangles = selected;
            _selection.RecalculateBounds();
            _selectionFilter.sharedMesh = _selection;
        }

        public void SelectEdge(MeshSemanticHit hit)
        {
            ClearSelection();
            if (hit == null || _edges == null) return;
            _selection = new Mesh { name = "Selected CAD edge", indexFormat = _edges.indexFormat };
            _selection.vertices = Vectors(_semantic.EdgeVertices);
            var segments = new List<int>();
            for (var v = hit.RangeStart; v + 1 < hit.RangeStart + hit.RangeCount; v++)
            { segments.Add(v); segments.Add(v + 1); }
            _selection.SetIndices(segments.ToArray(), MeshTopology.Lines, 0);
            _selection.RecalculateBounds();
            _selectionFilter.sharedMesh = _selection;
        }

        public void ClearSelection()
        {
            if (_selectionFilter != null) _selectionFilter.sharedMesh = null;
            DisposeMesh(_selection);
            _selection = null;
        }

        MeshFilter Child(string name, Material material)
        {
            var child = new GameObject(name);
            child.transform.SetParent(transform, false);
            var filter = child.AddComponent<MeshFilter>();
            child.AddComponent<MeshRenderer>().sharedMaterial = material;
            return filter;
        }

        static Mesh NewMesh(string name, float[] coordinates)
        {
            var mesh = new Mesh { name = name, indexFormat = coordinates.Length / 3 > 65535
                ? IndexFormat.UInt32 : IndexFormat.UInt16 };
            mesh.vertices = Vectors(coordinates);
            return mesh;
        }

        static Vector3[] Vectors(float[] coordinates)
        {
            var vectors = new Vector3[coordinates.Length / 3];
            for (var i = 0; i < vectors.Length; i++)
                vectors[i] = new Vector3(coordinates[i * 3], coordinates[i * 3 + 1], coordinates[i * 3 + 2]);
            return vectors;
        }

        static void DisposeMesh(Mesh mesh)
        {
            if (mesh == null) return;
            if (Application.isPlaying) Destroy(mesh); else DestroyImmediate(mesh);
        }

        void OnDestroy()
        {
            ClearSelection();
            ClearCut();
            DisposeMesh(_surface);
            DisposeMesh(_edges);
        }
    }
}
