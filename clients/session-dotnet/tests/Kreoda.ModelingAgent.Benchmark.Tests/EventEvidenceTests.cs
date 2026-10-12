using Kreoda.ModelingAgent.Benchmark;
using Xunit;
namespace Kreoda.ModelingAgent.Benchmark.Tests;
public class EventEvidenceTests
{
    [Fact] public void ParseNativeSseWithoutKeepingReasoning() {
        var events=EventEvidence.Parse(": open\n\nid: 0\ndata: {\"type\":\"reasoning.available\",\"text\":\"private\"}\n\nid: 1\ndata: {\"type\":\"tool.started\",\"tool\":\"mcp__kreoda__kreoda_command\"}\n\nid: 2\ndata: {\"type\":\"tool.completed\",\"error\":false}\n\n: stream closed\n\n");
        Assert.Equal(2,events.Length);Assert.DoesNotContain("private",string.Join("",events.Select(e=>e.GetRawText())));
    }
    [Fact] public void ReplayTruncationRemainsVisible() => Assert.Equal("replay.truncated",EventEvidence.Parse("data: {\"type\":\"replay.truncated\"}\r\n\r\n").Single().GetProperty("type").GetString());
    [Fact] public void InvalidEventCannotClaimComplete() => Assert.ThrowsAny<System.Text.Json.JsonException>(()=>EventEvidence.Parse("data: invalid\n\n"));
    [Theory]
    [InlineData("{\"type\":\"tool.started\",\"tool\":\"mcp__kreoda__kreoda_command\"}")]
    [InlineData("{\"type\":\"tool.started\",\"data\":{\"tool_name\":\"mcp__kreoda__kreoda_command\"}}")]
    public void CountersAndDisplayUseSameNameForBothPayloadForms(string json) =>
        Assert.Equal("mcp__kreoda__kreoda_command",EventEvidence.ToolName(EventEvidence.Parse("data: "+json+"\n\n").Single()));
}
