using System;
using System.Text.Json;
using Kreoda.Session;
using NUnit.Framework;

namespace Kreoda.QuestRuntime.Tests
{
    public sealed class QuestConfigurationsTests
    {
        [Test]
        public void QueryResponseListsNamedConfigurationsAndCurrentWithoutGeometryEdits()
        {
            using var response = JsonDocument.Parse("{\"result\":{\"active\":\"Small\",\"named\":{\"Small\":{},\"Large\":{}}}}");
            var snapshot = QuestConfigurations.Parse(response.RootElement);
            Assert.That(snapshot.Active, Is.EqualTo("Small"));
            Assert.That(snapshot.Names, Is.EquivalentTo(new[] { "Small", "Large" }));
            using var native = JsonDocument.Parse("{\"active\":\"Large\",\"named\":{\"Small\":{},\"Large\":{}},\"revision\":9}");
            Assert.That(QuestConfigurations.Parse(native.RootElement).Active, Is.EqualTo("Large"));
        }

        [Test]
        public void InvalidConfigurationAndStaleRevisionAreRejected()
        {
            using var response = JsonDocument.Parse("{\"result\":{\"active\":\"Missing\",\"named\":{\"Small\":{}}}}");
            Assert.Throws<FormatException>(() => QuestConfigurations.Parse(response.RootElement));
            SessionModelState Model(string document, long revision) => new SessionModelState("session", document, revision,
                Array.Empty<JsonElement>(), Array.Empty<JsonElement>(), Array.Empty<JsonElement>());
            Assert.That(QuestConfigurations.IsCurrent(Model("doc", 5), Model("doc", 5)), Is.True);
            Assert.That(QuestConfigurations.IsCurrent(Model("doc", 6), Model("doc", 5)), Is.False);
            Assert.That(QuestConfigurations.IsCurrent(Model("other", 5), Model("doc", 5)), Is.False);
        }
    }
}
