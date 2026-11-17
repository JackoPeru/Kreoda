using NUnit.Framework;

namespace Kreoda.QuestRuntime.Tests
{
    public sealed class QuestSharedSelectionTests
    {
        [Test]
        public void SharedSelectionRequiresCanonicalUnambiguousTarget()
        {
            Assert.That(QuestControls.SharedSelectionId("body", null, false, "body-1"), Is.EqualTo("body-1"));
            Assert.That(QuestControls.SharedSelectionId("face", "face-2", false, "body-1"), Is.EqualTo("face-2"));
            Assert.That(QuestControls.SharedSelectionId("edge", "edge-3", true, "body-1"), Is.Null);
            Assert.That(QuestControls.SharedSelectionId("face", null, false, "body-1"), Is.Null);
            Assert.That(QuestControls.SharedSelectionId("unknown", "face-2", false, "body-1"), Is.Null);
        }
    }
}
