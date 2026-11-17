using System.Text.Json;
using Xunit;

namespace Kreoda.ModelingAgent.Tests;

public sealed class SketchConstraintSuggestionsTests
{
    static AgentCommandCatalog Catalog(bool supportsUpdate)
    {
        var command = supportsUpdate ? """{"id":"UpdateSketch","nativeType":14,"creation":{"fixedCount":0},"parameters":{"type":"object","properties":{"featureId":{"type":"string"},"model":{"type":"object"}}}}""" :
            """{"id":"CreateBox","nativeType":3,"creation":{"fixedCount":1},"parameters":{"type":"object"}}""";
        using var schema = JsonDocument.Parse("{\"commands\":["+command+"]}");return AgentCommandCatalog.FromReply(schema.RootElement);
    }
    static JsonElement Sketch() => JsonSerializer.SerializeToElement(new {
        points = new[] { new { id="a", x=0d,y=0d },new { id="b", x=10d,y=0d },new { id="c", x=0d,y=10d },
            new { id="d", x=10d,y=10d },new { id="middle",x=5d,y=0d } },
        lines = new[] { new {id="horizontal1",p1="a",p2="b"},new {id="horizontal2",p1="c",p2="d"},
            new {id="vertical",p1="a",p2="c"} },
        circles = new[] { new { id="c1",center="a",r=3d },new {id="c2",center="d",r=3d} },
        arcs=Array.Empty<object>(), constraints=Array.Empty<object>(),
    });

    [Fact]
    public void FindsFiveRelationshipsWithoutMutatingTheSource()
    {
        var source=Sketch();var original=source.GetRawText();
        var result=SketchConstraintSuggestions.Infer(Guid.NewGuid().ToString(),source,Catalog(true));
        Assert.Contains(result,r=>r.Kind=="parallel" && r.CanAccept);
        Assert.Contains(result,r=>r.Kind=="perpendicular" && r.CanAccept);
        Assert.Contains(result,r=>r.Kind=="equalRadius" && r.CanAccept);
        Assert.Contains(result,r=>r.Kind=="equal-length" && !r.CanAccept);
        Assert.Contains(result,r=>r.Kind=="midpoint" && !r.CanAccept);
        Assert.Equal(original,source.GetRawText());
        var typed=Assert.Single(result,r=>r.Kind=="equalRadius").AcceptedCommand!;
        Assert.Equal("UpdateSketch",Assert.Single(typed.Steps).CommandId);
        Assert.Single(Assert.Single(typed.Steps).Parameters.GetProperty("model").GetProperty("constraints").EnumerateArray());
    }

    [Fact]
    public void UnsupportedCatalogOnlyOffersAdvisorySuggestions()
    {
        var result=SketchConstraintSuggestions.Infer(Guid.NewGuid().ToString(),Sketch(),Catalog(false));
        Assert.NotEmpty(result);
        Assert.All(result,r=>Assert.Null(r.AcceptedCommand));
    }

    [Fact]
    public void ExistingConstraintSuppressesDuplicateAndBrokenLineFailsClosed()
    {
        var model=Sketch();
        var fields=JsonSerializer.Deserialize<Dictionary<string,JsonElement>>(model.GetRawText())!;
        fields["constraints"]=JsonSerializer.SerializeToElement(new[] { new { id="existing",kind="parallel",refs=new[] {"horizontal1","horizontal2"},value=0 } });
        Assert.DoesNotContain(SketchConstraintSuggestions.Infer(Guid.NewGuid().ToString(),JsonSerializer.SerializeToElement(fields),Catalog(true)),
            r=>r.Kind=="parallel" && r.References.Contains("horizontal1") && r.References.Contains("horizontal2"));
        fields["lines"]=JsonSerializer.SerializeToElement(new[] {new {id="broken",p1="unknown",p2="a"}});
        Assert.Throws<ArgumentException>(()=>SketchConstraintSuggestions.Infer(Guid.NewGuid().ToString(),JsonSerializer.SerializeToElement(fields),Catalog(true)));
    }

    [Fact]
    public void MirroredPointsYieldTypedPersistentConstraintWithSelectionFence()
    {
        var sketchId="sk-df825bf1-e9a9-45e0-b9f6-23eb6c705804";
        var model=JsonSerializer.SerializeToElement(new {
            points=new[] {new {id="a",x=-10d,y=5d},new {id="b",x=10d,y=5d},
                new {id="up",x=0d,y=0d},new {id="down",x=0d,y=20d}},
            lines=new[] {new {id="axis",p1="up",p2="down"}},
            circles=Array.Empty<object>(),arcs=Array.Empty<object>(),
            constraints=new[] {new {id="existing",kind="coincident",refs=new[] {"a","up"},value=0d}}});
        var fence=new GeneratedCadSelectionFence("session","document",5);
        var suggestion=Assert.Single(SketchConstraintSuggestions.Infer(sketchId,model,Catalog(true),selectionFence:fence),
            s=>s.Kind=="symmetric");
        Assert.True(suggestion.CanAccept);
        Assert.Equal(new[] {"a","b","axis"},suggestion.References);
        var accepted=suggestion.AcceptedCommand!;
        Assert.Equal(fence,accepted.SelectionFence);
        var update=Assert.Single(accepted.Steps).Parameters;
        Assert.Equal(sketchId,update.GetProperty("featureId").GetString());
        var updatedModel=update.GetProperty("model");
        Assert.Equal(4,updatedModel.GetProperty("points").GetArrayLength());
        Assert.Equal("a",updatedModel.GetProperty("points")[0].GetProperty("id").GetString());
        Assert.Equal("axis",updatedModel.GetProperty("lines")[0].GetProperty("id").GetString());
        var persistedConstraints=updatedModel.GetProperty("constraints");
        Assert.Equal(2,persistedConstraints.GetArrayLength());
        Assert.Contains(persistedConstraints.EnumerateArray(),c=>c.GetProperty("id").GetString()=="existing");
        var persisted=Assert.Single(persistedConstraints.EnumerateArray(),c=>c.GetProperty("kind").GetString()=="symmetric");
        Assert.Equal("symmetric",persisted.GetProperty("kind").GetString());
        Assert.Equal(0,persisted.GetProperty("value").GetDouble());
    }

    [Fact]
    public void InvalidStableSketchIdsAreRejected()
    {
        var invalidIds = new string?[] { null, "", new string('x', 129), "caf\u00e9", "bad:id", "bad/id", "bad id" };
        foreach (var id in invalidIds)
            Assert.Throws<ArgumentException>(() => SketchConstraintSuggestions.Infer(id!, Sketch(), Catalog(true)));
    }

    [Fact]
    public void MultipleValidMirrorAxesNeverAutoOfferExecutableRelation()
    {
        var model=JsonSerializer.SerializeToElement(new {
            points=new[] {new {id="a",x=-10d,y=5d},new {id="b",x=10d,y=5d},
                new {id="u",x=0d,y=0d},new {id="v",x=0d,y=20d},
                new {id="c",x=0d,y=-10d},new {id="d",x=0d,y=30d}},
            lines=new[] {new {id="axis1",p1="u",p2="v"},new {id="axis2",p1="c",p2="d"}},
            circles=Array.Empty<object>(),arcs=Array.Empty<object>(),constraints=Array.Empty<object>()});
        var suggestions=SketchConstraintSuggestions.Infer(Guid.NewGuid().ToString("D"),model,Catalog(true));
        Assert.DoesNotContain(suggestions,s=>s.Kind=="symmetric" && s.References.Contains("a"));
        Assert.Contains(suggestions,s=>s.Kind=="symmetric-ambiguous" && !s.CanAccept);
    }
}
