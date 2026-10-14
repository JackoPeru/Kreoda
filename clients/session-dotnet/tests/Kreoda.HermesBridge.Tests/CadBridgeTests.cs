using System.Text.Json;
using Kreoda.Session;
using Kreoda.SessionClient.Tests;
using Kreoda.ModelingAgent;
using Kreoda.HermesBridge;
using CadClient = Kreoda.Session.SessionClient;
using Xunit;

namespace Kreoda.HermesBridge.Tests;

public sealed class CadBridgeTests
{
    internal sealed class Wire : IAsyncDisposable
    {
        const string Session = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        public readonly LoopbackWsServer Server;
        public int Commands, Commits, Rollbacks;
        public bool Valid = true;
        public bool DropCommitAck;
        public bool FailRollback;
        public TimeSpan CatalogDelay;
        public object[] Sketches = Array.Empty<object>();
        public object[] Datums = Array.Empty<object>();
        public readonly List<string> CommitOperations = new();
        readonly HashSet<string> _committed = new();
        public Wire()
        {
            Server = new(Reply);
            Server.ExtendedHandler = async request => {
                if (request.GetProperty("method").GetString() == "getCommandSchema") await Task.Delay(CatalogDelay);
                var reply = Reply(request);
                return DropCommitAck && request.GetProperty("method").GetString() == "txnCommit" && CommitOperations.Count == 1
                    ? null : new LoopbackWsResponse(reply);
            };
            Server.Start();
        }
        string Reply(JsonElement request)
        {
            var method = request.GetProperty("method").GetString();
            var result = new Dictionary<string, object?> { ["requestId"] = request.GetProperty("requestId").GetString(), ["ok"] = true };
            if (method == "hello") {
                result["clientId"] = "bridge";result["sessionId"] = Session;result["documentId"] = "doc-phase1";
                result["revision"] = 7;result["capabilities"] = SessionMethods.ServerCapabilities;
            } else if (method == "snapshot") {
                result["sessionId"] = Session;result["documentId"] = "doc-phase1";result["revision"] = 7;
                result["features"] = Array.Empty<object>();result["sketches"] = Sketches;result["bodies"] = Array.Empty<object>();result["datums"] = Datums;
            } else if (method == "getCommandSchema") {
                result["result"] = new { commands = new object[] {
                    new { id = "CreateBox", nativeType = 3, description = "Box", creation = new { fixedCount = 1 }, parameters = new { type = "object" } },
                    new { id = "SetDimension", nativeType = 6, description = "Dimension", creation = new { fixedCount = 0 }, parameters = new { type = "object" } },
                    new { id = "CreateHolePattern", nativeType = 25, description = "Pattern", creation = new { idArrayParameter = "featureIds" }, parameters = new {
                        type = "object", properties = new { featureIds = new { type = "array", items = new { type = "string" } } },
                    } },
                } };
            } else if (method == "validateDocument" || method == "validateReferences") result["result"] = new { valid = Valid };
            else if (method == "measureVolume") result["result"] = new { volumeMm3 = 100000d };
            else if (method == SessionMethods.GetDatum) result["result"] = new { featureId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", kind = "DatumPlane", status = "ok", definition = new { type = "offset", @base = new { type = "principal", planeKind = "XY" }, offsetMm = 24d }, resolved = new { originMm = new[] { 0d, 0d, 24d }, normal = new[] { 0d, 0d, 1d } } };
            else if (method == "command") { Commands++;result["status"] = "ok";result["revision"] = 7; }
            else if (method == "txnCommit") {
                var operation = request.GetProperty("operationId").GetString()!;CommitOperations.Add(operation);
                if (_committed.Add(operation)) Commits++;
                result["status"] = "ok";result["revision"] = 8;
            }
            else if (method == "txnRollback") {
                Rollbacks++;
                if (FailRollback) { result["ok"] = false;result["errorCode"] = "INTERNAL_ERROR";result["error"] = "rollback rejected"; }
                else result["status"] = "ok";
            }
            else result["status"] = "ok";
            return JsonSerializer.Serialize(result);
        }
        public Task<CadClient> Connect() => CadClient.ConnectAsync(new Uri($"ws://127.0.0.1:{Server.Port}/"), "test-token", "hermes-mcp");
        public ValueTask DisposeAsync() => Server.DisposeAsync();
    }
    static JsonElement Json(string text) { using var doc = JsonDocument.Parse(text);return doc.RootElement.Clone(); }
    static CadCheck Check(double expected = 100000) => new("measureVolume", Json("{\"bodyId\":\"$plate\"}"), "volumeMm3", expected, .01);

    [Fact]
    public async Task DescribeIncludesDatumDescriptorsAndSupportedSketchFrames()
    {
        const string datumId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
        await using var wire = new Wire();
        wire.Datums = [new { featureId = datumId, kind = "DatumPlane", status = "ok", definition = new { type = "offset", @base = new { type = "principal", planeKind = "XY" }, offsetMm = 24d }, resolved = new { originMm = new[] { 0d, 0d, 24d }, normal = new[] { 0d, 0d, 1d } } }];
        wire.Sketches = [new { featureId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc", planeKind = "XY", supportRef = datumId, plane = new { origin = new[] { 0d, 0d, 24d }, xAxis = new[] { 1d, 0d, 0d }, yAxis = new[] { 0d, 1d, 0d }, normal = new[] { 0d, 0d, 1d } }, points = Array.Empty<object>(), lines = Array.Empty<object>(), circles = Array.Empty<object>(), arcs = Array.Empty<object>(), constraints = Array.Empty<object>() }];
        await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client));

        var description = await bridge.DescribeAsync();

        Assert.Equal(datumId, description.GetProperty("datums")[0].GetProperty("featureId").GetString());
        Assert.Equal(24d, description.GetProperty("datums")[0].GetProperty("resolved").GetProperty("originMm")[2].GetDouble());
        Assert.Equal(datumId, description.GetProperty("sketches")[0].GetProperty("supportRef").GetString());
        Assert.Equal(24d, description.GetProperty("sketches")[0].GetProperty("plane").GetProperty("origin")[2].GetDouble());
        Assert.Equal(1d, description.GetProperty("sketches")[0].GetProperty("plane").GetProperty("normal")[2].GetDouble());
    }

    [Fact]
    public async Task GetDatumQueryReturnsNativeDescriptorWithoutMutation()
    {
        await using var wire = new Wire();await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client));

        var result = await bridge.QueryAsync(null, SessionMethods.GetDatum, Json("{\"featureId\":\"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb\"}"));

        Assert.Equal("DatumPlane", result.GetProperty("kind").GetString());
        Assert.Equal(24d, result.GetProperty("resolved").GetProperty("originMm")[2].GetDouble());
        Assert.Equal(0, wire.Commands);
        var query = wire.Server.Received.Select(Json).Single(request => request.GetProperty("method").GetString() == SessionMethods.GetDatum);
        Assert.Equal("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", query.GetProperty("params").GetProperty("featureId").GetString());
    }

    [Fact]
    public async Task FailedValidationRollbackPersistsRecoveryAndSurvivesBridgeRestart()
    {
        await using var wire = new Wire { FailRollback = true, Valid = false };await using var client = await wire.Connect();
        JsonElement? saved = null;
        await using var bridge = new CadBridge(_ => Task.FromResult(client), persistRecovery: state => { saved = state.Clone();return Task.CompletedTask; });
        var request = await bridge.BeginAsync("plate", new[] { Check() });
        var result = await new CadTools(bridge).Commit(request, CancellationToken.None);
        Assert.True(result.IsError);Assert.NotNull(saved);
        using var reply = JsonDocument.Parse(((ModelContextProtocol.Protocol.TextContentBlock)result.Content.Single()).Text);
        Assert.Equal("uncertain", reply.RootElement.GetProperty("status").GetString());
        Assert.True(reply.RootElement.GetProperty("recoveryPersisted").GetBoolean());Assert.Equal(0, wire.Commits);
        await using var restarted = new CadBridge(_ => throw new InvalidOperationException("Recovery fence must precede reconnect"), initialRecovery: saved);
        Assert.Equal("uncertain", (await restarted.DescribeAsync()).GetProperty("status").GetString());
        await Assert.ThrowsAsync<CadRecoveryRequiredException>(() => restarted.BeginAsync("retry", new[] { Check() }));
    }

    [Fact]
    public async Task FailedIdleRollbackRecordsRecoveryWithoutAnUnobservedExpiryFailure()
    {
        await using var wire = new Wire { FailRollback = true };await using var client = await wire.Connect();
        var saved = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        await using var bridge = new CadBridge(_ => Task.FromResult(client), persistRecovery: state => { saved.TrySetResult(state.Clone());return Task.CompletedTask; });
        var request = await bridge.BeginAsync("plate", new[] { Check() }, new AgentLimits(maxDuration: TimeSpan.FromMilliseconds(100)));
        var recovery = await saved.Task.WaitAsync(TimeSpan.FromSeconds(3));
        Assert.Equal(request, recovery.GetProperty("requestId").GetString());
        var description = await bridge.DescribeAsync();Assert.Equal("uncertain", description.GetProperty("status").GetString());
        Assert.Equal(1, wire.Rollbacks);
    }

    [Fact]
    public async Task FailedRollbackCannotReportCancellationAndBlocksNewWorkWithRecoveryIdentity()
    {
        await using var wire = new Wire { FailRollback = true };await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client));
        var request = await bridge.BeginAsync("plate", new[] { Check() });
        var result = await new CadTools(bridge).Cancel(request, CancellationToken.None);
        Assert.True(result.IsError);
        using var data = JsonDocument.Parse(((ModelContextProtocol.Protocol.TextContentBlock)result.Content.Single()).Text);
        Assert.Equal("uncertain", data.RootElement.GetProperty("status").GetString());
        var recovery = data.RootElement.GetProperty("recovery");
        Assert.Equal(request, recovery.GetProperty("requestId").GetString());
        var begin = wire.Server.Received.Select(Json).Single(r => r.GetProperty("method").GetString() == "txnBegin");
        Assert.Equal(begin.GetProperty("params").GetProperty("transactionId").GetString(), recovery.GetProperty("transactionId").GetString());
        var retry = await new CadTools(bridge).Begin("another", new[] { Check() });
        Assert.True(retry.IsError);
    }

    [Fact]
    public async Task SinglePatternAliasResolvesItsDeclaredIdWithoutAnAllocatedEnvelopeId()
    {
        await using var wire = new Wire();await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client));
        var request = await bridge.BeginAsync("one hole", new[] { Check() });
        var id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
        var result = await bridge.CommandAsync(request, "CreateHolePattern", Json("{\"featureIds\":[\"" + id + "\"]}"), "singleHole");
        Assert.Equal(id, result.GetProperty("featureId").GetString());
        await bridge.QueryAsync(request, "measureVolume", Json("{\"featureId\":\"$singleHole\"}"));
        var measured = wire.Server.Received.Select(Json).Single(r => r.GetProperty("method").GetString() == "measureVolume");
        Assert.Equal(id, measured.GetProperty("params").GetProperty("featureId").GetString());
        var command = wire.Server.Received.Select(Json).Single(r => r.GetProperty("method").GetString() == "command");
        Assert.False(command.GetProperty("params").TryGetProperty("featureId", out _));
        await bridge.CancelAsync(request);
    }

    [Fact]
    public async Task EditOmitsUnallocatedFeatureIdAndPreservesExistingTargetInParameters()
    {
        await using var wire = new Wire();await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client));
        var request = await bridge.BeginAsync("resize", new[] { Check() });
        var target = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
        await bridge.CommandAsync(request, "SetDimension", Json("{\"featureId\":\"" + target + "\",\"paramName\":\"widthMm\",\"valueMm\":120}"));
        var command = wire.Server.Received.Select(Json).Single(r => r.GetProperty("method").GetString() == "command").GetProperty("params");
        Assert.False(command.TryGetProperty("featureId", out _));
        Assert.Equal(target, command.GetProperty("parameters").GetProperty("featureId").GetString());
        Assert.Equal(1, wire.Commands);await bridge.CancelAsync(request);
    }

    [Fact]
    public async Task ExpiryDuringCatalogLoadCannotLeaveAnAssignedRequestWithoutCleanup()
    {
        await using var wire = new Wire { CatalogDelay = TimeSpan.FromMilliseconds(250) };
        await using var client = await wire.Connect();await using var bridge = new CadBridge(_ => Task.FromResult(client));
        var origin = await bridge.BeginVoiceAsync(Json("{\"voiceRequestId\":\"voice-expiry\",\"sessionId\":\"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\",\"documentId\":\"doc-phase1\",\"revision\":7}"), limits: new AgentLimits(maxDuration: TimeSpan.FromMilliseconds(100)));
        await Assert.ThrowsAsync<AgentBudgetExceededException>(() => bridge.BeginAsync("plate", new[] { Check() }, originRequestId: origin));
        // The second attempt must report the expired budget, not LOCKED by a leaked request.
        await Assert.ThrowsAsync<AgentBudgetExceededException>(() => bridge.BeginAsync("plate", new[] { Check() }, originRequestId: origin));
        Assert.Equal(0, wire.Commands);Assert.Equal(0, wire.Rollbacks);
        Assert.False(await bridge.EndVoiceAsync(origin));
        wire.CatalogDelay = TimeSpan.Zero;
        var next = await bridge.BeginAsync("fresh request", new[] { Check() });await bridge.CancelAsync(next);
    }

    [Fact]
    public async Task CanonicalRequestChecksRealQueryThenCommitsOneGroup()
    {
        await using var wire = new Wire();await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client));
        var request = await bridge.BeginAsync("plate", new[] { Check() });
        await bridge.CommandAsync(request, "CreateBox", Json("{\"widthMm\":100,\"heightMm\":50,\"depthMm\":20}"), "plate");
        var outcome = await bridge.CommitAsync(request);
        Assert.Equal("committed", outcome.GetProperty("status").GetString());
        Assert.Equal(1, wire.Commands);Assert.Equal(1, wire.Commits);Assert.Equal(0, wire.Rollbacks);
        var command = wire.Server.Received.Select(Json).Single(r => r.GetProperty("method").GetString() == "command");
        Assert.Equal("CreateBox", command.GetProperty("params").GetProperty("commandId").GetString());
        Assert.Equal(7, command.GetProperty("params").GetProperty("baseRevision").GetInt64());
        Assert.True(command.GetProperty("params").TryGetProperty("transactionId", out _));
        Assert.True(command.TryGetProperty("operationId", out _));
    }

    [Fact]
    public async Task WrongGoalMeasurementRollsBackAndCannotReportSuccess()
    {
        await using var wire = new Wire();await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client));
        var request = await bridge.BeginAsync("plate", new[] { Check(200000) });
        await bridge.CommandAsync(request, "CreateBox", Json("{}"), "plate");
        var outcome = await bridge.CommitAsync(request);
        Assert.Equal("validation_failed", outcome.GetProperty("status").GetString());
        Assert.Equal(0, wire.Commits);Assert.Equal(1, wire.Rollbacks);
    }

    [Fact]
    public async Task ForeignRequestAndRawInvokeCannotMutateOrReadStagedGeometry()
    {
        await using var wire = new Wire();await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client));
        var request = await bridge.BeginAsync("plate", new[] { Check() });
        await Assert.ThrowsAsync<SessionException>(() => bridge.BeginAsync("other", new[] { Check() }));
        await Assert.ThrowsAsync<SessionException>(() => bridge.CommandAsync("foreign", "CreateBox", Json("{}"), "plate"));
        await Assert.ThrowsAsync<ArgumentException>(() => bridge.QueryAsync(request, "invoke", Json("{\"type\":3}")));
        await Assert.ThrowsAsync<SessionException>(() => bridge.QueryAsync(null, "getFeatures", Json("{}")));
        Assert.Equal(0, wire.Commands);
        await bridge.CancelAsync(request);Assert.Equal(1, wire.Rollbacks);
    }

    [Fact]
    public async Task LimitsAndMissingPredicatesFailBeforeMutation()
    {
        await using var wire = new Wire();await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client));
        await Assert.ThrowsAsync<ArgumentException>(() => bridge.BeginAsync("plate", Array.Empty<CadCheck>()));
        var request = await bridge.BeginAsync("plate", new[] { Check() }, new AgentLimits(maxFeatures: 1));
        await bridge.CommandAsync(request, "CreateBox", Json("{}"), "plate");
        await Assert.ThrowsAsync<AgentBudgetExceededException>(() => bridge.CommandAsync(request, "CreateBox", Json("{}"), "other"));
        Assert.Equal(1, wire.Commands);await bridge.CancelAsync(request);
    }

    [Fact]
    public async Task LostCommitAckReconcilesAndReplaysOnlyTheSameOperation()
    {
        await using var wire = new Wire { DropCommitAck = true };await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client), TimeSpan.FromMilliseconds(100));
        var request = await bridge.BeginAsync("plate", new[] { Check() });
        await bridge.CommandAsync(request, "CreateBox", Json("{}"), "plate");
        var outcome = await bridge.CommitAsync(request);
        Assert.Equal("committed", outcome.GetProperty("status").GetString());
        Assert.Equal(1, wire.Commits);Assert.Equal(2, wire.CommitOperations.Count);
        Assert.Equal(wire.CommitOperations[0], wire.CommitOperations[1]);
    }

    [Fact]
    public async Task IdleRequestExpiresAndReleasesItsOwnedTransaction()
    {
        await using var wire = new Wire();await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client));
        await bridge.BeginAsync("plate", new[] { Check() }, new AgentLimits(maxDuration: TimeSpan.FromMilliseconds(100)));
        await Task.Delay(250);
        Assert.Equal(1, wire.Rollbacks);
        var next = await bridge.BeginAsync("next", new[] { Check() });
        await bridge.CancelAsync(next);
    }

    [Fact]
    public async Task MissingMeasurementReturnsAnExplicitFailedValidation()
    {
        await using var wire = new Wire();await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client));
        var request = await bridge.BeginAsync("plate", new[] { Check() with { Path = "missing" } });
        await bridge.CommandAsync(request, "CreateBox", Json("{}"), "plate");
        var result = await bridge.CommitAsync(request);
        Assert.Equal("validation_failed", result.GetProperty("status").GetString());
        Assert.Equal(JsonValueKind.Null, result.GetProperty("measurements")[0].GetProperty("actual").ValueKind);
        Assert.Equal(1, wire.Rollbacks);Assert.Equal(0, wire.Commits);
    }

    [Fact]
    public async Task VoiceCancellationRollsBackOnlyItsOwnedRequestAndRejectsLateOrigin()
    {
        await using var wire = new Wire();await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client));
        var context = Json("{\"voiceRequestId\":\"voice-1\",\"sessionId\":\"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\",\"documentId\":\"doc-phase1\",\"revision\":7}");
        var origin = await bridge.BeginVoiceAsync(context);
        await Assert.ThrowsAsync<SessionException>(() => bridge.BeginAsync("other", new[] { Check() }));
        var request = await bridge.BeginAsync("voice plate", new[] { Check() }, originRequestId: origin);
        await bridge.CommandAsync(request, "CreateBox", Json("{}"), "plate");
        Assert.True(await bridge.EndVoiceAsync(origin));Assert.Equal(1, wire.Rollbacks);
        await Assert.ThrowsAsync<SessionException>(() => bridge.BeginAsync("late", new[] { Check() }, originRequestId: origin));
    }

    [Fact]
    public async Task StaleQuestVoiceContextFailsBeforeStartingAgentOrTransaction()
    {
        await using var wire = new Wire();await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client));
        await Assert.ThrowsAsync<SessionException>(() => bridge.BeginVoiceAsync(Json("{\"voiceRequestId\":\"v\",\"sessionId\":\"other\",\"documentId\":\"doc-phase1\",\"revision\":7}")));
        Assert.Equal(0, wire.Commands);Assert.Equal(0, wire.Commits);
    }

    [Fact]
    public async Task VoiceCorrectionCannotResetCommandIterationBudget()
    {
        await using var wire = new Wire();await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client));
        var origin = await bridge.BeginVoiceAsync(Json("{\"voiceRequestId\":\"voice-1\",\"sessionId\":\"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\",\"documentId\":\"doc-phase1\",\"revision\":7}"), limits: new AgentLimits(maxIterations: 1));
        var first = await bridge.BeginAsync("plate", new[] { Check() }, originRequestId: origin);
        await bridge.CommandAsync(first, "CreateBox", Json("{}"), "plate");await bridge.CancelAsync(first);
        var correction = await bridge.BeginAsync("correct", new[] { Check() }, originRequestId: origin);
        var error = await Assert.ThrowsAsync<AgentBudgetExceededException>(() => bridge.CommandAsync(correction, "CreateBox", Json("{}"), "plate"));
        Assert.Equal("iterations", error.Limit);Assert.Equal(1, wire.Commands);
        await bridge.EndVoiceAsync(origin);
    }

    [Fact]
    public async Task VoiceCorrectionCannotResetFeatureBudgetOrWeakenOriginalGoal()
    {
        await using var wire = new Wire();await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client));
        var origin = await bridge.BeginVoiceAsync(Json("{\"voiceRequestId\":\"voice-1\",\"sessionId\":\"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\",\"documentId\":\"doc-phase1\",\"revision\":7}"), limits: new AgentLimits(maxFeatures: 1));
        var first = await bridge.BeginAsync("plate", new[] { Check() }, originRequestId: origin);
        await bridge.CommandAsync(first, "CreateBox", Json("{}"), "plate");await bridge.CancelAsync(first);
        await Assert.ThrowsAsync<ArgumentException>(() => bridge.BeginAsync("weaker", new[] { Check(50000) }, originRequestId: origin));
        var correction = await bridge.BeginAsync("correct", new[] { Check() }, originRequestId: origin);
        await Assert.ThrowsAsync<AgentBudgetExceededException>(() => bridge.CommandAsync(correction, "CreateBox", Json("{}"), "plate"));
        Assert.Equal(1, wire.Commands);await bridge.EndVoiceAsync(origin);
    }
}
