using System.Text.Json;
using Kreoda.QuestFoundation;
using Xunit;

namespace Kreoda.SessionClient.Tests;

public sealed class SpatialEditIntentTests
{
    const string Session = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    static SpatialEditIntent Intent(string metadata, Dictionary<string, double> values)
    {
        using var doc = JsonDocument.Parse(metadata);
        return new SpatialEditIntent(Session, "doc-phase1", 7, "owner", "body-owner", "tip", doc.RootElement, values);
    }

    [Theory]
    [InlineData(.1)] [InlineData(1)] [InlineData(10)]
    public void RotatedDisplayMagnificationPreservesCadDisplacement(double magnification)
    {
        var frame = new CadDisplayFrame(new(1, 2, 3), new(0, 0, 1), new(-1, 0, 0), new(0, 1, 0), magnification);
        var intent = Intent("""{"id":"width","type":"linear","parameter":"widthMm","unit":"mm","origin":[100,25,10],"axis":[1,0,0]}""",
            new() { ["widthMm"] = 100 });
        var start = new CadVector(100, 25, 10);var end = new CadVector(110, 999, -42);
        var result = intent.PredictDrag(frame.ToCad(frame.ToWorld(start)), frame.ToCad(frame.ToWorld(end)));
        Assert.Equal(110, result["widthMm"], 8);
        Assert.Equal(100, intent.InitialValues["widthMm"]);
    }

    [Fact]
    public void AngularProjectionUsesSignedDegrees()
    {
        var intent = Intent("""{"id":"angle","type":"angular","parameter":"angleDeg","unit":"deg","origin":[0,0,0],"axis":[0,1,0]}""",
            new() { ["angleDeg"] = 20 });
        Assert.Equal(110, intent.PredictDrag(new(10, 0, 0), new(0, 0, -10))["angleDeg"], 8);
        Assert.Equal(-70, intent.PredictDrag(new(10, 0, 0), new(0, 0, 10))["angleDeg"], 8);
    }

    [Fact]
    public void RadialDiameterIgnoresAxialMotionAndDoublesRadiusChange()
    {
        var intent = Intent("""{"id":"diameter","type":"radial","parameter":"diameterMm","unit":"mm","origin":[0,0,0],"axis":[0,0,1]}""",
            new() { ["diameterMm"] = 6 });
        Assert.Equal(10, intent.PredictDrag(new(3, 0, 20), new(5, 0, -20))["diameterMm"], 8);
    }

    [Fact]
    public void PlanarAndPositionUseDeclaredSignedBasis()
    {
        var planar = Intent("""{"id":"xy","type":"planar","parameters":["txMm","tyMm"],"unit":"mm","origin":[1,2,3],"xAxis":[1,0,0],"yAxis":[0,1,0],"normal":[0,0,1]}""",
            new() { ["txMm"] = 1, ["tyMm"] = 2 });
        var draft = planar.PredictDrag(new(1, 2, 3), new(-9, 22, 999));
        Assert.Equal(-9, draft["txMm"]);Assert.Equal(22, draft["tyMm"]);Assert.Equal(2, draft.Count);
        var position = Intent("""{"id":"position","type":"position","parameters":["txMm","tyMm","tzMm"],"unit":"mm","origin":[1,2,3],"basis":[[1,0,0],[0,1,0],[0,0,1]]}""",
            new() { ["txMm"] = 1, ["tyMm"] = 2, ["tzMm"] = 3 });
        Assert.Equal(-27, position.PredictDrag(new(1, 2, 3), new(-9, 22, -27))["tzMm"]);
    }

    [Fact]
    public void OrientationDeltaMatchesExtrinsicZyxComposition()
    {
        var intent = Intent("""{"id":"rotation","type":"angular","parameters":["rxDeg","ryDeg","rzDeg"],"unit":"deg","origin":[0,0,0],"basis":[[1,0,0],[0,1,0],[0,0,1]],"rotationConvention":"extrinsic-ZYX"}""",
            new() { ["rxDeg"] = 0, ["ryDeg"] = 0, ["rzDeg"] = 90 });
        var result = intent.PredictRotation(new(30, 0, 0));
        Assert.Equal(0, result["rxDeg"], 8);Assert.Equal(-30, result["ryDeg"], 8);Assert.Equal(90, result["rzDeg"], 8);
    }

    [Fact]
    public void UnityReflectionConvertsWorldRotationIntoCadRotation()
    {
        var frame = new CadDisplayFrame(new(0, 0, 0), new(1, 0, 0), new(0, 0, 1), new(0, 1, 0), 10);
        var intent = Intent("""{"id":"rotation","type":"angular","parameters":["rxDeg","ryDeg","rzDeg"],"unit":"deg","origin":[0,0,0],"basis":[[1,0,0],[0,1,0],[0,0,1]],"rotationConvention":"extrinsic-ZYX"}""",
            new() { ["rxDeg"] = 0, ["ryDeg"] = 0, ["rzDeg"] = 90 });
        var delta = frame.ToCadRotationMatrix(SpatialEditIntent.EulerMatrix(new(0, 30, 0)));
        Assert.Equal(60, intent.PredictRotationMatrix(delta)["rzDeg"], 8);
    }

    [Fact]
    public void IntentCopiesValuesAndRejectsInvalidMetadata()
    {
        var values = new Dictionary<string, double> { ["widthMm"] = 100 };
        const string valid = """{"id":"width","type":"linear","parameter":"widthMm","unit":"mm","origin":[0,0,0],"axis":[1,0,0]}""";
        var intent = Intent(valid, values);values["widthMm"] = 999;
        Assert.Equal(100, intent.InitialValues["widthMm"]);Assert.Equal("owner", intent.FeatureId);
        Assert.Throws<ArgumentException>(() => Intent(valid.Replace("[1,0,0]", "[0,0,0]"), values));
        Assert.Throws<ArgumentException>(() => Intent(valid.Replace("\"mm\"", "\"deg\""), values));
        Assert.Throws<ArgumentException>(() => Intent(valid, new() { ["widthMm"] = double.NaN }));
        Assert.Throws<ArgumentException>(() => new CadDisplayFrame(new(0, 0, 0), new(1, 0, 0), new(1, 0, 0), new(0, 0, 1), 1));
        Assert.Equal(15, SpatialEditIntent.Snap(14, 5));
    }

    [Fact]
    public void CanonicalExtrinsicRotationRejectsNonIdentityParameterBasis()
    {
        Assert.Throws<ArgumentException>(() => Intent("""{"id":"rotation","type":"angular","parameters":["rxDeg","ryDeg","rzDeg"],"unit":"deg","origin":[0,0,0],"basis":[[0,1,0],[-1,0,0],[0,0,1]],"rotationConvention":"extrinsic-ZYX"}""",
            new() { ["rxDeg"] = 0, ["ryDeg"] = 0, ["rzDeg"] = 0 }));
    }

    [Fact]
    public void ExactCopiesCanonicalKeysRegardlessOfInputComparer()
    {
        var intent = Intent("""{"id":"width","type":"linear","parameter":"widthMm","unit":"mm","origin":[0,0,0],"axis":[1,0,0]}""",
            new() { ["widthMm"] = 100 });
        var draft = intent.Exact(new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase) { ["WIDTHMM"] = 120 });
        Assert.Equal(new[] { "widthMm" }, draft.Keys);Assert.Equal(120, draft["widthMm"]);
    }
}
