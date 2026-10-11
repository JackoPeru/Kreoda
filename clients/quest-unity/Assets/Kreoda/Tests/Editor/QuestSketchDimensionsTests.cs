using System.Text.Json;
using NUnit.Framework;
using UnityEngine;

namespace Kreoda.QuestRuntime.Tests
{
    public class QuestSketchDimensionsTests
    {
        [Test]
        public void PreviewLinesUseCapturedPlaneAndRemainUnpickable()
        {
            var owned = new GameObject("Owned sketch preview test");
            try
            {
                var view = owned.AddComponent<QuestSketchDimensions>();
                using var sketch = JsonDocument.Parse("{\"id\":\"sk\",\"plane\":{\"origin\":[10,20,30],\"xAxis\":[0,1,0],\"yAxis\":[0,0,-1]},\"model\":{\"points\":[{\"id\":\"a\",\"x\":0,\"y\":0},{\"id\":\"b\",\"x\":10,\"y\":0}],\"lines\":[{\"id\":\"line\",\"p1\":\"a\",\"p2\":\"b\"}]}}");
                view.ShowSketch(sketch.RootElement);
                var line = owned.GetComponentInChildren<LineRenderer>();
                Assert.That(Vector3.Distance(line.GetPosition(0), new Vector3(.01f,.03f,.02f)), Is.LessThan(1e-7f));
                Assert.That(Vector3.Distance(line.GetPosition(1), new Vector3(.01f,.03f,.03f)), Is.LessThan(1e-7f));
                Assert.That(owned.GetComponentsInChildren<Collider>(), Is.Empty);
                Assert.That(owned.GetComponentsInChildren<QuestMeshView>(), Is.Empty);
            }
            finally { Object.DestroyImmediate(owned); }
        }
    }
}
