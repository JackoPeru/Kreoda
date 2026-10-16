using System.Collections.Concurrent;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using Kreoda.Session;
using Xunit;

namespace Kreoda.SessionClient.Tests;

public sealed class SketchProjectionClientTests
{
    private const string SessionA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    private const string SessionB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    private static readonly JsonSerializerOptions ProjectionJson = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    private sealed record Lineage(string SessionId, string DocumentId, long Revision);

    private static LoopbackWsServer CreateServer(
        Func<Lineage> lineage,
        Func<JsonElement, LoopbackWsResponse?> projection)
    {
        var server = new LoopbackWsServer(_ => null);
        server.ExtendedHandler = request =>
        {
            var method = request.GetProperty("method").GetString();
            LoopbackWsResponse? response = method switch
            {
                SessionMethods.Hello => new(HelloReply(request, lineage())),
                SessionMethods.Snapshot => new(SnapshotReply(request, lineage())),
                SessionMethods.GetSketchProjection => projection(request),
                _ => null,
            };
            return Task.FromResult(response);
        };
        return server;
    }

    private static async Task<Session.SessionClient> ConnectAsync(LoopbackWsServer server)
    {
        server.Start();
        var client = await Session.SessionClient.ConnectAsync(
            new Uri($"ws://127.0.0.1:{server.Port}/"), "t", "xunit");
        Assert.NotNull(client.Model);
        return client;
    }

    private static string HelloReply(JsonElement request, Lineage lineage) => Reply(request, new Dictionary<string, object?>
    {
        ["clientId"] = "client-1",
        ["sessionId"] = lineage.SessionId,
        ["documentId"] = lineage.DocumentId,
        ["revision"] = lineage.Revision,
        ["capabilities"] = new[] { SessionMethods.IncrementalDeltasCapability },
    });

    private static string SnapshotReply(JsonElement request, Lineage lineage) => Reply(request, new Dictionary<string, object?>
    {
        ["sessionId"] = lineage.SessionId,
        ["documentId"] = lineage.DocumentId,
        ["revision"] = lineage.Revision,
        ["features"] = Array.Empty<object>(),
        ["sketches"] = Array.Empty<object>(),
        ["bodies"] = Array.Empty<object>(),
        ["datums"] = Array.Empty<object>(),
    });

    private static string Reply(JsonElement request, IDictionary<string, object?> payload)
    {
        var response = new Dictionary<string, object?>
        {
            ["requestId"] = request.GetProperty("requestId").GetString(),
            ["ok"] = true,
        };
        foreach (var (key, value) in payload) response[key] = value;
        return JsonSerializer.Serialize(response);
    }

    private static string ProjectionReply(JsonElement request, Lineage lineage, object projection) => Reply(request,
        new Dictionary<string, object?>
        {
            ["sessionId"] = lineage.SessionId,
            ["documentId"] = lineage.DocumentId,
            ["revision"] = lineage.Revision,
            ["result"] = projection,
        });

    private static string ErrorReply(JsonElement request, string code = "QUERY_FAILED") => JsonSerializer.Serialize(new
    {
        requestId = request.GetProperty("requestId").GetString(),
        ok = false,
        errorCode = code,
        error = "projection query failed",
    });

    private static JsonElement Definition(params string[] entityIds) => JsonSerializer.SerializeToElement(new
    {
        version = 1,
        operation = "projectEdges",
        sources = new[] { new { type = "sketchEntities", featureId = "source", entityIds } },
    }, ProjectionJson);

    private static object Projection(JsonElement definition, long generation = 1) => new
    {
        featureId = "target",
        plane = new
        {
            origin = new[] { 0d, 0d, 0d },
            xAxis = new[] { 1d, 0d, 0d },
            yAxis = new[] { 0d, 1d, 0d },
            normal = new[] { 0d, 0d, 1d },
        },
        geometryCurrent = true,
        status = "ok",
        error = "",
        blockingSourceIds = Array.Empty<string>(),
        groups = new[]
        {
            new
            {
                groupId = "group",
                definition,
                sourceFeatureIds = new[] { "source" },
                status = "ok",
                error = "",
                blockingSourceIds = Array.Empty<string>(),
                generation,
                edges = new[]
                {
                    new
                    {
                        memberIndex = 0,
                        curveType = "line",
                        firstParameter = 0d,
                        lastParameter = 1d,
                        closed = false,
                        pointsMm = new[] { new[] { 0d, 0d, 0d }, new[] { 1d, 0d, 0d } },
                    },
                },
            },
        },
    };

    [Fact]
    public async Task TypedQueryCapturesRevisionAndOlderFailureCannotClearNewerSuccess()
    {
        var lineage = new Lineage(SessionA, "doc-phase1", 7);
        var requests = new ConcurrentQueue<JsonElement>();
        using var arrived = new SemaphoreSlim(0);
        var server = CreateServer(() => lineage, request =>
        {
            requests.Enqueue(request.Clone());
            arrived.Release();
            return new(null);
        });
        await using var ownedServer = server;
        await using var client = await ConnectAsync(server);

        var older = client.GetSketchProjectionAsync("target", "group");
        await arrived.WaitAsync(TimeSpan.FromSeconds(5));
        var newer = client.GetSketchProjectionAsync("target", "group");
        await arrived.WaitAsync(TimeSpan.FromSeconds(5));
        var received = requests.ToArray();
        Assert.Equal(2, received.Length);
        var parameters = received[0].GetProperty("params");
        Assert.Equal(SessionMethods.GetSketchProjection, received[0].GetProperty("method").GetString());
        Assert.Equal(SessionA, received[0].GetProperty("sessionId").GetString());
        Assert.Equal("target", parameters.GetProperty("featureId").GetString());
        Assert.Equal("group", parameters.GetProperty("groupId").GetString());
        Assert.Equal(7, parameters.GetProperty("expectedRevision").GetInt64());

        await server.PushAsync(ProjectionReply(received[1], lineage, Projection(Definition("circle"), generation: 2)));
        var current = await newer;
        Assert.Equal(2, current.Result.Groups.Single().Generation);
        await server.PushAsync(ErrorReply(received[0]));
        var olderFailure = await Assert.ThrowsAsync<SessionException>(() => older);
        Assert.Equal("QUERY_FAILED", olderFailure.Code);
        var cached = Assert.Single(client.SketchProjectionState.Current);
        Assert.Equal(2, cached.Result.Groups.Single().Generation);
    }

    [Fact]
    public async Task LatestQueryFailureClearsExistingProjectionDisplay()
    {
        var lineage = new Lineage(SessionA, "doc-phase1", 7);
        var requestCount = 0;
        var server = CreateServer(() => lineage, request =>
        {
            if (Interlocked.Increment(ref requestCount) == 1)
                return new(ProjectionReply(request, lineage, Projection(Definition("circle"))));
            return new(ErrorReply(request));
        });
        await using var ownedServer = server;
        await using var client = await ConnectAsync(server);

        _ = await client.GetSketchProjectionAsync("target", "group");
        Assert.Single(client.SketchProjectionState.Current);
        var error = await Assert.ThrowsAsync<SessionException>(() => client.GetSketchProjectionAsync("target", "group"));
        Assert.Equal("QUERY_FAILED", error.Code);
        Assert.Empty(client.SketchProjectionState.Current);
    }

    [Fact]
    public async Task DocumentSwitchRejectsLateReplyWhenNativeIdsAndGenerationAreReused()
    {
        var lineage = new Lineage(SessionA, "doc-phase1", 7);
        var oldLineage = lineage;
        var callCount = 0;
        var oldRequest = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        var nextModel = new TaskCompletionSource<SessionModelState>(TaskCreationOptions.RunContinuationsAsynchronously);
        var server = CreateServer(() => lineage, request =>
        {
            var sequence = Interlocked.Increment(ref callCount);
            if (sequence == 2)
            {
                oldRequest.TrySetResult(request.Clone());
                return new(null);
            }
            return new(ProjectionReply(request, lineage, Projection(Definition("circle"), generation: 1)));
        });
        await using var ownedServer = server;
        await using var client = await ConnectAsync(server);
        client.ModelChanged += update =>
        {
            if (update.Model.SessionId == SessionB && update.Model.DocumentId == "doc-next")
                nextModel.TrySetResult(update.Model);
        };

        var initial = await client.GetSketchProjectionAsync("target", "group");
        Assert.Equal(1, initial.Result.Groups.Single().Generation);
        var delayed = client.GetSketchProjectionAsync("target", "group");
        var staleRequest = await oldRequest.Task.WaitAsync(TimeSpan.FromSeconds(5));

        lineage = new Lineage(SessionB, "doc-next", 1);
        await server.PushAsync(JsonSerializer.Serialize(new
        {
            @event = "snapshot-required", sessionId = lineage.SessionId,
            documentId = lineage.DocumentId, revision = lineage.Revision,
        }));
        var switched = await nextModel.Task.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal(SessionB, switched.SessionId);
        Assert.Equal("doc-next", switched.DocumentId);
        Assert.Empty(client.SketchProjectionState.Current);

        var reusedIds = await client.GetSketchProjectionAsync("target", "group");
        Assert.Equal(1, reusedIds.Result.Groups.Single().Generation);
        Assert.Equal(SessionB, Assert.Single(client.SketchProjectionState.Current).SessionId);

        await server.PushAsync(ProjectionReply(staleRequest, oldLineage, Projection(Definition("circle"), generation: 1)));
        var staleError = await Assert.ThrowsAsync<SessionException>(() => delayed);
        Assert.Equal("NEED_FULL_SNAPSHOT", staleError.Code);
        var current = Assert.Single(client.SketchProjectionState.Current);
        Assert.Equal(SessionB, current.SessionId);
        Assert.Equal("doc-next", current.DocumentId);
        Assert.Equal(1, current.Result.Groups.Single().Generation);
    }

    [Fact]
    public async Task CoreRestartClearsProjectionStateBeforeSnapshotWithReusedIdsAndGeneration()
    {
        var lineage = new Lineage(SessionA, "doc-phase1", 7);
        var server = CreateServer(() => lineage, request =>
            new(ProjectionReply(request, lineage, Projection(Definition("circle"), generation: 1))));
        await using var ownedServer = server;
        await using var client = await ConnectAsync(server);
        var restarted = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        client.CoreRestarted += () => restarted.TrySetResult();

        _ = await client.GetSketchProjectionAsync("target", "group");
        Assert.Single(client.SketchProjectionState.Current);
        lineage = new Lineage(SessionB, "doc-phase1", 7);
        await server.PushAsync(JsonSerializer.Serialize(new
        {
            @event = "core-restarted", sessionId = lineage.SessionId,
            documentId = lineage.DocumentId, revision = lineage.Revision,
        }));
        await restarted.Task.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Null(client.Model);
        Assert.Empty(client.SketchProjectionState.Current);

        _ = await client.SnapshotAsync(lineage.DocumentId);
        Assert.Equal(SessionB, client.Model?.SessionId);
        var result = await client.GetSketchProjectionAsync("target", "group");
        Assert.Equal(1, result.Result.Groups.Single().Generation);
        var current = Assert.Single(client.SketchProjectionState.Current);
        Assert.Equal(SessionB, current.SessionId);
        Assert.Equal("doc-phase1", current.DocumentId);
        Assert.Equal(1, current.Result.Groups.Single().Generation);
    }

    [Fact]
    public async Task TypedQueryEnforcesUnicodeEntityAndExactDefinitionByteLimits()
    {
        var lineage = new Lineage(SessionA, "doc-phase1", 7);
        var requestCount = 0;
        var exactIds = EntityIdsForDefinitionSize(65536);
        var oversizedIds = EntityIdsForDefinitionSize(65537);
        Assert.Equal(65536, DefinitionByteCount(exactIds));
        Assert.Equal(65537, DefinitionByteCount(oversizedIds));
        var server = CreateServer(() => lineage, request =>
        {
            var index = Interlocked.Increment(ref requestCount);
            var ids = index switch
            {
                1 => new[] { new string('é', 203) + "a" },
                2 => new[] { new string('é', 303) + "a" },
                3 => exactIds,
                4 => oversizedIds,
                _ => throw new InvalidOperationException("unexpected projection query"),
            };
            return new(ProjectionReply(request, lineage, Projection(Definition(ids))));
        });
        await using var ownedServer = server;
        await using var client = await ConnectAsync(server);

        var acceptedUnicode = await client.GetSketchProjectionAsync("target", "group");
        var acceptedId = acceptedUnicode.Result.Groups.Single().Definition.Sources.Single().EntityIds!.Single();
        Assert.Equal(407, Encoding.UTF8.GetByteCount(acceptedId));
        Assert.Single(client.SketchProjectionState.Current);

        var oversizedUnicode = await Assert.ThrowsAsync<SessionException>(() => client.GetSketchProjectionAsync("target", "group"));
        Assert.Equal("BAD_MODEL", oversizedUnicode.Code);
        Assert.Empty(client.SketchProjectionState.Current);

        var exactBoundary = await client.GetSketchProjectionAsync("target", "group");
        Assert.Equal(128, exactBoundary.Result.Groups.Single().Definition.Sources.Single().EntityIds!.Length);
        Assert.Single(client.SketchProjectionState.Current);

        var oneByteOver = await Assert.ThrowsAsync<SessionException>(() => client.GetSketchProjectionAsync("target", "group"));
        Assert.Equal("BAD_MODEL", oneByteOver.Code);
        Assert.Empty(client.SketchProjectionState.Current);
    }

    private static int DefinitionByteCount(string[] entityIds) =>
        JsonSerializer.SerializeToUtf8Bytes(Definition(entityIds), ProjectionJson).Length;

    private static string[] EntityIdsForDefinitionSize(int targetBytes)
    {
        var ids = Enumerable.Range(0, 128).Select(index =>
        {
            var prefix = $"id{index:D3}";
            return prefix + new string((char)('a' + index % 26), 512 - prefix.Length);
        }).ToArray();
        var reduction = DefinitionByteCount(ids) - targetBytes;
        if (reduction <= 0 || reduction >= ids[^1].Length)
            throw new InvalidOperationException("could not fit the projection definition boundary fixture");
        ids[^1] = ids[^1][..^reduction];
        if (DefinitionByteCount(ids) != targetBytes)
            throw new InvalidOperationException("projection definition fixture missed its exact UTF-8 byte target");
        return ids;
    }
}
