using System.Linq;
using System.Text.Json;
using NUnit.Framework;
using UnityEngine;
using Object = UnityEngine.Object;

namespace Kreoda.QuestRuntime.Tests
{
    public class QuestDatumViewTests
    {
        [Test]
        public void PlaneUsesCompleteNativeFrameUnderReflectedDisplayRootAndPicksOnlyItsBorder()
        {
            var root = new GameObject("Owned transformed display root");
            try
            {
                root.transform.SetPositionAndRotation(new Vector3(2, -1, 3), Quaternion.Euler(23, 41, -17));
                root.transform.localScale = new Vector3(-2, .5f, 3);
                var view = NewView(root.transform);
                using var datum = JsonDocument.Parse(@"{""featureId"":""11111111-1111-4111-8111-111111111111"",""kind"":""DatumPlane"",""status"":""ok"",""resolved"":{""originMm"":[10,20,30],""xAxis"":[0,1,0],""yAxis"":[0,0,-1],""normal"":[-1,0,0]}}");

                view.Apply(datum.RootElement, "session", "document", 7);

                Assert.That(view.FeatureId, Is.EqualTo("11111111-1111-4111-8111-111111111111"));
                Assert.That(view.SelectionKind, Is.EqualTo("datumPlane"));
                Assert.That(view.IsSelectable, Is.True);
                var lines = view.GetComponentsInChildren<LineRenderer>();
                Assert.That(lines.Length, Is.EqualTo(4));
                var cadCorner = new Kreoda.QuestFoundation.CadVector(10, 20, 30) -
                    new Kreoda.QuestFoundation.CadVector(0, 1, 0) * 100 -
                    new Kreoda.QuestFoundation.CadVector(0, 0, -1) * 100;
                var expected = root.transform.TransformPoint(QuestDimensions.CadPoint(cadCorner));
                Assert.That(Vector3.Distance(lines[0].transform.TransformPoint(lines[0].GetPosition(0)), expected), Is.LessThan(1e-5f));

                Physics.SyncTransforms();
                var center = root.transform.TransformPoint(QuestDimensions.CadPoint(new Kreoda.QuestFoundation.CadVector(10, 20, 30)));
                var normal = root.transform.TransformVector(QuestDimensions.CadPoint(new Kreoda.QuestFoundation.CadVector(-1, 0, 0))).normalized;
                Assert.That(Physics.Raycast(center + normal * .1f, -normal, 1f), Is.False, "plane interior must not steal body hits");
                var edge = (lines[0].transform.TransformPoint(lines[0].GetPosition(0)) +
                    lines[0].transform.TransformPoint(lines[0].GetPosition(1))) * .5f;
                Assert.That(Physics.Raycast(edge + Vector3.up * .1f, Vector3.down, 1f, ~0, QueryTriggerInteraction.Ignore), Is.True);
            }
            finally { Object.DestroyImmediate(root); }
        }

        [Test]
        public void AxisAndPointKeepTheirNativeUuidAndCanonicalSelectionKind()
        {
            var root = new GameObject("Owned datum targets");
            try
            {
                var axis = NewView(root.transform);
                using var axisData = JsonDocument.Parse(@"{""featureId"":""22222222-2222-4222-8222-222222222222"",""kind"":""DatumAxis"",""status"":""ok"",""resolved"":{""originMm"":[4,5,6],""direction"":[0,1,0]}}");
                axis.Apply(axisData.RootElement, "session", "document", 8);
                Assert.That(axis.FeatureId, Is.EqualTo("22222222-2222-4222-8222-222222222222"));
                Assert.That(axis.SelectionKind, Is.EqualTo("datumAxis"));
                Assert.That(axis.IsSelectable, Is.True);
                Assert.That(axis.GetComponentsInChildren<CapsuleCollider>().Length, Is.EqualTo(1));

                var point = NewView(root.transform);
                using var pointData = JsonDocument.Parse(@"{""featureId"":""33333333-3333-4333-8333-333333333333"",""kind"":""DatumPoint"",""status"":""ok"",""resolved"":{""positionMm"":[7,8,9]}}");
                point.Apply(pointData.RootElement, "session", "document", 8);
                Assert.That(point.FeatureId, Is.EqualTo("33333333-3333-4333-8333-333333333333"));
                Assert.That(point.SelectionKind, Is.EqualTo("datumPoint"));
                Assert.That(point.IsSelectable, Is.True);
                Assert.That(point.GetComponentsInChildren<SphereCollider>().Length, Is.EqualTo(1));
            }
            finally { Object.DestroyImmediate(root); }
        }

        [Test]
        public void NonUnitAxisCannotBeNormalizedIntoHealthyNativeGeometry()
        {
            var root = new GameObject("Owned malformed axis");
            try
            {
                var view = NewView(root.transform);
                using var datum = JsonDocument.Parse(@"{""featureId"":""55555555-5555-4555-8555-555555555555"",""kind"":""DatumAxis"",""status"":""ok"",""resolved"":{""originMm"":[0,0,0],""direction"":[0,2,0]}}");

                view.Apply(datum.RootElement, "session", "document", 10);

                Assert.That(view.IsSelectable, Is.False);
                Assert.That(view.GetComponentsInChildren<Collider>(), Is.Empty);
                Assert.That(view.DisplayStatus, Is.Not.Empty);
            }
            finally { Object.DestroyImmediate(root); }
        }

        [Test]
        public void FiniteCadCoordinatesThatOverflowUnityFloatCannotBecomeTargets()
        {
            var root = new GameObject("Owned unrepresentable datum");
            try
            {
                var view = NewView(root.transform);
                using var datum = JsonDocument.Parse(@"{""featureId"":""66666666-6666-4666-8666-666666666666"",""kind"":""DatumPoint"",""status"":""ok"",""resolved"":{""positionMm"":[1e100,0,0]}}");

                view.Apply(datum.RootElement, "session", "document", 11);

                Assert.That(view.IsSelectable, Is.False);
                Assert.That(view.GetComponentsInChildren<Collider>(), Is.Empty);
                Assert.That(view.DisplayStatus, Is.Not.Empty);
            }
            finally { Object.DestroyImmediate(root); }
        }

        [Test]
        public void RemovedGuideCanDisablePickingBeforeDeferredDestroy()
        {
            var root = new GameObject("Owned deferred datum removal");
            try
            {
                var view = NewView(root.transform);
                using var datum = JsonDocument.Parse(@"{""featureId"":""77777777-7777-4777-8777-777777777777"",""kind"":""DatumPoint"",""status"":""ok"",""resolved"":{""positionMm"":[1,2,3]}}");
                view.Apply(datum.RootElement, "session", "document", 12);
                Assert.That(view.GetComponentsInChildren<Collider>().Length, Is.EqualTo(1));

                view.DisablePicking();

                Assert.That(view.IsSelectable, Is.False);
                Assert.That(view.GetComponentsInChildren<Collider>().Any(collider => collider.enabled), Is.False);
            }
            finally { Object.DestroyImmediate(root); }
        }

        [TestCase("broken", "[0,0,0]", "[1,0,0]", "[0,1,0]", "[0,0,1]")]
        [TestCase("ok", "[0,0,0]", "[1,0,0]", "[0.0001,1,0]", "[0,0,1]")]
        [TestCase("ok", "[0,0,0]", "[0,0,0]", "[0,1,0]", "[0,0,1]")]
        public void BrokenOrMalformedPlaneCannotBecomeHealthyGeometryOrTarget(string status, string origin, string x, string y, string normal)
        {
            var root = new GameObject("Owned invalid datum");
            try
            {
                var view = NewView(root.transform);
                using var datum = JsonDocument.Parse($"{{\"featureId\":\"44444444-4444-4444-8444-444444444444\",\"kind\":\"DatumPlane\",\"status\":\"{status}\",\"resolved\":{{\"originMm\":{origin},\"xAxis\":{x},\"yAxis\":{y},\"normal\":{normal}}}}}");

                view.Apply(datum.RootElement, "session", "document", 9);

                Assert.That(view.FeatureId, Is.EqualTo("44444444-4444-4444-8444-444444444444"));
                Assert.That(view.IsSelectable, Is.False);
                Assert.That(view.GetComponentsInChildren<LineRenderer>(), Is.Empty);
                Assert.That(view.GetComponentsInChildren<Collider>(), Is.Empty);
                Assert.That(view.DisplayStatus, Is.Not.Empty);
            }
            finally { Object.DestroyImmediate(root); }
        }

        static QuestDatumView NewView(Transform parent)
        {
            var owned = new GameObject("Owned datum view");
            owned.transform.SetParent(parent, false);
            return owned.AddComponent<QuestDatumView>();
        }
    }
}
