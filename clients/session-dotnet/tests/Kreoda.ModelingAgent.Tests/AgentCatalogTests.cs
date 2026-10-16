using System.Text.Json;
using Xunit;

namespace Kreoda.ModelingAgent.Tests;

public sealed class AgentCatalogTests
{
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
    [InlineData("getParameters")]
    [InlineData("describeModel")]
    [InlineData("listCommands")]
    [InlineData("getCommandSchema")]
    [InlineData("getManipulators")]
    [InlineData("getSketchProjection")]
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
