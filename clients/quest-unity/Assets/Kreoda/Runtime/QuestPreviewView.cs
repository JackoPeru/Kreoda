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
        Mesh _mesh;
        MeshFilter _filter;
        MeshRenderer _renderer;
        LineRenderer _prediction;
        MaterialPropertyBlock _staleStyle;
        long _ticket, _generation = -1;
        string _previewId;
        public long Begin(SpatialEditIntent intent, Mesh committed = null)
        {
            Clear();_intent = intent ?? throw new ArgumentNullException(nameof(intent));
            if (committed != null)
            {
                _mesh = Instantiate(committed);_mesh.name = "Transient committed reference";
                Surface(_mesh);StaleStyle();
            }
            return _ticket;
        }
        void Surface(Mesh mesh)
        {
            if (_filter == null) _filter = gameObject.AddComponent<MeshFilter>();
            if (_renderer == null) _renderer = gameObject.AddComponent<MeshRenderer>();
            _filter.sharedMesh = mesh;_renderer.sharedMaterial = Material;_renderer.enabled = true;
            _renderer.SetPropertyBlock(null);
        }
        void StaleStyle()
        {
            if (_renderer == null || _mesh == null) return;
            var color = Material != null ? Material.color : Color.cyan;color.a = Mathf.Min(color.a, .1f);
            if (_staleStyle == null) _staleStyle = new MaterialPropertyBlock();
            _staleStyle.SetColor("_Color", color);_renderer.SetPropertyBlock(_staleStyle);
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
                Surface(candidate);
                DisposeMesh(_mesh);_mesh = candidate;candidate = null;
                _generation = source.Header.Generation;_previewId = source.Header.PreviewId;
                return true;
            }
            finally { DisposeMesh(candidate); }
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
            DisposeMesh(_mesh);_mesh = null;
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
        void OnDestroy() => Clear();
    }
}
