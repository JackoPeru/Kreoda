using System.Text.Json;
using System.Text.Json.Nodes;
using Kreoda.HermesBridge;

string Required(string name) => Environment.GetEnvironmentVariable(name) is { Length: > 0 } value
    ? value : throw new InvalidOperationException("Missing private bridge configuration: " + name);
var deviceFile = Required("KREODA_CAD_DEVICE_FILE");
var connector = new PrivateCadConnection(deviceFile, Environment.GetEnvironmentVariable("KREODA_CAD_SESSION_URL"),
    Environment.GetEnvironmentVariable("KREODA_CAD_PAIR"));
var recoveryFile = deviceFile + ".rollback-uncertain.json";
JsonElement? recovery = File.Exists(recoveryFile)
    ? JsonSerializer.Deserialize<JsonElement>(await File.ReadAllTextAsync(recoveryFile)) : null;
await using var cad = new CadBridge(connector.ConnectAsync,
    persistRecovery: state => PrivateCadConnection.SaveAsync(recoveryFile, state), initialRecovery: recovery);
HermesGatewayClient? hermes = null;
using var http = new HttpClient { Timeout = Timeout.InfiniteTimeSpan };
var hermesFile = Environment.GetEnvironmentVariable("KREODA_HERMES_CONFIG");
if (!string.IsNullOrWhiteSpace(hermesFile)) {
    var options = JsonSerializer.Deserialize<HermesOptions>(await File.ReadAllTextAsync(hermesFile), new JsonSerializerOptions(JsonSerializerDefaults.Web))
        ?? throw new InvalidOperationException("Private Hermes configuration unavailable");
    hermes = new HermesGatewayClient(http, options, async id => {
        var saved = JsonNode.Parse(await File.ReadAllTextAsync(hermesFile))!.AsObject();saved["conversationId"] = id;
        await PrivateCadConnection.SaveAsync(hermesFile, saved);
    });
}
var voiceToken = Environment.GetEnvironmentVariable("KREODA_VOICE_TOKEN");
await using var app = BridgeHost.Build(cad, Required("KREODA_HERMES_BRIDGE_URL"), hermes, voiceToken);
await app.RunAsync();
