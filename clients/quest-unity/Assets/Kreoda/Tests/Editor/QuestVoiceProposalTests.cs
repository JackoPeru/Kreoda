using System;
using System.Text.Json;
using NUnit.Framework;

namespace Kreoda.QuestRuntime.Tests
{
    public sealed class QuestVoiceProposalTests
    {
        [Test]
        public void AcceptsOnlyVersionedServerChoicesForExactLineage()
        {
            using var response = JsonDocument.Parse("{\"proposal\":{\"version\":1,\"proposalId\":\"p-1\",\"sessionId\":\"s\",\"documentId\":\"d\",\"revision\":7,\"choices\":[{\"id\":\"c-1\",\"description\":\"Create rounded edge\"}]}}");
            var parsed = QuestVoiceProposal.Parse(response.RootElement, "s", "d", 7);
            Assert.That(parsed.ChoiceIds, Is.EqualTo(new[] { "c-1" }));
            Assert.Throws<FormatException>(() => QuestVoiceProposal.Parse(response.RootElement, "s", "d", 8));
            Assert.Throws<FormatException>(() => QuestVoiceProposal.Parse(response.RootElement, "other", "d", 7));
        }
    }
}
