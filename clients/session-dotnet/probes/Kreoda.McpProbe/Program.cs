using System.Text.Json;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;

void Check(bool value, string message) { if (!value) throw new InvalidOperationException(message); }
await using var transport = new HttpClientTransport(new() { Endpoint = new Uri(Environment.GetEnvironmentVariable("KREODA_MCP_PROBE_URL")!) });
await using var client = await McpClient.CreateAsync(transport);
async Task<JsonElement> Tool(string name, Dictionary<string, object?> arguments)
{
    var response = await client.CallToolAsync(name, arguments);Check(response.IsError != true, name + " returned a tool error: " +
        string.Join(" ", response.Content.OfType<TextContentBlock>().Select(c => c.Text)));
    using var json = JsonDocument.Parse(response.Content.OfType<TextContentBlock>().Single().Text);return json.RootElement.Clone();
}
var tools = await client.ListToolsAsync();Check(tools.Count == 7, "MCP discovery did not expose the actual CAD tools");
var resource = await client.ReadResourceAsync("kreoda://project");Check(resource.Contents.OfType<TextResourceContents>().Single().Text.Contains("Hermes owns"), "project resource missing");
var schemas = await Tool("kreoda_query", new() { ["method"] = "getCommandSchema", ["parameters"] = new Dictionary<string, object?>() });
Check(schemas.GetProperty("commands").EnumerateArray().Single(c => c.GetProperty("id").GetString() == "CreateBox").GetProperty("creation").GetProperty("fixedCount").GetInt32() == 1, "runtime creation metadata missing");
var opened = await Tool("kreoda_begin_request", new() { ["goal"] = "Plate 100 by 50 by 20 mm", ["checks"] = new[] {
    new { method = "measureVolume", parameters = new Dictionary<string, object?> { ["bodyId"] = "$plate" }, path = "volumeMm3", expected = 100000d, tolerance = .01 },
} });
var request = opened.GetProperty("requestId").GetString();
var created = await Tool("kreoda_command", new() { ["requestId"] = request, ["commandId"] = "CreateBox", ["newFeatureAlias"] = "plate",
    ["parameters"] = new Dictionary<string, object?> { ["widthMm"] = 100d, ["heightMm"] = 50d, ["depthMm"] = 20d } });
var committed = await Tool("kreoda_commit_request", new() { ["requestId"] = request });
Check(committed.GetProperty("status").GetString() == "committed", "MCP group not committed");
var id = created.GetProperty("featureId").GetString();
var measured = await Tool("kreoda_query", new() { ["method"] = "measureVolume", ["parameters"] = new Dictionary<string, object?> { ["featureId"] = id } });
Check(Math.Abs(measured.GetProperty("volumeMm3").GetDouble() - 100000) < .01, "actual native measure differs");
Console.WriteLine(JsonSerializer.Serialize(new { passed = new[] { "official-mcp-http-discovery-and-project-context", "runtime-command-schema-and-creation-budget", "native-canonical-checked-transaction" }, featureId = id,
    finalRevision = committed.GetProperty("result").GetProperty("revision").GetInt64(), measuredVolumeMm3 = measured.GetProperty("volumeMm3").GetDouble(),
    boundary = "Official MCP SDK to actual OCCT via SessionClient; not yet a live Hermes Agent or headset voice test." }));
