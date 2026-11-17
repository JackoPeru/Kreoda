using System;
using System.Text.Json;
using Kreoda.Session;
using NUnit.Framework;

namespace Kreoda.QuestRuntime.Tests
{
    public sealed class QuestOpenableProjectsTests
    {
        [Test]
        public void OpaqueProjectIdsAreBoundToExactModelAndExpiry()
        {
            var model = new SessionModelState("s", "d", 7, Array.Empty<JsonElement>(), Array.Empty<JsonElement>(), Array.Empty<JsonElement>());
            using var payload = JsonDocument.Parse("{\"result\":{\"sessionId\":\"s\",\"documentId\":\"d\",\"revision\":7,\"projects\":[{\"projectId\":\"opaque-1\",\"name\":\"Part A\",\"expiresAt\":1100}]}}");
            var parsed = QuestOpenableProjects.Parse(payload.RootElement, model, 1000);
            Assert.That(parsed, Is.Not.Null);
            Assert.That(parsed.IsCurrent(model, 1000, 0), Is.True);
            Assert.That(parsed.IsCurrent(model with { Revision = 8 }, 1000, 0), Is.False);
            Assert.That(parsed.IsCurrent(model, 1100, 0), Is.False);
            Assert.That(QuestOpenableProjects.Parse(payload.RootElement, model with { DocumentId = "other" }, 1000), Is.Null);
        }

        [Test]
        public void OpenRequiresExplicitServerSuccessAndRotatedSession()
        {
            using var opened = JsonDocument.Parse("{\"result\":{\"status\":\"opened\",\"sessionId\":\"new\",\"revision\":0}}");
            using var denied = JsonDocument.Parse("{\"result\":{\"status\":\"consent_required\",\"sessionId\":\"new\",\"revision\":0}}");
            Assert.That(QuestOpenableProjects.OpenReplyAccepted(opened.RootElement, "old"), Is.True);
            Assert.That(QuestOpenableProjects.OpenReplyAccepted(opened.RootElement, "new"), Is.False);
            Assert.That(QuestOpenableProjects.OpenReplyAccepted(denied.RootElement, "old"), Is.False);
        }
    }
}
