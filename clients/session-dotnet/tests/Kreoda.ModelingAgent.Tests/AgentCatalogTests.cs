using System.Text.Json;
using Xunit;

namespace Kreoda.ModelingAgent.Tests;

public sealed class AgentCatalogTests
{
    [Theory]
    [InlineData("anyOf")]
    [InlineData("oneOf")]
    public void ObjectParameterUnionsFromThePcRemainExecutableAndUnchanged(string union)
    {
        using var schema=JsonDocument.Parse("{\""+union+"\":[{\"type\":\"object\",\"properties\":{\"kind\":{\"const\":\"ground\"}},\"required\":[\"kind\"]},{\"type\":\"object\",\"properties\":{\"kind\":{\"const\":\"distance\"},\"distanceMm\":{\"type\":\"number\"}},\"required\":[\"kind\",\"distanceMm\"]}]}");
        var definition=JsonSerializer.SerializeToElement(new {commands=new[] {new {id="DefineAssemblyConstraint",nativeType=123,
            creation=new {fixedCount=0},parameters=schema.RootElement}}});
        var command=AgentCommandCatalog.FromReply(definition).Require("DefineAssemblyConstraint");
        Assert.Equal(schema.RootElement.GetRawText(),command.Parameters.GetRawText());
        Assert.Equal(0,command.CreatedFeatureCount(JsonSerializer.SerializeToElement(new {kind="ground"})));
    }

    [Theory]
    [InlineData("{\"anyOf\":[]}")]
    [InlineData("{\"anyOf\":[{\"type\":\"string\"}]}")]
    [InlineData("{\"oneOf\":[{\"type\":\"object\"},{\"type\":\"array\"}]}")]
    [InlineData("{\"anyOf\":{\"type\":\"object\"}}")]
    [InlineData("{\"anyOf\":[true]}")]
    public void InvalidObjectParameterUnionsRemainRejected(string input)
    {
        using var schema=JsonDocument.Parse(input);
        var definition=JsonSerializer.SerializeToElement(new {commands=new[] {new {id="BadUnion",nativeType=123,
            creation=new {fixedCount=0},parameters=schema.RootElement}}});
        Assert.Throws<ArgumentException>(()=>AgentCommandCatalog.FromReply(definition));
    }

    [Fact]
    public void CommandsComeOnlyFromRuntimeSchemasAndHistoryIsExcluded()
    {
        using var json = JsonDocument.Parse("""{"commands":[{"id":"NewServerCommand","nativeType":123,"description":"server defined","creation":{"fixedCount":0},"parameters":{"type":"object","properties":{"distanceMm":{"type":"number"}}}},{"id":"Undo","nativeType":8,"description":"undo","parameters":{"type":"object"}}]}""");
        var catalog = AgentCommandCatalog.FromReply(json.RootElement);
        Assert.Equal("server defined", catalog.Commands.Single().Description);
        Assert.True(catalog.Commands.Single().Parameters.GetProperty("properties").TryGetProperty("distanceMm", out _));
        Assert.Throws<ArgumentException>(() => catalog.Require("CreateBox"));
        Assert.Throws<ArgumentException>(() => catalog.Require("Undo"));
    }

    [Theory]
    [InlineData("invoke")]
    [InlineData("txnForceRollback")]
    [InlineData("setSelection")]
    [InlineData("authenticate")]
    [InlineData("previewCommit")]
    public void ProviderCannotEscapeToControlOrMutationMethods(string method) =>
        Assert.False(AgentCommandCatalog.IsReadOnlyQuery(method));

    [Theory]
    [InlineData("findFaces")]
    [InlineData("validateReferences")]
    [InlineData("measureVolume")]
    [InlineData("measureInterferences")]
    [InlineData("measureMinimumThickness")]
    [InlineData("getParameters")]
    [InlineData("describeModel")]
    [InlineData("listCommands")]
    [InlineData("getCommandSchema")]
    [InlineData("getManipulators")]
    [InlineData("getSketchProjection")]
    [InlineData("resolveSurfacePoint")]
    public void RequiredIntrospectionMethodsAreAllowed(string method) =>
        Assert.True(AgentCommandCatalog.IsReadOnlyQuery(method));

    [Theory]
    [InlineData("{\"commands\":[{\"id\":\"x\",\"nativeType\":1,\"parameters\":null}]}")]
    [InlineData("{\"commands\":[{\"id\":\"x\",\"nativeType\":123,\"parameters\":{\"type\":\"object\"}},{\"id\":\"x\",\"nativeType\":123,\"parameters\":{\"type\":\"object\"}}]}")]
    [InlineData("{\"commands\":[{\"id\":\"x\",\"nativeType\":\"123\",\"parameters\":{\"type\":\"object\"}}]}")]
    [InlineData("{\"commands\":[{\"id\":\"x\",\"nativeType\":123,\"parameters\":{\"type\":1}}]}")]
    public void MalformedOrDuplicateRuntimeSchemasFailClosed(string input)
    {
        using var json = JsonDocument.Parse(input);
        Assert.Throws<ArgumentException>(() => AgentCommandCatalog.FromReply(json.RootElement));
    }
}
