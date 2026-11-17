using System;
using NUnit.Framework;
using Kreoda.Session;

namespace Kreoda.QuestRuntime.Tests
{
    public sealed class QuestSpatialIntentLoadTests
    {
        [Test]
        public void DelayedIntentResponseIsRejectedAfterRevisionOrSelectionChanges()
        {
            var original = new SessionModelState("s", "d", 7, Array.Empty<System.Text.Json.JsonElement>(),
                Array.Empty<System.Text.Json.JsonElement>(), Array.Empty<System.Text.Json.JsonElement>());
            var current = original with { };
            Assert.That(QuestSpatialEdit.IsIntentLoadCurrent(original, current, 3, 3, true, true), Is.True);
            current = original with { Revision = 8 };
            Assert.That(QuestSpatialEdit.IsIntentLoadCurrent(original, current, 3, 3, true, true), Is.False);
            current = original with { };
            Assert.That(QuestSpatialEdit.IsIntentLoadCurrent(original, current, 3, 4, true, true), Is.False);
            Assert.That(QuestSpatialEdit.IsIntentLoadCurrent(original, current, 3, 3, true, false), Is.False);
            Assert.That(QuestSpatialEdit.PreviewLineageCurrent(original, current, true), Is.True);
            Assert.That(QuestSpatialEdit.PreviewLineageCurrent(original, original with { Revision = 8 }, true), Is.False);
            Assert.That(QuestSpatialEdit.PreviewLineageCurrent(original, original with { DocumentId = "other" }, true), Is.False);
            Assert.That(QuestSpatialEdit.PreviewLineageCurrent(original, current, false), Is.False);
        }
    }
}
