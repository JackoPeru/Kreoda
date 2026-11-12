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
    public void MissingCalibrationAmbiguousOrUnregisteredNativeWorkflowFailsClosed()
    {
        Assert.Throws<ArgumentOutOfRangeException>(()=>ReferenceReconstruction.Rectangle(new("ref",0,100),new(0,0,100,100),5,Catalog(),Fence()));
        Assert.Throws<ArgumentOutOfRangeException>(()=>ReferenceReconstruction.Rectangle(new("ref",100,100),new(100,0,10,100),5,Catalog(),Fence()));
        Assert.Throws<ArgumentException>(()=>ReferenceReconstruction.Rectangle(new("ref",100,100),new(0,0,100,100),5,Catalog(false),Fence()));
    }
}
