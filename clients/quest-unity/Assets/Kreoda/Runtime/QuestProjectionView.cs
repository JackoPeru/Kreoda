using System;
using System.Collections.Generic;
using Kreoda.QuestFoundation;
using Kreoda.Session.Generated;
using UnityEngine;
using UnityEngine.Rendering;

namespace Kreoda.QuestRuntime
{
    internal sealed class QuestProjectionView : IDisposable
    {
        readonly List<GameObject> _owned = new List<GameObject>();
        bool _disposed;

        public int CurveCount => _owned.Count;

        public bool Render(Transform displayRoot, Material sharedMaterial, SketchProjectionGroupResult group, out string error)
        {
            Clear();
            error = "";
            if (_disposed || displayRoot == null || sharedMaterial == null || group == null || group.Edges == null)
            { error = "Vista proiezione non disponibile"; return false; }
            if (group.Edges.Length == 0)
            { error = "Nessuna curva corrente da mostrare"; return false; }

            var curves = new List<Vector3[]>(group.Edges.Length);
            foreach (var edge in group.Edges)
            {
                if (edge == null || edge.PointsMm == null || edge.PointsMm.Length < 2)
                { error = "Campioni curva non validi"; return false; }
                var points = new Vector3[edge.PointsMm.Length];
                for (var i = 0; i < points.Length; i++)
                {
                    var point = edge.PointsMm[i];
                    if (point == null || point.Length != 3 || !Finite(point[0]) || !Finite(point[1]) || !Finite(point[2]))
                    { error = "Punto CAD non valido"; return false; }
                    // Native points are already world CAD mm; apply axis/unit conversion once.
                    var converted = QuestDimensions.CadPoint(new CadVector(point[0], point[1], point[2]));
                    if (!Finite(converted.x) || !Finite(converted.y) || !Finite(converted.z))
                    { error = "Punto CAD non rappresentabile nelle coordinate Unity"; return false; }
                    points[i] = converted;
                }
                curves.Add(points);
            }

            for (var i = 0; i < curves.Count; i++)
            {
                var edge = group.Edges[i];
                var lineObject = new GameObject("Quest projection " + group.GroupId + " / " + edge.MemberIndex);
                _owned.Add(lineObject);
                lineObject.transform.SetParent(displayRoot, false);
                var line = lineObject.AddComponent<LineRenderer>();
                line.useWorldSpace = false;
                line.sharedMaterial = sharedMaterial;
                line.positionCount = curves[i].Length;
                line.widthMultiplier = .0015f;
                line.numCapVertices = 2;
                line.numCornerVertices = 2;
                line.loop = edge.Closed;
                line.startColor = new Color(.22f, .82f, 1f, .95f);
                line.endColor = new Color(.56f, .92f, 1f, .95f);
                line.shadowCastingMode = ShadowCastingMode.Off;
                line.receiveShadows = false;
                line.SetPositions(curves[i]);
            }
            return true;
        }

        public void Clear()
        {
            foreach (var item in _owned)
            {
                if (item == null) continue;
                if (Application.isPlaying) UnityEngine.Object.Destroy(item);
                else UnityEngine.Object.DestroyImmediate(item);
            }
            _owned.Clear();
        }

        public void Dispose()
        {
            if (_disposed) return;
            Clear();
            _disposed = true;
        }

        static bool Finite(double value) => !double.IsNaN(value) && !double.IsInfinity(value);
    }
}
