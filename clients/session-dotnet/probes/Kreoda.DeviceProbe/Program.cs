using System.Text.Json;
using Kreoda.Session;

string Setting(string name) => Environment.GetEnvironmentVariable(name) ?? throw new InvalidOperationException("missing device probe setting");
void Check(bool value) { if (!value) throw new InvalidOperationException("device probe assertion failed"); }
var uri = new Uri(Setting("KREODA_DEVICE_PROBE_URL"));
var pair = await SessionClient.PairAsync(uri, Setting("KREODA_DEVICE_PROBE_PAIR"), "compiled-dotnet-device", "device-probe");
var passed = new List<string> { "compiled-csharp-pair-and-hello" };
await using (var client = pair.Client)
{
    Check(client.DeviceId == pair.DeviceId && client.Model is not null);
    var info = await client.InvokeAsync(1, new Dictionary<string, object?>());
    Check(info.GetProperty("occtVersion").GetString() == "8.0.1-native");
    var edited = await client.CommandAsync("SetDimension", new Dictionary<string, object?>
        { ["featureId"] = "box", ["paramName"] = "widthMm", ["valueMm"] = 25 });
    var snapshot = await client.SnapshotAsync();
    Check(snapshot.GetProperty("revision").GetInt64() == edited.GetProperty("revision").GetInt64());
    Check(Math.Abs(snapshot.GetProperty("features").EnumerateArray().Single(x => x.GetProperty("featureId").GetString() == "box").GetProperty("volumeMm3").GetDouble() - 7500) < 1e-5);
    passed.Add("paired-csharp-existing-native-edit");
    await client.InvokeAsync(8, new Dictionary<string, object?>());
    snapshot = await client.SnapshotAsync();
    Check(Math.Abs(snapshot.GetProperty("features").EnumerateArray().Single(x => x.GetProperty("featureId").GetString() == "box").GetProperty("volumeMm3").GetDouble() - 6000) < 1e-5);
    passed.Add("paired-csharp-native-undo");
}
await using (var returning = await SessionClient.ConnectDeviceAsync(uri, pair.DeviceId, pair.Credential, "device-probe"))
{
    Check(returning.DeviceId == pair.DeviceId && returning.Model is not null);
    var model = returning.Model ?? throw new InvalidOperationException("missing returning model");
    Check(model.Features.Any(x => x.GetProperty("featureId").GetString() == "box"));
    passed.Add("returning-csharp-credential-authentication-snapshot");
}
Console.WriteLine(JsonSerializer.Serialize(new { passed, credentialsLogged = false,
    boundary = "Compiled C# client and real native session over an assigned interface; no Unity or remote device." }));
