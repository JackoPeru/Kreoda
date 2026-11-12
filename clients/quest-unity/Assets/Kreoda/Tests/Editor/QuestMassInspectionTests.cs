using System;
using System.Text.Json;
using NUnit.Framework;
using Kreoda.Session;

namespace Kreoda.QuestRuntime.Tests
{
    public class QuestMassInspectionTests
    {
        [Test]
        public void DisplaysCanonicalBrepValuesWithoutInventingDensity()
        {
            using var response = JsonDocument.Parse("{\"result\":{\"basis\":\"brep\",\"volumeMm3\":1000,\"areaMm2\":600,\"centroidMm\":[5,6,7],\"massKg\":0,\"densityKgPerM3\":0}}");
            var text = QuestMassInspection.Format(response.RootElement);
            Assert.That(text, Does.Contain("1000 mm³").And.Contain("600 mm²").And.Contain("(5, 6, 7) mm"));
            Assert.That(text, Does.Contain("densità non assegnata"));
        }

        [Test]
        public void RejectsMalformedOrNonFiniteGeometry()
        {
            using var response = JsonDocument.Parse("{\"result\":{\"basis\":\"mesh\",\"volumeMm3\":1,\"areaMm2\":2,\"centroidMm\":[0,0,0],\"massKg\":0,\"densityKgPerM3\":0}}");
            Assert.Throws<FormatException>(() => QuestMassInspection.Format(response.RootElement));
        }

        [Test]
        public void StaleRevisionOrDocumentCannotOverwritePhysicalInspection()
        {
            SessionModelState Model(string document, long revision) => new SessionModelState("session", document, revision,
                Array.Empty<JsonElement>(), Array.Empty<JsonElement>(), Array.Empty<JsonElement>());
            Assert.That(QuestControls.CanApplyMassResult(Model("doc", 3), Model("doc", 3)), Is.True);
            Assert.That(QuestControls.CanApplyMassResult(Model("doc", 4), Model("doc", 3)), Is.False);
            Assert.That(QuestControls.CanApplyMassResult(Model("other", 3), Model("doc", 3)), Is.False);
        }
    }
}
