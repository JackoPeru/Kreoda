using System.Text.Json;
using NUnit.Framework;

namespace Kreoda.QuestRuntime.Tests
{
    public sealed class QuestCommandFieldValidationTests
    {
        [Test]
        public void SpatialNumericCommandFieldsRespectCanonicalBounds()
        {
            using var schema = JsonDocument.Parse("{\"type\":\"number\",\"minimum\":0.1,\"maximum\":10}");
            Assert.That(QuestCommands.ValidateFieldValue(schema.RootElement, 0.05d), Is.False);
            Assert.That(QuestCommands.ValidateFieldValue(schema.RootElement, 10.1d), Is.False);
            Assert.That(QuestCommands.ValidateFieldValue(schema.RootElement, 2.5d), Is.True);
            Assert.That(QuestCommands.ValidateFieldValue(schema.RootElement, double.NaN), Is.False);
        }

        [Test]
        public void TypedContextCommandRejectsUnknownEnumAndFractionalInteger()
        {
            using var enumSchema = JsonDocument.Parse("{\"type\":\"string\",\"enum\":[\"normal\",\"reverse\"]}");
            using var integerSchema = JsonDocument.Parse("{\"type\":\"integer\",\"exclusiveMinimum\":0}");
            Assert.That(QuestCommands.ValidateFieldValue(enumSchema.RootElement, "normal"), Is.True);
            Assert.That(QuestCommands.ValidateFieldValue(enumSchema.RootElement, "other"), Is.False);
            Assert.That(QuestCommands.ValidateFieldValue(integerSchema.RootElement, 0d), Is.False);
            Assert.That(QuestCommands.ValidateFieldValue(integerSchema.RootElement, 1.5d), Is.False);
            Assert.That(QuestCommands.ValidateFieldValue(integerSchema.RootElement, 2d), Is.True);
        }
    }
}
