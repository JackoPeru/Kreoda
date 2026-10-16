using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using Kreoda.Session;
using Xunit;

namespace Kreoda.SessionClient.Tests;

public class SessionDiscoveryTests
{
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
