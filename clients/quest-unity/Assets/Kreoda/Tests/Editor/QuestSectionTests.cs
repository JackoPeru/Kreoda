using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using Kreoda.QuestFoundation;
using NUnit.Framework;
using UnityEngine;
using Object = UnityEngine.Object;

namespace Kreoda.QuestRuntime.Tests
{
    public sealed class QuestSectionTests
    {
        static readonly BindingFlags Private = BindingFlags.Instance | BindingFlags.NonPublic;
        GameObject _root;
        Transform _display;
        QuestConnection _connection;
        QuestSection _section;
        readonly List<Material> _materials = new List<Material>();

        [SetUp]
        public void SetUp()
        {
            _root = new GameObject("Section fixture");
            var display = new GameObject("Display root");
            _display = display.transform;
            _display.SetParent(_root.transform, false);
            _connection = _root.AddComponent<QuestConnection>();
            _connection.DisplayRoot = _display;
            _connection.SectionCapMaterial = Material("Kreoda/SectionSurface", new Color(.34f, .38f, .42f, 1));
            _connection.SectionContourMaterial = Material("Kreoda/SectionEdge", Color.black);
            _section = _root.AddComponent<QuestSection>();
            _section.Connection = _connection;
            _connection.Section = _section;
        }

        [TearDown]
        public void TearDown()
        {
            Object.DestroyImmediate(_root);
            foreach (var material in _materials) Object.DestroyImmediate(material);
        }

        Material Material(string shaderName, Color color)
        {
            var shader = Shader.Find(shaderName);
            Assert.That(shader, Is.Not.Null, shaderName + " must be included in the Quest project");
            var material = new Material(shader) { color = color };
            _materials.Add(material);
            return material;
        }

        QuestMeshView AddNativeView()
        {
            var body = new GameObject("Native body");
            body.transform.SetParent(_display, false);
            var view = body.AddComponent<QuestMeshView>();
            view.SurfaceMaterial = Material("Kreoda/SectionSurface", new Color(.63f, .71f, .78f, 1));
            view.EdgeMaterial = Material("Kreoda/SectionEdge", new Color(.06f, .1f, .15f, 1));
            view.SelectionMaterial = Material("Kreoda/Selection", new Color(0, .8f, 1, .45f));
            view.PreviewMaterial = Material("Kreoda/Selection", new Color(0, .7f, 1, .22f));
            view.Upload(QuestMeshViewTests.NativeFixture());
            var views = (Dictionary<SceneObjectKey, QuestMeshView>)typeof(QuestConnection)
                .GetField("_views", Private).GetValue(_connection);
            views[new SceneObjectKey(view.BodyId, view.InstanceId)] = view;
            return view;
        }

        static string NativeDetails()
        {
            var source = QuestMeshViewTests.NativeFixture();
            var summary = new List<string> { "bbox=" + string.Join(",", source.BboxMm.Select(value => value.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture))) };
            foreach (var face in source.Faces.GroupBy(range => range.PersistentFaceId))
            {
                var min = new Vector3(float.PositiveInfinity, float.PositiveInfinity, float.PositiveInfinity);
                var max = new Vector3(float.NegativeInfinity, float.NegativeInfinity, float.NegativeInfinity);
                foreach (var range in face)
                for (var triangle = range.TriangleStart; triangle < range.TriangleStart + range.TriangleCount; triangle++)
                for (var corner = 0; corner < 3; corner++)
                {
                    var vertex = checked((int)source.Indices[triangle * 3 + corner]);
                    var point = new Vector3(source.Positions[vertex * 3], source.Positions[vertex * 3 + 1], source.Positions[vertex * 3 + 2]);
                    min = Vector3.Min(min, point);max = Vector3.Max(max, point);
                }
                if (face.Key.Contains("wall.") || face.Key.Contains("cyl")) summary.Add($"face {face.Key} min={min} max={max}");
            }
            foreach (var edge in source.Edges.Where(range => range.PersistentEdgeId.Contains("wall.") || range.PersistentEdgeId.Contains("cir")))
            {
                var min = new Vector3(float.PositiveInfinity, float.PositiveInfinity, float.PositiveInfinity);
                var max = new Vector3(float.NegativeInfinity, float.NegativeInfinity, float.NegativeInfinity);
                for (var vertex = edge.VertexStart; vertex < edge.VertexStart + edge.VertexCount; vertex++)
                {
                    var point = new Vector3(source.EdgeVertices[vertex * 3], source.EdgeVertices[vertex * 3 + 1], source.EdgeVertices[vertex * 3 + 2]);
                    min = Vector3.Min(min, point);max = Vector3.Max(max, point);
                }
                summary.Add($"edge {edge.PersistentEdgeId} min={min} max={max}");
            }
            return string.Join("; ", summary);
        }

        static List<Vector3> ClipTriangleBelowY(Vector3 a, Vector3 b, Vector3 c, float limit)
        {
            var input = new[] { a, b, c };
            var clipped = new List<Vector3>(4);
            var previous = input[input.Length - 1];
            var previousInside = previous.y <= limit;
            foreach (var current in input)
            {
                var currentInside = current.y <= limit;
                if (currentInside != previousInside)
                {
                    var amount = (limit - previous.y) / (current.y - previous.y);
                    clipped.Add(Vector3.LerpUnclamped(previous, current, amount));
                }
                if (currentInside) clipped.Add(current);
                previous = current;
                previousInside = currentInside;
            }
            return clipped;
        }

        [Test]
        public void EmptySceneCannotEnableAndNativeMidpointAndExplicitZeroSurviveRemesh()
        {
            Assert.That(_section.TryEnable(), Is.False, "empty model cannot invent a zero-quota cut");
            Assert.That(_section.Enabled, Is.False);

            AddNativeView();
            Assert.That(_section.TryEnable(), Is.True);
            Assert.That(_section.Plane.Value.Axis, Is.EqualTo(SectionAxis.Z));
            Assert.That(_section.Plane.Value.OffsetMm, Is.EqualTo(5).Within(.001));
            Assert.That(_section.TrySetOffsetMm(0), Is.True);
            _section.Disable();
            Assert.That(_section.TryEnable(), Is.True);
            Assert.That(_section.Plane.Value.OffsetMm, Is.EqualTo(0));

            var view = _connection.Views.Single();
            view.Upload(QuestMeshViewTests.NativeFixture());
            _section.Refresh();
            Assert.That(_section.Enabled, Is.True);
            Assert.That(_section.Plane.Value.OffsetMm, Is.EqualTo(0));
        }

        [TestCase(false)]
        [TestCase(true)]
        public void SameDocumentBoxToHolePendingMeshKeepsSectionUntilHydrationAndTrueEmptyUndo(bool hydrateReplacement)
        {
            const string sessionId = "same-session";
            const string documentId = "same-document";
            var scene = (QuestSceneState)typeof(QuestConnection).GetField("_scene", Private).GetValue(_connection);
            var generation = scene.BeginConnection();
            var view = AddNativeView();
            _section.Refresh();
            Assert.That(_section.TryEnable(), Is.True);
            Assert.That(_section.TrySetOffsetMm(0), Is.True);

            var box = new SceneMeshTarget(view.BodyId, view.InstanceId, view.FeatureId, sessionId, documentId, 1);
            var boxStamp = scene.CaptureObservation(generation, sessionId, documentId, 1, new[] { box.BodyId });
            var boxPlan = scene.Reconcile(boxStamp, new[] { box }, snapshot: true);
            Assert.That(scene.Complete(boxPlan.Requests.Single()), Is.EqualTo(MeshCompletionDisposition.Apply));

            var hole = new SceneMeshTarget(view.BodyId, view.InstanceId, "hole-tip", sessionId, documentId, 2);
            var holeStamp = scene.CaptureObservation(generation, sessionId, documentId, 2, new[] { hole.BodyId });
            var holePlan = scene.Reconcile(holeStamp, new[] { hole });
            Assert.That(holePlan.Requests, Has.Count.EqualTo(1));
            Assert.That(_connection.PendingMeshCount, Is.EqualTo(1));

            var views = (Dictionary<SceneObjectKey, QuestMeshView>)typeof(QuestConnection)
                .GetField("_views", Private).GetValue(_connection);
            views.Clear();
            Object.DestroyImmediate(view.gameObject);
            _section.Refresh();
            Assert.That(_section.Enabled, Is.True, "pending same-document replacement must retain enabled section");
            Assert.That(_section.Plane.Value.OffsetMm, Is.EqualTo(0), "pending replacement must retain explicit zero quota");

            QuestMeshView hydrated = null;
            if (hydrateReplacement)
            {
                Assert.That(scene.Complete(holePlan.Requests.Single()), Is.EqualTo(MeshCompletionDisposition.Apply));
                hydrated = AddNativeView();
                _section.Refresh();
                Assert.That(_section.Enabled, Is.True);
                Assert.That(_section.Plane.Value.OffsetMm, Is.EqualTo(0));
            }

            var undoStamp = scene.CaptureObservation(generation, sessionId, documentId, 3, new[] { hole.BodyId });
            var undoPlan = scene.Reconcile(undoStamp, Array.Empty<SceneMeshTarget>(), snapshot: true);
            Assert.That(undoPlan.Removed, Has.Count.EqualTo(1));
            Assert.That(_connection.PendingMeshCount, Is.Zero);
            views.Clear();
            if (hydrated != null) Object.DestroyImmediate(hydrated.gameObject);
            _section.Refresh();
            Assert.That(_section.Enabled, Is.False, "Undo to a truly empty scene clears section state");
            Assert.That(_section.Plane, Is.Null);
        }

        [Test]
        public void RejectedResetWithOutOfRangeTranslatedBoundsPreservesEnabledPlane()
        {
            var view = AddNativeView();
            Assert.That(_section.TryEnable(), Is.True);
            Assert.That(_section.TrySetOffsetMm(123.5), Is.True);
            var acceptedPlane = _section.Plane;

            view.transform.localPosition = Vector3.up * 1001f;
            Assert.That(_section.TrySetAxis(SectionAxis.Z), Is.False,
                "translated model midpoint is beyond the supported one-million millimetre offset");
            _section.ResetView();

            Assert.That(_section.Enabled, Is.True, "rejected reset must preserve the accepted enabled state");
            Assert.That(_section.Plane, Is.EqualTo(acceptedPlane), "rejected reset must preserve the accepted plane");
        }

        [Test]
        public void NewSessionLineageResetsSectionEvenWhenDocumentIdStaysTheSame()
        {
            AddNativeView();
            Assert.That(_section.TryEnable(), Is.True);
            Assert.That(_section.TrySetOffsetMm(0), Is.True);
            var observe = typeof(QuestSection).GetMethod("ObserveModelIdentity", Private);
            Assert.That(observe, Is.Not.Null);
            observe.Invoke(_section, new object[] { "native-open-1", "doc-phase1" });
            observe.Invoke(_section, new object[] { "native-open-1", "doc-phase1" });
            Assert.That(_section.Enabled, Is.True);
            Assert.That(_section.Plane.Value.OffsetMm, Is.EqualTo(0));

            observe.Invoke(_section, new object[] { "native-open-2", "doc-phase1" });
            Assert.That(_section.Enabled, Is.False);
            Assert.That(_section.Plane, Is.Null);
        }

        [Test]
        public void NativeCutHasOpaqueCapAndContourButLeavesBlindHoleApertureOpen()
        {
            var view = AddNativeView();
            Assert.That(_section.TryEnable(), Is.True);
            Assert.That(_section.TrySetOffsetMm(7), Is.True);
            _section.SetInverted(true);
            Physics.SyncTransforms();

            var cap = view.transform.Find("Section cap");
            var contour = view.transform.Find("Section contour");
            Assert.That(cap, Is.Not.Null);
            Assert.That(contour, Is.Not.Null);
            var capMesh = cap.GetComponent<MeshFilter>().sharedMesh;
            Assert.That(capMesh.triangles.Length, Is.GreaterThan(0));
            Assert.That(contour.GetComponent<MeshFilter>().sharedMesh.GetIndexCount(0), Is.GreaterThan(0));

            var capCollider = cap.GetComponent<MeshCollider>();
            Assert.That(capCollider, Is.Not.Null);
            Assert.That(capCollider.Raycast(new Ray(new Vector3(.02f, .02f, .02f), Vector3.down), out _, .02f),
                Is.False, "native hole center must remain an aperture in cap collision. " + NativeDetails());
            Assert.That(capCollider.Raycast(new Ray(new Vector3(.01f, .02f, .02f), Vector3.down), out _, .02f),
                Is.True, "opaque cut cap must occlude behind it outside aperture");
            Assert.That(_section.IsSectionCapCollider(capCollider), Is.True, "cap cannot become a CAD target");
        }

        [Test]
        public void VisibleNativeRayFindsInteriorTriangleBehindHiddenRoofUnderTransformedRoot()
        {
            var view = AddNativeView();
            _display.SetPositionAndRotation(new Vector3(1.2f, -.3f, 2.1f), Quaternion.Euler(17, 31, -9));
            _display.localScale = new Vector3(1.7f, .6f, 1.2f);
            Assert.That(_section.TryEnable(), Is.True);
            Assert.That(_section.TrySetOffsetMm(7), Is.True);
            _section.SetInverted(true);
            Physics.SyncTransforms();

            var mesh = view.GetComponent<MeshFilter>().sharedMesh;
            var positions = mesh.vertices;
            var indices = mesh.triangles;
            var foundInteriorThroughRoof = false;
            for (var triangle = 0; triangle < indices.Length / 3 && !foundInteriorThroughRoof; triangle++)
            {
                var face = view.ResolveFace(triangle);
                if (face == null || !face.PersistentId.Contains("wall.")) continue;
                var a = positions[indices[triangle * 3]];
                var b = positions[indices[triangle * 3 + 1]];
                var c = positions[indices[triangle * 3 + 2]];
                var clipped = ClipTriangleBelowY(a, b, c, .00701f);
                if (clipped.Count < 3) continue;
                var center = Vector3.zero;
                foreach (var point in clipped) center += point;
                center /= clipped.Count;
                for (var angle = 0; angle < 360 && !foundInteriorThroughRoof; angle += 15)
                foreach (var rise in new[] { .025f, .05f, .1f })
                foreach (var radius in new[] { .025f, .05f, .1f })
                {
                    var radial = new Vector3(Mathf.Cos(angle * Mathf.Deg2Rad), 0, Mathf.Sin(angle * Mathf.Deg2Rad));
                    var localOrigin = center + Vector3.up * rise + radial * radius;
                    var worldOrigin = view.transform.TransformPoint(localOrigin);
                    var worldTarget = view.transform.TransformPoint(center);
                    var ray = new Ray(worldOrigin, worldTarget - worldOrigin);
                    var maxDistance = Vector3.Distance(worldOrigin, worldTarget) + .001f;
                    var hasUncut = view.TryRaycast(ray, null, _display, maxDistance,
                        out var uncutTriangle, out _, out _);
                    var hasCut = view.TryRaycast(ray, _section.Plane, _display, maxDistance,
                        out var cutTriangle, out _, out _);
                    if (hasUncut && hasCut && view.ResolveFace(uncutTriangle)?.PersistentId.EndsWith("box.+Z") == true &&
                        view.ResolveFace(cutTriangle)?.PersistentId.Contains("wall.") == true)
                        foundInteriorThroughRoof = true;
                }
            }
            Assert.That(foundInteriorThroughRoof, Is.True,
                "same native ray must change from occluding roof to original interior wall triangle. " + NativeDetails());
        }

        [Test]
        public void OverlayAndStalePreviewComposeSectionPropertiesAndDisableReleasesGeneratedMeshes()
        {
            var view = AddNativeView();
            Assert.That(_section.TryEnable(), Is.True);
            var surfaceRenderer = view.GetComponent<MeshRenderer>();
            var edgeRenderer = view.transform.Find("Edges").GetComponent<MeshRenderer>();
            view.SelectFace(view.ResolveFace(0));
            var selectionRenderer = view.transform.Find("Selection").GetComponent<MeshRenderer>();
            AssertSectionEnabled(surfaceRenderer);
            AssertSectionEnabled(edgeRenderer);
            AssertSectionEnabled(selectionRenderer);

            var previewObject = new GameObject("Transient preview");
            previewObject.transform.SetParent(_display, false);
            var preview = previewObject.AddComponent<QuestPreviewView>();
            preview.Material = view.PreviewMaterial;
            preview.Begin(new SpatialEditIntent(
                "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "fixture-doc", 1, "owner", view.BodyId, view.FeatureId,
                System.Text.Json.JsonDocument.Parse("{\"id\":\"width\",\"type\":\"linear\",\"parameter\":\"widthMm\",\"unit\":\"mm\",\"origin\":[0,0,0],\"axis\":[1,0,0]}").RootElement,
                new Dictionary<string, double> { ["widthMm"] = 1 }), view.GetComponent<MeshFilter>().sharedMesh);
            preview.ApplySection(_section.Plane, _display, _connection.SectionCapMaterial, _connection.SectionContourMaterial);
            typeof(QuestPreviewView).GetMethod("StaleStyle", Private).Invoke(preview, null);
            var previewRenderer = preview.GetComponent<MeshRenderer>();
            AssertSectionEnabled(previewRenderer);
            var previewStyle = new MaterialPropertyBlock();
            previewRenderer.GetPropertyBlock(previewStyle);
            Assert.That(previewStyle.GetColor("_Color").a, Is.LessThanOrEqualTo(.1f));

            var oldCap = view.transform.Find("Section cap").GetComponent<MeshFilter>().sharedMesh;
            _section.Disable();
            Assert.That(oldCap == null, Is.True, "disable must release generated native cap buffers");
            AssertSectionDisabled(surfaceRenderer);
            AssertSectionDisabled(edgeRenderer);
            AssertSectionDisabled(selectionRenderer);
            AssertSectionDisabled(previewRenderer);
        }

        void AssertSectionEnabled(Renderer renderer)
        {
            var block = new MaterialPropertyBlock();
            renderer.GetPropertyBlock(block);
            Assert.That(block.GetFloat("_SectionEnabled"), Is.EqualTo(1));
        }

        void AssertSectionDisabled(Renderer renderer)
        {
            var block = new MaterialPropertyBlock();
            renderer.GetPropertyBlock(block);
            Assert.That(block.GetFloat("_SectionEnabled"), Is.EqualTo(0));
        }
    }
}
