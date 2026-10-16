using System;
using System.Linq;
using Kreoda.QuestFoundation;
using Kreoda.Session;
using UnityEngine;
using UnityEngine.Rendering;

namespace Kreoda.QuestRuntime
{
    // Transient render-only geometry: never a selection or publishable CAD target.
    public sealed class QuestPreviewView : MonoBehaviour
    {
        public Material Material;
        SpatialEditIntent _intent;
        Mesh _mesh, _sectionCap, _sectionContour;
        MeshFilter _filter, _sectionCapFilter, _sectionContourFilter;
        MeshRenderer _renderer, _sectionCapRenderer, _sectionContourRenderer;
        LineRenderer _prediction;
        MaterialPropertyBlock _style, _capStyle, _contourStyle;
        float[] _positions, _normals;
        uint[] _indices;
        SectionPlane? _sectionPlane;
        Transform _sectionRoot;
        Material _sectionCapMaterial, _sectionContourMaterial;
        bool _stale;
        long _ticket, _generation = -1;
        string _previewId;
        public long Begin(SpatialEditIntent intent, Mesh committed = null)
        {
            Clear();_intent = intent ?? throw new ArgumentNullException(nameof(intent));
            if (committed != null)
            {
                _mesh = Instantiate(committed);_mesh.name = "Transient committed reference";
                ReadMesh(committed, out _positions, out _normals, out _indices);
                Surface(_mesh);StaleStyle();
                ApplySection(_sectionPlane, _sectionRoot, _sectionCapMaterial, _sectionContourMaterial);
            }
            return _ticket;
        }
        void Surface(Mesh mesh)
        {
            if (_filter == null) _filter = gameObject.AddComponent<MeshFilter>();
            if (_renderer == null) _renderer = gameObject.AddComponent<MeshRenderer>();
            _filter.sharedMesh = mesh;_renderer.sharedMaterial = Material;_renderer.enabled = true;
            ApplyStyle();
        }
        void StaleStyle()
        {
            _stale = true;
            ApplyStyle();
        }
        public bool TryUpload(long ticket, SessionPreviewMeshResult source, Func<bool> isCurrent)
        {
            if (!Matches(ticket, source) || !isCurrent()) return false;
            var data = CadMeshTransform.Convert(source.Mesh.Positions, source.Mesh.Normals, source.Mesh.Indices,
                source.Mesh.EdgeVertices, Array.Empty<FaceRange>(), Array.Empty<EdgeRange>(), source.Mesh.BboxMm);
            Mesh candidate = null;
            try
            {
                candidate = new Mesh { name = "Transient CAD preview", indexFormat = data.Positions.Length / 3 > 65535 ? IndexFormat.UInt32 : IndexFormat.UInt16 };
                candidate.vertices = Vectors(data.Positions);candidate.normals = Vectors(data.Normals);
                candidate.triangles = data.Indices.Select(i => checked((int)i)).ToArray();candidate.RecalculateBounds();
                if (!Matches(ticket, source) || !isCurrent()) return false;
                _positions = data.Positions;_normals = data.Normals;_indices = data.Indices;_stale = false;
                Surface(candidate);
                DisposeMesh(_mesh);_mesh = candidate;candidate = null;
                ApplySection(_sectionPlane, _sectionRoot, _sectionCapMaterial, _sectionContourMaterial);
                _generation = source.Header.Generation;_previewId = source.Header.PreviewId;
                return true;
            }
            finally { DisposeMesh(candidate); }
        }

        public void ApplySection(SectionPlane? plane, Transform sectionRoot, Material capMaterial, Material contourMaterial)
        {
            _sectionPlane = plane;_sectionRoot = sectionRoot;
            _sectionCapMaterial = capMaterial;_sectionContourMaterial = contourMaterial;
            ApplyStyle();
            if (!plane.HasValue || _positions == null || _indices == null)
            { ClearCut();return; }
            var cut = SectionCutBuilder.Build(_positions, _indices, _normals, plane.Value, sectionRoot, transform);
            if (cut.CapIndices.Length > 0)
            {
                if (_sectionCapFilter == null)
                {
                    var cap = new GameObject("Section cap");cap.transform.SetParent(transform, false);
                    _sectionCapFilter = cap.AddComponent<MeshFilter>();_sectionCapRenderer = cap.AddComponent<MeshRenderer>();
                }
                var generated = new Mesh { name = "Render-only preview section cap", indexFormat = cut.CapVertices.Length > 65535 ? IndexFormat.UInt32 : IndexFormat.UInt16 };
                generated.vertices = cut.CapVertices;generated.triangles = cut.CapIndices;generated.RecalculateBounds();
                DisposeMesh(_sectionCap);_sectionCap = generated;
                _sectionCapFilter.sharedMesh = generated;_sectionCapRenderer.sharedMaterial = capMaterial;_sectionCapRenderer.enabled = true;
                if (_capStyle == null) _capStyle = new MaterialPropertyBlock();
                SectionMaterialState.Apply(_sectionCapRenderer, plane, sectionRoot, _capStyle);
            }
            else ClearCap();
            if (cut.ContourIndices.Length > 0)
            {
                if (_sectionContourFilter == null)
                {
                    var contour = new GameObject("Section contour");contour.transform.SetParent(transform, false);
                    _sectionContourFilter = contour.AddComponent<MeshFilter>();_sectionContourRenderer = contour.AddComponent<MeshRenderer>();
                }
                var generated = new Mesh { name = "Render-only preview section contour", indexFormat = cut.ContourVertices.Length > 65535 ? IndexFormat.UInt32 : IndexFormat.UInt16 };
                generated.vertices = cut.ContourVertices;generated.SetIndices(cut.ContourIndices, MeshTopology.Lines, 0);generated.RecalculateBounds();
                DisposeMesh(_sectionContour);_sectionContour = generated;
                _sectionContourFilter.sharedMesh = generated;_sectionContourRenderer.sharedMaterial = contourMaterial;_sectionContourRenderer.enabled = true;
                if (_contourStyle == null) _contourStyle = new MaterialPropertyBlock();
                SectionMaterialState.Apply(_sectionContourRenderer, plane, sectionRoot, _contourStyle);
            }
            else ClearContour();
        }

        void ApplyStyle()
        {
            if (_renderer == null) return;
            var block = StyleBlock();
            _renderer.GetPropertyBlock(block);
            if (Material != null)
            {
                var color = Material.color;
                if (_stale) color.a = Mathf.Min(color.a, .1f);
                block.SetColor("_Color", color);
            }
            SectionMaterialState.Set(block, _sectionPlane, _sectionRoot, _renderer.transform);
            _renderer.SetPropertyBlock(block);
        }

        MaterialPropertyBlock StyleBlock()
        {
            if (_style == null) _style = new MaterialPropertyBlock();
            return _style;
        }

        static void ReadMesh(Mesh mesh, out float[] positions, out float[] normals, out uint[] indices)
        {
            var vertices = mesh.vertices;var meshNormals = mesh.normals;var triangles = mesh.triangles;
            positions = new float[vertices.Length * 3];normals = new float[meshNormals.Length * 3];indices = new uint[triangles.Length];
            for (var i = 0; i < vertices.Length; i++)
            { positions[i * 3] = vertices[i].x;positions[i * 3 + 1] = vertices[i].y;positions[i * 3 + 2] = vertices[i].z; }
            for (var i = 0; i < meshNormals.Length; i++)
            { normals[i * 3] = meshNormals[i].x;normals[i * 3 + 1] = meshNormals[i].y;normals[i * 3 + 2] = meshNormals[i].z; }
            for (var i = 0; i < triangles.Length; i++) indices[i] = checked((uint)triangles[i]);
        }
        bool Matches(long ticket, SessionPreviewMeshResult source)
        {
            var h = source?.Header;
            return _intent != null && ticket == _ticket && h != null && h.Generation > _generation &&
                (_previewId == null || h.PreviewId == _previewId) && h.SessionId == _intent.SessionId &&
                h.DocumentId == _intent.DocumentId && h.BaseRevision == _intent.BaseRevision &&
                h.FeatureId == _intent.FeatureId && h.BodyId == _intent.BodyId && h.TargetTipId == _intent.TargetTipId &&
                h.ParamName == _intent.Parameters[0] && h.Quality == 0;
        }
        // Local handle prediction updates every frame; exact candidate solid is PC-authored.
        public void Predict(long ticket, Vector3 originWorld, Vector3 handleWorld)
        {
            if (_intent == null || ticket != _ticket) return;
            StaleStyle();
            if (_prediction == null)
            {
                var child = new GameObject("Local dimension prediction");child.transform.SetParent(transform, false);
                _prediction = child.AddComponent<LineRenderer>();_prediction.useWorldSpace = true;
                _prediction.positionCount = 2;_prediction.startWidth = _prediction.endWidth = .0015f;
            }
            _prediction.sharedMaterial = Material;_prediction.enabled = true;
            _prediction.SetPosition(0, originWorld);_prediction.SetPosition(1, handleWorld);
        }
        public void Clear()
        {
            _ticket++;_intent = null;_generation = -1;_previewId = null;
            if (_filter != null) _filter.sharedMesh = null;
            if (_renderer != null) _renderer.enabled = false;
            if (_prediction != null) _prediction.enabled = false;
            ClearCut();DisposeMesh(_mesh);_mesh = null;
            _positions = _normals = null;_indices = null;_stale = false;
        }
        static Vector3[] Vectors(float[] values)
        {
            var result = new Vector3[values.Length / 3];
            for (var i = 0; i < result.Length; i++) result[i] = new Vector3(values[i * 3], values[i * 3 + 1], values[i * 3 + 2]);
            return result;
        }
        static void DisposeMesh(Mesh mesh)
        {
            if (mesh == null) return;
            if (Application.isPlaying) Destroy(mesh);else DestroyImmediate(mesh);
        }
        void ClearCut() { ClearCap();ClearContour(); }
        void ClearCap()
        {
            if (_sectionCapFilter != null) _sectionCapFilter.sharedMesh = null;
            if (_sectionCapRenderer != null) _sectionCapRenderer.enabled = false;
            DisposeMesh(_sectionCap);_sectionCap = null;
        }
        void ClearContour()
        {
            if (_sectionContourFilter != null) _sectionContourFilter.sharedMesh = null;
            if (_sectionContourRenderer != null) _sectionContourRenderer.enabled = false;
            DisposeMesh(_sectionContour);_sectionContour = null;
        }
        void OnDestroy() => Clear();
    }
}
