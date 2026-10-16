using System.Text.Json;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;

void Check(bool value, string message) { if (!value) throw new InvalidOperationException(message); }
var scenario = Environment.GetEnvironmentVariable("KREODA_MCP_PROBE_SCENARIO");
if (scenario == "projection-archive-break")
{
    var healthyPath = Environment.GetEnvironmentVariable("KREODA_PROJECTION_HEALTHY_FILE") ?? throw new InvalidOperationException("healthy archive path missing");
    var brokenPath = Environment.GetEnvironmentVariable("KREODA_PROJECTION_BROKEN_FILE") ?? throw new InvalidOperationException("broken archive path missing");
    Console.WriteLine(JsonSerializer.Serialize(ProjectionScenario.BreakPersistedProjectionBindingArchive(healthyPath, brokenPath)));
    return;
}
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
if (scenario == "mcp-preflight")
{
    Console.WriteLine(JsonSerializer.Serialize(new { scenario, status = "ready", tools = tools.Count }));
    return;
}
if (scenario == "projection" || scenario == "projection-repair")
{
    var proof = scenario == "projection"
        ? await ProjectionScenario.CreateAndExerciseAsync(client, Tool)
        : await ProjectionScenario.InspectAndRepairAsync(client, Tool);
    Console.WriteLine(JsonSerializer.Serialize(proof));
    return;
}
if (scenario == "datum")
{
    var definitions = schemas.GetProperty("commands");
    var expected = new[] { ("CreateDatumPlane", 31, 1), ("CreateDatumAxis", 32, 1), ("CreateDatumPoint", 33, 1), ("UpdateDatum", 34, 0), ("RequestDatum", 35, 0) };
    foreach (var (id, type, count) in expected)
    {
        var command = definitions.EnumerateArray().Single(c => c.GetProperty("id").GetString() == id);
        Check(command.GetProperty("nativeType").GetInt32() == type && command.GetProperty("creation").GetProperty("fixedCount").GetInt32() == count,
            $"actual {id} command metadata differs");
    }
    foreach (var (id, type) in new[] { ("CreateSketch", 13), ("CreateExtrude", 15) })
    {
        var command = definitions.EnumerateArray().Single(c => c.GetProperty("id").GetString() == id);
        Check(command.GetProperty("nativeType").GetInt32() == type && command.GetProperty("creation").GetProperty("fixedCount").GetInt32() == 1,
            $"actual {id} creation metadata differs");
    }
    var commandMetadata = expected.Select(item => {
        var command = definitions.EnumerateArray().Single(c => c.GetProperty("id").GetString() == item.Item1);
        return new { id = item.Item1, nativeType = command.GetProperty("nativeType").GetInt32(), creation = command.GetProperty("creation").Clone() };
    }).ToArray();

    var before = await Tool("kreoda_describe_model", new());
    var initialRevision = before.GetProperty("revision").GetInt64();
    Check(before.GetProperty("datums").GetArrayLength() == 0 && before.GetProperty("sketches").GetArrayLength() == 0 &&
        before.GetProperty("bodies").GetArrayLength() == 0 && !before.GetProperty("requestActive").GetBoolean(),
        "datum proof requires an isolated empty committed document");
    var opened = await Tool("kreoda_begin_request", new() { ["goal"] = "Create a 100 by 50 mm supported sketch on an XY datum at 24 mm and extrude 7 mm",
        ["checks"] = new[] { new { method = "measureVolume", parameters = new Dictionary<string, object?> { ["featureId"] = "$solid" },
            path = "volumeMm3", expected = 35000d, tolerance = .01 } } });
    var request = opened.GetProperty("requestId").GetString() ?? throw new InvalidOperationException("MCP request ID missing");
    var planeCreated = await Tool("kreoda_command", new() { ["requestId"] = request, ["commandId"] = "CreateDatumPlane", ["newFeatureAlias"] = "plane",
        ["parameters"] = new Dictionary<string, object?> { ["definition"] = new { type = "offset", @base = new { type = "principal", planeKind = "XY" }, offsetMm = 24d } } });
    var datumId = planeCreated.GetProperty("featureId").GetString() ?? throw new InvalidOperationException("Datum UUID missing");
    Check(Guid.TryParseExact(datumId, "D", out _), "native datum ID is not a real UUID");
    var sketchCreated = await Tool("kreoda_command", new() { ["requestId"] = request, ["commandId"] = "CreateSketch", ["newFeatureAlias"] = "sketch",
        ["parameters"] = new Dictionary<string, object?> { ["supportRef"] = "$plane", ["model"] = new {
            points = new[] { new { id = "p0", x = 0d, y = 0d, @fixed = false }, new { id = "p1", x = 100d, y = 0d, @fixed = false },
                new { id = "p2", x = 100d, y = 50d, @fixed = false }, new { id = "p3", x = 0d, y = 50d, @fixed = false } },
            lines = new[] { new { id = "l0", p1 = "p0", p2 = "p1" }, new { id = "l1", p1 = "p1", p2 = "p2" },
                new { id = "l2", p1 = "p2", p2 = "p3" }, new { id = "l3", p1 = "p3", p2 = "p0" } },
            circles = Array.Empty<object>(), arcs = Array.Empty<object>(), constraints = new[] {
                new { id = "h0", kind = "horizontal", refs = new[] { "l0" }, value = 0d },
                new { id = "h2", kind = "horizontal", refs = new[] { "l2" }, value = 0d },
                new { id = "v1", kind = "vertical", refs = new[] { "l1" }, value = 0d },
                new { id = "v3", kind = "vertical", refs = new[] { "l3" }, value = 0d },
                new { id = "dim-w", kind = "distance", refs = new[] { "p0", "p1" }, value = 100d },
                new { id = "dim-h", kind = "distance", refs = new[] { "p1", "p2" }, value = 50d },
            },
        } } });
    var sketchId = sketchCreated.GetProperty("featureId").GetString() ?? throw new InvalidOperationException("Sketch UUID missing");
    Check(Guid.TryParseExact(sketchId, "D", out _), "native sketch ID is not a real UUID");
    var solidCreated = await Tool("kreoda_command", new() { ["requestId"] = request, ["commandId"] = "CreateExtrude", ["newFeatureAlias"] = "solid",
        ["parameters"] = new Dictionary<string, object?> { ["sketchId"] = "$sketch", ["distanceMm"] = 7d } });
    var solidId = solidCreated.GetProperty("featureId").GetString() ?? throw new InvalidOperationException("Solid UUID missing");
    Check(Guid.TryParseExact(solidId, "D", out _) && new[] { datumId, sketchId, solidId }.Distinct().Count() == 3, "created feature IDs are not unique real UUIDs");
    var validation = await Tool("kreoda_query", new() { ["requestId"] = request, ["method"] = "validateDocument", ["parameters"] = new Dictionary<string, object?>() });
    var committed = await Tool("kreoda_commit_request", new() { ["requestId"] = request });
    if (committed.GetProperty("status").GetString() != "committed")
    {
        Console.WriteLine(JsonSerializer.Serialize(new {
            scenario = "datum", status = committed.GetProperty("status").GetString(), commandMetadata,
            featureIds = new { plane = datumId, sketch = sketchId, solid = solidId }, initialRevision,
            nativeValidation = validation, measurements = committed.GetProperty("measurements"),
            boundary = "Official MCP SDK reached actual native document validation; no commit or undo/redo proof on validation failure.",
        }));
        throw new InvalidOperationException($"MCP group status={committed.GetProperty("status").GetString()}; native validation={validation.GetRawText()}; measurements={committed.GetProperty("measurements").GetRawText()}");
    }
    var finalRevision = committed.GetProperty("result").GetProperty("revision").GetInt64();
    Check(finalRevision == initialRevision + 1, "MCP group did not produce one shared document revision");

    var datum = await Tool("kreoda_query", new() { ["method"] = "getDatum", ["parameters"] = new Dictionary<string, object?> { ["featureId"] = datumId } });
    Check(datum.GetProperty("featureId").GetString() == datumId && datum.GetProperty("kind").GetString() == "DatumPlane" && datum.GetProperty("status").GetString() == "ok",
        "native datum identity or status differs");
    var datumDefinition = datum.GetProperty("definition");
    Check(datumDefinition.GetProperty("type").GetString() == "offset" && datumDefinition.GetProperty("base").GetProperty("planeKind").GetString() == "XY" &&
        Math.Abs(datumDefinition.GetProperty("offsetMm").GetDouble() - 24) < 1e-9, "native datum definition differs");
    Check(Math.Abs(datum.GetProperty("resolved").GetProperty("originMm")[2].GetDouble() - 24) < 1e-9 &&
        Math.Abs(datum.GetProperty("resolved").GetProperty("normal")[2].GetDouble() - 1) < 1e-9, "native datum frame differs");

    var description = await Tool("kreoda_describe_model", new());
    for (var attempt = 0; attempt < 40 && description.GetProperty("revision").GetInt64() < finalRevision; attempt++)
    {
        await Task.Delay(50);
        description = await Tool("kreoda_describe_model", new());
    }
    Check(description.GetProperty("revision").GetInt64() == finalRevision,
        $"Describe model did not reach committed revision {finalRevision}: {description.GetRawText()}");
    var describedDatum = description.GetProperty("datums").EnumerateArray().Single(d => d.GetProperty("featureId").GetString() == datumId);
    Check(describedDatum.GetProperty("status").GetString() == "ok" && describedDatum.GetProperty("definition").GetProperty("type").GetString() == "offset",
        "Describe model omitted the real datum definition or status");
    var describedSketch = description.GetProperty("sketches").EnumerateArray().Single(s => s.GetProperty("featureId").GetString() == sketchId);
    var frame = describedSketch.GetProperty("plane");
    Check(describedSketch.GetProperty("supportRef").GetString() == datumId && describedSketch.GetProperty("points").GetInt32() == 4 &&
        describedSketch.GetProperty("lines").GetInt32() == 4 && Math.Abs(frame.GetProperty("origin")[2].GetDouble() - 24) < 1e-9 &&
        Math.Abs(frame.GetProperty("xAxis")[0].GetDouble() - 1) < 1e-9 && Math.Abs(frame.GetProperty("yAxis")[1].GetDouble() - 1) < 1e-9 &&
        Math.Abs(frame.GetProperty("normal")[2].GetDouble() - 1) < 1e-9, "Describe model omitted the supported sketch or full frame");

    var measured = await Tool("kreoda_query", new() { ["method"] = "measureVolume", ["parameters"] = new Dictionary<string, object?> { ["featureId"] = solidId } });
    var bounds = await Tool("kreoda_query", new() { ["method"] = "getBoundingBox", ["parameters"] = new Dictionary<string, object?> { ["featureId"] = solidId } });
    Check(Math.Abs(measured.GetProperty("volumeMm3").GetDouble() - 35000) < .01 && Math.Abs(bounds.GetProperty("volumeMm3").GetDouble() - 35000) < .01 &&
        bounds.GetProperty("solidCount").GetInt32() == 1 && Math.Abs(bounds.GetProperty("bboxMm")[2].GetDouble() - 24) < 1e-6 &&
        Math.Abs(bounds.GetProperty("bboxMm")[5].GetDouble() - 31) < 1e-6, "native committed B-Rep differs from expected volume or bounds");
    Console.WriteLine(JsonSerializer.Serialize(new {
        scenario = "datum", status = "committed",
        passed = new[] { "official-mcp-http-discovery-and-project-context", "actual-command-metadata31-35-and-creation-budget",
            "official-mcp-native-datum-sketch-solid-transaction", "committed-datum-description-frame-and-brep" },
        commandMetadata, featureIds = new { plane = datumId, sketch = sketchId, solid = solidId }, initialRevision, finalRevision,
        volumeMm3 = measured.GetProperty("volumeMm3").GetDouble(), solidCount = bounds.GetProperty("solidCount").GetInt32(), bboxMm = bounds.GetProperty("bboxMm"),
        datum, sketch = new { featureId = sketchId, supportRef = describedSketch.GetProperty("supportRef"), plane = frame, points = 4, lines = 4 },
        boundary = "Official MCP SDK to actual OCCT via SessionClient and local SessionRelay; Desktop undo/redo is verified by the hidden Electron E2E.",
    }));
}
else
{
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
var bounds = await Tool("kreoda_query", new() { ["method"] = "getBoundingBox", ["parameters"] = new Dictionary<string, object?>() });
Check(bounds.GetProperty("solidCount").GetInt32() == 1, "native B-Rep solid count differs");
Console.WriteLine(JsonSerializer.Serialize(new { passed = new[] { "official-mcp-http-discovery-and-project-context", "runtime-command-schema-and-creation-budget", "native-canonical-checked-transaction" }, featureId = id,
    finalRevision = committed.GetProperty("result").GetProperty("revision").GetInt64(), measuredVolumeMm3 = measured.GetProperty("volumeMm3").GetDouble(), solidCount = bounds.GetProperty("solidCount").GetInt32(),
    boundary = "Official MCP SDK to actual OCCT via SessionClient; not yet a live Hermes Agent or headset voice test." }));
}
