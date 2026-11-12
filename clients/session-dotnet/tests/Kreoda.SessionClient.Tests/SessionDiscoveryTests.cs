using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Text.Json;
using Kreoda.Session;
using Xunit;

namespace Kreoda.SessionClient.Tests;

public class SessionDiscoveryTests
{
    [Fact]
    public async Task KnownIdentityProofAuthenticatesTheActualHostAndBothPorts()
    {
        await using var server = new LoopbackDiscoveryServer(9876);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        Assert.True(await SessionDiscovery.VerifyKnownDeviceAsync(server.Pc, server.DeviceId, server.Credential, timeout.Token, true));
        Assert.Equal(2, server.IdentifyRequests.Single().GetProperty("proofVersion").GetInt32());
        Assert.False(await SessionDiscovery.VerifyKnownDeviceAsync(server.Pc with { Endpoint = new Uri("ws://127.0.0.1:9877") },
            server.DeviceId, server.Credential, timeout.Token, true));
        Assert.False(await SessionDiscovery.VerifyKnownDeviceAsync(server.Pc with { Endpoint = new Uri("ws://192.168.1.88:9876") },
            server.DeviceId, server.Credential, timeout.Token, true));
    }
    [Fact]
    public async Task LegacyIdentityOnlyProofCannotAuthorizeAChangedEndpoint()
    {
        await using var server = new LoopbackDiscoveryServer(9876) { LegacyProof = true };
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        Assert.False(await SessionDiscovery.VerifyKnownDeviceAsync(server.Pc with { Endpoint = new Uri("ws://127.0.0.1:9877") },
            server.DeviceId, server.Credential, timeout.Token, true));
    }

    static byte[] Reply(string nonce, string? id = null, string? name = null, int version = 1) =>
        JsonSerializer.SerializeToUtf8Bytes(new { protocol = "kreoda-discovery", version, nonce,
            pcId = id ?? Guid.NewGuid().ToString("D"), name = name ?? "Studio", sessionPort = 9842, bootstrapPort = 9844 });

    [Fact]
    public void DecodeBindsNonceAndSenderAndRejectsInvalidPackets()
    {
        var nonce = Guid.NewGuid().ToString("D");
        var sender = new IPEndPoint(IPAddress.Parse("192.168.1.8"), 9843);
        var bytes = Reply(nonce);
        Assert.Equal("192.168.1.8", SessionDiscovery.Decode(bytes, sender, nonce)!.Endpoint.Host);
        Assert.Null(SessionDiscovery.Decode(bytes, sender, "wrong"));
        Assert.Null(SessionDiscovery.Decode(Reply(nonce, version: 2), sender, nonce));
        Assert.Null(SessionDiscovery.Decode(Reply(nonce, name: new string('x', 81)), sender, nonce));
        Assert.Null(SessionDiscovery.Decode(new byte[4097], sender, nonce));
        Assert.Null(SessionDiscovery.Decode(bytes, new IPEndPoint(IPAddress.Parse("8.8.8.8"), 9843), nonce));
        Assert.Null(SessionDiscovery.Decode(Encoding.UTF8.GetBytes("{}"), sender, nonce));
    }

    [Fact]
    public void ChoiceIsAutomaticOnlyForKnownOrUniquePc()
    {
        var first = new DiscoveredSessionPc(Guid.NewGuid().ToString("D"), "Studio", new Uri("ws://192.168.1.1:1"), new Uri("http://192.168.1.1:2/pair"));
        var second = first with { PcId = Guid.NewGuid().ToString("D"), Name = "Office" };
        Assert.Null(SessionDiscovery.Choose(Array.Empty<DiscoveredSessionPc>(), null));
        Assert.Equal(first, SessionDiscovery.Choose(new[] { first }, null));
        Assert.Null(SessionDiscovery.Choose(new[] { first, second }, null));
        Assert.Equal(second, SessionDiscovery.Choose(new[] { first, second }, second.PcId));
        Assert.Null(SessionDiscovery.Choose(new[] { second }, first.PcId)); // Known PC offline: never jump to a different model.
        var moved = first with { Endpoint = new Uri("ws://192.168.1.99:10") };
        Assert.Equal(moved, SessionDiscovery.Choose(new[] { moved, second }, first.PcId));
    }

    [Fact]
    public async Task ActualUdpDiscoveryExpiresAndCancellationClosesPendingReceive()
    {
        using var server = new UdpClient(new IPEndPoint(IPAddress.Loopback, 0));
        var target = (IPEndPoint)server.Client.LocalEndPoint!;
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        var finding = SessionDiscovery.FindAsync(deadline.Token, target);
        var request = await server.ReceiveAsync(deadline.Token);
        using var json = JsonDocument.Parse(request.Buffer);
        var nonce = json.RootElement.GetProperty("nonce").GetString()!;
        var id = Guid.NewGuid().ToString("D");
        await server.SendAsync(Reply("wrong"), request.RemoteEndPoint, deadline.Token);
        await server.SendAsync(Reply(nonce, id), request.RemoteEndPoint, deadline.Token);
        var peers = await finding;
        Assert.Single(peers);Assert.Equal(id, peers[0].PcId);
        using var cancel = new CancellationTokenSource(30);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => SessionDiscovery.FindAsync(cancel.Token, target));
    }

    static Task<DiscoveredSessionPc[]> FindWithHintAsync(CancellationToken ct, IPEndPoint testTarget, IPAddress knownHost)
    {
        var overload = typeof(SessionDiscovery).GetMethod("FindAsync", new[] {
            typeof(CancellationToken), typeof(IPEndPoint), typeof(IPAddress) });
        if (overload == null) return SessionDiscovery.FindAsync(ct, testTarget);
        return (Task<DiscoveredSessionPc[]>)overload.Invoke(null, new object[] { ct, testTarget, knownHost })!;
    }

    [Fact]
    public async Task DiscoverySendsProtocolOnlyProbeToKnownHostAlongsideTestTarget()
    {
        using var ordinary = new UdpClient(new IPEndPoint(IPAddress.Loopback, 0));
        var ordinaryTarget = (IPEndPoint)ordinary.Client.LocalEndPoint!;
        var knownHost = IPAddress.Parse("127.0.0.2");
        using var hinted = new UdpClient(new IPEndPoint(knownHost, ordinaryTarget.Port));
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        var ordinaryRequest = ordinary.ReceiveAsync(timeout.Token).AsTask();
        var hintedRequest = hinted.ReceiveAsync(timeout.Token).AsTask();
        var finding = FindWithHintAsync(timeout.Token, ordinaryTarget, knownHost);
        try
        {
            var first = await ordinaryRequest;
            using var ordinaryJson = JsonDocument.Parse(first.Buffer);
            var nonce = ordinaryJson.RootElement.GetProperty("nonce").GetString()!;
            Assert.Equal(3, ordinaryJson.RootElement.EnumerateObject().Count());
            await ordinary.SendAsync(Reply(nonce, "11111111-1111-4111-8111-111111111111"), first.RemoteEndPoint, timeout.Token);

            Assert.True(ReferenceEquals(hintedRequest, await Task.WhenAny(hintedRequest, finding)),
                "known private host must receive the same discovery probe in addition to the current target");
            var second = await hintedRequest;
            using var hintedJson = JsonDocument.Parse(second.Buffer);
            Assert.Equal(nonce, hintedJson.RootElement.GetProperty("nonce").GetString());
            Assert.Equal(3, hintedJson.RootElement.EnumerateObject().Count());
            await hinted.SendAsync(Reply(nonce, "22222222-2222-4222-8222-222222222222"), second.RemoteEndPoint, timeout.Token);

            var peers = await finding;
            Assert.Contains(peers, peer => peer.PcId == "11111111-1111-4111-8111-111111111111");
            var hintedPeer = Assert.Single(peers, peer => peer.PcId == "22222222-2222-4222-8222-222222222222");
            Assert.Equal(knownHost.ToString(), hintedPeer.Endpoint.Host);
            Assert.Equal(9842, hintedPeer.Endpoint.Port);
            Assert.Equal(9844, hintedPeer.Bootstrap.Port);
        }
        finally
        {
            timeout.Cancel();
            try { await hintedRequest; } catch (OperationCanceledException) { }
        }
    }

    [Fact]
    public async Task OfflineKnownHostHintDoesNotSuppressDelayedOrdinaryFixtureReply()
    {
        using var ordinary = new UdpClient(new IPEndPoint(IPAddress.Loopback, 0));
        var ordinaryTarget = (IPEndPoint)ordinary.Client.LocalEndPoint!;
        var offlineHint = IPAddress.Parse("127.0.0.3");
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        var ordinaryRequest = ordinary.ReceiveAsync(timeout.Token).AsTask();
        var finding = FindWithHintAsync(timeout.Token, ordinaryTarget, offlineHint);
        try
        {
            var request = await ordinaryRequest;
            using var json = JsonDocument.Parse(request.Buffer);
            var nonce = json.RootElement.GetProperty("nonce").GetString()!;
            await Task.Delay(150, timeout.Token);
            var id = "33333333-3333-4333-8333-333333333333";
            await ordinary.SendAsync(Reply(nonce, id), request.RemoteEndPoint, timeout.Token);

            var peers = await finding;
            var discovered = Assert.Single(peers);
            Assert.Equal(id, discovered.PcId);
            Assert.Equal(IPAddress.Loopback.ToString(), discovered.Endpoint.Host);
        }
        finally
        {
            timeout.Cancel();
            try { await ordinaryRequest; } catch (OperationCanceledException) { }
            try { await finding; } catch (OperationCanceledException) { }
        }
    }

    [Fact]
    public async Task CancellationDuringOfflineHintRecoveryStillPropagates()
    {
        using var ordinary = new UdpClient(new IPEndPoint(IPAddress.Loopback, 0));
        var ordinaryTarget = (IPEndPoint)ordinary.Client.LocalEndPoint!;
        using var cancel = new CancellationTokenSource(TimeSpan.FromMilliseconds(50));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => FindWithHintAsync(cancel.Token,
            ordinaryTarget, IPAddress.Parse("127.0.0.3")));
    }

    [Theory]
    [InlineData("10.2.3.4", true)]
    [InlineData("172.20.3.4", true)]
    [InlineData("192.168.3.4", true)]
    [InlineData("8.8.8.8", false)]
    [InlineData("127.0.0.1", false)]
    [InlineData("::1", false)]
    public void CachedDiscoveryHintMustBePrivateIpv4(string host, bool expected)
    {
        Assert.Equal(expected, SessionDiscovery.IsPrivate(IPAddress.Parse(host)));
        Assert.Equal(expected || host == "127.0.0.1", SessionDiscovery.IsPrivate(IPAddress.Parse(host), true));
    }

    [Fact]
    public void CredentialIsOpaqueRandom32ByteSecret()
    {
        var first = SessionDiscovery.CreateCredential();
        Assert.Matches("^[A-Za-z0-9_-]{43}$", first);
        Assert.NotEqual(first, SessionDiscovery.CreateCredential());
    }

    [Fact]
    public async Task MissingUdpResponderIsAnEmptyResultInsteadOfAConnectionFailure()
    {
        var socket = new UdpClient(new IPEndPoint(IPAddress.Loopback, 0));
        var target = (IPEndPoint)socket.Client.LocalEndPoint!;socket.Dispose();
        using var timeout = new CancellationTokenSource(5000);
        Assert.Empty(await SessionDiscovery.FindAsync(timeout.Token, target));
    }
}
