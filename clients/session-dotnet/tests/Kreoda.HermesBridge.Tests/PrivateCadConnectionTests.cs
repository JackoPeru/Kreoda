using System.Net;
using System.Net.Sockets;
using System.Text.Json;
using Kreoda.HermesBridge;
using Kreoda.Session;
using Kreoda.SessionClient.Tests;
using Xunit;
using CadClient = Kreoda.Session.SessionClient;

namespace Kreoda.HermesBridge.Tests;

public sealed class PrivateCadConnectionTests
{
    static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    sealed class Pc : IAsyncDisposable
    {
        public LoopbackWsServer Socket { get; }
        public LoopbackDiscoveryServer Discovery { get; }
        public string SessionId { get; } = Guid.NewGuid().ToString("D");
        public bool InvalidSnapshot;
        public bool RejectSocketAuthentication;
        public Action? OnSnapshot;
        public string DocumentId = "mcp-current-document";
        public Pc()
        {
            Socket = new(Reply);Discovery = new(Socket.Port);Socket.Start();
        }
        string Reply(JsonElement request)
        {
            var method = request.GetProperty("method").GetString();
            var parameters = request.GetProperty("params");
            var fields = new Dictionary<string, object?> { ["requestId"] = request.GetProperty("requestId").GetString(), ["ok"] = true };
            if (method == SessionMethods.Authenticate) {
                var device = parameters.GetProperty("deviceId").GetString()!;
                if(RejectSocketAuthentication || !Discovery.Authenticate(device,parameters.GetProperty("credential").GetString()!)) {
                    fields["ok"] = false;fields["errorCode"] = "UNAUTHORIZED";fields["error"] = "fixture rejection";
                } else { fields["deviceId"] = device;fields["sessionToken"] = SessionDiscovery.CreateCredential(); }
            } else if (method == SessionMethods.Hello) {
                fields["clientId"] = parameters.GetProperty("clientId").GetString();fields["sessionId"] = SessionId;
                fields["documentId"] = DocumentId;fields["revision"] = 7;fields["capabilities"] = SessionMethods.ServerCapabilities;
            } else if (method == SessionMethods.Snapshot) {
                fields["sessionId"] = SessionId;fields["documentId"] = DocumentId;fields["revision"] = InvalidSnapshot ? -1 : 7;
                fields["features"] = Array.Empty<object>();fields["sketches"] = Array.Empty<object>();
                fields["datums"] = Array.Empty<object>();fields["bodies"] = Array.Empty<object>();
                OnSnapshot?.Invoke();
            }
            return JsonSerializer.Serialize(fields);
        }
        public async ValueTask DisposeAsync() { await Discovery.DisposeAsync();await Socket.DisposeAsync(); }
    }
    sealed class Files : IDisposable
    {
        public string Root { get; } = Path.Combine(Path.GetTempPath(), "kreoda-mcp-connect-" + Guid.NewGuid().ToString("N"));
        public string Active => Path.Combine(Root,"cad.json");
        public Files() => Directory.CreateDirectory(Root);
        public void Dispose()
        {
            var full = Path.GetFullPath(Root);
            var temp = Path.TrimEndingDirectorySeparator(Path.GetFullPath(Path.GetTempPath())) + Path.DirectorySeparatorChar;
            if(!full.StartsWith(temp,StringComparison.OrdinalIgnoreCase) || !Path.GetFileName(full).StartsWith("kreoda-mcp-connect-",StringComparison.Ordinal))
                throw new InvalidOperationException("Unexpected owned fixture cleanup path");
            Directory.Delete(full,true);
        }
    }
    static string ClosedUrl()
    {
        var socket = new TcpListener(IPAddress.Loopback,0);socket.Start();
        var port = ((IPEndPoint)socket.LocalEndpoint).Port;socket.Stop();return $"ws://127.0.0.1:{port}";
    }
    static CadDeviceConfiguration Configuration(Pc pc, string? endpoint = null, bool legacy = false) => new(
        endpoint ?? pc.Discovery.Pc.Endpoint.AbsoluteUri, pc.Discovery.DeviceId, pc.Discovery.Credential,
        "client-" + Guid.NewGuid().ToString("D"), legacy ? null : pc.Discovery.PcId,
        legacy ? null : pc.Discovery.Bootstrap.AbsoluteUri);
    static Task Write(string file, CadDeviceConfiguration config) => File.WriteAllTextAsync(file,JsonSerializer.Serialize(config,JsonOptions));

    [Fact]
    public async Task MovedEndpointUsesProvenPcAndCommitsOnlyItsCurrentAddress()
    {
        using var files = new Files();await using var pc = new Pc();
        var original = Configuration(pc,ClosedUrl());await Write(files.Active,original);
        var connector = new PrivateCadConnection(files.Active,null,null,pc.Discovery.DiscoveryTarget);
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(8));
        await using var client = await connector.ConnectAsync(deadline.Token);
        Assert.Equal(pc.DocumentId, client.Model!.DocumentId);
        var saved = JsonSerializer.Deserialize<CadDeviceConfiguration>(await File.ReadAllTextAsync(files.Active),JsonOptions)!;
        Assert.Equal(pc.Discovery.Pc.Endpoint.AbsoluteUri,saved.SessionUrl);
        Assert.Equal(original.Credential,saved.Credential);Assert.Equal(original.LogicalClientId,saved.LogicalClientId);
        Assert.Empty(pc.Discovery.PairRequests);Assert.NotEmpty(pc.Discovery.IdentifyRequests);
        Assert.Contains(pc.Socket.Received,raw=> {
            using var json=JsonDocument.Parse(raw);
            return json.RootElement.GetProperty("method").GetString()==SessionMethods.Hello &&
                json.RootElement.GetProperty("params").GetProperty("clientType").GetString()=="agent";
        });
    }

    [Theory]
    [InlineData(false)] [InlineData(true)]
    public async Task UnrelatedOrUnprovenPcNeverReceivesOldCredentialsOrChangesActiveFile(bool sameClaimedIdentity)
    {
        using var files = new Files();await using var pc = new Pc();
        var original = new CadDeviceConfiguration(ClosedUrl(),"device-"+Guid.NewGuid().ToString("D"),
            SessionDiscovery.CreateCredential(),"client-"+Guid.NewGuid().ToString("D"),
            sameClaimedIdentity ? pc.Discovery.PcId : Guid.NewGuid().ToString("D"));
        await Write(files.Active,original);var before=await File.ReadAllTextAsync(files.Active);
        var connector = new PrivateCadConnection(files.Active,null,null,pc.Discovery.DiscoveryTarget);
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(8));
        await Assert.ThrowsAsync<SessionException>(()=>connector.ConnectAsync(deadline.Token));
        Assert.Empty(pc.Socket.Received);Assert.Empty(pc.Discovery.PairRequests);
        Assert.Equal(before,await File.ReadAllTextAsync(files.Active));
        Assert.All(pc.Discovery.IdentifyRequests,request=>Assert.False(request.TryGetProperty("credential",out _)));
    }

    [Theory]
    [InlineData(false)] [InlineData(true)]
    public async Task RejectionOrInvalidSnapshotPreservesThePreviousActiveConfiguration(bool snapshot)
    {
        using var files = new Files();await using var pc = new Pc();
        pc.InvalidSnapshot=snapshot;pc.RejectSocketAuthentication=!snapshot;
        await Write(files.Active,Configuration(pc,ClosedUrl()));var before=await File.ReadAllTextAsync(files.Active);
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(8));
        await Assert.ThrowsAsync<SessionException>(()=>new PrivateCadConnection(files.Active,null,null,pc.Discovery.DiscoveryTarget).ConnectAsync(deadline.Token));
        Assert.Equal(before,await File.ReadAllTextAsync(files.Active));Assert.Empty(pc.Discovery.PairRequests);
    }

    [Fact]
    public async Task NewAgentEnrollsWithItsOwnIdentityWithoutPairingCodes()
    {
        using var files = new Files();await using var pc = new Pc();
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(8));
        await using var client=await new PrivateCadConnection(files.Active,null,null,pc.Discovery.DiscoveryTarget).ConnectAsync(deadline.Token);
        Assert.Equal(pc.DocumentId,client.Model!.DocumentId);
        var pair=Assert.Single(pc.Discovery.PairRequests);
        Assert.Equal("Hermes Kreoda MCP",pair.GetProperty("name").GetString());
        Assert.NotEqual(pc.Discovery.Credential,pair.GetProperty("credential").GetString());
        var saved=JsonSerializer.Deserialize<CadDeviceConfiguration>(await File.ReadAllTextAsync(files.Active),JsonOptions)!;
        Assert.Equal(pc.Discovery.PcId,saved.PcId);Assert.NotNull(saved.InstallationId);
        Assert.Equal(client.DeviceId,saved.DeviceId);Assert.Equal(2,pc.Discovery.DeviceCount);
    }

    [Fact]
    public async Task LostEnrollmentAcknowledgementReusesDurablePendingIdentityOnRestart()
    {
        using var files = new Files();await using var pc = new Pc();pc.Discovery.DropPairAcknowledgements=1;
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(12));
        await Assert.ThrowsAnyAsync<Exception>(()=>new PrivateCadConnection(files.Active,null,null,pc.Discovery.DiscoveryTarget).ConnectAsync(deadline.Token));
        Assert.False(File.Exists(files.Active));
        Assert.NotEmpty(pc.Discovery.PairRequests);
        await using var client=await new PrivateCadConnection(files.Active,null,null,pc.Discovery.DiscoveryTarget).ConnectAsync(deadline.Token);
        var requests=pc.Discovery.PairRequests.ToArray();Assert.True(requests.Length>=2);
        Assert.Single(requests.Select(request=>request.GetProperty("installationId").GetString()).Distinct());
        Assert.Single(requests.Select(request=>request.GetProperty("credential").GetString()).Distinct());
        Assert.Equal(2,pc.Discovery.DeviceCount);Assert.Equal(pc.DocumentId,client.Model!.DocumentId);
    }

    [Fact]
    public async Task LegacyConfigurationCanMigrateOnlyAfterThePcProvesItsExistingCredential()
    {
        using var files=new Files();await using var pc=new Pc();var original=Configuration(pc,ClosedUrl(),legacy:true);
        await Write(files.Active,original);using var deadline=new CancellationTokenSource(TimeSpan.FromSeconds(8));
        await using var client=await new PrivateCadConnection(files.Active,null,null,pc.Discovery.DiscoveryTarget).ConnectAsync(deadline.Token);
        var saved=JsonSerializer.Deserialize<CadDeviceConfiguration>(await File.ReadAllTextAsync(files.Active),JsonOptions)!;
        Assert.Equal(pc.Discovery.PcId,saved.PcId);Assert.Equal(original.Credential,saved.Credential);
        Assert.Empty(pc.Discovery.PairRequests);
    }

    [Fact]
    public async Task ExplicitLegacyEndpointRemainsUsableWhenDiscoveryIsQuiet()
    {
        using var files=new Files();await using var pc=new Pc();
        await Write(files.Active,Configuration(pc,legacy:true));
        var before=await File.ReadAllTextAsync(files.Active);
        var quiet=new IPEndPoint(IPAddress.Loopback,new Uri(ClosedUrl()).Port);
        using var deadline=new CancellationTokenSource(TimeSpan.FromSeconds(8));
        await using var client=await new PrivateCadConnection(files.Active,null,null,quiet).ConnectAsync(deadline.Token);
        Assert.Equal(pc.DocumentId,client.Model!.DocumentId);
        Assert.Equal(before,await File.ReadAllTextAsync(files.Active));
        Assert.Empty(pc.Discovery.PairRequests);
    }

    [Fact]
    public async Task PreferredPcAbsentDoesNotEnrollTheAvailableUnrelatedPc()
    {
        using var files=new Files();await using var pc=new Pc();
        using var deadline=new CancellationTokenSource(TimeSpan.FromSeconds(8));
        await Assert.ThrowsAsync<SessionException>(()=>new PrivateCadConnection(files.Active,null,null,
            pc.Discovery.DiscoveryTarget,Guid.NewGuid().ToString("D")).ConnectAsync(deadline.Token));
        Assert.False(File.Exists(files.Active));Assert.False(File.Exists(files.Active+".pending.json"));
        Assert.Empty(pc.Discovery.PairRequests);Assert.Empty(pc.Socket.Received);
    }

    [Fact]
    public async Task CancellationDuringSnapshotDoesNotReplaceActiveFile()
    {
        using var files=new Files();await using var pc=new Pc();
        await Write(files.Active,Configuration(pc,ClosedUrl()));var before=await File.ReadAllTextAsync(files.Active);
        using var deadline=new CancellationTokenSource(TimeSpan.FromSeconds(8));pc.OnSnapshot=deadline.Cancel;
        var error=await Assert.ThrowsAsync<SessionException>(()=>new PrivateCadConnection(files.Active,null,null,
            pc.Discovery.DiscoveryTarget).ConnectAsync(deadline.Token));
        Assert.Equal("CANCELLED",error.Code);
        Assert.Equal(before,await File.ReadAllTextAsync(files.Active));Assert.Empty(pc.Discovery.PairRequests);
        Assert.Empty(Directory.GetFiles(files.Root,"*.new-*"));
    }

    [Fact]
    public async Task FailedActivationKeepsPendingIdentityAndDoesNotEnrollAgain()
    {
        using var files=new Files();await using var pc=new Pc();pc.InvalidSnapshot=true;
        using var deadline=new CancellationTokenSource(TimeSpan.FromSeconds(12));
        await Assert.ThrowsAsync<SessionException>(()=>new PrivateCadConnection(files.Active,null,null,
            pc.Discovery.DiscoveryTarget).ConnectAsync(deadline.Token));
        Assert.False(File.Exists(files.Active));Assert.True(File.Exists(files.Active+".pending.json"));
        pc.InvalidSnapshot=false;
        await using var client=await new PrivateCadConnection(files.Active,null,null,pc.Discovery.DiscoveryTarget).ConnectAsync(deadline.Token);
        Assert.Single(pc.Discovery.PairRequests);Assert.Equal(2,pc.Discovery.DeviceCount);
        Assert.False(File.Exists(files.Active+".pending.json"));Assert.Equal(pc.DocumentId,client.Model!.DocumentId);
    }
}
