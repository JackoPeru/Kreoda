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
        public double[] BboxMetres { get; private set; }
        BodyMesh _semantic;
        Mesh _surface, _edges, _selection;
        MeshFilter _edgeFilter, _selectionFilter;
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
                var renderer = GetComponent<MeshRenderer>();
                if (renderer == null) renderer = gameObject.AddComponent<MeshRenderer>();
                var collider = GetComponent<MeshCollider>();
                if (collider == null) collider = gameObject.AddComponent<MeshCollider>();
                if (_edgeFilter == null) _edgeFilter = Child("Edges", EdgeMaterial);
                if (_selectionFilter == null) _selectionFilter = Child("Selection", SelectionMaterial);
                // Avoid welding/cleaning that could renumber semantic triangles.
                collider.cookingOptions = MeshColliderCookingOptions.None;
                try { collider.sharedMesh = surface; }
                catch { collider.sharedMesh = _surface; throw; }
                filter.sharedMesh = surface;
                renderer.sharedMaterial = _preview && PreviewMaterial != null ? PreviewMaterial : SurfaceMaterial;
                _edgeFilter.sharedMesh = lines;
                _edgeFilter.GetComponent<MeshRenderer>().sharedMaterial = EdgeMaterial;
                _selectionFilter.GetComponent<MeshRenderer>().sharedMaterial = SelectionMaterial;
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
            }
            finally { DisposeMesh(surface); DisposeMesh(lines); }
        }

        public MeshSemanticHit ResolveFace(int triangle) => _semantic?.ResolveFaceHit(triangle);

        // Client-local placement preview uses the same immutable geometry and
        // semantic map. Shared referenced materials are never owned/disposed here.
        public void SetPreview(bool active)
        {
            _preview = active;
            var renderer = GetComponent<MeshRenderer>();
            if (renderer != null) renderer.sharedMaterial = active && PreviewMaterial != null ? PreviewMaterial : SurfaceMaterial;
        }

        public void SelectBody()
        {
            if (_semantic != null) SelectFace(new MeshSemanticHit(FeatureId, 0, _semantic.TriangleCount, false));
        }

        // Only the clicked body's polylines are examined, once per selection.
        public MeshSemanticHit ResolveNearestEdge(Vector3 worldPoint, float toleranceMetres)
        {
            if (_semantic == null || toleranceMetres <= 0) return null;
            float nearest = toleranceMetres * toleranceMetres;
            int vertex = -1;
            var positions = _edges.vertices;
            foreach (var edge in _semantic.Edges)
                for (var v = edge.VertexStart; v + 1 < edge.VertexStart + edge.VertexCount; v++)
                {
                    var a = transform.TransformPoint(positions[v]);
                    var b = transform.TransformPoint(positions[v + 1]);
                    var ab = b - a;
                    var t = ab.sqrMagnitude == 0 ? 0 : Mathf.Clamp01(Vector3.Dot(worldPoint - a, ab) / ab.sqrMagnitude);
                    var distance = (worldPoint - a - t * ab).sqrMagnitude;
                    if (distance < nearest) { nearest = distance; vertex = v; }
                }
            return _semantic.ResolveEdgeByNativeVertexIndex(vertex);
        }

        public void SelectFace(MeshSemanticHit hit)
        {
            ClearSelection();
            if (hit == null || _surface == null) return;
            var selected = _surface.triangles.Skip(checked(hit.RangeStart * 3))
                .Take(checked(hit.RangeCount * 3)).ToArray();
            _selection = new Mesh { name = "Selected CAD face", indexFormat = _surface.indexFormat };
            _selection.vertices = _surface.vertices;
            _selection.normals = _surface.normals;
            _selection.triangles = selected;
            _selection.RecalculateBounds();
            _selectionFilter.sharedMesh = _selection;
        }

        public void SelectEdge(MeshSemanticHit hit)
        {
            ClearSelection();
            if (hit == null || _edges == null) return;
            _selection = new Mesh { name = "Selected CAD edge", indexFormat = _edges.indexFormat };
            _selection.vertices = _edges.vertices;
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
            DisposeMesh(_surface);
            DisposeMesh(_edges);
        }
    }
}
