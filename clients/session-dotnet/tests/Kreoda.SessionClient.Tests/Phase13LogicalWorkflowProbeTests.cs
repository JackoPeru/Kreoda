using System.Text.Json;
using Kreoda.Session;
using Xunit;

namespace Kreoda.SessionClient.Tests;

/// <summary>Transport-only rehearsal. The loopback relay simulates geometry; this is NOT OCCT/Unity acceptance.</summary>
public sealed class Phase13LogicalWorkflowProbeTests
{
    [Fact]
    public async Task FourteenStepDesktopQuestRehearsalPreservesSharedRevisionAndUndo()
    {
        const string session = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        const string document = "doc-phase13-probe";
        var revision = 0L;
        var previewActive = false;
        var committedDistance = 100.0;
        var history = new Stack<(long Revision, double Distance)>();
        var trace = new List<string>();
        var gate = new object();
        string Reply(JsonElement req, object? result)
        {
            var payload = new Dictionary<string, object?> {
                ["requestId"] = req.GetProperty("requestId").GetString(), ["ok"] = true,
                ["sessionId"] = session, ["documentId"] = document, ["revision"] = revision,
                ["result"] = result,
            };
            return JsonSerializer.Serialize(payload);
        }
        await using var relay = new LoopbackWsServer(req => {
            lock (gate) {
                var method = req.GetProperty("method").GetString()!;
                trace.Add(method);
                if (method == "hello") return JsonSerializer.Serialize(new {
                    requestId = req.GetProperty("requestId").GetString(), ok = true,
                    clientId = "logical-client", sessionId = session, documentId = document,
                    capabilities = new[] { "operation-replay", "incremental-deltas" }, revision,
                });
                if (method == "snapshot") return JsonSerializer.Serialize(new {
                    requestId = req.GetProperty("requestId").GetString(), ok = true,
                    sessionId = session, documentId = document, revision,
                    features = Array.Empty<object>(), sketches = Array.Empty<object>(), bodies = Array.Empty<object>(),
                });
                if (method == SessionMethods.PreviewBegin) { previewActive = true; return Reply(req, new { previewId = "probe-preview", generation = 1 }); }
                if (method == SessionMethods.PreviewUpdate) return Reply(req, new { previewId = "probe-preview", generation = 2, distanceMm = 125 });
                if (method == SessionMethods.PreviewCancel) { previewActive = false;return Reply(req, new { cancelled = true }); }
                if (method == SessionMethods.PreviewCommit) {
                    if (!previewActive) throw new InvalidOperationException("commit without preview");
                    history.Push((revision, committedDistance)); committedDistance = 125;revision++;previewActive = false;
                    return Reply(req, new { revision, distanceMm = committedDistance });
                }
                if (method == SessionMethods.Command) {
                    history.Push((revision, committedDistance));revision++;
                    return Reply(req, new { featureId = "fillet-1", revision });
                }
                if (method == SessionMethods.Invoke) {
                    var undo = history.Pop();committedDistance = undo.Distance;revision++;
                    return Reply(req, new { revision, undoneRevision = undo.Revision });
                }
                return Reply(req, new { revision, distanceMm = committedDistance });
            }
        });
        relay.Start();
        var uri = new Uri($"ws://127.0.0.1:{relay.Port}/");
        await using var desktop = await Kreoda.Session.SessionClient.ConnectAsync(uri, "desktop-token", "desktop-probe");
        await using var quest = await Kreoda.Session.SessionClient.ConnectAsync(uri, "quest-token", "quest-probe");
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        async Task<JsonElement> Call(Kreoda.Session.SessionClient client, string method, IDictionary<string, object?>? args = null) =>
            await client.CallAsync(method, args ?? new Dictionary<string, object?>(), deadline.Token);
        // 14 logical operations, not 14 physical headset actions.
        await Call(desktop, SessionMethods.GetDocumentInfo); // 1 desktop opens
        await Call(desktop, SessionMethods.GetFeatures); // 2 saved feature graph
        await Call(quest, SessionMethods.GetDocumentInfo); // 3 Quest connects
        await Call(quest, SessionMethods.GetManipulators); // 4 spatial handle query
        await Call(quest, SessionMethods.PreviewBegin); // 5 pull begins
        await Call(quest, SessionMethods.PreviewUpdate); // 6 exact numeric preview
        Assert.Equal(100, committedDistance);Assert.Equal(0, revision); // preview isolation
        await Call(quest, SessionMethods.PreviewCommit); // 7 confirm
        Assert.Equal(125, committedDistance);Assert.Equal(1, revision);
        await Call(desktop, SessionMethods.GetFeatures); // 8 desktop observes committed state
        await Call(quest, SessionMethods.FindEdges); // 9 edge lookup
        await Call(quest, SessionMethods.ListCommands); // 10 contextual command list
        await Call(quest, SessionMethods.Command, new Dictionary<string, object?> { ["name"] = "Fillet", ["parameters"] = new { radiusMm = 3 } }); // 11 fillet
        Assert.Equal(2, revision);
        await Call(quest, SessionMethods.Invoke, new Dictionary<string, object?> { ["type"] = 8 }); // 12 shared Undo (simulated)
        Assert.Equal(3, revision);
        await Call(desktop, SessionMethods.GetFeatures); // 13 desktop resumes
        await Call(desktop, SessionMethods.GetDependencies); // 14 expression/dependency continuation
        Assert.Equal(14, trace.Count(m => m != "hello" && m != "snapshot"));
        Assert.Equal(125, committedDistance);
        Assert.False(previewActive);
    }
}
