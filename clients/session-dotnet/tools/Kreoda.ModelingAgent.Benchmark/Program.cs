using System.Diagnostics;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Kreoda.ModelingAgent.Benchmark;
using Kreoda.QuestFoundation;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;

// One fixture per invocation. The caller owns an isolated empty native document;
// this runner never resets, imports, saves or edits an existing user's model.
if(args.Length!=3) {
    Console.Error.WriteLine("Usage: benchmark <frozen-requirements.json> <fixture-id> <new-report.json>; configuration paths via KREODA_BENCHMARK_VOICE_CONFIG and KREODA_BENCHMARK_HERMES_CONFIG, MCP URL via KREODA_BENCHMARK_MCP_URL");return 2;
}
var output=Path.GetFullPath(args[2]);
if(File.Exists(output))throw new IOException("Refusing to overwrite a previous attempt");
var requirementBytes=File.ReadAllBytes(args[0]);
var sha=FrozenRequirements.Verify(requirementBytes);
using var requirements=JsonDocument.Parse(requirementBytes);
var fixture=requirements.RootElement.GetProperty("fixtures").EnumerateArray().Single(f=>f.GetProperty("id").GetString()==args[1]).Clone();
using var configuration=JsonDocument.Parse(File.ReadAllBytes(Environment.GetEnvironmentVariable("KREODA_BENCHMARK_VOICE_CONFIG")??throw new InvalidOperationException("Private voice config required")));
var privateVoice=configuration.RootElement;
using var voice=new HermesVoiceClient(new Uri(privateVoice.GetProperty("endpoint").GetString()!),privateVoice.GetProperty("token").GetString()!);
using var deadline=new CancellationTokenSource(TimeSpan.FromSeconds(240));var ct=deadline.Token;
await using var transport=new HttpClientTransport(new() { Endpoint=new Uri(Environment.GetEnvironmentVariable("KREODA_BENCHMARK_MCP_URL")??"http://127.0.0.1:9843/mcp") });
await using var mcp=await McpClient.CreateAsync(transport,cancellationToken:ct);
async Task<JsonElement> Tool(string name,Dictionary<string,object?>? args=null) {
    var response=await mcp.CallToolAsync(name,args??new(),cancellationToken:ct);
    if(response.IsError==true)throw new InvalidOperationException(name+" returned a tool error");
    using var parsed=JsonDocument.Parse(response.Content.OfType<TextContentBlock>().Single().Text);return parsed.RootElement.Clone();
}
Task<JsonElement> Query(string method,Dictionary<string,object?>? parameters=null) => Tool("kreoda_query",new() { ["method"]=method,["parameters"]=parameters??new() });
var before=await Tool("kreoda_describe_model");
if(new[]{"features","sketches","bodies"}.Any(k=>!before.TryGetProperty(k,out var a)||a.ValueKind!=JsonValueKind.Array||a.GetArrayLength()!=0)||
    !before.TryGetProperty("requestActive",out var active)||active.ValueKind!=JsonValueKind.False)throw new InvalidOperationException("Benchmark requires an isolated empty committed document");
var context=JsonSerializer.SerializeToElement(new {
    voiceRequestId="benchmark-"+Guid.NewGuid().ToString("D"),sessionId=before.GetProperty("sessionId").GetString(),
    documentId=before.GetProperty("documentId").GetString(),revision=before.GetProperty("revision").GetInt64(),selectedIds=System.Array.Empty<string>(),
    benchmarkRequirements=fixture,
});
var clock=Stopwatch.StartNew();VoiceReply? reply=null;string? error=null;string? failedRunId=null;
try { reply=await voice.TalkAsync(fixture.GetProperty("prompt").GetString()!,context,ct); }
catch(Exception e) { error=e is VoiceServiceException service?"voice-http-"+service.StatusCode:e.GetType().Name;failedRunId=(e as VoiceServiceException)?.RunId; }
var duration=clock.Elapsed.TotalSeconds;
JsonElement? after=null,validation=null,bounds=null,faces=null;string[] failures=["no-native-evidence"];
try {
    after=await Tool("kreoda_describe_model");validation=await Query("validateDocument");bounds=await Query("getBoundingBox");
    // No feature/body filter: queries inspect every displayed native solid.
    faces=await Query("findFaces");
    failures=GeometryCheck.Evaluate(fixture,after.Value,validation.Value,bounds.Value,faces.Value);
} catch(Exception e) { failures=["measurement-"+e.GetType().Name]; }
object? metadata=null;string? metadataError=null;
var runId=reply?.RunId??failedRunId;
if(runId is not null) {
    try { metadata=await RunMetadata.Read(runId,ct); }
    catch(Exception e) { metadataError=e.GetType().Name; }
}
var report=new {
    schemaVersion=1,fixtureId=args[1],requirementsSha256=sha,startedAt=DateTimeOffset.UtcNow.AddSeconds(-clock.Elapsed.TotalSeconds),
    prompt=fixture.GetProperty("prompt").GetString(),origin=context,before,after,validation,bounds,faces,
    durationSeconds=duration,error,runId,sessionId=reply?.SessionId,finalReply=reply?.Text,metadata,metadataError,
    failedPredicates=failures,geometryPassed=error is null&&reply is not null&&failures.Length==0,
    accepted=false,editabilityVerified=false,oneUndoVerified=false,desktopObserved=false,questObserved=false,
    boundary="Live native Hermes through the Quest voice proxy and official MCP. Geometry only; acceptance also requires editability, one Undo group, command metadata and client observation. Synthetic unit fixtures never count as live passes.",
};
await using(var stream=new FileStream(output,FileMode.CreateNew,FileAccess.Write,FileShare.None)) {
    await JsonSerializer.SerializeAsync(stream,report,new JsonSerializerOptions { WriteIndented=true });
}
Console.WriteLine(JsonSerializer.Serialize(new { fixtureId=args[1],report=output,report.geometryPassed,report.accepted,failedPredicates=failures,error,metadataError,durationSeconds=duration }));
// Exit 0 is reserved for full fixture acceptance. Geometry-only is incomplete.
return report.accepted?0:report.geometryPassed?2:1;

static class RunMetadata
{
    public static async Task<object> Read(string run,CancellationToken ct) {
        var path=Environment.GetEnvironmentVariable("KREODA_BENCHMARK_HERMES_CONFIG")??throw new InvalidOperationException("Private Hermes metadata config required");
        using var file=JsonDocument.Parse(await File.ReadAllTextAsync(path,ct));var config=file.RootElement;
        var endpoint=new Uri(config.GetProperty("gatewayUrl").GetString()!.TrimEnd('/')+"/");
        if(endpoint.UserInfo.Length!=0||endpoint.Query.Length!=0||endpoint.Fragment.Length!=0||endpoint.Scheme is not ("http" or "https"))throw new ArgumentException("Invalid private endpoint");
        using var http=new HttpClient(new HttpClientHandler { AllowAutoRedirect=false }) { Timeout=TimeSpan.FromSeconds(15) };
        http.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",config.GetProperty("apiKey").GetString());
        http.DefaultRequestHeaders.Add("X-Hermes-Session-Key",config.GetProperty("sessionKey").GetString());
        using var status=await ReadJson(http,new Uri(endpoint,"runs/"+Uri.EscapeDataString(run)),ct);
        var eventBytes=await ReadBytes(http,new Uri(endpoint,"runs/"+Uri.EscapeDataString(run)+"/events"),ct);
        var items=EventEvidence.Parse(Encoding.UTF8.GetString(eventBytes));
        var tools=new List<object>();
        foreach(var item in items) {
            var type=GeometryCheck.Text(item,"type");if(type is not ("tool.started" or "tool.completed"))continue;
            var data=item.TryGetProperty("data",out var nested)?nested:item;
            var name=EventEvidence.ToolName(item);
            JsonElement? command=null;
            if(name?.EndsWith("kreoda_command",StringComparison.Ordinal)==true&&data.TryGetProperty("arguments",out var a)&&a.ValueKind==JsonValueKind.Object) {
                command=JsonSerializer.SerializeToElement(new { commandId=GeometryCheck.Text(a,"commandId"),parameters=a.TryGetProperty("parameters",out var p)?p:(JsonElement?)null });
            }
            tools.Add(new { type,tool=name,error=data.TryGetProperty("error",out var e)?e:(JsonElement?)null,duration=data.TryGetProperty("duration",out var d)?d:(JsonElement?)null,command,
                commandPreview=name?.EndsWith("kreoda_command",StringComparison.Ordinal)==true?GeometryCheck.Text(data,"preview"):null });
        }
        var native=status.RootElement;
        var names=items.Where(i=>GeometryCheck.Text(i,"type")=="tool.started").Select(EventEvidence.ToolName).ToArray();
        return new { status=GeometryCheck.Text(native,"status"),model=GeometryCheck.Text(native,"model"),provider=GeometryCheck.Text(native,"provider"),tools,
            cadCommandAttempts=names.Count(n=>n?.EndsWith("kreoda_command",StringComparison.Ordinal)==true),
            corrections=Math.Max(0,names.Count(n=>n?.EndsWith("kreoda_begin_request",StringComparison.Ordinal)==true)-1),
            eventsComplete=tools.Count>0&&!items.Any(i=>GeometryCheck.Text(i,"type")=="replay.truncated"),
            fullCommandArgumentsRecorded=false,reasoningSaved=false };
    }
    static async Task<JsonDocument> ReadJson(HttpClient http,Uri uri,CancellationToken ct) {
        return JsonDocument.Parse(await ReadBytes(http,uri,ct));
    }
    static async Task<byte[]> ReadBytes(HttpClient http,Uri uri,CancellationToken ct) {
        using var deadline=CancellationTokenSource.CreateLinkedTokenSource(ct);deadline.CancelAfter(TimeSpan.FromSeconds(15));
        using var response=await http.GetAsync(uri,HttpCompletionOption.ResponseHeadersRead,deadline.Token);response.EnsureSuccessStatusCode();
        using var stream=await response.Content.ReadAsStreamAsync(deadline.Token);using var bytes=new MemoryStream();var buffer=new byte[8192];int n;
        while((n=await stream.ReadAsync(buffer,deadline.Token))>0) { if(bytes.Length+n>4194304)throw new IOException("Metadata exceeds limit");bytes.Write(buffer,0,n); }
        return bytes.ToArray();
    }
}
