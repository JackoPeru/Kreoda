using System;
using System.Collections.Generic;
using System.Text.Json;
using NUnit.Framework;

namespace Kreoda.QuestRuntime.Tests
{
    public class QuestReferencesTests
    {
        static QuestReferenceValue P(string kind) => QuestReferenceValue.PrincipalPlane(kind);
        static QuestReferenceValue A(string axis) => QuestReferenceValue.PrincipalAxis(axis);
        static QuestReferenceValue D(QuestReferenceKind kind, string id, string nativeKind) =>
            QuestReferenceValue.Datum(kind, id, nativeKind, "ok");
        static QuestReferenceValue C(double x, double y, double z) => QuestReferenceValue.Coordinates(x, y, z);

        [Test]
        public void AllTenDefinitionsKeepCanonicalDiscriminatorsAndStableSourceIdentities()
        {
            var plane = D(QuestReferenceKind.Plane, "plane-1", "DatumPlane");
            var axis = A("Z");
            var point = D(QuestReferenceKind.Point, "point-1", "DatumPoint");
            AssertDefinition(QuestReferenceKind.Plane, "principal", new() { ["planeKind"] = "XZ" },
                "{\"type\":\"principal\",\"planeKind\":\"XZ\"}");
            AssertDefinition(QuestReferenceKind.Plane, "offset", new() { ["base"] = P("XY"), ["offsetMm"] = 24d },
                "{\"type\":\"offset\",\"base\":{\"type\":\"principal\",\"planeKind\":\"XY\"},\"offsetMm\":24}");
            AssertDefinition(QuestReferenceKind.Plane, "mid", new() { ["first"] = P("XY"), ["second"] = plane },
                "{\"type\":\"mid\",\"first\":{\"type\":\"principal\",\"planeKind\":\"XY\"},\"second\":{\"type\":\"datum\",\"featureId\":\"plane-1\"}}");
            AssertDefinition(QuestReferenceKind.Plane, "offset", new() { ["base"] = QuestReferenceValue.Face("body-feature", "persistent-face-7"), ["offsetMm"] = 2d },
                "{\"type\":\"offset\",\"base\":{\"type\":\"face\",\"featureId\":\"body-feature\",\"persistentFaceId\":\"persistent-face-7\"},\"offsetMm\":2}");
            AssertDefinition(QuestReferenceKind.Plane, "angle", new() { ["base"] = P("XY"), ["axis"] = QuestReferenceValue.Edge("body-feature", "persistent-edge-4"), ["angleDeg"] = -90d },
                "{\"type\":\"angle\",\"base\":{\"type\":\"principal\",\"planeKind\":\"XY\"},\"axis\":{\"type\":\"edge\",\"featureId\":\"body-feature\",\"persistentEdgeId\":\"persistent-edge-4\"},\"angleDeg\":-90}");
            AssertDefinition(QuestReferenceKind.Plane, "threePoint", new() { ["first"] = C(0, 0, 0), ["second"] = point, ["third"] = C(0, 1, 0) },
                "{\"type\":\"threePoint\",\"first\":{\"type\":\"coordinates\",\"positionMm\":[0,0,0]},\"second\":{\"type\":\"datum\",\"featureId\":\"point-1\"},\"third\":{\"type\":\"coordinates\",\"positionMm\":[0,1,0]}}");
            AssertDefinition(QuestReferenceKind.Axis, "twoPoint", new() { ["first"] = C(0, 0, 0), ["second"] = point },
                "{\"type\":\"twoPoint\",\"first\":{\"type\":\"coordinates\",\"positionMm\":[0,0,0]},\"second\":{\"type\":\"datum\",\"featureId\":\"point-1\"}}");
            AssertDefinition(QuestReferenceKind.Axis, "planeIntersection", new() { ["first"] = P("XY"), ["second"] = plane },
                "{\"type\":\"planeIntersection\",\"first\":{\"type\":\"principal\",\"planeKind\":\"XY\"},\"second\":{\"type\":\"datum\",\"featureId\":\"plane-1\"}}");
            AssertDefinition(QuestReferenceKind.Axis, "planeNormal", new() { ["plane"] = plane, ["through"] = QuestReferenceValue.PlaneOrigin() },
                "{\"type\":\"planeNormal\",\"plane\":{\"type\":\"datum\",\"featureId\":\"plane-1\"}}");
            AssertDefinition(QuestReferenceKind.Axis, "planeNormal", new() { ["plane"] = P("YZ"), ["through"] = C(1, 2, 3) },
                "{\"type\":\"planeNormal\",\"plane\":{\"type\":\"principal\",\"planeKind\":\"YZ\"},\"through\":{\"type\":\"coordinates\",\"positionMm\":[1,2,3]}}");
            AssertDefinition(QuestReferenceKind.Axis, "planeIntersection", new() { ["first"] = P("XY"), ["second"] = P("XZ") },
                "{\"type\":\"planeIntersection\",\"first\":{\"type\":\"principal\",\"planeKind\":\"XY\"},\"second\":{\"type\":\"principal\",\"planeKind\":\"XZ\"}}");
            AssertDefinition(QuestReferenceKind.Point, "coordinates", new() { ["xMm"] = 1d, ["yMm"] = 2d, ["zMm"] = 3d },
                "{\"type\":\"coordinates\",\"positionMm\":[1,2,3]}");
            AssertDefinition(QuestReferenceKind.Point, "midpoint", new() { ["first"] = C(0, 0, 0), ["second"] = point },
                "{\"type\":\"midpoint\",\"first\":{\"type\":\"coordinates\",\"positionMm\":[0,0,0]},\"second\":{\"type\":\"datum\",\"featureId\":\"point-1\"}}");
        }

        [TestCase("1,25", true, 1.25)]
        [TestCase("-1000000", true, -1000000)]
        [TestCase("1000000.01", false, 0)]
        [TestCase("NaN", false, 0)]
        [TestCase("Infinity", false, 0)]
        [TestCase("361", true, 361)]
        public void NumericInputAcceptsCommaAndRejectsNonFiniteOrOutOfRange(string text, bool valid, double expected)
        {
            Assert.That(QuestReferences.TryParseNumber(text, -1000000, 1000000, out var value), Is.EqualTo(valid));
            if (valid) Assert.That(value, Is.EqualTo(expected).Within(1e-9));
        }

        [Test]
        public void DegreeRangeIsBoundedSeparatelyFromMillimetreInputs()
        {
            Assert.That(QuestReferences.TryParseNumber("360", -360, 360, out _), Is.True);
            Assert.That(QuestReferences.TryParseNumber("-360.01", -360, 360, out _), Is.False);
        }

        [Test]
        public void WrongDatumKindAndInvalidSourceIdentityCannotBecomeAnonymousGeometry()
        {
            Assert.Throws<ArgumentException>(() => QuestReferences.BuildDefinition(QuestReferenceKind.Plane, "offset",
                new Dictionary<string, object> { ["base"] = D(QuestReferenceKind.Axis, "axis-1", "DatumAxis"), ["offsetMm"] = 1d }));
            Assert.Throws<ArgumentException>(() => QuestReferences.BuildDefinition(QuestReferenceKind.Point, "midpoint",
                new Dictionary<string, object> { ["first"] = QuestReferenceValue.Datum(QuestReferenceKind.Point, "", "DatumPoint", "ok"), ["second"] = C(0, 0, 0) }));
            var definition = QuestReferences.BuildDefinition(QuestReferenceKind.Plane, "offset",
                new Dictionary<string, object> { ["base"] = D(QuestReferenceKind.Plane, "source-uuid", "DatumPlane"), ["offsetMm"] = 4d });
            Assert.That(JsonSerializer.Serialize(definition), Does.Contain("source-uuid"));
            Assert.That(JsonSerializer.Serialize(definition), Does.Not.Contain("coordinates"));
        }

        [Test]
        public void EditPayloadRetainsOriginalFeatureUuidAndSelectsCanonicalUpdateCommand()
        {
            var parameters = QuestReferences.BuildCommandParameters(QuestReferenceKind.Plane, "offset",
                new Dictionary<string, object> { ["base"] = P("XY"), ["offsetMm"] = 24d }, "feature-keep-this-id");
            Assert.That(QuestReferences.CanonicalCommandId(QuestReferenceKind.Plane, true), Is.EqualTo("UpdateDatum"));
            Assert.That(parameters["featureId"], Is.EqualTo("feature-keep-this-id"));
            Assert.That(JsonSerializer.Serialize(parameters["definition"]), Does.Contain("\"offsetMm\":24"));
        }

        [Test]
        public void ContextSchemaRestrictsAvailableConstructors()
        {
            using var schema = JsonDocument.Parse("{\"properties\":{\"definition\":{\"anyOf\":[{\"properties\":{\"type\":{\"type\":\"string\",\"const\":\"principal\"}}},{\"properties\":{\"type\":{\"type\":\"string\",\"const\":\"offset\"}}}]}}}");
            Assert.That(QuestReferences.AllowedOperations(schema.RootElement, QuestReferenceKind.Plane), Is.EquivalentTo(new[] { "principal", "offset" }));
            Assert.That(QuestReferences.AllowedOperations(schema.RootElement, QuestReferenceKind.Axis), Is.Empty);
        }

        [Test]
        public void PlaneIntersectionRejectsEdgeBecauseAxisRefCannotBeUsedAsPlaneRef()
        {
            Assert.Throws<ArgumentException>(() => QuestReferences.BuildDefinition(QuestReferenceKind.Axis, "planeIntersection",
                new Dictionary<string, object> { ["first"] = P("XY"), ["second"] = QuestReferenceValue.Edge("body-feature", "persistent-edge-4") }));
        }

        static void AssertDefinition(QuestReferenceKind kind, string operation, Dictionary<string, object> fields, string expected)
        {
            var actual = JsonSerializer.Serialize(QuestReferences.BuildDefinition(kind, operation, fields));
            using var actualJson = JsonDocument.Parse(actual);
            using var expectedJson = JsonDocument.Parse(expected);
            Assert.That(actualJson.RootElement.GetRawText(), Is.EqualTo(expectedJson.RootElement.GetRawText()), operation);
        }
    }
}
