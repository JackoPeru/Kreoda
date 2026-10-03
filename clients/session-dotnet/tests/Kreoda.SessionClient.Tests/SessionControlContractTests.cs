// Slice 7: C# mirror of schemas/session-control-v1.json stays pinned to it,
// and the typed DTOs send the contracted wire shape (errorCode/error kept).
using System.Text.Json;
using Kreoda.Session;
using Xunit;

namespace Kreoda.SessionClient.Tests;

public sealed class SessionControlContractTests
{
    private static JsonDocument LoadContract()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "schemas", "session-control-v1.json")))
            dir = dir.Parent;
        Assert.NotNull(dir);
        return JsonDocument.Parse(File.ReadAllText(
            Path.Combine(dir!.FullName, "schemas", "session-control-v1.json")));
    }

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
        ["sessionId"] = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        ["documentId"] = "doc-phase1",
        ["capabilities"] = new[] { "operation-replay" },
        ["revision"] = 0,
    });

    private static async Task<Session.SessionClient> BootAsync(LoopbackWsServer server, string token = "t")
    {
        var uri = new Uri($"ws://127.0.0.1:{server.Port}/");
        return await Session.SessionClient.ConnectAsync(uri, token, "xunit");
    }

    [Fact]
    public void MethodListAndRequiredFieldsMatchContract()
    {
        using var contract = LoadContract();
        var methods = contract.RootElement.GetProperty("methods").EnumerateArray().ToList();
        Assert.Equal(
            methods.Select(m => m.GetProperty("method").GetString()),
            SessionMethods.All);
        Assert.Equal(1, contract.RootElement.GetProperty("protocolVersion").GetInt32());
        foreach (var m in methods)
        {
            var name = m.GetProperty("method").GetString()!;
            Assert.True(SessionMethods.RequiredParams.ContainsKey(name), name);
            Assert.Equal(
                m.GetProperty("required").EnumerateArray().Select(e => e.GetString()),
                SessionMethods.RequiredParams[name]);
        }
        Assert.Equal(
            methods.Count,
            SessionMethods.RequiredParams.Count);
    }

    [Fact]
    public async Task TypedInvokeSendsContractedShape()
    {
        JsonElement seen = default;
        await using var server = new LoopbackWsServer(req =>
        {
            if (req.GetProperty("method").GetString() == "hello")
                return HelloReply(req);
            seen = req.Clone();
            return Reply(req, new Dictionary<string, object?>
            {
                ["featureId"] = "box-1",
                ["revision"] = 1,
            });
        });
        server.Start();
        await using var client = await BootAsync(server);
        var created = await client.InvokeAsync(new InvokeRequest(3,
            new Dictionary<string, object?>
            {
                ["featureId"] = "box-1",
                ["widthMm"] = 10.0,
            }));
        Assert.Equal("box-1", created.GetProperty("featureId").GetString());
        Assert.Equal("invoke", seen.GetProperty("method").GetString());
        Assert.Equal(3, seen.GetProperty("params").GetProperty("type").GetInt32());
        Assert.Equal("box-1", seen.GetProperty("params").GetProperty("fields").GetProperty("featureId").GetString());
        Assert.Equal("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", seen.GetProperty("sessionId").GetString());
        Assert.True(Guid.TryParse(seen.GetProperty("operationId").GetString(), out _));
    }

    [Fact]
    public async Task ConnectCanResumeLogicalClientIdentityAndCapturesSessionId()
    {
        JsonElement seenHello = default;
        await using var server = new LoopbackWsServer(req =>
        {
            seenHello = req.Clone();
            return HelloReply(req);
        });
        server.Start();
        var uri = new Uri($"ws://127.0.0.1:{server.Port}/");
        await using var client = await Session.SessionClient.ConnectAsync(
            uri,
            "t",
            "xunit",
            logicalClientId: "client-550e8400-e29b-41d4-a716-446655440000");

        Assert.Equal("client-550e8400-e29b-41d4-a716-446655440000",
            seenHello.GetProperty("params").GetProperty("clientId").GetString());
        Assert.Contains("operation-replay", seenHello.GetProperty("params").GetProperty("capabilities")
            .EnumerateArray().Select(capability => capability.GetString()));
        Assert.Equal("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            client.GetType().GetProperty("SessionId")?.GetValue(client));
        Assert.Contains("operation-replay", client.ServerCapabilities);
    }

    [Fact]
    public async Task ConnectWithDefaultCancellationTokenRemainsUnambiguous()
    {
        await using var server = new LoopbackWsServer(HelloReply);
        server.Start();
        var uri = new Uri($"ws://127.0.0.1:{server.Port}/");
        await using var client = await Session.SessionClient.ConnectAsync(
            uri, "t", "xunit", default);
        Assert.NotNull(client.ClientId);
    }

    [Fact]
    public async Task ExplicitReplayUsesTheSameOperationAndExpectedSessionIdentity()
    {
        var requests = new List<JsonElement>();
        await using var server = new LoopbackWsServer(req =>
        {
            if (req.GetProperty("method").GetString() == "hello")
                return HelloReply(req);
            requests.Add(req.Clone());
            return Reply(req, new Dictionary<string, object?> { ["featureId"] = "box-1" });
        });
        server.Start();
        await using var client = await BootAsync(server);
        var operationId = "11111111-1111-4111-8111-111111111111";
        var sessionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        var invokeParams = new Dictionary<string, object?>
        {
            ["type"] = 3,
            ["fields"] = new Dictionary<string, object?> { ["featureId"] = "box-1" },
        };

        await client.CallAsync(SessionMethods.Invoke, invokeParams,
            operationId: operationId, expectedSessionId: sessionId);
        var replayTask = client.ReplayOperationAsync(
            SessionMethods.Invoke, invokeParams, operationId, sessionId);
        await replayTask;

        Assert.Equal(2, requests.Count);
        Assert.Equal(operationId, requests[0].GetProperty("operationId").GetString());
        Assert.Equal(sessionId, requests[0].GetProperty("sessionId").GetString());
        Assert.Equal(operationId, requests[1].GetProperty("operationId").GetString());
        Assert.Equal(sessionId, requests[1].GetProperty("sessionId").GetString());
    }

    [Fact]
    public async Task LegacyServerCanInvokeButExplicitReplayNeedsAdvertisedCapability()
    {
        var requests = new List<JsonElement>();
        await using var server = new LoopbackWsServer(req =>
        {
            if (req.GetProperty("method").GetString() == "hello")
                return Reply(req, new Dictionary<string, object?>
                {
                    ["clientId"] = "client-1",
                    ["sessionId"] = "legacy-session-id",
                    ["documentId"] = "doc-phase1",
                    ["revision"] = 0,
                });
            requests.Add(req.Clone());
            return Reply(req, new Dictionary<string, object?> { ["featureId"] = "legacy-box" });
        });
        server.Start();
        await using var client = await BootAsync(server);
        var fields = new Dictionary<string, object?> { ["featureId"] = "legacy-box" };
        var result = await client.InvokeAsync(3, fields);
        Assert.Equal("legacy-box", result.GetProperty("featureId").GetString());
        Assert.Single(requests);
        Assert.False(requests[0].TryGetProperty("operationId", out _));

        var ex = await Assert.ThrowsAsync<SessionException>(() => client.ReplayOperationAsync(
            SessionMethods.Invoke,
            new Dictionary<string, object?>
            {
                ["type"] = 3,
                ["fields"] = fields,
            },
            "11111111-1111-4111-8111-111111111111",
            "legacy-session-id"));
        Assert.Equal("NOT_IMPLEMENTED", ex.Code);
        Assert.Single(requests);
    }

    [Fact]
    public async Task TypedTxnHelpersSendContractedShapes()
    {
        var methods = new List<string>();
        await using var server = new LoopbackWsServer(req =>
        {
            var method = req.GetProperty("method").GetString()!;
            if (method == "hello")
                return HelloReply(req);
            methods.Add(method);
            return method == "txnStatus"
                ? Reply(req, new Dictionary<string, object?> { ["open"] = false })
                : Reply(req, new Dictionary<string, object?> { ["transactionId"] = "t1" });
        });
        server.Start();
        await using var client = await BootAsync(server);
        await client.TxnBeginAsync("t1");
        await client.TxnCommitAsync("t1");
        await client.TxnRollbackAsync("t1");
        await client.TxnForceRollbackAsync("t1");
        var status = await client.TxnStatusAsync();
        Assert.False(status.GetProperty("open").GetBoolean());
        Assert.Equal(
            ["txnBegin", "txnCommit", "txnRollback", "txnForceRollback", "txnStatus"],
            methods);
    }

    [Fact]
    public async Task ErrorCodeAndMessageSurviveTheRoute()
    {
        await using var server = new LoopbackWsServer(req =>
            req.GetProperty("method").GetString() == "hello"
                ? HelloReply(req)
                : Reply(req, new Dictionary<string, object?>
                {
                    ["ok"] = false,
                    ["errorCode"] = "BAD_PARAMS",
                    ["error"] = "invoke needs an integer core command type",
                }));
        server.Start();
        await using var client = await BootAsync(server);
        var ex = await Assert.ThrowsAsync<SessionException>(() =>
            client.InvokeAsync(new InvokeRequest(0, new Dictionary<string, object?>())));
        Assert.Equal("BAD_PARAMS", ex.Code);
        Assert.Equal("invoke needs an integer core command type", ex.Message);
    }
}
