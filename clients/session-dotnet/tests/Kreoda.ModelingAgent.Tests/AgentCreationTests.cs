using System.Text.Json;
using Xunit;

namespace Kreoda.ModelingAgent.Tests;

public sealed class AgentCreationTests
{
    [Fact]
    public void MultipleFeatureCreationIsBudgetedBeforeAnyAction()
    {
        using var schema = JsonDocument.Parse("""{"commands":[{"id":"ServerPattern","nativeType":123,"creation":{"idArrayParameter":"newIds"},"parameters":{"type":"object","properties":{"newIds":{"type":"array","items":{"type":"string"}}}}}]}""");
        using var args = JsonDocument.Parse("""{"newIds":["new-1","new-2"]}""");
        var command = AgentCommandCatalog.FromReply(schema.RootElement).Require("ServerPattern");
        Assert.Equal(2, command.CreatedFeatureCount(args.RootElement));
        var budget = new AgentBudget(new AgentLimits(maxFeatures: 1));
        Assert.Throws<AgentBudgetExceededException>(() => budget.Action(command.CreatedFeatureCount(args.RootElement)));
        Assert.Equal(0, budget.Actions);
        Assert.Equal(0, budget.CreatedFeatures);
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("{\"newIds\":2}")]
    [InlineData("{\"newIds\":[]}")]
    [InlineData("{\"newIds\":[1]}")]
    [InlineData("{\"newIds\":[\"same\",\"same\"]}")]
    public void InvalidCreationInputsFailBeforeMutation(string input)
    {
        using var schema = JsonDocument.Parse("""{"commands":[{"id":"ServerPattern","nativeType":123,"creation":{"idArrayParameter":"newIds"},"parameters":{"type":"object","properties":{"newIds":{"type":"array","items":{"type":"string"}}}}}]}""");
        using var args = JsonDocument.Parse(input);
        Assert.Throws<ArgumentException>(() => AgentCommandCatalog.FromReply(schema.RootElement).Require("ServerPattern").CreatedFeatureCount(args.RootElement));
    }

    [Fact]
    public void MissingCreationMetadataCannotBeAssumedToCreateZeroFeatures()
    {
        using var schema = JsonDocument.Parse("""{"commands":[{"id":"ServerCreate","nativeType":123,"parameters":{"type":"object"}}]}""");
        using var args = JsonDocument.Parse("{}");
        Assert.Throws<ArgumentException>(() => AgentCommandCatalog.FromReply(schema.RootElement).Require("ServerCreate").CreatedFeatureCount(args.RootElement));
    }
}
