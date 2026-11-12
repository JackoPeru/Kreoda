using System.Collections.Generic;
using Kreoda.Session.Generated;
using NUnit.Framework;

namespace Kreoda.QuestRuntime.Tests
{
    public sealed class QuestIncrementalMeshIdentityTests
    {
        [Test]
        public void ChangedMeshDeltaAcceptsBodyOrFeatureIdentityWithoutTouchingOtherBodies()
        {
            var a = new BodyDescriptor { BodyId = "body-a", Tip = "feature-a", History = new[] { "base-a", "feature-a" } };
            var b = new BodyDescriptor { BodyId = "body-b", Tip = "feature-b", History = new[] { "feature-b" } };
            Assert.That(QuestConnection.ChangedBodyMatches(a, new HashSet<string> { "body-a" }), Is.True);
            Assert.That(QuestConnection.ChangedBodyMatches(a, new HashSet<string> { "base-a" }), Is.True);
            Assert.That(QuestConnection.ChangedBodyMatches(a, new HashSet<string> { "feature-a" }), Is.True);
            Assert.That(QuestConnection.ChangedBodyMatches(b, new HashSet<string> { "body-a" }), Is.False);
        }
    }
}
