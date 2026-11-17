using NUnit.Framework;

namespace Kreoda.QuestRuntime.Tests
{
    public class QuestSemanticContextTests
    {
        [Test]
        public void FaceAndEdgeContextsUseCanonicalPersistentIdsAndOwningGeometry()
        {
            foreach (var kind in new[] { "face", "edge" })
            {
                var context = QuestSemanticContext.Build(kind, "topology-persistent-id", "body-1", "feature-2", "instance-3");
                Assert.That(context["kind"], Is.EqualTo(kind));
                Assert.That(context["persistentId"], Is.EqualTo("topology-persistent-id"));
                Assert.That(context["bodyId"], Is.EqualTo("body-1"));
                Assert.That(context["featureId"], Is.EqualTo("feature-2"));
                Assert.That(context["instanceId"], Is.EqualTo("instance-3"));
                Assert.That(context.ContainsKey("command"), Is.False);
            }
        }

        [Test]
        public void MissingCanonicalIdAndUnknownSelectionKindAreNotForwarded()
        {
            Assert.That(QuestSemanticContext.Build("face", "", "body", "feature"), Is.Null);
            Assert.That(QuestSemanticContext.Build("arbitraryCommand", "id", "body", "feature"), Is.Null);
            var datum = QuestSemanticContext.Build("datumPlane", "datum-1", null, "datum-1");
            Assert.That(datum.ContainsKey("bodyId"), Is.False);
        }
    }
}
