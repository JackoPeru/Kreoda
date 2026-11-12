using System.Text.Json;
using Xunit;

namespace Kreoda.ModelingAgent.Tests;

public sealed class NativeFixturePlansTests
{
    static AgentCommandCatalog Catalog(params string[] unavailable)
    {
        var commands = new[] { ("CreateBox",3),("CreateCylinder",4),("CreateHole",20),
            ("CreateSketch",13),("CreateExtrude",15),("CreateBoolean",19),
            ("CreateDatumPlane",31),("CreateChamfer",22),("SetBodyVisibility",44) }
            .Where(c=>!unavailable.Contains(c.Item1))
            .Select(c=>new {id=c.Item1,nativeType=c.Item2,creation=new {fixedCount=c.Item1=="SetBodyVisibility"?0:1},
                parameters=new {type="object",properties=c.Item1 switch {
                    "CreateSketch" => new Dictionary<string,object>{{"model",new {type="object"}}},
                    "CreateExtrude" => new Dictionary<string,object>{{"sketchId",new {type="string"}},{"distanceMm",new {type="number"}}},
                    _ => new Dictionary<string,object>()}}}).ToArray();
        return AgentCommandCatalog.FromReply(JsonSerializer.SerializeToElement(new {commands}));
    }

    [Theory]
    [InlineData("centered-hole-plate",2)]
    [InlineData("u-bracket",2)]
    [InlineData("six-hole-flange",7)]
    [InlineData("hollow-box",6)]
    [InlineData("chamfered-shaft",2)]
    [InlineData("simple-enclosure",8)]
    [InlineData("mounting-plate",6)]
    public void FrozenNativeFixturePlansUseOnlyRegisteredCommandsAndUniqueAliases(string fixtureId,int count)
    {
        // The actual geometric outcome is checked separately against the OCCT kernel.
        var plan=NativeFixturePlans.Build(fixtureId,Catalog());
        Assert.Equal(count,plan.Steps.Count);
        Assert.All(plan.Steps.Where(s=>s.CommandId!="SetBodyVisibility"),s=>Assert.True(!string.IsNullOrWhiteSpace(s.Alias)));
        Assert.Equal(plan.Steps.Count(s=>s.Alias is not null),plan.Steps.Where(s=>s.Alias is not null).Select(s=>s.Alias).Distinct().Count());
        Assert.All(plan.Steps,s=>Catalog().Require(s.CommandId));
    }

    [Fact]
    public void MissingNativeCommandAndUnknownFrozenFixtureFailClosed()
    {
        Assert.Throws<ArgumentException>(()=>NativeFixturePlans.Build("centered-hole-plate",Catalog("CreateHole")));
        Assert.Throws<ArgumentException>(()=>NativeFixturePlans.Build("made-up-benchmark",Catalog()));
    }
}
