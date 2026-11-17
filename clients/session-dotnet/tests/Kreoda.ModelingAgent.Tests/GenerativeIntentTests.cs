using System.Text.Json;
using Xunit;

namespace Kreoda.ModelingAgent.Tests;

public sealed class GenerativeIntentTests
{
    const string BracketCommands = """{"id":"CreateBox","nativeType":3,"creation":{"fixedCount":1},"parameters":{"type":"object","properties":{"widthMm":{"type":"number"},"heightMm":{"type":"number"},"depthMm":{"type":"number"},"origin":{"type":"object","properties":{"x":{"type":"number"},"y":{"type":"number"},"z":{"type":"number"}}}}}},{"id":"CreateBoolean","nativeType":19,"creation":{"fixedCount":1},"parameters":{"type":"object","properties":{"op":{"type":"string"},"targetId":{"type":"string"},"toolId":{"type":"string"}}}}""";
    const string ProfileCommands = """{"id":"CreateSketch","nativeType":13,"creation":{"fixedCount":1},"parameters":{"type":"object","properties":{"model":{"type":"object"},"planeKind":{"type":"string"}}}},{"id":"CreateExtrude","nativeType":15,"creation":{"fixedCount":1},"parameters":{"type":"object","properties":{"sketchId":{"type":"string"},"distanceMm":{"type":"number"}}}}""";
    static AgentCommandCatalog Catalog(string commands = """{"id":"CreateBox","nativeType":3,"creation":{"fixedCount":1},"parameters":{"type":"object","properties":{"widthMm":{"type":"number"},"heightMm":{"type":"number"},"depthMm":{"type":"number"}}}},{"id":"CreateCylinder","nativeType":4,"creation":{"fixedCount":1},"parameters":{"type":"object","properties":{"radiusMm":{"type":"number"},"heightMm":{"type":"number"}}}}""")
    {
        using var json = JsonDocument.Parse("{\"commands\":[" + commands + "]}");
        return AgentCommandCatalog.FromReply(json.RootElement);
    }

    [Fact]
    public void FunctionalIntentOffersTwoEditableAlternativesWithoutChoosing()
    {
        var options = GenerativeIntent.ConnectParallelPlates(80, 20, 5, Catalog());
        Assert.Equal(new[] { "round-spacer", "rectangular-spacer" }, options.Select(o => o.Id));
        Assert.Equal("CreateCylinder", options[0].Steps.Single().CommandId);
        Assert.Equal(80, options[0].Steps.Single().Parameters.GetProperty("heightMm").GetDouble());
        Assert.Equal(10, options[0].Steps.Single().Parameters.GetProperty("radiusMm").GetDouble());
        Assert.Equal("CreateBox", options[1].Steps.Single().CommandId);
        Assert.Equal(80, options[1].Steps.Single().Parameters.GetProperty("heightMm").GetDouble());
        Assert.All(options, option => Assert.All(option.Steps, step => Assert.Equal(1, Catalog().Require(step.CommandId).CreatedFeatureCount(step.Parameters))));
    }

    [Fact]
    public void GeneratorUsesCanonicalEditableFeatureAndDimensions()
    {
        var option = GenerativeIntent.MountingBlank(140, 90, 6, Catalog());
        var step = Assert.Single(option.Steps);
        Assert.Equal("CreateBox", step.CommandId);
        Assert.Equal(140, step.Parameters.GetProperty("widthMm").GetDouble());
        Assert.Equal(90, step.Parameters.GetProperty("heightMm").GetDouble());
        Assert.Equal(6, step.Parameters.GetProperty("depthMm").GetDouble());
    }

    [Fact]
    public void UnsupportedServerSchemasNeverProduceInventedCommands()
    {
        var unsupported = Catalog("""{"id":"CreateBox","nativeType":3,"creation":{"fixedCount":1},"parameters":{"type":"object","properties":{}}}""");
        Assert.Empty(GenerativeIntent.ConnectParallelPlates(80, 20, 5, unsupported));
        Assert.Throws<ArgumentException>(() => GenerativeIntent.MountingBlank(100, 80, 5, unsupported));
    }

    [Theory]
    [InlineData(double.NaN, 20, 5)]
    [InlineData(80, double.PositiveInfinity, 5)]
    [InlineData(80, 20, 80)]
    [InlineData(-1, 20, 5)]
    public void UnsafeDimensionsAreRejected(double separation, double width, double thickness) =>
        Assert.Throws<ArgumentOutOfRangeException>(() => GenerativeIntent.ConnectParallelPlates(separation, width, thickness, Catalog()));

    [Theory]
    [InlineData("L", 3, 1)]
    [InlineData("U", 5, 2)]
    public void BracketUsesEditableBoxesAndFusedNativeFeatures(string shape, int count, int unions)
    {
        var option = GenerativeIntent.Bracket(shape, 100, 40, 60, 5, Catalog(BracketCommands));
        Assert.Equal(count, option.Steps.Count);
        Assert.Equal(unions, option.Steps.Count(step => step.CommandId == "CreateBoolean"));
        Assert.Equal(option.Steps.Count, option.Steps.Select(step => step.Alias).Distinct().Count());
        Assert.Equal(55, option.Steps[1].Parameters.GetProperty("depthMm").GetDouble());
        Assert.Equal(5, option.Steps[1].Parameters.GetProperty("origin").GetProperty("z").GetDouble());
        if (shape == "U") Assert.Equal(95, option.Steps[3].Parameters.GetProperty("origin").GetProperty("x").GetDouble());
    }

    [Fact]
    public void BracketRejectsMissingBooleanAndImpossibleThickness()
    {
        Assert.Throws<ArgumentException>(() => GenerativeIntent.Bracket("U", 100, 40, 60, 5, Catalog()));
        Assert.Throws<ArgumentOutOfRangeException>(() => GenerativeIntent.Bracket("U", 10, 40, 60, 5, Catalog(BracketCommands)));
    }

    [Theory]
    [InlineData("L", 6, 31000d)]
    [InlineData("U", 8, 42000d)]
    public void BracketFallsBackToCanonicalClosedProfileWithoutBoxOrigin(string shape, int expectedVertices, double expectedVolume)
    {
        var bracket=GenerativeIntent.Bracket(shape,100,40,60,5,Catalog(ProfileCommands));
        Assert.Equal(new[] { "CreateSketch", "CreateExtrude" },bracket.Steps.Select(s=>s.CommandId));
        var first=bracket.Steps[0].Parameters.GetProperty("model");
        var points=first.GetProperty("points").EnumerateArray().ToArray();
        Assert.Equal(expectedVertices,points.Length);
        Assert.Equal(expectedVertices,first.GetProperty("lines").GetArrayLength());
        var polygon=points.Select(p=>(x:p.GetProperty("x").GetDouble(),y:p.GetProperty("y").GetDouble())).ToArray();
        var twiceArea=Enumerable.Range(0,polygon.Length).Sum(i=>polygon[i].x*polygon[(i+1)%polygon.Length].y-polygon[(i+1)%polygon.Length].x*polygon[i].y);
        Assert.Equal(expectedVolume,Math.Abs(twiceArea)*20d);
        Assert.Equal("$profile",bracket.Steps[1].Parameters.GetProperty("sketchId").GetString());
        Assert.Equal(40,bracket.Steps[1].Parameters.GetProperty("distanceMm").GetDouble());
    }

    [Fact]
    public void OpenEnclosureUsesEditableSketchExtrusionsAndCanonicalCut()
    {
        var catalog=Catalog(ProfileCommands+","+"""{"id":"CreateBoolean","nativeType":19,"creation":{"fixedCount":1},"parameters":{"type":"object","properties":{"op":{"type":"string"},"targetId":{"type":"string"},"toolId":{"type":"string"}}}}""");
        var design=GenerativeIntent.OpenEnclosure(100,60,40,5,catalog);
        Assert.Equal(new[] {"CreateSketch","CreateExtrude","CreateSketch","CreateExtrude","CreateBoolean"},design.Steps.Select(s=>s.CommandId));
        Assert.Equal("cut",design.Steps[4].Parameters.GetProperty("op").GetString());
        Assert.Equal("$outer",design.Steps[4].Parameters.GetProperty("targetId").GetString());
        Assert.Equal("$cutter",design.Steps[4].Parameters.GetProperty("toolId").GetString());
        Assert.Throws<ArgumentOutOfRangeException>(()=>GenerativeIntent.OpenEnclosure(10,20,40,5,catalog));
        Assert.Throws<ArgumentException>(()=>GenerativeIntent.OpenEnclosure(100,60,40,5,Catalog(ProfileCommands)));
    }
}
