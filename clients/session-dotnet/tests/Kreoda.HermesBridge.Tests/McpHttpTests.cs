using System.Text.Json;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;
using Xunit;

namespace Kreoda.HermesBridge.Tests;

public sealed class McpHttpTests
{
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
            Assert.Equal(7, tools.Count);
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
