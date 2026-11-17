using System.Reflection;
using System.Runtime.Versioning;
using System.Text.Json;
using Kreoda.Session;
using Xunit;

namespace Kreoda.SessionClient.Tests;

public sealed class ManagedCompatibilityTests
{
    [Fact]
    public void TestLoadsTheRequestedManagedTargets()
    {
#if KREODA_NETSTANDARD_COMPAT
        const string expectedFramework = ".NETStandard,Version=v2.1";
#else
        const string expectedFramework = ".NETCoreApp,Version=v8.0";
#endif
        foreach (var assembly in new[] {
            typeof(global::Kreoda.Session.SessionClient).Assembly,
            typeof(global::Kreoda.QuestFoundation.BodyMesh).Assembly,
            typeof(global::Kreoda.Protocol.MeshUpdate).Assembly,
        })
            Assert.Equal(expectedFramework, assembly.GetCustomAttribute<TargetFrameworkAttribute>()?.FrameworkName);
    }
    [Fact]
    public async Task AdvertisedCapabilitiesCannotBeMutatedThroughCollectionInterfaces()
    {
        await using var server = new LoopbackWsServer(req => JsonSerializer.Serialize(new
        {
            requestId = req.GetProperty("requestId").GetString(),
            ok = true,
            clientId = "client-1",
            sessionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            capabilities = new[] { "operation-replay" },
            revision = 0,
        }));
        server.Start();

        await using var client = await Session.SessionClient.ConnectAsync(
            new Uri($"ws://127.0.0.1:{server.Port}/"), "token", "compat-test");
        var capabilities = Assert.IsAssignableFrom<ICollection<string>>(client.ServerCapabilities);

        Assert.Throws<NotSupportedException>(() => capabilities.Add("injected-capability"));
        Assert.Contains("operation-replay", client.ServerCapabilities);
        Assert.DoesNotContain("injected-capability", client.ServerCapabilities);
    }

    [Fact]
    public async Task CancellingSnapshotApplyWaitLeavesQueuedUpdatesRunning()
    {
        var revision = -1;
        await using var server = new LoopbackWsServer(req =>
        {
            var requestId = req.GetProperty("requestId").GetString();
            return req.GetProperty("method").GetString() switch
            {
                "hello" => JsonSerializer.Serialize(new
                {
                    requestId,
                    ok = true,
                    clientId = "client-1",
                    sessionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                    documentId = "doc-compat",
                    capabilities = new[] { "incremental-deltas" },
                    revision = 0,
                }),
                "snapshot" => JsonSerializer.Serialize(new
                {
                    requestId,
                    ok = true,
                    sessionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                    documentId = "doc-compat",
                    revision = Interlocked.Increment(ref revision),
                    features = Array.Empty<object>(),
                    sketches = Array.Empty<object>(),
                    bodies = Array.Empty<object>(),
                }),
                _ => throw new InvalidOperationException("unexpected session method"),
            };
        });
        server.Start();

        await using var client = await Session.SessionClient.ConnectAsync(
            new Uri($"ws://127.0.0.1:{server.Port}/"), "token", "compat-test");
        var updateEntered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var releaseUpdate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        client.ModelChanged += update =>
        {
            if (update.Model.Revision == 1)
            {
                updateEntered.TrySetResult();
                releaseUpdate.Task.GetAwaiter().GetResult();
            }
        };

        using var cancellation = new CancellationTokenSource();
        var snapshot = client.SnapshotAsync(ct: cancellation.Token);
        try
        {
            await updateEntered.Task.WaitAsync(TimeSpan.FromSeconds(5));
            cancellation.Cancel();
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => snapshot);
            Assert.Equal(1, client.Model!.Revision);
        }
        finally
        {
            releaseUpdate.TrySetResult();
        }

        using var followupTimeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        await client.SnapshotAsync(ct: followupTimeout.Token);
        Assert.Equal(2, client.Model!.Revision);
    }

    [Fact]
    public void GeneratedControlSerializationKeepsTheContractWireShape()
    {
        var serialized = new InvokeRequest(3,
            new Dictionary<string, object?> { ["featureId"] = "box-1", ["widthMm"] = 10.0 },
            "doc-compat").ToDictionary();

        Assert.Equal(3, ((JsonElement)serialized["type"]!).GetInt32());
        Assert.Equal("doc-compat", ((JsonElement)serialized["documentId"]!).GetString());
        Assert.Equal("box-1", ((JsonElement)serialized["fields"]!).GetProperty("featureId").GetString());
    }
}


