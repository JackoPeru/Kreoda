using Kreoda.QuestFoundation;
using NUnit.Framework;
using UnityEngine;

namespace Kreoda.QuestRuntime.Tests
{
    public class QuestSpatialEditTests
    {
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
    }
}
