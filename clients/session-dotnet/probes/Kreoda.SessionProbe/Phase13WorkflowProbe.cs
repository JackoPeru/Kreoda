using System.Diagnostics;
using System.Text.Json;
using Kreoda.Session;
using Kreoda.QuestFoundation;

static class Phase13WorkflowProbe
{
    static void Check(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }
    public static async Task RunAsync()
    {
        var url = new Uri(Environment.GetEnvironmentVariable("KREODA_SESSION_PROBE_URL")!);
        var pair = await SessionClient.PairAsync(url, Environment.GetEnvironmentVariable("KREODA_SESSION_PROBE_PAIR")!, "workflow-probe", "agent");
        await using var client = pair.Client;
        var doc = client.Model!.DocumentId;
        var kernel = await client.InvokeAsync(1, new Dictionary<string, object?>());
        Check(kernel.GetProperty("occtVersion").GetString() == "8.0.1-native", "requires actual OCCT");
        var suffix = Guid.NewGuid().ToString("N");
        var sketch = "workflow-sketch-" + suffix;var extrude = "workflow-extrude-" + suffix;
        var hole = "workflow-hole-" + suffix;var fillet = "workflow-fillet-" + suffix;
        async Task Refresh() => await client.SnapshotAsync(doc);
        async Task Mutate(string command, Dictionary<string, object?> fields, string? feature = null) {
            var reply = await client.CommandAsync(command, fields, doc, featureId: feature, baseRevision: client.Model!.Revision);
            Check(reply.GetProperty("status").GetString() == "ok", command + " failed");await Refresh();
        }
        async Task<JsonElement> Query(string method, Dictionary<string, object?> fields) => (await client.CallAsync(method, fields)).GetProperty("result");
        var model = new {
            points = new[] { new { id = "p0", x = 0d, y = 0d }, new { id = "p1", x = 100d, y = 0d }, new { id = "p2", x = 100d, y = 50d }, new { id = "p3", x = 0d, y = 50d } },
            lines = new[] { new { id = "l0", p1 = "p0", p2 = "p1" }, new { id = "l1", p1 = "p1", p2 = "p2" }, new { id = "l2", p1 = "p2", p2 = "p3" }, new { id = "l3", p1 = "p3", p2 = "p0" } }
        };
        await Mutate("CreateSketch", new() { ["planeKind"] = "XY", ["model"] = model }, sketch);
        await Mutate("CreateExtrude", new() { ["sketchId"] = sketch, ["distanceMm"] = 20d }, extrude);
        var face = (await Query(SessionMethods.FindFaces, new() { ["ownerBody"] = extrude, ["normal"] = new[] { 0d, 0d, 1d }, ["surfaceType"] = "plane" }))
            .GetProperty("faces").EnumerateArray().Single(f => !f.GetProperty("ambiguous").GetBoolean());
        var faceId = face.GetProperty("persistentFaceId").GetString()!;
        var holeContext = (await client.ContextCommandsAsync(new[] { faceId }, doc, client.Model!.Revision)).Commands.Single(c => c.Id == "CreateHole");
        Check(holeContext.Available, "selected native face does not expose Hole");
        var fields = holeContext.BoundParameters.ToDictionary(p => p.Key, p => (object?)p.Value);
        fields["xMm"] = 0d;fields["yMm"] = 0d;fields["diameterMm"] = 10d;fields["depthMode"] = "throughAll";
        await Mutate("CreateHole", fields, hole);
        // File access belongs to Desktop; it saves this same live document before the edit.
        Console.WriteLine("{\"checkpoint\":\"save-fixture\"}");
        Check(await Console.In.ReadLineAsync() == "saved", "Desktop did not save the fixture");
        async Task<SpatialEditIntent> Capture() {
            var metadata = (await Query(SessionMethods.GetManipulators, new() { ["featureId"] = extrude }))
                .GetProperty("manipulators").EnumerateArray().Single(m => m.GetProperty("parameter").GetString() == "distanceMm");
            var body = client.Model!.Bodies.Single(b => b.GetProperty("history").EnumerateArray().Any(id => id.GetString() == extrude));
            return new(client.Model.SessionId, doc, client.Model.Revision, extrude, body.GetProperty("bodyId").GetString()!, hole, metadata,
                metadata.GetProperty("currentValues").EnumerateObject().ToDictionary(p => p.Name, p => p.Value.GetDouble()));
        }
        var intent = await Capture();var previewCount = 0;var sw = Stopwatch.StartNew();
        await using (var worker = new SpatialEditWorker(client, intent)) {
            var candidate = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            worker.PreviewReady += mesh => { if (worker.IsPreviewCurrent(mesh)) { Interlocked.Increment(ref previewCount);candidate.TrySetResult(true); } };
            await worker.BeginAsync();
            worker.Submit(intent.PredictDrag(intent.Origin, intent.Origin + intent.Axis!.Value * 7));
            await candidate.Task.WaitAsync(TimeSpan.FromSeconds(15));
            worker.Submit(intent.Exact(new Dictionary<string, double> { ["distanceMm"] = 30 }));
            Check((await worker.ReleaseAsync()).Status == SpatialEditStatus.Committed, "spatial exact release did not commit");
        }
        await Refresh();
        Check(client.Model!.Features.Single(f => f.GetProperty("featureId").GetString() == extrude).GetProperty("paramsMm")[0].GetDouble() == 30, "final exact value missing");
        var beforeCancel = client.Model.Revision;
        await using (var cancelled = new SpatialEditWorker(client, await Capture())) {
            await cancelled.BeginAsync();cancelled.Submit(new Dictionary<string, double> { ["distanceMm"] = 35 });
            Check((await cancelled.CancelAsync()).Status == SpatialEditStatus.Cancelled, "draft cancellation failed");
        }
        await Refresh();Check(client.Model!.Revision == beforeCancel, "cancel committed a draft");
        var edges = await Query(SessionMethods.FindEdges, new() { ["ownerBody"] = hole, ["curveType"] = "line" });
        var edge = edges.GetProperty("edges").EnumerateArray().First(e => !e.GetProperty("ambiguous").GetBoolean()).GetProperty("persistentEdgeId").GetString()!;
        var context = (await client.ContextCommandsAsync(new[] { edge }, doc, client.Model.Revision)).Commands.Single(c => c.Id == "CreateFillet");
        fields = context.BoundParameters.ToDictionary(p => p.Key, p => (object?)p.Value);fields["radiusMm"] = 1d;
        await Mutate("CreateFillet", fields, fillet);await Mutate("Undo", new());
        Check(!client.Model!.Features.Any(f => f.GetProperty("featureId").GetString() == fillet), "shared Undo kept fillet");
        Console.WriteLine(JsonSerializer.Serialize(new { passed = new[] { "saved-sketch-extrude-hole", "native-semantic-spatial-pull-exact-commit", "cancel-without-document-mutation", "contextual-edge-fillet-shared-undo" },
            finalRevision = client.Model.Revision, extrudeId = extrude, holeId = hole, previewCount, spatialMilliseconds = sw.Elapsed.TotalMilliseconds,
            boundary = "Actual OCCT/Electron/compiled spatial worker; physical Quest actions and usability remain unverified." }));
    }
}
