using System.Text.Json;
using Kreoda.QuestFoundation;
using Xunit;

namespace Kreoda.SessionClient.Tests;
public sealed class SketchDimensionIntentTests
{
    [Theory]
    [InlineData("distance", 12, 20, "mm", 20)]
    [InlineData("angle", 1.5707963267948966, 180, "deg", 3.141592653589793)]
    public void ExactDraftChangesOnlySelectedConstraintAndPreservesCapturedSketch(string kind, double stored, double requested, string unit, double expected)
    {
        using var source = JsonDocument.Parse(JsonSerializer.Serialize(new {
            featureId = "sketch", planeKind = "XZ", plane = new { origin = new[] { 10, 20, 30 } },
            model = new { points = new[] { new { id = "p0", x = 1, y = 2, @fixed = true } },
                constraints = new[] { new { id = "dimension", kind, refs = new[] { "p0", "p1" }, value = stored },
                    new { id = "other", kind = "distance", refs = new[] { "p1", "p2" }, value = 5d } } } }));
        var intent = new SketchDimensionIntent("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "doc", 7, source.RootElement, "dimension");
        Assert.Equal(unit, intent.Unit);
        var draft = intent.Draft(requested);
        Assert.Equal(expected, draft.GetProperty("constraints")[0].GetProperty("value").GetDouble(), 10);
        Assert.Equal(source.RootElement.GetProperty("model").GetProperty("points").GetRawText(), draft.GetProperty("points").GetRawText());
        Assert.Equal(5, draft.GetProperty("constraints")[1].GetProperty("value").GetDouble());
        Assert.Equal(stored, source.RootElement.GetProperty("model").GetProperty("constraints")[0].GetProperty("value").GetDouble());
        Assert.Equal("XZ", intent.Sketch.GetProperty("planeKind").GetString());
        Assert.Throws<ArgumentException>(() => intent.Draft(double.NaN));
    }
}
