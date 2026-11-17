using System.Text.Json;
using System.Text.Json.Nodes;
using Kreoda.HermesBridge;

string Required(string name) => Environment.GetEnvironmentVariable(name) is { Length: > 0 } value
    ? value : throw new InvalidOperationException("Missing private bridge configuration: " + name);
// Optional private records are bounded and may be corrupt (power loss);
// neither may take the MCP endpoint down.
static async Task<byte[]?> PrivateRead(string path) {
    var info = new FileInfo(path);
    if (!info.Exists || info.Length > 65536) return null;
    return await File.ReadAllBytesAsync(path);
}
var deviceFile = Required("KREODA_CAD_DEVICE_FILE");
var connector = new PrivateCadConnection(deviceFile, Environment.GetEnvironmentVariable("KREODA_CAD_SESSION_URL"),
    Environment.GetEnvironmentVariable("KREODA_CAD_PAIR"), preferredPcId: Environment.GetEnvironmentVariable("KREODA_CAD_PC_ID"));
var recoveryFile = deviceFile + ".rollback-uncertain.json";
JsonElement? recovery = null;
if (File.Exists(recoveryFile)) {
    try {
        var recoveryBytes = await PrivateRead(recoveryFile);
        if (recoveryBytes == null) throw new JsonException("oversized recovery record");
        recovery = JsonSerializer.Deserialize<JsonElement>(recoveryBytes);
    }
    catch (Exception error) when (error is JsonException or IOException or UnauthorizedAccessException) {
        // Keep the fence: an unreadable record still blocks mutation until a
        // person inspects it. Never pretend the transaction was reconciled.
        Console.Error.WriteLine("rollback recovery record is unreadable; CAD stays fenced");
        recovery = JsonSerializer.SerializeToElement(new {
            requestId = "unreadable", transactionId = "unreadable", recoveryUnreadable = true,
        });
    }
}
await using var cad = new CadBridge(connector.ConnectAsync,
    persistRecovery: state => PrivateCadConnection.SaveAsync(recoveryFile, state), initialRecovery: recovery);
HermesGatewayClient? hermes = null;
using var http = new HttpClient { Timeout = Timeout.InfiniteTimeSpan };
var hermesFile = Environment.GetEnvironmentVariable("KREODA_HERMES_CONFIG");
if (!string.IsNullOrWhiteSpace(hermesFile)) {
    HermesOptions? options = null;
    try {
        options = await PrivateRead(hermesFile) is { } hermesBytes
            ? JsonSerializer.Deserialize<HermesOptions>(hermesBytes, new JsonSerializerOptions(JsonSerializerDefaults.Web)) : null;
    }
    catch (Exception error) when (error is JsonException or IOException or UnauthorizedAccessException) {
        options = null;
    }
    if (options == null) {
        // Voice is optional; CAD/MCP keeps working with an explicit log line.
        Console.Error.WriteLine("private Hermes configuration is unreadable; voice disabled");
    } else {
        try {
            hermes = new HermesGatewayClient(http, options, async id => {
                var saved = JsonNode.Parse(await File.ReadAllTextAsync(hermesFile))!.AsObject();saved["conversationId"] = id;
                await PrivateCadConnection.SaveAsync(hermesFile, saved);
            });
        }
        catch (ArgumentException) {
            // Valid JSON but invalid private fields: keep CAD/MCP available.
            Console.Error.WriteLine("private Hermes configuration is invalid; voice disabled");
        }
    }
}
var voiceToken = Environment.GetEnvironmentVariable("KREODA_VOICE_TOKEN");
await using var app = BridgeHost.Build(cad, Required("KREODA_HERMES_BRIDGE_URL"), hermes, voiceToken);
await app.RunAsync();
