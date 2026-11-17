using System.Text.Json;
using Kreoda.Session;
using Kreoda.QuestFoundation;

static class Phase13ContextProbe
{
    static void Check(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }
    public static async Task RunAsync()
    {
        var url = new Uri(Environment.GetEnvironmentVariable("KREODA_SESSION_PROBE_URL")!);
        var pair = await SessionClient.PairAsync(url, Environment.GetEnvironmentVariable("KREODA_SESSION_PROBE_PAIR")!, "context-sketch-probe", "agent");
        await using var client = pair.Client;var doc = client.Model!.DocumentId;
        var kernel = await client.InvokeAsync(1, new Dictionary<string, object?>());
        Check(kernel.GetProperty("occtVersion").GetString() == "8.0.1-native", "context proof requires actual OCCT");
        var suffix = Guid.NewGuid().ToString("N");var box = "context-box-" + suffix;var fillet = "context-fillet-" + suffix;var sketch = "context-sketch-" + suffix;
        async Task Refresh() => await client.SnapshotAsync(doc);
        async Task Mutate(string id, Dictionary<string, object?> fields, string? feature = null) {
            var reply = await client.CommandAsync(id, fields, doc, featureId: feature, baseRevision: client.Model!.Revision);
            Check(reply.GetProperty("status").GetString() == "ok", "canonical command failed: " + id);await Refresh();
        }
        await Mutate("CreateBox", new() { ["widthMm"] = 100d, ["heightMm"] = 50d, ["depthMm"] = 20d }, box);
        var initialVolume = client.Model!.Features.Single(f => f.GetProperty("featureId").GetString() == box).GetProperty("volumeMm3").GetDouble();
        var found = (await client.CallAsync(SessionMethods.FindEdges, new Dictionary<string, object?> { ["ownerBody"] = box })).GetProperty("result");
        var edge = found.GetProperty("edges").EnumerateArray().First(e => !e.GetProperty("ambiguous").GetBoolean()).GetProperty("persistentEdgeId").GetString()!;
        var context = await client.ContextCommandsAsync(new[] { edge }, doc, client.Model.Revision);
        var command = context.Commands.Single(c => c.Id == "CreateFillet");
        Check(command.Available && !command.SupportsPreview, "fillet availability or preview capability is incorrect");
        var parameters = command.BoundParameters.ToDictionary(p => p.Key, p => (object?)p.Value);parameters["radiusMm"] = 2d;
        await Mutate(command.Id, parameters, fillet);
        Check(client.Model!.Features.Any(f => f.GetProperty("featureId").GetString() == fillet), "fillet did not reach the shared model");
        await Mutate("Undo", new());
        Check(!client.Model!.Features.Any(f => f.GetProperty("featureId").GetString() == fillet), "shared Undo did not remove the fillet");
        Check(Math.Abs(client.Model.Features.Single(f => f.GetProperty("featureId").GetString() == box).GetProperty("volumeMm3").GetDouble() - initialVolume) < 1e-5, "Undo changed the source box");
        var model = new { points = new[] { new { id = "centre", x = 0, y = 0, @fixed = true } },
            circles = new[] { new { id = "circle", center = "centre", r = 5d } },
            constraints = new[] { new { id = "radius", kind = "radius", refs = new[] { "circle" }, value = 5d } } };
        await Mutate("CreateSketch", new() { ["planeKind"] = "XZ", ["model"] = model }, sketch);
        var saved = client.Model!.Sketches.Single(s => s.GetProperty("featureId").GetString() == sketch);
        var intent = new SketchDimensionIntent(client.Model.SessionId, doc, client.Model.Revision, saved, "radius");
        var beforeRevision = client.Model.Revision;
        var preview = await intent.PreviewAsync(client, 10);
        Check(Math.Abs(preview.GetProperty("model").GetProperty("circles")[0].GetProperty("r").GetDouble() - 10) < 1e-5, "solved sketch preview returned old radius");
        await Refresh();Check(client.Model!.Revision == beforeRevision, "preview changed the document revision");
        Check(client.Model.Sketches.Single(s => s.GetProperty("featureId").GetString() == sketch).GetProperty("model").GetProperty("circles")[0].GetProperty("r").GetDouble() == 5, "preview mutated the stored sketch");
        var commit = await intent.CommitAsync(client, 10);Check(commit.GetProperty("status").GetString() == "ok", "sketch dimension commit failed");await Refresh();
        var changed = client.Model!.Sketches.Single(s => s.GetProperty("featureId").GetString() == sketch);
        Check(changed.GetProperty("plane").GetRawText() == saved.GetProperty("plane").GetRawText(), "dimension edit changed the sketch plane");
        Check(changed.GetProperty("model").GetProperty("constraints")[0].GetProperty("id").GetString() == "radius", "dimension identity changed");
        Check(Math.Abs(changed.GetProperty("model").GetProperty("circles")[0].GetProperty("r").GetDouble() - 10) < 1e-5, "exact dimension did not solve geometry");
        await Mutate("Undo", new());
        var restored = client.Model!.Sketches.Single(s => s.GetProperty("featureId").GetString() == sketch);
        Check(Math.Abs(restored.GetProperty("model").GetProperty("circles")[0].GetProperty("r").GetDouble() - 5) < 1e-5, "Undo did not restore the same sketch dimension");
        Check(restored.GetProperty("plane").GetRawText() == saved.GetProperty("plane").GetRawText(), "Undo changed plane placement");
        Console.WriteLine(JsonSerializer.Serialize(new { passed = new[] { "native-context-fillet-and-shared-undo", "pure-solved-sketch-dimension-preview", "exact-sketch-dimension-and-shared-undo-preserve-identities" },
            finalRevision = client.Model.Revision, boundary = "Actual OCCT/Electron and compiled C#; no Unity/headset usability claim." }));
    }
}
