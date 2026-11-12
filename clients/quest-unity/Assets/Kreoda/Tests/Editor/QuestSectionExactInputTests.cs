using NUnit.Framework;

namespace Kreoda.QuestRuntime.Tests
{
    public sealed class QuestSectionExactInputTests
    {
        [Test]
        public void ExactSectionOffsetRequiresFiniteNumberAndSameDocument()
        {
            Assert.That(QuestControls.CanApplySectionQuota("s", "d", "s", "d", "-12,75", out var offset), Is.True);
            Assert.That(offset, Is.EqualTo(-12.75d));
            Assert.That(QuestControls.CanApplySectionQuota("s", "d", "s2", "d", "5", out _), Is.False);
            Assert.That(QuestControls.CanApplySectionQuota("s", "d", "s", "d2", "5", out _), Is.False);
            Assert.That(QuestControls.CanApplySectionQuota("s", "d", "s", "d", "NaN", out _), Is.False);
            Assert.That(QuestControls.CanApplySectionQuota("s", "d", "s", "d", "abc", out _), Is.False);
        }
    }
}
