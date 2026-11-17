using System.Text.Json;
using NUnit.Framework;

namespace Kreoda.QuestRuntime.Tests
{
    public sealed class QuestSketchSymmetryInspectionTests
    {
        [Test]
        public void SymmetryInspectionRequiresTwoDistinctPointsAndAxis()
        {
            using var valid = JsonDocument.Parse("{\"id\":\"c1\",\"kind\":\"symmetric\",\"refs\":[\"p1\",\"p2\",\"l1\"]}");
            using var repeated = JsonDocument.Parse("{\"id\":\"c1\",\"kind\":\"symmetric\",\"refs\":[\"p1\",\"p1\",\"l1\"]}");
            using var other = JsonDocument.Parse("{\"id\":\"c1\",\"kind\":\"parallel\",\"refs\":[\"l1\",\"l2\"]}");
            Assert.That(QuestSketchDimensions.DescribeConstraint(valid.RootElement), Does.Contain("asse l1"));
            Assert.That(QuestSketchDimensions.DescribeConstraint(repeated.RootElement), Is.Null);
            Assert.That(QuestSketchDimensions.DescribeConstraint(other.RootElement), Is.Null);
        }
        [Test]
        public void SymmetryInspectionRejectsMissingPointOrAxisFromCanonicalSketch()
        {
            using var sketch = JsonDocument.Parse("{\"points\":[{\"id\":\"p1\"},{\"id\":\"p2\"}],\"lines\":[{\"id\":\"axis\"}]}");
            using var valid = JsonDocument.Parse("{\"id\":\"c\",\"kind\":\"symmetric\",\"refs\":[\"p1\",\"p2\",\"axis\"]}");
            using var missingAxis = JsonDocument.Parse("{\"id\":\"c\",\"kind\":\"symmetric\",\"refs\":[\"p1\",\"p2\",\"deleted\"]}");
            Assert.That(QuestSketchDimensions.DescribeConstraint(valid.RootElement, sketch.RootElement), Does.Contain("axis"));
            Assert.That(QuestSketchDimensions.DescribeConstraint(missingAxis.RootElement, sketch.RootElement), Is.Null);
        }
    }
}
