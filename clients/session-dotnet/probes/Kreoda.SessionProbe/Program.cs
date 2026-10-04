using System.Text.Json;
using Kreoda.Session;

string Required(string key) => Environment.GetEnvironmentVariable(key) ?? throw new InvalidOperationException("missing probe setting: " + key);
void Check(bool value, string message) { if (!value) throw new InvalidOperationException(message); }
await using var client = await SessionClient.ConnectAsync(new Uri(Required("KREODA_SESSION_PROBE_URL")), Required("KREODA_SESSION_PROBE_TOKEN"), "native-dotnet-probe");
var editedId = Required("KREODA_SESSION_PROBE_FEATURE");
var instanceId = Required("KREODA_SESSION_PROBE_INSTANCE");
var untouchedId = Required("KREODA_SESSION_PROBE_UNTOUCHED");
var before = client.Model ?? throw new InvalidOperationException("join did not seed the typed model");
var untouched = before.Features.Single(feature => feature.GetProperty("featureId").GetString() == untouchedId);
var updates = new List<SessionModelUpdate>();
client.ModelChanged += update => { lock (updates) updates.Add(update); };
async Task WaitRevision(long revision)
{
    var deadline = DateTime.UtcNow.AddSeconds(10);
    while (true)
    {
        bool observed;
        lock (updates) observed = updates.Any(update => update.Model.Revision == revision);
        if (client.Model?.Revision == revision && observed) return;
        Check(DateTime.UtcNow < deadline, "model recovery timed out at revision " + revision);
        await Task.Delay(10);
    }
}
double Volume() => client.Model!.Features.Single(feature => feature.GetProperty("featureId").GetString() == editedId).GetProperty("volumeMm3").GetDouble();
async Task<JsonElement> Edit(double width) => await client.InvokeAsync(6,
    new Dictionary<string, object?> { ["featureId"] = editedId, ["paramName"] = "widthMm", ["valueMm"] = width });
var info = await client.InvokeAsync(1, new Dictionary<string, object?>());
Check(info.GetProperty("occtVersion").GetString() == "8.0.1-native", "probe requires the real native kernel");
var edit = await Edit(120);
await WaitRevision(edit.GetProperty("revision").GetInt64());
Check(Math.Abs(Volume() - 72000) < 1e-5, "typed model did not apply the native parameter edit");
SessionModelUpdate edited;
lock (updates) edited = updates.Single(update => update.Model.Revision == client.Model!.Revision);
Check(edited.Delta is not null && edited.Delta.ChangedMeshIds.Contains(editedId) && edited.Delta.ChangedMeshIds.Contains(instanceId) && !edited.Delta.ChangedMeshIds.Contains(untouchedId), "native incremental mesh invalidation disagrees");
Check(untouched.Equals(client.Model!.Features.Single(feature => feature.GetProperty("featureId").GetString() == untouchedId)), "untouched model entity was rebuilt");
var undo = await client.InvokeAsync(8, new Dictionary<string, object?>());
await WaitRevision(undo.GetProperty("revision").GetInt64());
Check(Math.Abs(Volume() - 60000) < 1e-5, "Undo did not restore the typed model");
// The parent injects one dropped outgoing event for this exact edit, then
// lets the next native revision expose a gap to the actual C# receive loop.
await Edit(130);
var recovery = await Edit(150);
await WaitRevision(recovery.GetProperty("revision").GetInt64());
Check(Math.Abs(Volume() - 90000) < 1e-5, "gap recovery did not hydrate native state");
var snapshot = await client.SnapshotAsync();
Check(snapshot.GetProperty("revision").GetInt64() == client.Model!.Revision, "snapshot revision mismatch");
Check(snapshot.GetProperty("features").EnumerateArray().Select(feature => feature.GetRawText()).SequenceEqual(client.Model.Features.Select(feature => feature.GetRawText())), "native snapshot and typed feature model differ");
Console.WriteLine(JsonSerializer.Serialize(new {
    kernel = info.GetProperty("occtVersion").GetString(), initialRevision = before.Revision, finalRevision = client.Model.Revision,
    passed = new[] { "native-join-snapshot", "existing-parameter-edit", "typed-incremental-model", "dependent-instance-invalidation", "untouched-entity-preserved", "native-undo", "lost-event-gap-recovery", "native-snapshot-model-match" },
    boundary = "Actual SessionRelay/OCCT and compiled C# SessionClient over loopback WebSocket; no Unity or Quest device." }));
