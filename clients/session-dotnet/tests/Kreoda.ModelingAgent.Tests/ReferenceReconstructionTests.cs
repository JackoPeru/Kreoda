using System.Text.Json;
using Xunit;

namespace Kreoda.ModelingAgent.Tests;

public sealed class ReferenceReconstructionTests
{
    static AgentCommandCatalog Catalog(bool extrude=true) {
        var commands=new List<object>{new {id="CreateSketch",nativeType=13,creation=new {fixedCount=1},parameters=new {
            type="object",properties=new Dictionary<string,object>{{"model",new {type="object"}}}}}};
        if(extrude) commands.Add(new {id="CreateExtrude",nativeType=15,creation=new {fixedCount=1},parameters=new {
            type="object",properties=new Dictionary<string,object>{{"sketchId",new {type="string"}},{"distanceMm",new {type="number"}}}}});
        return AgentCommandCatalog.FromReply(JsonSerializer.SerializeToElement(new {commands}));
    }
    static GeneratedCadSelectionFence Fence()=>new("session","document",8);
    [Fact]
    public void CalibratedManuallyTracedRectangleYieldsEditableNativeSketchAndExtrusion()
    {
        var p=ReferenceReconstruction.Rectangle(new("reference-1",200,100),new(10,20,170,100),8,Catalog(),Fence());
        Assert.Equal(Fence(),p.SelectionFence);
        Assert.Equal(new[]{"CreateSketch","CreateExtrude"},p.Steps.Select(s=>s.CommandId));
        var points=p.Steps[0].Parameters.GetProperty("model").GetProperty("points");
        Assert.Equal(80,points[1].GetProperty("x").GetDouble());
        Assert.Equal(40,points[2].GetProperty("y").GetDouble());
        Assert.Equal(8,p.Steps[1].Parameters.GetProperty("distanceMm").GetDouble());
        Assert.Equal("$referenceSketch",p.Steps[1].Parameters.GetProperty("sketchId").GetString());
        Assert.Contains("No unverified image inference",p.Description);
    }
    [Fact]
    public void NonzeroImagePixelOffsetOnlyControlsExtentNotUncalibratedSketchPlacement()
    {
        var first=ReferenceReconstruction.Rectangle(new("ref",200,100),new(10,20,170,100),8,Catalog(),Fence());
        var shifted=ReferenceReconstruction.Rectangle(new("ref",200,100),new(510,320,670,400),8,Catalog(),Fence());
        var firstModel=first.Steps[0].Parameters.GetProperty("model");
        var shiftedModel=shifted.Steps[0].Parameters.GetProperty("model");
        Assert.Equal(firstModel.GetRawText(),shiftedModel.GetRawText());

        var points=firstModel.GetProperty("points");
        Assert.Equal(4,points.GetArrayLength());
        Assert.Equal(0d,points[0].GetProperty("x").GetDouble());
        Assert.Equal(0d,points[0].GetProperty("y").GetDouble());
        Assert.True(points[0].GetProperty("fixed").GetBoolean());
        Assert.Equal(80d,points[1].GetProperty("x").GetDouble());
        Assert.Equal(40d,points[2].GetProperty("y").GetDouble());
        Assert.Equal(0d,points[3].GetProperty("x").GetDouble());

        // These wire kinds and reference shapes are accepted by native sketch_json and PlaneGCS.
        var constraints=firstModel.GetProperty("constraints");
        Assert.Equal(6,constraints.GetArrayLength());
        Assert.Equal(new[]{"horizontal","vertical","horizontal","vertical","distance","distance"},
            constraints.EnumerateArray().Select(c=>c.GetProperty("kind").GetString()));
        Assert.Equal(new[]{"l0","l1","l2","l3"},
            constraints.EnumerateArray().Take(4).Select(c=>c.GetProperty("refs")[0].GetString()));
        Assert.Equal(new[]{"p0","p1"},constraints[4].GetProperty("refs").EnumerateArray().Select(r=>r.GetString()));
        Assert.Equal(new[]{"p1","p2"},constraints[5].GetProperty("refs").EnumerateArray().Select(r=>r.GetString()));
        Assert.Equal(80d,constraints[4].GetProperty("value").GetDouble());
        Assert.Equal(40d,constraints[5].GetProperty("value").GetDouble());
        Assert.Equal(6,constraints.EnumerateArray().Select(c=>c.GetProperty("id").GetString()).Distinct().Count());
        Assert.Contains("local sketch origin",first.Description);
    }
    [Fact]
    public void InvalidImageMeasurementsAndGeometryFailClosed()
    {
        var valid=new ReferenceCalibration("ref",200,100);
        var rect=new ReferenceRectangle(10,20,170,100);
        Assert.Throws<ArgumentOutOfRangeException>(()=>ReferenceReconstruction.Rectangle(valid,new(-1,20,170,100),8,Catalog(),Fence()));
        Assert.Throws<ArgumentOutOfRangeException>(()=>ReferenceReconstruction.Rectangle(valid,new(10,20,100001,100),8,Catalog(),Fence()));
        Assert.Throws<ArgumentOutOfRangeException>(()=>ReferenceReconstruction.Rectangle(valid,new(10,20,10,100),8,Catalog(),Fence()));
        Assert.Throws<ArgumentOutOfRangeException>(()=>ReferenceReconstruction.Rectangle(valid,new(10,20,double.NaN,100),8,Catalog(),Fence()));
        Assert.Throws<ArgumentOutOfRangeException>(()=>ReferenceReconstruction.Rectangle(new("ref",double.PositiveInfinity,100),rect,8,Catalog(),Fence()));
        Assert.Throws<ArgumentOutOfRangeException>(()=>ReferenceReconstruction.Rectangle(new("ref",1,100000),rect,8,Catalog(),Fence()));
        Assert.Throws<ArgumentOutOfRangeException>(()=>ReferenceReconstruction.Rectangle(valid,rect,0,Catalog(),Fence()));
        Assert.Throws<ArgumentOutOfRangeException>(()=>ReferenceReconstruction.Rectangle(valid,rect,double.NaN,Catalog(),Fence()));
    }
    [Fact]
    public void InvalidIdentityFenceOrNativeCatalogFailClosed()
    {
        var valid=new ReferenceCalibration("ref",200,100);
        var rect=new ReferenceRectangle(10,20,170,100);
        Assert.Throws<ArgumentException>(()=>ReferenceReconstruction.Rectangle(new("bad source",200,100),rect,8,Catalog(),Fence()));
        Assert.Throws<ArgumentException>(()=>ReferenceReconstruction.Rectangle(valid,rect,8,Catalog(),new("", "document",8)));
        Assert.Throws<ArgumentException>(()=>ReferenceReconstruction.Rectangle(valid,rect,8,Catalog(),new("session", "",8)));
        Assert.Throws<ArgumentException>(()=>ReferenceReconstruction.Rectangle(valid,rect,8,Catalog(),new("session", "document",-1)));
        Assert.Throws<ArgumentException>(()=>ReferenceReconstruction.Rectangle(valid,rect,8,Catalog(false),Fence()));
    }
    [Fact]
    public void MissingCalibrationAmbiguousOrUnregisteredNativeWorkflowFailsClosed()
    {
        Assert.Throws<ArgumentOutOfRangeException>(()=>ReferenceReconstruction.Rectangle(new("ref",0,100),new(0,0,100,100),5,Catalog(),Fence()));
        Assert.Throws<ArgumentOutOfRangeException>(()=>ReferenceReconstruction.Rectangle(new("ref",100,100),new(100,0,10,100),5,Catalog(),Fence()));
        Assert.Throws<ArgumentException>(()=>ReferenceReconstruction.Rectangle(new("ref",100,100),new(0,0,100,100),5,Catalog(false),Fence()));
    }
}
