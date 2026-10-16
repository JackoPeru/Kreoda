using System.Text.Json;
using NUnit.Framework;
using UnityEngine;

namespace Kreoda.QuestRuntime.Tests
{
    public class QuestSketchDimensionsTests
    {
        [Test]
        public void MalformedNativeSketchBasisCannotRenderAsCurrentSupportedGeometry()
        {
            var owned = new GameObject("Owned invalid sketch frame test");
            try
            {
                var view = owned.AddComponent<QuestSketchDimensions>();
                using var sketch = JsonDocument.Parse("{\"plane\":{\"origin\":[0,0,24],\"xAxis\":[2,0,0],\"yAxis\":[0,1,0],\"normal\":[0,0,1]},\"model\":{\"points\":[]}}");
                Assert.Throws<System.ArgumentException>(() => view.ShowSketch(sketch.RootElement));
                Assert.That(owned.GetComponentsInChildren<LineRenderer>(), Is.Empty);
            }
            finally { Object.DestroyImmediate(owned); }
        }

        [Test]
        public void PreviewLinesUseCapturedPlaneAndRemainUnpickable()
        {
            var owned = new GameObject("Owned sketch preview test");
            try
            {
                var view = owned.AddComponent<QuestSketchDimensions>();
                owned.transform.SetPositionAndRotation(new Vector3(2, -1, 3), Quaternion.Euler(23, 41, -17));
                owned.transform.localScale = new Vector3(-2, .5f, 3);
                using var sketch = JsonDocument.Parse("{\"id\":\"sk\",\"supportRef\":\"native-plane\",\"planeKind\":\"Datum\",\"plane\":{\"origin\":[10,20,30],\"xAxis\":[0,1,0],\"yAxis\":[0,0,-1],\"normal\":[-1,0,0]},\"model\":{\"points\":[{\"id\":\"a\",\"x\":0,\"y\":0},{\"id\":\"b\",\"x\":10,\"y\":0}],\"lines\":[{\"id\":\"line\",\"p1\":\"a\",\"p2\":\"b\"}]}}");
                view.ShowSketch(sketch.RootElement);
                var line = owned.GetComponentInChildren<LineRenderer>();
                Assert.That(Vector3.Distance(line.GetPosition(0), new Vector3(.01f,.03f,.02f)), Is.LessThan(1e-7f));
                Assert.That(Vector3.Distance(line.GetPosition(1), new Vector3(.01f,.03f,.03f)), Is.LessThan(1e-7f));
                Assert.That(Vector3.Distance(line.transform.TransformPoint(line.GetPosition(1)), owned.transform.TransformPoint(new Vector3(.01f,.03f,.03f))), Is.LessThan(1e-7f));
                Assert.That(owned.GetComponentsInChildren<Collider>(), Is.Empty);
                Assert.That(owned.GetComponentsInChildren<QuestMeshView>(), Is.Empty);
            }
            finally { Object.DestroyImmediate(owned); }
        }
    }
}
