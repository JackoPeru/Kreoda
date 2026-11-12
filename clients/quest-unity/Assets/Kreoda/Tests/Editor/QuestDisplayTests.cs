using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Kreoda.QuestFoundation;
using NUnit.Framework;
using UnityEngine;

namespace Kreoda.QuestRuntime.Tests
{
    public class QuestDisplayTests
    {
        GameObject _owned;
        QuestDisplay _display;
        QuestMeshView _view;
        Transform Root => _display.Connection.DisplayRoot;
        Dictionary<SceneObjectKey, QuestMeshView> Views => (Dictionary<SceneObjectKey, QuestMeshView>)typeof(QuestConnection)
            .GetField("_views", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(_display.Connection);

        [SetUp]
        public void CreateActualNativeCadDisplay()
        {
            _owned = new GameObject("Owned display test");
            var connection = _owned.AddComponent<QuestConnection>();
            connection.DisplayRoot = new GameObject("Independent CAD root").transform;
            connection.DisplayRoot.SetParent(_owned.transform);
            _display = _owned.AddComponent<QuestDisplay>();
            _display.Connection = connection;
            _view = new GameObject("Actual native fixture").AddComponent<QuestMeshView>();
            _view.transform.SetParent(Root, false);
            _view.Upload(QuestMeshViewTests.NativeFixture());
            var views = (Dictionary<SceneObjectKey, QuestMeshView>)typeof(QuestConnection)
                .GetField("_views", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(connection);
            views.Add(new SceneObjectKey(_view.BodyId), _view);
        }

        [TearDown]
        public void DisposeOwnedDisplay() => Object.DestroyImmediate(_owned);

        Vector3 Bottom()
        {
            var box = _view.BboxMetres;
            return new Vector3((float)(box[0] + box[3]) / 2, (float)box[1], (float)(box[2] + box[5]) / 2);
        }

        [Test]
        public void MalformedCadBoundsCannotCreatePlacementGuidesOrMoveDisplay()
        {
            var property = typeof(QuestMeshView).GetProperty("BboxMetres",
                BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
            Assert.That(property, Is.Not.Null);
            var original = _view.BboxMetres;
            var invalid = new[]
            {
                new double[] { 0, 0, 0 },
                new double[] { 0, 0, 0, double.NaN, 1, 1 },
                new double[] { 0, 0, 0, double.PositiveInfinity, 1, 1 },
                new double[] { 2, 0, 0, 1, 1, 1 }
            };
            try
            {
                foreach (var bounds in invalid)
                {
                    property.SetValue(_view, bounds);
                    var position = Root.position;
                    var rotation = Root.rotation;
                    var scale = Root.localScale;
                    Assert.That(_display.BeginPlacement(), Is.False,
                        "invalid bounds must not create a physical placement preview");
                    Assert.That(_display.Place(new Vector3(.4f, .8f, 1.2f), 60), Is.False,
                        "invalid bounds must not be accepted as a physical contact");
                    Assert.That(_display.PlacementActive, Is.False);
                    Assert.That(Root.position, Is.EqualTo(position));
                    Assert.That(Root.rotation, Is.EqualTo(rotation));
                    Assert.That(Root.localScale, Is.EqualTo(scale));
                    Assert.That(typeof(QuestDisplay).GetField("_marker",
                        BindingFlags.Instance | BindingFlags.NonPublic).GetValue(_display), Is.Null,
                        "invalid CAD bounds must not leave a ray-interfering preview");
                }
            }
            finally { property.SetValue(_view, original); }
        }

        [TestCase("1:10", .1f)]
        [TestCase("1:5", .2f)]
        [TestCase("1:1", 1f)]
        [TestCase("2:1", 2f)]
        [TestCase("10:1", 10f)]
        public void DisplayMagnificationPreservesChosenSurfaceContactAndNativeVertices(string preset, float scale)
        {
            var before = _view.GetComponent<MeshFilter>().sharedMesh.vertices;
            var anchor = new Vector3(.8f, .75f, 1.2f);
            Assert.That(_display.Place(anchor, 90), Is.True);
            Assert.That(_display.SetScale(preset), Is.True);
            Assert.That(Root.localScale.x, Is.EqualTo(scale).Within(.00001f), "0.001 conversion must not be applied twice");
            Assert.That(Vector3.Distance(Root.TransformPoint(Bottom()), anchor), Is.LessThan(.00001f));
            Assert.That(_view.GetComponent<MeshFilter>().sharedMesh.vertices, Is.EqualTo(before));
            Assert.That(Root.parent, Is.SameAs(_owned.transform));
        }

        [Test]
        public void FitUsesActualMetreBoundsAndCancelRestoresPlacementAfterTrackingLoss()
        {
            var anchor = new Vector3(.3f, .8f, 1);
            Assert.That(_display.Place(anchor, 35), Is.True);
            Assert.That(_display.SetScale("Fit"), Is.True);
            var box = _view.BboxMetres;
            var largest = Mathf.Max((float)(box[3] - box[0]), (float)(box[4] - box[1]), (float)(box[5] - box[2]));
            Assert.That(largest * Root.localScale.x, Is.EqualTo(.35f).Within(.00001f));
            var position = Root.position; var rotation = Root.rotation; var scale = Root.localScale;
            Assert.That(_display.BeginPlacement(), Is.True);
            _display.UpdatePlacement(new Vector3(2, 1, 3), 120, true);
            _display.FreezePlacement();
            Assert.That(_display.ConfirmPlacement(false), Is.False, "tracking loss cannot confirm a physical anchor");
            _display.CancelPlacement();
            Assert.That(Root.position, Is.EqualTo(position));
            Assert.That(Root.rotation, Is.EqualTo(rotation));
            Assert.That(Root.localScale, Is.EqualTo(scale));
            Assert.That(_display.PlacementActive, Is.False);
        }

        [Test]
        public void PlacementFootprintTracksTrueCadBoundsScaleAndTrackingWithoutStealingRaycasts()
        {
            var shader = Shader.Find("Kreoda/QuestUi") ?? Shader.Find("Standard");
            Assert.That(shader, Is.Not.Null);
            var source = new Material(shader);
            _display.MarkerMaterial = source;
            try
            {
                Assert.That(_display.BeginPlacement(), Is.True);
                var marker = (GameObject)typeof(QuestDisplay)
                    .GetField("_marker", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(_display);
                Assert.That(marker, Is.Not.Null);
                Assert.That(marker.transform.childCount, Is.EqualTo(11),
                    "one contact point, four authentic CAD edges and six local X/Z direction segments");
                _display.UpdatePlacement(new Vector3(.4f, .75f, 1.3f), 45, true);
                Assert.That(marker.activeSelf, Is.True);
                Assert.That(marker.transform.position, Is.EqualTo(new Vector3(.4f, .75f, 1.3f)));
                Assert.That(Quaternion.Angle(marker.transform.rotation, Root.rotation), Is.LessThan(.001f));
                var bounds = _view.BboxMetres;
                var expectedWidth = (float)(bounds[3] - bounds[0]);
                var expectedDepth = (float)(bounds[5] - bounds[2]);
                var horizontal = marker.transform.Find("CAD footprint edge 0");
                var vertical = marker.transform.Find("CAD footprint edge 2");
                Assert.That(horizontal, Is.Not.Null);
                Assert.That(vertical, Is.Not.Null);
                Assert.That(horizontal.localScale.x, Is.EqualTo(expectedWidth).Within(.00001f));
                Assert.That(vertical.localScale.z, Is.EqualTo(expectedDepth).Within(.00001f));
                var xLength = Mathf.Min(expectedWidth * .26f, .09f);
                var zLength = Mathf.Min(expectedDepth * .26f, .09f);
                for (var axis = 0; axis < 6; axis++)
                {
                    var guide = marker.transform.Find("CAD local " + (axis < 3 ? "X" : "Z") +
                        " direction " + (axis % 3));
                    Assert.That(guide, Is.Not.Null);
                    var visible = axis < 3 ? xLength >= .015f : zLength >= .015f;
                    Assert.That(guide.gameObject.activeSelf, Is.EqualTo(visible));
                    if (visible)
                        Assert.That(guide.localScale.magnitude, Is.GreaterThan(.001f),
                            "visible direction guides require nondegenerate geometry");
                }
                var x = marker.transform.Find("CAD local X direction 0");
                var z = marker.transform.Find("CAD local Z direction 0");
                if (xLength >= .015f && zLength >= .015f)
                {
                    Assert.That(x.localScale.x, Is.EqualTo(xLength).Within(.0001f));
                    Assert.That(z.localScale.x, Is.EqualTo(zLength).Within(.0001f));
                    Assert.That(Vector3.Dot(x.TransformDirection(Vector3.right),
                        z.TransformDirection(Vector3.right)), Is.EqualTo(0f).Within(.01f),
                        "local X/Z direction strokes must remain perpendicular under yaw");
                }
                for (var i = 0; i < marker.transform.childCount; i++)
                    Assert.That(marker.transform.GetChild(i).GetComponent<Collider>().enabled, Is.False,
                        "placement preview must never intercept CAD selection or pinch raycasts");
                Assert.That(_display.SetScale("2:1"), Is.True);
                Assert.That(horizontal.localScale.x, Is.EqualTo(expectedWidth * 2f).Within(.00001f));
                Assert.That(vertical.localScale.z, Is.EqualTo(expectedDepth * 2f).Within(.00001f));
                _display.UpdatePlacement(default, 45, false);
                Assert.That(marker.activeSelf, Is.False, "lost tracking cannot show a false valid contact");
                _display.CancelPlacement();
                Assert.That(marker == null, Is.True, "preview is removed after cancellation");
            }
            finally
            {
                _display.MarkerMaterial = null;
                Object.DestroyImmediate(source);
            }
        }

        [Test]
        public void TwoHandGestureChangesOnlyDisplayAndTrackingLossRestoresItsStart()
        {
            _display.Place(new Vector3(0, 1, 1), 0);
            var before = _view.GetComponent<MeshFilter>().sharedMesh.vertices;
            var original = Root.position;var originalScale = Root.localScale;
            Assert.That(_display.BeginTwoHand(new Vector3(-.1f, 1, 1), new Vector3(.1f, 1, 1)), Is.True);
            _display.UpdateTwoHand(new Vector3(0, 1, 1), new Vector3(.4f, 1, 1), true);
            Assert.That(Root.localScale.x, Is.EqualTo(2).Within(.0001));
            Assert.That(_view.GetComponent<MeshFilter>().sharedMesh.vertices, Is.EqualTo(before));
            _display.EndTwoHand(false);
            Assert.That(Root.position, Is.EqualTo(original));Assert.That(Root.localScale, Is.EqualTo(originalScale));
            Assert.That(_display.TwoHandActive, Is.False);
        }

        QuestMeshView AddAlreadyPlacedInstance()
        {
            var source = QuestMeshViewTests.NativeFixture();
            var positions = (float[])source.Positions.Clone();
            var edges = (float[])source.EdgeVertices.Clone();
            for (int i = 0; i < positions.Length; i += 3) positions[i] += 500;
            for (int i = 0; i < edges.Length; i += 3) edges[i] += 500;
            var box = (double[])source.BboxMm.Clone(); box[0] += 500; box[3] += 500;
            var header = new Kreoda.Session.SessionMeshHeader(source.Header.NativeRequestId, source.Header.SessionId,
                source.Header.DocumentId, source.Header.Revision, _view.BodyId, "placed-instance", "placed-instance",
                source.Header.Quality, source.Header.ByteLength, "placed-instance");
            var instance = new GameObject("Pretransformed instance fixture").AddComponent<QuestMeshView>();
            instance.transform.SetParent(Root, false);
            instance.Upload(new Kreoda.Session.SessionMeshResult(header, positions, source.Normals, source.Indices,
                edges, source.Faces, source.Edges, source.VolumeMm3, box, source.RawByteLength, source.RawPayloadSha256));
            Views.Add(new SceneObjectKey(_view.BodyId, "placed-instance"), instance);
            return instance;
        }

        [Test]
        public void InitialFitWaitsForTheWholeModelAndDoesNotOverwriteAnExplicitAnchor()
        {
            var scene = (QuestSceneState)typeof(QuestConnection).GetField("_scene", BindingFlags.Instance | BindingFlags.NonPublic)
                .GetValue(_display.Connection);
            var source = QuestMeshViewTests.NativeFixture().Header;
            var generation = scene.BeginConnection();
            var targets = new[] {
                new SceneMeshTarget(_view.BodyId, null, _view.FeatureId, source.SessionId, source.DocumentId, source.Revision),
                new SceneMeshTarget(_view.BodyId, "placed-instance", "placed-instance", source.SessionId, source.DocumentId, source.Revision) };
            var plan = scene.Reconcile(scene.CaptureObservation(generation, source.SessionId, source.DocumentId, source.Revision), targets, true);
            scene.Complete(plan.Requests.Single(ticket => ticket.Target.InstanceId == null));
            var firstModel = typeof(QuestDisplay).GetMethod("FirstModel", BindingFlags.Instance | BindingFlags.NonPublic);
            firstModel.Invoke(_display, null);
            Assert.That(Root.localScale, Is.EqualTo(Vector3.one), "Fit ran before the remaining body/instance arrived");
            var instance = AddAlreadyPlacedInstance();
            scene.Complete(plan.Requests.Single(ticket => ticket.Target.InstanceId != null));
            firstModel.Invoke(_display, null);
            var extent = (float)(instance.BboxMetres[3] - _view.BboxMetres[0]);
            Assert.That(Root.localScale.x * extent, Is.EqualTo(.35f).Within(.00001f));
            Assert.That(instance.transform.localPosition, Is.EqualTo(Vector3.zero), "instance placement must not be applied again");
            var anchor = new Vector3(.4f, .7f, 1.3f);
            _display.Place(anchor, 60);
            var before = Root.position;
            firstModel.Invoke(_display, null);
            Assert.That(Root.position, Is.EqualTo(before), "network hydration overwrote the explicit local anchor");
        }

        [Test]
        public void FitRejectsEmptyOrDegenerateBoundsWithoutChangingPlacement()
        {
            _display.Place(new Vector3(.3f, .8f, 1), 45);
            var before = Root.position; var scale = Root.localScale;
            Views.Clear();
            Assert.That(_display.SetScale("Fit"), Is.False);
            Assert.That(Root.position, Is.EqualTo(before));
            Views.Add(new SceneObjectKey(_view.BodyId), _view);
            typeof(QuestMeshView).GetProperty("BboxMetres").SetValue(_view, new double[6]);
            Assert.That(_display.SetScale("Fit"), Is.False);
            Assert.That(Root.position, Is.EqualTo(before));
            Assert.That(Root.localScale, Is.EqualTo(scale));
        }

        [Test]
        public void ExplicitPlacementBeforeFirstHydrationPreventsAutomaticRecenterAndScale()
        {
            _display.Place(new Vector3(.4f, .75f, 1.4f), 70);
            var position = Root.position; var scale = Root.localScale; var rotation = Root.rotation;
            typeof(QuestDisplay).GetMethod("FirstModel", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(_display, null);
            Assert.That(Root.position, Is.EqualTo(position), "initial hydration must respect a user-chosen anchor");
            Assert.That(Root.localScale, Is.EqualTo(scale));
            Assert.That(Root.rotation, Is.EqualTo(rotation));
        }

        [Test]
        public void PlacementPreviewIsDistinctTranslucentAndRestoresMaterialsWithoutReplacingGeometry()
        {
            var surface = new Material(Shader.Find("Standard"));
            var preview = new Material(Shader.Find("Kreoda/Selection")) { color = new Color(0, .7f, 1, .22f) };
            var selection = new Material(Shader.Find("Kreoda/Selection")) { color = new Color(0, .8f, 1, .45f) };
            try
            {
                _view.SurfaceMaterial = surface; _view.PreviewMaterial = preview; _view.SelectionMaterial = selection;
                _view.Upload(QuestMeshViewTests.NativeFixture());
                var mesh = _view.GetComponent<MeshFilter>().sharedMesh;
                Assert.That(_display.BeginPlacement(), Is.True);
                Assert.That(_view.GetComponent<MeshRenderer>().sharedMaterial, Is.SameAs(preview),
                    "placement still renders opaque authoritative style instead of distinct translucent preview");
                Assert.That(preview.color.a, Is.LessThan(1));
                Assert.That(preview, Is.Not.SameAs(selection));
                Assert.That(_view.GetComponent<MeshFilter>().sharedMesh, Is.SameAs(mesh));
                _view.Upload(QuestMeshViewTests.NativeFixture());
                Assert.That(_view.GetComponent<MeshRenderer>().sharedMaterial, Is.SameAs(preview), "incoming mesh lost active preview style");
                var incoming = AddAlreadyPlacedInstance();
                incoming.SurfaceMaterial = surface; incoming.PreviewMaterial = preview;
                typeof(QuestDisplay).GetMethod("FirstModel", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(_display, null);
                Assert.That(incoming.GetComponent<MeshRenderer>().sharedMaterial, Is.SameAs(preview));
                _display.CancelPlacement();
                Assert.That(_view.GetComponent<MeshRenderer>().sharedMaterial, Is.SameAs(surface));
                Assert.That(incoming.GetComponent<MeshRenderer>().sharedMaterial, Is.SameAs(surface));
                _display.BeginPlacement(); _display.UpdatePlacement(new Vector3(.3f, .75f, 1), 45, true);
                _display.FreezePlacement(); Assert.That(_display.ConfirmPlacement(true), Is.True);
                Assert.That(_view.GetComponent<MeshRenderer>().sharedMaterial, Is.SameAs(surface));
                Assert.That(surface == null || preview == null || selection == null, Is.False, "shared style assets must survive preview cleanup");
            }
            finally { Object.DestroyImmediate(surface); Object.DestroyImmediate(preview); Object.DestroyImmediate(selection); }
        }
    }
}
