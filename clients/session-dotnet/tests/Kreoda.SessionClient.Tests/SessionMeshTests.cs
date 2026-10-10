using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Google.FlatBuffers;
using Kreoda.Protocol;
using Kreoda.Session;
using Xunit;

namespace Kreoda.SessionClient.Tests;

public sealed class SessionMeshTests
{
    private const string Session = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

    private static string JsonReply(JsonElement request, object payload)
    {
        var id = request.GetProperty("requestId").GetString();
        var reply = new Dictionary<string, object?> { ["requestId"] = id, ["ok"] = true };
        foreach (var pair in (IDictionary<string, object?>)payload) reply[pair.Key] = pair.Value;
        return JsonSerializer.Serialize(reply);
    }

    private static string HelloReply(JsonElement request, string[]? capabilities = null, string sessionId = Session,
        string documentId = "doc-phase1", long revision = 7) => JsonReply(request, new Dictionary<string, object?>
    {
        ["clientId"] = "client-1", ["sessionId"] = sessionId, ["documentId"] = documentId, ["revision"] = revision,
        ["capabilities"] = capabilities ?? [SessionMethods.BinaryMeshV1Capability],
    });

    private static string MeshHeader(JsonElement request, string nativeId, int quality, int byteLength,
        string sessionId = Session, string documentId = "doc-phase1", long revision = 7,
        string bodyId = "body-root", string tipId = "tip-1", string? instanceId = null)
    {
        var result = new Dictionary<string, object?>
        {
            ["nativeRequestId"] = nativeId, ["sessionId"] = sessionId, ["documentId"] = documentId,
            ["revision"] = revision, ["bodyId"] = bodyId, ["featureId"] = tipId, ["tipId"] = tipId,
            ["quality"] = quality, ["byteLength"] = byteLength,
        };
        if (instanceId is not null) result["instanceId"] = instanceId;
        return JsonSerializer.Serialize(new { requestId = request.GetProperty("requestId").GetString(), ok = true, result });
    }

    private static byte[] FloatBytes(float[] values) => MemoryMarshal.AsBytes(values.AsSpan()).ToArray();
    private static byte[] UintBytes(uint[] values) => MemoryMarshal.AsBytes(values.AsSpan()).ToArray();

    private static byte[] MeshFrame(string requestId, int quality, long revision = 7, uint[]? indices = null, string tipId = "tip-1", bool includeEdges = true)
    {
        var positions = new[] { 0f, 0f, 0f, 1f, 0f, 0f, 0f, 1f, 0f };
        var normals = new[] { 0f, 0f, 1f, 0f, 0f, 1f, 0f, 0f, 1f };
        var edges = new[] { 0f, 0f, 0f, 1f, 0f, 0f };
        var triangleIndices = indices ?? [0, 1, 2];
        var builder = new FlatBufferBuilder(1024);
        var featureId = builder.CreateString(tipId);
        var nativeId = builder.CreateString(requestId);
        var positionsOffset = MeshUpdate.CreatePositionsVector(builder, FloatBytes(positions));
        var normalsOffset = MeshUpdate.CreateNormalsVector(builder, FloatBytes(normals));
        var indicesOffset = MeshUpdate.CreateIndicesVector(builder, UintBytes(triangleIndices));
        var edgesOffset = includeEdges ? MeshUpdate.CreateEdgeVerticesVector(builder, FloatBytes(edges)) : default;
        var face = FaceRange.CreateFaceRange(builder, builder.CreateString("face-1"), 0, 1);
        var facesOffset = MeshUpdate.CreateFacesVector(builder, [face]);
        var edgeRangesOffset = default(VectorOffset);
        if (includeEdges)
        {
            var edge = EdgeRange.CreateEdgeRange(builder, builder.CreateString("edge-1"), 0, 2);
            edgeRangesOffset = MeshUpdate.CreateEdgesVector(builder, [edge]);
        }
        var bboxOffset = MeshUpdate.CreateBboxMmVector(builder, [0, 0, 0, 1, 1, 1]);
        var mesh = MeshUpdate.CreateMeshUpdate(builder, featureId, featureId, (sbyte)quality, nativeId,
            (uint)positions.Length, (uint)normals.Length, (uint)triangleIndices.Length,
            positionsOffset, normalsOffset, indicesOffset, edgesOffset, facesOffset, edgeRangesOffset,
            1, bboxOffset, revision);
        builder.Finish(mesh.Value);
        return builder.SizedByteArray();
    }

    [Fact]
    public async Task RequestMeshLodValidatesHeaderAndFragmentedMeshForEveryQuality()
    {
        await using var server = new LoopbackWsServer(_ => null);
        var sent = new List<JsonElement>();
        var selection = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        server.ExtendedHandler = async request =>
        {
            var method = request.GetProperty("method").GetString();
            if (method == SessionMethods.Hello) return new LoopbackWsResponse(HelloReply(request));
            if (method != SessionMethods.RequestMeshLOD) return null;
            lock (sent) sent.Add(request.Clone());
            var quality = request.GetProperty("params").GetProperty("quality").GetInt32();
            var nativeId = $"native-{quality}";
            var mesh = MeshFrame(nativeId, quality);
            return new LoopbackWsResponse(
                MeshHeader(request, nativeId, quality, mesh.Length), mesh, FragmentSize: 5,
                AfterTextSent: quality == 0 ? async () =>
                {
                    var json = "{\"event\":\"selection\",\"clientId\":\"remote\",\"sessionId\":\"stale-session\",\"documentId\":\"stale-doc\",\"revision\":999,\"ids\":[\"face-面\"]}";
                    var bytes = Encoding.UTF8.GetBytes(json);
                    var split = Array.IndexOf(bytes, (byte)0xE9) + 1;
                    await server.PushFragmentedAsync(json, split);
                } : null);
        };
        server.Start();
        var uri = new Uri($"ws://127.0.0.1:{server.Port}/");
        await using var client = await Kreoda.Session.SessionClient.ConnectAsync(uri, "t", "xunit");
        client.Selection += value => selection.TrySetResult(value.Clone());
        using (var hello = JsonDocument.Parse(Assert.Single(server.Received)))
        {
            var offered = hello.RootElement.GetProperty("params").GetProperty("capabilities").EnumerateArray()
                .Select(value => value.GetString());
            Assert.Contains(SessionMethods.BinaryMeshV1Capability, offered);
        }

        for (var quality = 0; quality <= 2; quality++)
        {
            var mesh = await client.RequestMeshLodAsync("body-root", quality, "doc-phase1", 7);
            Assert.Equal("body-root", mesh.Header.BodyId);
            Assert.Equal("tip-1", mesh.Header.FeatureId);
            Assert.Equal("tip-1", mesh.Header.TipId);
            Assert.Equal(quality, mesh.Header.Quality);
            Assert.Equal(7, mesh.Header.Revision);
            Assert.Equal(mesh.Header.ByteLength, mesh.RawByteLength);
            Assert.Equal("native-" + quality, mesh.Header.NativeRequestId);
            Assert.Equal(9, mesh.Positions.Length);
            Assert.Equal(9, mesh.Normals.Length);
            Assert.Equal(new uint[] { 0, 1, 2 }, mesh.Indices);
            Assert.Equal(new float[] { 0, 0, 0, 1, 0, 0 }, mesh.EdgeVertices);
            Assert.Equal("face-1", Assert.Single(mesh.Faces).PersistentFaceId);
            Assert.Equal("edge-1", Assert.Single(mesh.Edges).PersistentEdgeId);
        }

        var selected = await selection.Task.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal("face-面", selected.GetProperty("ids")[0].GetString());
        lock (sent)
        {
            Assert.Equal(3, sent.Count);
            foreach (var request in sent)
            {
                Assert.Equal(SessionMethods.RequestMeshLOD, request.GetProperty("method").GetString());
                Assert.Equal(Session, request.GetProperty("sessionId").GetString());
                Assert.Equal("body-root", request.GetProperty("params").GetProperty("bodyId").GetString());
                Assert.Equal("doc-phase1", request.GetProperty("params").GetProperty("documentId").GetString());
                Assert.Equal(7, request.GetProperty("params").GetProperty("expectedRevision").GetInt64());
            }
        }
    }

    [Fact]
    public async Task RequestMeshLodCarriesOptionalInstanceIdentityWithoutChangingRootBodyIdentity()
    {
        const string instanceId = "instance-1";
        await using var server = new LoopbackWsServer(_ => null);
        server.ExtendedHandler = request =>
        {
            var method = request.GetProperty("method").GetString();
            if (method == SessionMethods.Hello) return Task.FromResult<LoopbackWsResponse?>(new(HelloReply(request)));
            Assert.Equal(instanceId, request.GetProperty("params").GetProperty("instanceId").GetString());
            var mesh = MeshFrame("native-instance", 2, tipId: instanceId);
            return Task.FromResult<LoopbackWsResponse?>(new(
                MeshHeader(request, "native-instance", 2, mesh.Length, bodyId: "body-root", tipId: instanceId, instanceId: instanceId), mesh));
        };
        server.Start();
        var uri = new Uri($"ws://127.0.0.1:{server.Port}/");
        await using var client = await Kreoda.Session.SessionClient.ConnectAsync(uri, "t", "xunit");
        var mesh = await client.RequestMeshLodAsync("body-root", 2, "doc-phase1", 7, instanceId: instanceId);
        Assert.Equal("body-root", mesh.Header.BodyId);
        Assert.Equal(instanceId, mesh.Header.FeatureId);
        Assert.Equal(instanceId, mesh.Header.TipId);
        Assert.Equal(instanceId, mesh.Header.InstanceId);
        Assert.Equal("native-instance", mesh.Header.NativeRequestId);
    }

    [Fact]
    public async Task MissingOptionalEdgeVerticesAreAcceptedWhenNoEdgesArePresent()
    {
        await using var server = new LoopbackWsServer(_ => null);
        server.ExtendedHandler = request =>
        {
            var method = request.GetProperty("method").GetString();
            if (method == SessionMethods.Hello) return Task.FromResult<LoopbackWsResponse?>(new(HelloReply(request)));
            const string nativeId = "native-no-edges";
            var mesh = MeshFrame(nativeId, 1, includeEdges: false);
            return Task.FromResult<LoopbackWsResponse?>(new(MeshHeader(request, nativeId, 1, mesh.Length), mesh));
        };
        server.Start();
        var uri = new Uri($"ws://127.0.0.1:{server.Port}/");
        await using var client = await Kreoda.Session.SessionClient.ConnectAsync(uri, "t", "xunit");

        var mesh = await client.RequestMeshLodAsync("body-root", 1, "doc-phase1", 7);

        Assert.Empty(mesh.EdgeVertices);
        Assert.Empty(mesh.Edges);
        Assert.Equal(9, mesh.Positions.Length);
    }

    [Fact]
    public async Task NativeBlindHoleMeshPreservesRepeatedAmbiguousFaceAndEdgeRanges()
    {
        var raw = await File.ReadAllBytesAsync(Path.Combine(AppContext.BaseDirectory, "Fixtures", "native-blind-hole.meshfb"));
        await using var server = new LoopbackWsServer(_ => null);
        server.ExtendedHandler = request =>
        {
            var method = request.GetProperty("method").GetString();
            if (method == SessionMethods.Hello)
                return Task.FromResult<LoopbackWsResponse?>(new(HelloReply(request, revision: 2)));
            return Task.FromResult<LoopbackWsResponse?>(new(
                MeshHeader(request, "mesh-blind-hole", 1, raw.Length, revision: 2,
                    bodyId: "hole-blind", tipId: "hole-blind"), raw));
        };
        server.Start();
        var uri = new Uri($"ws://127.0.0.1:{server.Port}/");
        await using var client = await Kreoda.Session.SessionClient.ConnectAsync(uri, "t", "native-fixture");

        var mesh = await client.RequestMeshLodAsync("hole-blind", 1, "doc-phase1", 2);

        Assert.Equal(264, mesh.Indices.Length / 3);
        Assert.Equal(new[]
        {
            new SessionMeshFaceRange("hole-blind:box.+Z", 4, 67),
            new SessionMeshFaceRange("hole-blind:box.+Z", 203, 61),
        }, mesh.Faces.Where(range => range.PersistentFaceId == "hole-blind:box.+Z"));
        Assert.Equal(new[]
        {
            new SessionMeshEdgeRange("hole-blind:edge.cir.box.+Z~wall.0", 18, 21),
            new SessionMeshEdgeRange("hole-blind:edge.cir.box.+Z~wall.0", 47, 21),
        }, mesh.Edges.Where(range => range.PersistentEdgeId == "hole-blind:edge.cir.box.+Z~wall.0"));
    }

    [Fact]
    public async Task RequestMeshLodFailsLocallyWhenOldServerOmitsCapability()
    {
        await using var server = new LoopbackWsServer(request => HelloReply(request, [SessionMethods.OperationReplayCapability]));
        server.Start();
        var uri = new Uri($"ws://127.0.0.1:{server.Port}/");
        await using var client = await Kreoda.Session.SessionClient.ConnectAsync(uri, "t", "xunit");
        var error = await Assert.ThrowsAsync<SessionException>(() => client.RequestMeshLodAsync("body-root", 1, "doc-phase1", 7));
        Assert.Equal("NOT_IMPLEMENTED", error.Code);
        lock (server.Received)
            Assert.Single(server.Received);
    }

    [Fact]
    public async Task MeshJsonErrorAndMalformedBinaryFailPendingRequest()
    {
        await using var server = new LoopbackWsServer(_ => null);
        server.ExtendedHandler = request =>
        {
            var method = request.GetProperty("method").GetString();
            if (method == SessionMethods.Hello) return Task.FromResult<LoopbackWsResponse?>(new(HelloReply(request)));
            var error = JsonSerializer.Serialize(new { requestId = request.GetProperty("requestId").GetString(), ok = false, errorCode = "BAD_PARAMS", error = "native query rejected" });
            return Task.FromResult<LoopbackWsResponse?>(new(error));
        };
        server.Start();
        var uri = new Uri($"ws://127.0.0.1:{server.Port}/");
        await using var client = await Kreoda.Session.SessionClient.ConnectAsync(uri, "t", "xunit");
        var error = await Assert.ThrowsAsync<SessionException>(() => client.RequestMeshLodAsync("body-root", 1, "doc-phase1", 7));
        Assert.Equal("BAD_PARAMS", error.Code);
    }

    [Fact]
    public async Task MalformedFlatBufferHasExplicitMeshError()
    {
        await using var server = new LoopbackWsServer(_ => null);
        server.ExtendedHandler = request =>
        {
            var method = request.GetProperty("method").GetString();
            if (method == SessionMethods.Hello) return Task.FromResult<LoopbackWsResponse?>(new(HelloReply(request)));
            var mesh = new byte[] { 1, 2, 3, 4, 5, 6, 7, 8 };
            return Task.FromResult<LoopbackWsResponse?>(new(MeshHeader(request, "native-1", 1, mesh.Length), mesh));
        };
        server.Start();
        var uri = new Uri($"ws://127.0.0.1:{server.Port}/");
        await using var client = await Kreoda.Session.SessionClient.ConnectAsync(uri, "t", "xunit");
        var error = await Assert.ThrowsAsync<SessionException>(() => client.RequestMeshLodAsync("body-root", 1, "doc-phase1", 7));
        Assert.Equal("INVALID_MESH", error.Code);
    }

    [Fact]
    public async Task ControlMessagesAreCappedAtFourMiBBeforeBufferGrowth()
    {
        await using var server = new LoopbackWsServer(_ => null);
        var oversized = JsonSerializer.Serialize(new { @event = "selection", value = new string('x', 4 * 1024 * 1024) });
        server.ExtendedHandler = request =>
        {
            if (request.GetProperty("method").GetString() == SessionMethods.Hello)
                return Task.FromResult<LoopbackWsResponse?>(new(HelloReply(request)));
            return Task.FromResult<LoopbackWsResponse?>(new(null, AfterTextSent: () => server.PushAsync(oversized)));
        };
        server.Start();
        var uri = new Uri($"ws://127.0.0.1:{server.Port}/");
        await using var client = await Kreoda.Session.SessionClient.ConnectAsync(uri, "t", "xunit");
        var error = await Assert.ThrowsAsync<SessionException>(() => client.RequestMeshLodAsync("body-root", 1, "doc-phase1", 7));
        Assert.Equal("MESSAGE_TOO_LARGE", error.Code);
    }

    [Fact]
    public async Task SemanticIndexBoundsAreCheckedAfterFlatBufferVerification()
    {
        await using var server = new LoopbackWsServer(_ => null);
        server.ExtendedHandler = request =>
        {
            var method = request.GetProperty("method").GetString();
            if (method == SessionMethods.Hello) return Task.FromResult<LoopbackWsResponse?>(new(HelloReply(request)));
            const string nativeId = "native-invalid";
            var mesh = MeshFrame(nativeId, 1, indices: [0, 1, 3]);
            return Task.FromResult<LoopbackWsResponse?>(new(MeshHeader(request, nativeId, 1, mesh.Length), mesh));
        };
        server.Start();
        var uri = new Uri($"ws://127.0.0.1:{server.Port}/");
        await using var client = await Kreoda.Session.SessionClient.ConnectAsync(uri, "t", "xunit");
        var error = await Assert.ThrowsAsync<SessionException>(() => client.RequestMeshLodAsync("body-root", 1, "doc-phase1", 7));
        Assert.Equal("INVALID_MESH", error.Code);
    }

    [Fact]
    public async Task CanceledHeaderAndLateBinaryCannotAttachToNextRequest()
    {
        await using var server = new LoopbackWsServer(_ => null);
        var headerSent = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var releaseFirst = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var firstRawSent = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var requestNumber = 0;
        server.ExtendedHandler = request =>
        {
            var method = request.GetProperty("method").GetString();
            if (method == SessionMethods.Hello) return Task.FromResult<LoopbackWsResponse?>(new(HelloReply(request)));
            var number = Interlocked.Increment(ref requestNumber);
            var nativeId = number == 1 ? "native-canceled" : "native-next";
            var mesh = MeshFrame(nativeId, 1);
            return Task.FromResult<LoopbackWsResponse?>(new(
                MeshHeader(request, nativeId, 1, mesh.Length), mesh,
                AfterTextSent: number == 1 ? () => { headerSent.TrySetResult(); return Task.CompletedTask; } : null,
                BeforeBinary: number == 1 ? releaseFirst.Task : null,
                AfterBinarySent: number == 1 ? () => { firstRawSent.TrySetResult(); return Task.CompletedTask; } : null));
        };
        server.Start();
        var uri = new Uri($"ws://127.0.0.1:{server.Port}/");
        await using var client = await Kreoda.Session.SessionClient.ConnectAsync(uri, "t", "xunit");
        using var cts = new CancellationTokenSource();
        var canceled = client.RequestMeshLodAsync("body-root", 1, "doc-phase1", 7, cts.Token);
        await headerSent.Task.WaitAsync(TimeSpan.FromSeconds(5));
        cts.Cancel();
        Assert.Equal("CANCELLED", (await Assert.ThrowsAsync<SessionException>(() => canceled)).Code);
        releaseFirst.TrySetResult();
        await firstRawSent.Task.WaitAsync(TimeSpan.FromSeconds(5));
        var next = await client.RequestMeshLodAsync("body-root", 1, "doc-phase1", 7);
        Assert.Equal("native-next", next.Header.NativeRequestId);
    }

    [Fact]
    public async Task KnownLineageReplacementRejectsMeshArrivingAfterHeader()
    {
        await using var server = new LoopbackWsServer(_ => null);
        server.ExtendedHandler = request =>
        {
            var method = request.GetProperty("method").GetString();
            if (method == SessionMethods.Hello) return Task.FromResult<LoopbackWsResponse?>(new(HelloReply(request)));
            var mesh = MeshFrame("native-stale", 1);
            return Task.FromResult<LoopbackWsResponse?>(new(
                MeshHeader(request, "native-stale", 1, mesh.Length), mesh,
                AfterTextSent: async () => await server.PushAsync(JsonSerializer.Serialize(new { @event = "core-restarted", sessionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }))));
        };
        server.Start();
        var uri = new Uri($"ws://127.0.0.1:{server.Port}/");
        await using var client = await Kreoda.Session.SessionClient.ConnectAsync(uri, "t", "xunit");
        var error = await Assert.ThrowsAsync<SessionException>(() => client.RequestMeshLodAsync("body-root", 1, "doc-phase1", 7));
        Assert.Equal("NEED_FULL_SNAPSHOT", error.Code);
    }

    [Fact]
    public async Task SnapshotRequiredReplacesDocumentLineageAndRetiresOldMeshReply()
    {
        const string nextSession = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
        const string nextDocument = "doc-next";
        byte[]? lateOldMesh = null;
        var meshRequests = 0;
        await using var server = new LoopbackWsServer(_ => null);
        server.ExtendedHandler = async request =>
        {
            var method = request.GetProperty("method").GetString();
            if (method == SessionMethods.Hello)
                return new LoopbackWsResponse(HelloReply(request,
                    [SessionMethods.BinaryMeshV1Capability, SessionMethods.IncrementalDeltasCapability]));
            if (method == SessionMethods.Snapshot)
            {
                var documentId = request.GetProperty("params").GetProperty("documentId").GetString()!;
                var next = documentId == nextDocument;
                var payload = new Dictionary<string, object?>
                {
                    ["sessionId"] = next ? nextSession : Session,
                    ["documentId"] = next ? nextDocument : "doc-phase1",
                    ["revision"] = next ? 1 : 7,
                    ["features"] = Array.Empty<object>(),
                    ["sketches"] = Array.Empty<object>(),
                    ["bodies"] = Array.Empty<object>(),
                };
                return new LoopbackWsResponse(JsonReply(request, payload), AfterTextSent: next && lateOldMesh is not null
                    ? () => server.PushBinaryAsync(lateOldMesh)
                    : null);
            }
            if (method != SessionMethods.RequestMeshLOD) return null;
            if (Interlocked.Increment(ref meshRequests) == 1)
            {
                const string nativeId = "native-retired";
                lateOldMesh = MeshFrame(nativeId, 1);
                var required = JsonSerializer.Serialize(new
                {
                    @event = "snapshot-required", sessionId = nextSession, documentId = nextDocument, revision = 1,
                });
                return new LoopbackWsResponse(MeshHeader(request, nativeId, 1, lateOldMesh.Length),
                    AfterTextSent: () => server.PushAsync(required));
            }
            const string nextNativeId = "native-current";
            var currentMesh = MeshFrame(nextNativeId, 2, revision: 1, tipId: "tip-next");
            return new LoopbackWsResponse(MeshHeader(request, nextNativeId, 2, currentMesh.Length,
                nextSession, nextDocument, 1, "body-next", "tip-next"), currentMesh);
        };
        server.Start();
        var uri = new Uri($"ws://127.0.0.1:{server.Port}/");
        await using var client = await Kreoda.Session.SessionClient.ConnectAsync(uri, "t", "xunit");
        var nextModel = new TaskCompletionSource<SessionModelState>(TaskCreationOptions.RunContinuationsAsynchronously);
        client.ModelChanged += update =>
        {
            if (update.Model.SessionId == nextSession && update.Model.DocumentId == nextDocument)
                nextModel.TrySetResult(update.Model);
        };

        var oldRequest = client.RequestMeshLodAsync("body-root", 1, "doc-phase1", 7);
        var oldError = await Assert.ThrowsAsync<SessionException>(() => oldRequest);
        Assert.Equal("NEED_FULL_SNAPSHOT", oldError.Code);
        var currentModel = await nextModel.Task.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal(nextSession, currentModel.SessionId);
        Assert.Equal(nextDocument, currentModel.DocumentId);
        Assert.Equal(1, currentModel.Revision);
        var current = await client.RequestMeshLodAsync("body-next", 2, nextDocument, 1);
        Assert.Equal(nextSession, current.Header.SessionId);
        Assert.Equal(nextDocument, current.Header.DocumentId);
        Assert.Equal("tip-next", current.Header.FeatureId);
        Assert.Equal("native-current", current.Header.NativeRequestId);
    }
}
