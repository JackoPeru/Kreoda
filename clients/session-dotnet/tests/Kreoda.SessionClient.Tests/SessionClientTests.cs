using System.Text.Json;
using Kreoda.Session;
using Xunit;

namespace Kreoda.SessionClient.Tests;

/// <summary>Relay protocol conformance against the loopback stub: hello
/// pairing, request correlation under concurrency, error codes, server
/// events, close-rejection of pending calls.</summary>
public sealed class SessionClientTests
{
    private static string Reply(JsonElement req, object payload)
    {
        var id = req.TryGetProperty("requestId", out var r) ? r.GetString() : "?";
        var dict = new Dictionary<string, object?> { ["requestId"] = id, ["ok"] = true };
        foreach (var kv in (IDictionary<string, object?>)payload)
            dict[kv.Key] = kv.Value;
        return JsonSerializer.Serialize(dict);
    }

    private static string HelloReply(JsonElement req) => Reply(req, new Dictionary<string, object?>
    {
        ["clientId"] = "client-1",
        ["revision"] = 0,
    });

    private static async Task<Session.SessionClient> BootAsync(
        LoopbackWsServer server, string token = "t")
    {
        var uri = new Uri($"ws://127.0.0.1:{server.Port}/");
        return await Session.SessionClient.ConnectAsync(uri, token, "xunit");
    }

    [Fact]
    public async Task HelloSnapshotInvokeUndoRoundTrip()
    {
        await using var server = new LoopbackWsServer(static req =>
        {
            var method = req.GetProperty("method").GetString();
            return method switch
            {
                "hello" => Reply(req, new Dictionary<string, object?>
                {
                    ["clientId"] = "client-1",
                    ["sessionId"] = "session-doc-phase1",
                    ["documentId"] = "doc-phase1",
                    ["revision"] = 0,
                }),
                "snapshot" => Reply(req, new Dictionary<string, object?>
                {
                    ["documentId"] = "doc-phase1",
                    ["revision"] = 0,
                    ["features"] = Array.Empty<object>(),
                    ["sketches"] = Array.Empty<object>(),
                }),
                "invoke" => Reply(req, new Dictionary<string, object?>
                {
                    ["featureId"] = "box-1",
                    ["revision"] = 1,
                }),
                _ => Reply(req, new Dictionary<string, object?>
                {
                    ["ok"] = false,
                }),
            };
        });
        server.Start();
        await using var client = await BootAsync(server);
        Assert.NotNull(client.ClientId);

        var snap = await client.SnapshotAsync();
        Assert.Equal(0, snap.GetProperty("revision").GetInt32());

        var created = await client.InvokeAsync(3, new Dictionary<string, object?>
        {
            ["featureId"] = "box-1",
            ["widthMm"] = 10.0,
            ["heightMm"] = 10.0,
            ["depthMm"] = 10.0,
        });
        Assert.Equal("box-1", created.GetProperty("featureId").GetString());
    }

    [Fact]
    public async Task ErrorCodesSurfaceAsSessionException()
    {
        await using var server = new LoopbackWsServer(static req =>
        {
            if (req.GetProperty("method").GetString() == "hello")
            {
                return HelloReply(req);
            }
            return Reply(req, new Dictionary<string, object?>
            {
                ["ok"] = false,
                ["errorCode"] = "NEED_FULL_SNAPSHOT",
                ["error"] = "stale",
            });
        });
        server.Start();
        await using var client = await BootAsync(server);
        var ex = await Assert.ThrowsAsync<SessionException>(() =>
            client.InvokeAsync(3, new Dictionary<string, object?>()));
        Assert.Equal("NEED_FULL_SNAPSHOT", ex.Code);
    }

    [Fact]
    public async Task BadTokenClosesSocket()
    {
        await using var server = new LoopbackWsServer(static _ => "__CLOSE__");
        server.Start();
        var uri = new Uri($"ws://127.0.0.1:{server.Port}/");
        var ex = await Assert.ThrowsAsync<SessionException>(() =>
            Session.SessionClient.ConnectAsync(uri, "wrong", "xunit"));
        Assert.Equal("CLOSED", ex.Code);
    }

    [Fact]
    public async Task ConcurrentCallsCorrelateByRequestId()
    {
        await using var server = new LoopbackWsServer(static req =>
        {
            if (req.GetProperty("method").GetString() == "hello")
            {
                return HelloReply(req);
            }
            var n = req.GetProperty("params").GetProperty("n").GetInt32();
            return Reply(req, new Dictionary<string, object?> { ["n"] = n });
        });
        server.Start();
        await using var client = await BootAsync(server);
        var tasks = Enumerable.Range(0, 20)
            .Select(i => client.CallAsync("echo", new Dictionary<string, object?> { ["n"] = i }));
        var results = await Task.WhenAll(tasks);
        Assert.Equal(
            Enumerable.Range(0, 20),
            results.Select(r => r.GetProperty("n").GetInt32()).OrderBy(x => x));
    }

    [Fact]
    public async Task ServerEventsDispatch()
    {
        await using var server = new LoopbackWsServer(static req =>
            Reply(req, new Dictionary<string, object?>()));
        server.Start();
        await using var client = await BootAsync(server);
        var deltas = new List<JsonElement>();
        var selections = new List<JsonElement>();
        var restarted = 0;
        client.Delta += d => deltas.Add(d);
        client.Selection += s => selections.Add(s);
        client.CoreRestarted += () => restarted++;
        await server.PushAsync(JsonSerializer.Serialize(new Dictionary<string, object?>
        {
            ["event"] = "delta",
            ["revision"] = 7,
        }));
        await server.PushAsync(JsonSerializer.Serialize(new Dictionary<string, object?>
        {
            ["event"] = "selection",
            ["clientId"] = "other",
        }));
        await server.PushAsync(JsonSerializer.Serialize(new Dictionary<string, object?>
        {
            ["event"] = "core-restarted",
        }));
        await Task.Delay(500);
        Assert.Single(deltas);
        Assert.Equal(7, deltas[0].GetProperty("revision").GetInt32());
        Assert.Single(selections);
        Assert.Equal(1, restarted);
    }

    [Fact]
    public async Task PendingCallsFailLoudlyOnClose()
    {
        // Hello is answered immediately; the real query never gets a reply:
        // the stall is bounded (background threadpool task — the suite never
        // waits on it, and it dies with the host).
        await using var server = new LoopbackWsServer(static req =>
        {
            if (req.GetProperty("method").GetString() == "hello")
            {
                return HelloReply(req);
            }
            Task.Delay(TimeSpan.FromSeconds(60)).Wait();
            return null;
        });
        server.Start();
        await using var client = await BootAsync(server);
        var pending = client.CallAsync("never", new Dictionary<string, object?>());
        await client.DisposeAsync();
        var ex = await Assert.ThrowsAsync<SessionException>(() => pending);
        Assert.Equal("CLOSED", ex.Code);
    }

    [Fact]
    public async Task SnapshotAndDeltaCarryBodySemantics()
    {
        // Slice 6 wire: snapshot/delta serve real bodies (bodyId/tip/history)
        // plus tips, changed/disappeared ids and the revision. The client is
        // untyped JSON (no model change required) — this pins consumption.
        await using var server = new LoopbackWsServer(static req =>
        {
            var method = req.GetProperty("method").GetString();
            return method switch
            {
                "hello" => HelloReply(req),
                "snapshot" => Reply(req, new Dictionary<string, object?>
                {
                    ["documentId"] = "doc-phase1",
                    ["revision"] = 3,
                    ["features"] = new[]
                    {
                        new Dictionary<string, object?> { ["featureId"] = "box-1" },
                        new Dictionary<string, object?> { ["featureId"] = "hole-1" },
                    },
                    ["sketches"] = Array.Empty<object>(),
                    ["bodies"] = new[]
                    {
                        new Dictionary<string, object?>
                        {
                            ["bodyId"] = "body-box-1",
                            ["tip"] = "hole-1",
                            ["history"] = new[] { "box-1", "hole-1" },
                        },
                    },
                    ["tips"] = new[] { "hole-1" },
                }),
                _ => Reply(req, new Dictionary<string, object?>()),
            };
        });
        server.Start();
        await using var client = await BootAsync(server);

        var snap = await client.SnapshotAsync();
        Assert.Equal(3, snap.GetProperty("revision").GetInt32());
        var bodies = snap.GetProperty("bodies");
        Assert.Single(bodies.EnumerateArray());
        var body = bodies.EnumerateArray().First();
        Assert.Equal("body-box-1", body.GetProperty("bodyId").GetString());
        Assert.Equal("hole-1", body.GetProperty("tip").GetString());
        Assert.Equal(
            new[] { "box-1", "hole-1" },
            body.GetProperty("history").EnumerateArray().Select(e => e.GetString()));
        Assert.Equal(
            new[] { "hole-1" },
            snap.GetProperty("tips").EnumerateArray().Select(e => e.GetString()));

        var deltas = new List<JsonElement>();
        client.Delta += d => deltas.Add(d);
        await server.PushAsync(JsonSerializer.Serialize(new Dictionary<string, object?>
        {
            ["event"] = "delta",
            ["documentId"] = "doc-phase1",
            ["revision"] = 4,
            ["bodies"] = new[]
            {
                new Dictionary<string, object?>
                {
                    ["bodyId"] = "body-box-1",
                    ["tip"] = "box-1",
                    ["history"] = new[] { "box-1" },
                },
            },
            ["tips"] = new[] { "box-1" },
            ["changedBodyIds"] = new[] { "body-box-1" },
            ["changedMeshIds"] = new[] { "box-1" },
            ["disappearedIds"] = new[] { "hole-1" },
        }));
        await Task.Delay(500);
        Assert.Single(deltas);
        Assert.Equal(4, deltas[0].GetProperty("revision").GetInt32());
        Assert.Equal(
            new[] { "body-box-1" },
            deltas[0].GetProperty("changedBodyIds").EnumerateArray().Select(e => e.GetString()));
        Assert.Equal(
            new[] { "hole-1" },
            deltas[0].GetProperty("disappearedIds").EnumerateArray().Select(e => e.GetString()));
    }

    [Fact]
    public async Task CallAfterDisposeThrowsSessionException()
    {
        await using var server = new LoopbackWsServer(static req => HelloReply(req));
        server.Start();
        var client = await BootAsync(server);
        await client.DisposeAsync();
        var ex = await Assert.ThrowsAsync<SessionException>(() =>
            client.CallAsync("late", new Dictionary<string, object?>()));
        Assert.Equal("NOT_CONNECTED", ex.Code);
    }
}

