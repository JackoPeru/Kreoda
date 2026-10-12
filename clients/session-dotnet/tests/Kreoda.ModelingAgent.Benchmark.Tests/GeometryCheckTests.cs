using System.Text.Json;
using System.Text.Json.Nodes;
using Kreoda.ModelingAgent.Benchmark;
using Xunit;
namespace Kreoda.ModelingAgent.Benchmark.Tests;
public class GeometryCheckTests
{
    static JsonElement J(string json) => JsonSerializer.Deserialize<JsonElement>(json);
    static readonly JsonElement Fixture = J("""{"id":"centered-hole-plate","bboxSizeMm":[100,80,5],"volumeMm3":39607.30091830128,"holes":[{"centerXY":[50,40],"radiusMm":5}]}""");
    static readonly JsonElement Model = J("""{"features":[{"featureId":"hole","type":"Hole"}],"sketches":[],"bodies":[{"bodyId":"body","tipFeatureId":"hole"}],"requestActive":false}""");
    static readonly JsonElement Valid = J("""{"valid":true,"checks":[{"ok":true}]}""");
    static readonly JsonElement Bounds = J("""{"bboxMm":[0,0,0,100,80,5],"volumeMm3":39607.30091830128}""");
    static readonly JsonElement Faces = J("""{"faces":[{"surfaceType":"cylinder","orientation":"reversed","axis":[0,0,1],"originMm":[50,40,0],"radiusMm":5,"bboxMm":[45,35,0,55,45,5],"areaMm2":157.07963267948966}]}""");
    static JsonElement Change(JsonElement source, Action<JsonNode> edit) { var n=JsonNode.Parse(source.GetRawText())!;edit(n);return J(n.ToJsonString()); }
    [Fact] public void CorrectMeasuredPlatePasses() => Assert.Empty(GeometryCheck.Evaluate(Fixture,Model,Valid,Bounds,Faces));
    [Fact] public void EqualVolumeWrongHoleLocationFails() => Assert.Contains("holes",GeometryCheck.Evaluate(Fixture,Model,Valid,Bounds,Change(Faces,n=>n["faces"]![0]!["originMm"]![0]=40)));
    [Fact] public void ExtraDuplicateHoleDoesNotCountTwice() => Assert.Empty(GeometryCheck.Evaluate(Fixture,Model,Valid,Bounds,Change(Faces,n=>n["faces"]!.AsArray().Add(n["faces"]![0]!.DeepClone()))));
    [Fact] public void ExtraSolidFails() => Assert.Contains("one-visible-body",GeometryCheck.Evaluate(Fixture,Change(Model,n=>n["bodies"]!.AsArray().Add(n["bodies"]![0]!.DeepClone())),Valid,Bounds,Faces));
    [Fact] public void BlindHoleFails() => Assert.Contains("hole-through-depth",GeometryCheck.Evaluate(Fixture,Model,Valid,Bounds,Change(Faces,n=>n["faces"]![0]!["bboxMm"]![2]=1)));
    [Fact] public void MissingValidationIsFailure() => Assert.Contains("native-validation",GeometryCheck.Evaluate(Fixture,Model,J("{}"),Bounds,Faces));
    [Fact] public void MissingVolumeIsFailure() => Assert.Contains("volume",GeometryCheck.Evaluate(Fixture,Model,Valid,Change(Bounds,n=>n.AsObject().Remove("volumeMm3")),Faces));
    [Fact] public void ActiveTransactionFails() => Assert.Contains("committed",GeometryCheck.Evaluate(Fixture,Change(Model,n=>n["requestActive"]=true),Valid,Bounds,Faces));
    [Fact] public void OuterCylinderCannotBeHole() => Assert.Contains("holes",GeometryCheck.Evaluate(Fixture,Model,Valid,Bounds,Change(Faces,n=>n["faces"]![0]!["orientation"]="forward")));
    [Fact] public void InvalidReferenceFails() => Assert.Contains("native-validation",GeometryCheck.Evaluate(Fixture,Model,Change(Valid,n=>n["checks"]![0]!["ok"]=false),Bounds,Faces));
    [Fact] public void MissingInteriorPlaneFails() => Assert.Contains("interior-planes-x",GeometryCheck.Evaluate(Change(Fixture,n=>n["expectedPlaneCoordinates"]=JsonNode.Parse("{\"x\":[0,3,97,100]}")),Model,Valid,Bounds,Faces));
    [Fact] public void WrongTopAreaFails() => Assert.Contains("open-top-area",GeometryCheck.Evaluate(Change(Fixture,n=>n["topAreaMm2"]=1044),Model,Valid,Bounds,Faces));
    [Fact] public void MissingChamfersFails() => Assert.Contains("terminal-chamfers",GeometryCheck.Evaluate(Change(Fixture,n=>n["chamferDistanceMm"]=1),Model,Valid,Bounds,Faces));
    [Fact] public void NonNumericDimensionRejects() => Assert.Contains("bbox",GeometryCheck.Evaluate(Fixture,Model,Valid,Change(Bounds,n=>n["bboxMm"]![3]="unknown"),Faces));
    [Theory]
    [InlineData(0)] [InlineData(1)] [InlineData(2)] [InlineData(3)] [InlineData(4)] [InlineData(5)] [InlineData(6)]
    public void EveryFrozenFixtureHasPositiveAndWrongGeometryPredicates(int index) {
        // Analytic test doubles exercise predicates; they are never live passes.
        var bytes=File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory,"phase14-requirements.json"));
        Assert.Equal(FrozenRequirements.Sha256,FrozenRequirements.Verify(bytes));
        var fixture=J(System.Text.Encoding.UTF8.GetString(bytes)).GetProperty("fixtures")[index];
        var size=fixture.GetProperty("bboxSizeMm").EnumerateArray().Select(n=>n.GetDouble()).ToArray();
        var bbox=new[]{0d,0,0,size[0],size[1],size[2]};var faces=new List<object>();
        if(fixture.TryGetProperty("expectedPlaneCoordinates",out var planes))AddPlanes(planes);
        if(fixture.TryGetProperty("windowPlanes",out var window))AddPlanes(window);
        foreach(var hole in fixture.GetProperty("holes").EnumerateArray()) {
            var x=hole.GetProperty("centerXY")[0].GetDouble();var y=hole.GetProperty("centerXY")[1].GetDouble();var r=hole.GetProperty("radiusMm").GetDouble();
            faces.Add(new { surfaceType="cylinder",orientation="reversed",axis=new[]{0d,0,1},originMm=new[]{x,y,0},radiusMm=r,areaMm2=1,bboxMm=new[]{x-r,y-r,0,x+r,y+r,index==5?2:size[2]} });
        }
        if(fixture.TryGetProperty("chamferDistanceMm",out var chamfer)) {
            var d=chamfer.GetDouble();
            foreach(var z in new[]{0d,size[2]-d})faces.Add(new { surfaceType="cone",axis=new[]{0d,0,1},semiAngleDeg=45,areaMm2=1,bboxMm=new[]{0d,0,z,size[0],size[1],z+d} });
        }
        var actualBounds=JsonSerializer.SerializeToElement(new { bboxMm=bbox,volumeMm3=fixture.GetProperty("volumeMm3").GetDouble() });
        var actualFaces=JsonSerializer.SerializeToElement(new { faces });
        Assert.Empty(GeometryCheck.Evaluate(fixture,Model,Valid,actualBounds,actualFaces));
        Assert.Contains("bbox",GeometryCheck.Evaluate(fixture,Model,Valid,Change(actualBounds,n=>n["bboxMm"]![3]=size[0]+1),actualFaces));
        void AddPlanes(JsonElement required) {
            foreach(var p in required.EnumerateObject())foreach(var c in p.Value.EnumerateArray()) {
                var i=p.Name=="x"?0:p.Name=="y"?1:2;var normal=new double[3];normal[i]=1;var origin=new double[3];origin[i]=c.GetDouble();
                var area=i==2&&Math.Abs(origin[2]-size[2])<.001&&fixture.TryGetProperty("topAreaMm2",out var top)?top.GetDouble():1;
                faces.Add(new { surfaceType="plane",normal,originMm=origin,areaMm2=area,bboxMm=bbox });
            }
        }
    }
}
