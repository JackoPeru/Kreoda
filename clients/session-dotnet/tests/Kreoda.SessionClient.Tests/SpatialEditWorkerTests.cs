using System.Text.Json;
using Kreoda.QuestFoundation;
using Kreoda.Session;
using Xunit;

namespace Kreoda.SessionClient.Tests;

public sealed class SpatialEditWorkerTests
{
    const string Session = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    static SpatialEditIntent Intent()
    {
        using var metadata = JsonDocument.Parse("""{"id":"width","type":"linear","parameter":"widthMm","unit":"mm","origin":[100,25,10],"axis":[1,0,0]}""");
        return new(Session, "doc-phase1", 7, "owner", "body-owner", "owner", metadata.RootElement,
            new Dictionary<string, double> { ["widthMm"] = 100 });
    }

    sealed class Wire : IAsyncDisposable
    {
        public readonly LoopbackWsServer Server = new(_ => null);
        public TaskCompletionSource<bool> BeginArrived = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource<bool>? BeginGate;
        public TaskCompletionSource<bool> PreviewArrived = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource<bool>? PreviewGate;
        public TaskCompletionSource<bool> CommitArrived = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource<bool>? CommitGate;
        int _previewReads;
        public readonly List<double> Updates = new();
        public readonly List<string> CommitOperations = new();
        public int Cancels, Commits;
        public long Revision = 7, Generation;
        public double Value = 100, Draft = 100;
        public bool DropCommitAck, DropCancelAck;
        JsonElement? _commit;
        public Wire() { Server.ExtendedHandler = Reply;Server.Start(); }
        string Json(JsonElement request, IDictionary<string, object?> payload)
        {
            var reply = new Dictionary<string, object?> { ["requestId"] = request.GetProperty("requestId").GetString(), ["ok"] = true };
            foreach (var item in payload) reply[item.Key] = item.Value;
            return JsonSerializer.Serialize(reply);
        }
        async Task<LoopbackWsResponse?> Reply(JsonElement request)
        {
            var method = request.GetProperty("method").GetString();var p = request.GetProperty("params");
            if (method == SessionMethods.Hello) return new(Json(request, new Dictionary<string, object?> {
                ["clientId"] = "gesture-client", ["sessionId"] = Session, ["documentId"] = "doc-phase1", ["revision"] = Revision,
                ["capabilities"] = SessionMethods.ServerCapabilities }));
            if (method == SessionMethods.Snapshot) return new(Json(request, new Dictionary<string, object?> {
                ["sessionId"] = Session, ["documentId"] = "doc-phase1", ["revision"] = Revision,
                ["features"] = new[] { new { featureId = "owner", type = "Box", paramsMm = new[] { Value, 50, 20 }, volumeMm3 = Value * 1000 } },
                ["sketches"] = Array.Empty<object>(), ["bodies"] = new[] { new { bodyId = "body-owner", tip = "owner", history = new[] { "owner" } } },
                ["tips"] = new[] { "owner" } }));
            if (method == SessionMethods.PreviewBegin) {
                BeginArrived.TrySetResult(true);if (BeginGate is not null) await BeginGate.Task;
            }
            if (method == SessionMethods.PreviewBegin || method == SessionMethods.PreviewUpdate) {
                Draft = p.GetProperty("valueMm").GetDouble();
                if (Draft <= 0) return new(JsonSerializer.Serialize(new { requestId = request.GetProperty("requestId").GetString(),
                    ok = false, errorCode = "PREVIEW_FAILED", error = "positive width required" }));
                if (method == SessionMethods.PreviewUpdate) { lock (Updates) Updates.Add(Draft);Generation++; }
                return new(Json(request, new Dictionary<string, object?> { ["result"] = new { previewId = "preview-owned", generation = Generation, revision = Revision } }));
            }
            if (method == SessionMethods.RequestPreviewMesh) {
                var first = ++_previewReads == 1;
                var raw = SessionMeshTests.MeshFrame("worker-" + Generation, 0, Revision, tipId: "owner");
                return new(Json(request, new Dictionary<string, object?> { ["result"] = new {
                    nativeRequestId = "worker-" + Generation, sessionId = Session, documentId = "doc-phase1", baseRevision = Revision,
                    previewId = "preview-owned", generation = Generation, featureId = "owner", paramName = "widthMm",
                    bodyId = "body-owner", targetTipId = "owner", quality = 0, byteLength = raw.Length } }), raw,
                    BeforeBinary: first ? PreviewGate?.Task : null,
                    AfterTextSent: first ? () => { PreviewArrived.TrySetResult(true);return Task.CompletedTask; } : null);
            }
            if (method == SessionMethods.PreviewCancel) { Cancels++;if (DropCancelAck) return null;return new(Json(request, new Dictionary<string, object?> { ["result"] = new { cancelled = true } })); }
            if (method == SessionMethods.PreviewCommit) {
                lock (CommitOperations) CommitOperations.Add(request.GetProperty("operationId").GetString()!);
                if (_commit is null) { Commits++;Value = Draft;Revision++;_commit = JsonSerializer.SerializeToElement(new { status = "ok", revision = Revision });
                    if (DropCommitAck) return null; }
                CommitArrived.TrySetResult(true);if (CommitGate is not null) await CommitGate.Task;
                return new(Json(request, new Dictionary<string, object?> { ["result"] = _commit.Value }));
            }
            return null;
        }
        public Task<Kreoda.Session.SessionClient> Connect() => Kreoda.Session.SessionClient.ConnectAsync(
            new Uri($"ws://127.0.0.1:{Server.Port}/"), "t", "quest-test");
        public ValueTask DisposeAsync() => Server.DisposeAsync();
    }

    [Fact]
    public async Task CoalescesDraftsAndFlushesExactReleaseBeforeOneCommit()
    {
        await using var wire = new Wire { BeginGate = new(TaskCreationOptions.RunContinuationsAsynchronously) };
        await using var client = await wire.Connect();
        await using var worker = new SpatialEditWorker(client, Intent());
        var begun = worker.BeginAsync();await wire.BeginArrived.Task.WaitAsync(TimeSpan.FromSeconds(5));
        foreach (var value in new[] { 110d, 120d, 130d }) worker.Submit(new Dictionary<string, double> { ["widthMm"] = value });
        var released = worker.ReleaseAsync();wire.BeginGate.TrySetResult(true);await begun;
        var outcome = await released.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal(SpatialEditStatus.Committed, outcome.Status);Assert.Equal(130, wire.Value);
        Assert.Equal(1, wire.Commits);Assert.Equal(new[] { 130d }, wire.Updates);
    }

    [Fact]
    public async Task CancelDuringBeginObtainsOwnedIdThenCancelsWithoutCommit()
    {
        await using var wire = new Wire { BeginGate = new(TaskCreationOptions.RunContinuationsAsynchronously) };
        await using var client = await wire.Connect();await using var worker = new SpatialEditWorker(client, Intent());
        var begun = worker.BeginAsync();await wire.BeginArrived.Task;
        var cancelled = worker.CancelAsync();wire.BeginGate.TrySetResult(true);await begun;
        Assert.Equal(SpatialEditStatus.Cancelled, (await cancelled.WaitAsync(TimeSpan.FromSeconds(5))).Status);
        Assert.Equal(1, wire.Cancels);Assert.Equal(0, wire.Commits);
    }

    [Fact]
    public async Task InvalidFinalValueCancelsInsteadOfCommittingLastGoodPreview()
    {
        await using var wire = new Wire();await using var client = await wire.Connect();await using var worker = new SpatialEditWorker(client, Intent());
        await worker.BeginAsync();worker.Submit(new Dictionary<string, double> { ["widthMm"] = -10 });
        var outcome = await worker.ReleaseAsync().WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal(SpatialEditStatus.Failed, outcome.Status);Assert.Equal(0, wire.Commits);Assert.Equal(100, wire.Value);Assert.Equal(1, wire.Cancels);
    }

    [Fact]
    public async Task LostCommitAckSnapshotsThenReplaysOriginalOperationOnce()
    {
        await using var wire = new Wire { DropCommitAck = true };await using var client = await wire.Connect();
        await using var worker = new SpatialEditWorker(client, Intent(), TimeSpan.FromMilliseconds(150));
        await worker.BeginAsync();worker.Submit(new Dictionary<string, double> { ["widthMm"] = 125 });
        var outcome = await worker.ReleaseAsync().WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal(SpatialEditStatus.Committed, outcome.Status);Assert.Equal(1, wire.Commits);Assert.Equal(125, wire.Value);
        Assert.Equal(2, wire.CommitOperations.Count);Assert.Single(wire.CommitOperations.Distinct());Assert.Equal(8, client.Model!.Revision);
    }

    [Fact]
    public async Task DelayedOldCandidateCannotReplaceNewerLocalDraft()
    {
        await using var wire = new Wire { PreviewGate = new(TaskCreationOptions.RunContinuationsAsynchronously) };
        await using var client = await wire.Connect();await using var worker = new SpatialEditWorker(client, Intent());
        var generations = new List<long>();worker.PreviewReady += mesh => generations.Add(mesh.Header.Generation);
        await worker.BeginAsync();worker.Submit(new Dictionary<string, double> { ["widthMm"] = 110 });
        await wire.PreviewArrived.Task;worker.Submit(new Dictionary<string, double> { ["widthMm"] = 120 });
        var released = worker.ReleaseAsync();wire.PreviewGate.TrySetResult(true);
        Assert.Equal(SpatialEditStatus.Committed, (await released.WaitAsync(TimeSpan.FromSeconds(5))).Status);
        Assert.Equal(new long[] { 2 }, generations);Assert.Equal(120, wire.Value);
    }

    [Fact]
    public async Task ModelRevisionChangeCancelsLockedIntentWithoutCommit()
    {
        await using var wire = new Wire();await using var client = await wire.Connect();await using var worker = new SpatialEditWorker(client, Intent());
        await worker.BeginAsync();wire.Revision = 8;await client.SnapshotAsync();
        Assert.Equal(SpatialEditStatus.Cancelled, (await worker.Completion.WaitAsync(TimeSpan.FromSeconds(5))).Status);
        Assert.Equal(0, wire.Commits);Assert.Equal(1, wire.Cancels);
    }

    [Fact]
    public async Task ReleaseWithoutMovementCancelsWithoutChangingHistory()
    {
        await using var wire = new Wire();await using var client = await wire.Connect();await using var worker = new SpatialEditWorker(client, Intent());
        await worker.BeginAsync();
        Assert.Equal(SpatialEditStatus.Cancelled, (await worker.ReleaseAsync().WaitAsync(TimeSpan.FromSeconds(5))).Status);
        Assert.Equal(0, wire.Commits);Assert.Equal(7, wire.Revision);
    }

    [Fact]
    public async Task CancelWhileCommitWaitsForSendGatePreventsCommit()
    {
        await using var wire = new Wire();await using var client = await wire.Connect();
        await using var worker = new SpatialEditWorker(client, Intent());
        var sendGate = (SemaphoreSlim)typeof(Kreoda.Session.SessionClient).GetField("_sendGate",
            System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)!.GetValue(client)!;
        var acquired = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        worker.PreviewReady += _ => { sendGate.Wait();acquired.TrySetResult(true); };
        await worker.BeginAsync();worker.Submit(new Dictionary<string, double> { ["widthMm"] = 120 });
        Task<SpatialEditOutcome> released, cancelled;
        try {
            await acquired.Task.WaitAsync(TimeSpan.FromSeconds(5));
            released = worker.ReleaseAsync();
            using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            while (worker.Phase != SpatialEditPhase.Committing) await Task.Delay(5, deadline.Token);
            cancelled = worker.CancelAsync();
        } finally { if (acquired.Task.IsCompletedSuccessfully) sendGate.Release(); }
        Assert.Equal(SpatialEditStatus.Cancelled, (await cancelled.WaitAsync(TimeSpan.FromSeconds(5))).Status);
        await released;Assert.Equal(0, wire.Commits);Assert.Equal(1, wire.Cancels);Assert.Equal(7, wire.Revision);
    }

    [Fact]
    public async Task UnresolvedCancelClosesBorrowedConnectionToReleaseReservations()
    {
        await using var wire = new Wire { DropCancelAck = true };await using var client = await wire.Connect();
        await using var worker = new SpatialEditWorker(client, Intent(), TimeSpan.FromMilliseconds(150));
        await worker.BeginAsync();
        Assert.Equal(SpatialEditStatus.Failed, (await worker.CancelAsync().WaitAsync(TimeSpan.FromSeconds(5))).Status);
        Assert.Equal(2, wire.Cancels);Assert.Equal(0, wire.Commits);
        var error = await Assert.ThrowsAsync<SessionException>(() => client.SnapshotAsync());
        Assert.Equal("NOT_CONNECTED", error.Code);
    }

    [Fact]
    public async Task CancelAfterCommitSendResolvesCommittedOutcome()
    {
        await using var wire = new Wire { CommitGate = new(TaskCreationOptions.RunContinuationsAsynchronously) };
        await using var client = await wire.Connect();await using var worker = new SpatialEditWorker(client, Intent());
        await worker.BeginAsync();worker.Submit(new Dictionary<string, double> { ["widthMm"] = 120 });
        var released = worker.ReleaseAsync();await wire.CommitArrived.Task.WaitAsync(TimeSpan.FromSeconds(5));
        var cancelled = worker.CancelAsync();wire.CommitGate.TrySetResult(true);
        Assert.Equal(SpatialEditStatus.Committed, (await cancelled.WaitAsync(TimeSpan.FromSeconds(5))).Status);
        await released;Assert.Equal(1, wire.Commits);Assert.Equal(120, wire.Value);Assert.Equal(0, wire.Cancels);
    }
}
