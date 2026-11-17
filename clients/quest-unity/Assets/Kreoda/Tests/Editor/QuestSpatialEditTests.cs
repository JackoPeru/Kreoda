using System.Collections.Generic;
using System.Reflection;
using System.Text.Json;
using Kreoda.QuestFoundation;
using Kreoda.QuestRuntime;
using NUnit.Framework;
using UnityEngine;

namespace Kreoda.QuestRuntime.Tests
{
    public class QuestSpatialEditTests
    {
        const BindingFlags Private = BindingFlags.Instance | BindingFlags.NonPublic;

        [TestCase(.1f)] [TestCase(1f)] [TestCase(10f)]
        public void ActualUnityDisplayFrameConvertsWorldDisplacementOnlyOnce(float scale)
        {
            var root = new GameObject("Owned frame test");
            try
            {
                root.transform.SetPositionAndRotation(new Vector3(1, 2, 3), Quaternion.Euler(15, 35, 20));
                root.transform.localScale = Vector3.one * scale;
                var frame = QuestSpatialEdit.CaptureFrame(root.transform);
                var world = root.transform.TransformPoint(QuestDimensions.CadPoint(new CadVector(100, 50, 20)));
                var cad = frame.ToCad(new CadVector(world.x, world.y, world.z));
                Assert.That(cad.X, Is.EqualTo(100).Within(.002));Assert.That(cad.Y, Is.EqualTo(50).Within(.002));
                Assert.That(cad.Z, Is.EqualTo(20).Within(.002));
            }
            finally { Object.DestroyImmediate(root); }
        }

        [Test]
        public void PendingDirectFaceWorkBlocksBeginAndExactBeforeAnyEditWorkerStarts()
        {
            var root = new GameObject("Owned direct-face spatial interlock test");
            try
            {
                var direct = root.AddComponent<QuestDirectFaceHistory>();
                typeof(QuestDirectFaceHistory).GetField("_pending", Private).SetValue(direct, 1);
                var spatial = root.AddComponent<QuestSpatialEdit>();spatial.DirectFaceHistory = direct;
                typeof(QuestSpatialEdit).GetProperty("EditMode", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic)
                    .SetValue(spatial, true);
                using var metadata = JsonDocument.Parse("{\"id\":\"distance\",\"type\":\"linear\",\"parameter\":\"distanceMm\",\"unit\":\"mm\",\"origin\":[0,0,0],\"axis\":[1,0,0]}");
                var intent = new SpatialEditIntent("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "doc", 7,
                    "owner", "body", "tip", metadata.RootElement, new Dictionary<string, double> { ["distanceMm"] = 1 });
                typeof(QuestSpatialEdit).GetProperty("SelectedIntent", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic)
                    .SetValue(spatial, intent);
                var handle = root.AddComponent<QuestEditHandle>();handle.Intent = intent;
                var status = spatial.Status;
                var began = false;
                var exact = false;

                Assert.DoesNotThrow(() => began = spatial.Begin(handle, new Ray(Vector3.zero, Vector3.forward),
                    Vector3.one, Quaternion.identity));
                Assert.DoesNotThrow(() => exact = spatial.Exact(new Dictionary<string, double> { ["distanceMm"] = 2 }));

                Assert.That(began, Is.False);
                Assert.That(exact, Is.False);
                Assert.That(spatial.Busy, Is.False);
                Assert.That(spatial.Status, Is.EqualTo(status));
            }
            finally { Object.DestroyImmediate(root); }
        }
    }
}
