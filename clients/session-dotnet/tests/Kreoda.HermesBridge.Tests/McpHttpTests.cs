using System.Text.Json;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;
using Xunit;

namespace Kreoda.HermesBridge.Tests;

public sealed class McpHttpTests
{
    [Fact]
    public async Task IntentProposalToolIsDiscoverableOverHttp()
    {
        await using var wire = new CadBridgeTests.Wire();await using var session = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(session));
        await using var app = BridgeHost.Build(bridge, "http://127.0.0.1:0");
        await app.StartAsync();
        try {
            await using var transport = new HttpClientTransport(new() { Endpoint = new Uri(app.Urls.Single() + "/mcp") });
            await using var client = await McpClient.CreateAsync(transport);
            var tools = await client.ListToolsAsync();
            Assert.Equal(8, tools.Count);
            var proposal = Assert.Single(tools, tool => tool.Name == "kreoda_propose_intent");
            var request = proposal.JsonSchema.GetProperty("properties").GetProperty("request");
            Assert.Equal("object", request.GetProperty("type").GetString());
            Assert.Contains("kind", request.GetProperty("required").EnumerateArray().Select(value => value.GetString()));
            Assert.Contains("expectedContext", request.GetProperty("required").EnumerateArray().Select(value => value.GetString()));
            var kind = request.GetProperty("properties").GetProperty("kind");
            Assert.Equal("string", kind.GetProperty("type").GetString());
            Assert.Equal(new[] { "mountingBlank", "lBracket", "uBracket", "openEnclosure", "connectParallelPlates", "inferHoles", "inferSketchConstraints" },
                kind.GetProperty("enum").EnumerateArray().Select(value => value.GetString()));
            var beginSchema = tools.Single(tool => tool.Name == "kreoda_begin_request").JsonSchema;
            Assert.True(beginSchema.GetProperty("properties").TryGetProperty("expectedContext", out _));
            Assert.DoesNotContain("expectedContext", beginSchema.GetProperty("required").EnumerateArray().Select(value => value.GetString()));
            var result = await client.CallToolAsync("kreoda_propose_intent", new Dictionary<string, object?> {
                ["request"] = new Dictionary<string, object?> {
                    ["kind"] = "mountingBlank",
                    ["expectedContext"] = new { sessionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", documentId = "doc-phase1", revision = 7 },
                    ["dimensions"] = new { widthMm = 100d, depthMm = 50d, thicknessMm = 8d },
                },
            });
            Assert.NotEqual(true, result.IsError);
            using var payload = JsonDocument.Parse(Assert.IsType<TextContentBlock>(result.Content.Single()).Text);
            Assert.Equal("proposed", payload.RootElement.GetProperty("status").GetString());
            Assert.Equal("CreateBox", payload.RootElement.GetProperty("options")[0].GetProperty("steps")[0].GetProperty("commandId").GetString());
            Assert.Equal(0, wire.Commands);
            Assert.Equal(0, wire.TxnBegins);

            async Task Reject(Dictionary<string, object?> arguments)
            {
                var invalid = await client.CallToolAsync("kreoda_propose_intent", arguments);
                Assert.True(invalid.IsError == true,
                    $"Unexpectedly accepted {JsonSerializer.Serialize(arguments)}: {string.Join(" | ", invalid.Content.OfType<TextContentBlock>().Select(block => block.Text))}");
            }
            var validContext = new { sessionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", documentId = "doc-phase1", revision = 7 };
            var validDimensions = new { widthMm = 100d, depthMm = 50d, thicknessMm = 8d };
            await Reject(new Dictionary<string, object?>());
            await Reject(new Dictionary<string, object?> { ["request"] = null });
            await Reject(new Dictionary<string, object?> { ["request"] = new { kind = "mountingBlank", expectedContext = (object?)null, dimensions = validDimensions } });
            await Reject(new Dictionary<string, object?> { ["request"] = new { kind = "mountingBlank", dimensions = validDimensions } });
            await Reject(new Dictionary<string, object?> { ["request"] = new { expectedContext = validContext, dimensions = validDimensions } });
            await Reject(new Dictionary<string, object?> { ["request"] = new { kind = 99, expectedContext = validContext, dimensions = validDimensions } });
            await Reject(new Dictionary<string, object?> { ["request"] = new { kind = 1, expectedContext = validContext, dimensions = validDimensions } });
            await Reject(new Dictionary<string, object?> { ["request"] = new { kind = "unknownKind", expectedContext = validContext } });
            await Reject(new Dictionary<string, object?> { ["request"] = new { kind = "mountingBlank", expectedContext = validContext, dimensions = validDimensions, extra = true } });
            await Reject(new Dictionary<string, object?> { ["request"] = new { kind = "mountingBlank", expectedContext = new { sessionId = validContext.sessionId, documentId = validContext.documentId, revision = validContext.revision, extra = true }, dimensions = validDimensions } });
            await Reject(new Dictionary<string, object?> { ["request"] = new { kind = "mountingBlank", expectedContext = validContext, dimensions = new { widthMm = 100d, depthMm = 50d, thicknessMm = 8d, heightMm = 20d } } });
            await Reject(new Dictionary<string, object?> { ["request"] = new { kind = "mountingBlank", expectedContext = validContext, dimensions = new { widthMm = 100d, depthMm = 50d, thicknessMm = 8d, extra = 1d } } });
            Assert.Equal(0, wire.Commands);Assert.Equal(0, wire.TxnBegins);Assert.Equal(0, wire.Rollbacks);
        } finally { await app.StopAsync(); }
    }

    [Fact]
    public async Task OfficialClientListsProjectContextAndRejectsRawInvokeThroughHttp()
    {
        await using var wire = new CadBridgeTests.Wire();await using var session = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(session));
        await using var app = BridgeHost.Build(bridge, "http://127.0.0.1:0");
        await app.StartAsync();
        try {
            await using var transport = new HttpClientTransport(new() { Endpoint = new Uri(app.Urls.Single() + "/mcp") });
            await using var client = await McpClient.CreateAsync(transport);
            var tools = await client.ListToolsAsync();
            Assert.Equal(8, tools.Count);
            Assert.Contains(tools, t => t.Name == "kreoda_begin_request");
            foreach (var name in new[] { "kreoda_query", "kreoda_command" }) {
                var parameters = tools.Single(t => t.Name == name).JsonSchema.GetProperty("properties").GetProperty("parameters");
                Assert.Equal(JsonValueKind.Object, parameters.ValueKind);
                Assert.Equal("object", parameters.GetProperty("type").GetString());
            }
            var resource = await client.ReadResourceAsync("kreoda://project");
            Assert.Contains("Hermes owns", Assert.IsType<TextResourceContents>(resource.Contents.Single()).Text);
            var description = await client.CallToolAsync("kreoda_describe_model", new Dictionary<string, object?>());
            Assert.NotEqual(true, description.IsError);
            using var info = JsonDocument.Parse(Assert.IsType<TextContentBlock>(description.Content.Single()).Text);
            Assert.Equal(7, info.RootElement.GetProperty("revision").GetInt64());
            var invalid = await client.CallToolAsync("kreoda_query", new Dictionary<string, object?> {
                ["method"] = "invoke", ["parameters"] = new Dictionary<string, object?> { ["type"] = 3 },
            });
            Assert.True(invalid.IsError);Assert.Equal(0, wire.Commands);
        } finally { await app.StopAsync(); }
    }
}
