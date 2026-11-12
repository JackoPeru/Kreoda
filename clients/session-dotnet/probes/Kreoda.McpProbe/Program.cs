using System.Text.Json;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;
using Kreoda.ModelingAgent;
using Kreoda.HermesBridge;
using Kreoda.ModelingAgent.Benchmark;
using System.Diagnostics;

void Check(bool value, string message) { if (!value) throw new InvalidOperationException(message); }
var scenario = Environment.GetEnvironmentVariable("KREODA_MCP_PROBE_SCENARIO");
if (scenario == "automatic-agent-local-connection")
{
    var deviceFile = Environment.GetEnvironmentVariable("KREODA_CAD_DEVICE_FILE")!;
    var connector = new PrivateCadConnection(deviceFile, null, null,
        new System.Net.IPEndPoint(System.Net.IPAddress.Loopback, Kreoda.Session.SessionDiscovery.Port));
    JsonElement model;
    await using (var cad = new CadBridge(connector.ConnectAsync))
    await using (var app = BridgeHost.Build(cad, "http://127.0.0.1:0"))
    {
        await app.StartAsync();
        try {
            await using var localTransport = new HttpClientTransport(new() { Endpoint = new Uri(app.Urls.Single() + "/mcp") });
            await using var localMcp = await McpClient.CreateAsync(localTransport);
            var available = await localMcp.ListToolsAsync();
            Check(available.Count == 7, "Automatic agent MCP tool catalog missing");
            var agentResource = await localMcp.ReadResourceAsync("kreoda://project");
            Check(agentResource.Contents.OfType<TextResourceContents>().Single().Text.Contains("Hermes owns"), "Agent project context missing");
            var description = await localMcp.CallToolAsync("kreoda_describe_model", new Dictionary<string, object?>());
            Check(description.IsError != true, "Automatic agent MCP could not describe actual CAD document");
            using var json = JsonDocument.Parse(description.Content.OfType<TextContentBlock>().Single().Text);
            model = json.RootElement.Clone();
            var schema = await localMcp.CallToolAsync("kreoda_query", new Dictionary<string, object?> {
                ["method"] = "getCommandSchema", ["parameters"] = new Dictionary<string, object?>() });
            Check(schema.IsError != true, "Automatic agent could not query actual native schema");
            using var catalog = JsonDocument.Parse(schema.Content.OfType<TextContentBlock>().Single().Text);
            Check(catalog.RootElement.GetProperty("commands").EnumerateArray().Any(c => c.GetProperty("id").GetString() == "CreateBox"),
                "Automatic agent native command schema incomplete");
        } finally { await app.StopAsync(); }
    }
    var config = JsonSerializer.Deserialize<CadDeviceConfiguration>(await File.ReadAllTextAsync(deviceFile), new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
    Console.WriteLine(JsonSerializer.Serialize(new { scenario, status = "automatic-agent-ready", manualInputs = 0,
        pcId = config.PcId, deviceId = config.DeviceId, installationId = config.InstallationId, sessionUrl = config.SessionUrl,
        sessionId = model.GetProperty("sessionId").GetString(), documentId = model.GetProperty("documentId").GetString(),
        features = model.GetProperty("features").GetArrayLength(), revision = model.GetProperty("revision").GetInt64(), tools = 7 }));
    return;
}
if(scenario=="native-reference-reconstruction")
{
    var connection=new PrivateCadConnection(Environment.GetEnvironmentVariable("KREODA_CAD_DEVICE_FILE")!,
        Environment.GetEnvironmentVariable("KREODA_CAD_SESSION_URL"),Environment.GetEnvironmentVariable("KREODA_CAD_PAIR"));
    await using var cad=new CadBridge(connection.ConnectAsync);
    var original=await cad.DescribeAsync();
    Check(original.GetProperty("features").GetArrayLength()==0,"Reference E2E requires empty document");
    var fence=new GeneratedCadSelectionFence(original.GetProperty("sessionId").GetString()!,
        original.GetProperty("documentId").GetString()!,original.GetProperty("revision").GetInt64());
    var option=ReferenceReconstruction.Rectangle(new("calibrated-source-01",200,100),
        new(10,20,170,100),8,await cad.CatalogAsync(),fence);
    var check=new CadCheck("measureVolume",JsonSerializer.SerializeToElement(new{featureId="$result"}),"volumeMm3",25600,.01);
    var rejection=await cad.ExecuteGeneratedAsync(option,[check with {Expected=1d}]);
    Check(rejection.GetProperty("status").GetString()=="validation_failed","Native false reference measurement unexpectedly committed");
    Check((await cad.DescribeAsync()).GetProperty("features").GetArrayLength()==0,"Rejected reference reconstruction persisted geometry");
    // Fresh explicit confirmation after rejected trial: prior revision may advance on rollback.
    var fresh=await cad.DescribeAsync();
    option=option with {SelectionFence=new GeneratedCadSelectionFence(fresh.GetProperty("sessionId").GetString()!,
        fresh.GetProperty("documentId").GetString()!,fresh.GetProperty("revision").GetInt64())};
    var committed=await cad.ExecuteGeneratedAsync(option,[check]);
    Check(committed.GetProperty("status").GetString()=="committed","Canonical reference sketch extrusion commit failed");
    var result=await cad.DescribeAsync();
    for(var i=0;i<30&&result.GetProperty("features").GetArrayLength()!=1;i++){await Task.Delay(50);result=await cad.DescribeAsync();}
    Check(result.GetProperty("features").GetArrayLength()==1 && result.GetProperty("sketches").GetArrayLength()==1,
        "Reference reconstruction did not persist editable feature and source sketch");
    var id=result.GetProperty("features")[0].GetProperty("featureId").GetString()!;
    var measured=await cad.QueryAsync(null,"measureVolume",JsonSerializer.SerializeToElement(new{featureId=id}));
    Check(Math.Abs(measured.GetProperty("volumeMm3").GetDouble()-25600)<.01,"Native OCCT reference volume differs from verified calibration");
    Console.WriteLine(JsonSerializer.Serialize(new {scenario,status="committed",featureId=id,
        volumeMm3=measured.GetProperty("volumeMm3").GetDouble(),revision=result.GetProperty("revision").GetInt64(),
        calibrationMmPerPixel=.5,sourceId="calibrated-source-01",rollbackVerified=true}));
    return;
}
if(scenario=="native-symmetric-approval")
{
    var connection=new PrivateCadConnection(Environment.GetEnvironmentVariable("KREODA_CAD_DEVICE_FILE")!,
        Environment.GetEnvironmentVariable("KREODA_CAD_SESSION_URL"),Environment.GetEnvironmentVariable("KREODA_CAD_PAIR"));
    await using var cad=new CadBridge(connection.ConnectAsync);
    var start=await cad.DescribeAsync();
    Check(start.GetProperty("sketches").GetArrayLength()==0,"Symmetry E2E needs isolated empty sketch document");
    var model=JsonSerializer.SerializeToElement(new {
        points=new[] {new{id="a",x=-10d,y=5d,@fixed=false},new{id="b",x=10d,y=5d,@fixed=false},
            new{id="top",x=0d,y=20d,@fixed=false},new{id="bottom",x=0d,y=0d,@fixed=false}},
        lines=new[] {new{id="axis",p1="top",p2="bottom"}},circles=Array.Empty<object>(),
        arcs=Array.Empty<object>(),constraints=Array.Empty<object>()});
    // Real baseline body makes check nonzero and independently measurable.
    var created=await cad.ExecuteGeneratedAsync(new GeneratedCadOption("symmetry-source","Editable source sketch",[
        new GeneratedCadStep("CreateBox",JsonSerializer.SerializeToElement(new{widthMm=10d,heightMm=10d,depthMm=10d}),"Known check solid","solid"),
        new GeneratedCadStep("CreateSketch",JsonSerializer.SerializeToElement(new{planeKind="XY",model}),"Four points and one explicit vertical axis","sketch")
    ]),[new CadCheck("measureVolume",JsonSerializer.SerializeToElement(new{featureId="$solid"}),"volumeMm3",1000,0.01)]);
    Check(created.GetProperty("status").GetString()=="committed","Could not persist symmetry source sketch");
    var source=await cad.DescribeAsync();
    for(var i=0;i<30 && source.GetProperty("sketches").GetArrayLength()!=1;i++) {
        await Task.Delay(50);source=await cad.DescribeAsync();
    }
    Check(source.GetProperty("sketches").GetArrayLength()==1,"Native source sketch not present");
    var sketchId=source.GetProperty("sketches")[0].GetProperty("featureId").GetString()!;
    var boxId=source.GetProperty("features").EnumerateArray().Single(f=>f.GetProperty("type").GetString()=="Box")
        .GetProperty("featureId").GetString()!;
    var catalog=await cad.CatalogAsync();
    var fence=new GeneratedCadSelectionFence(source.GetProperty("sessionId").GetString()!,
        source.GetProperty("documentId").GetString()!,source.GetProperty("revision").GetInt64());
    var proposals=SketchConstraintSuggestions.Infer(sketchId,model,catalog,selectionFence:fence);
    var candidate=AssertUnique(proposals.Where(s=>s.Kind=="symmetric"&&s.CanAccept).Select(s=>s.AcceptedCommand!).ToArray());
    var checks=new[] {new CadCheck("measureVolume",JsonSerializer.SerializeToElement(new{featureId=boxId}),"volumeMm3",1000,.01)};
    var accepted=await cad.ExecuteGeneratedAsync(candidate,checks);
    Check(accepted.GetProperty("status").GetString()=="committed","Native symmetric UpdateSketch rejected");
    var after=await cad.DescribeAsync();
    for(var i=0;i<30&&after.GetProperty("revision").GetInt64()<=fence.Revision;i++){
        await Task.Delay(50);after=await cad.DescribeAsync();
    }
    Check(after.GetProperty("revision").GetInt64()==fence.Revision+1,"Symmetric relation did not create exactly one native Undo group");
    Check(after.GetProperty("sketches").GetArrayLength()==1,"Native symmetric update lost the source sketch");
    var savedModel=after.GetProperty("sketches")[0].GetProperty("model");
    var savedRelations=savedModel.GetProperty("constraints").EnumerateArray()
        .Where(c=>c.GetProperty("kind").GetString()=="symmetric").ToArray();
    Check(savedRelations.Length==1 && savedRelations[0].GetProperty("value").GetDouble()==0 &&
        savedRelations[0].GetProperty("refs").EnumerateArray().Select(r=>r.GetString())
            .SequenceEqual(new[]{"a","b","axis"}),
        "Native persisted sketch did not retain typed symmetric refs and value");
    try {await cad.ExecuteGeneratedAsync(candidate,checks);throw new InvalidOperationException("Stale symmetry proposal accepted twice");}
    catch(Kreoda.Session.SessionException exception) when(exception.Code=="NEED_FULL_SNAPSHOT") { }
    var retained=await cad.DescribeAsync();
    Check(retained.GetProperty("revision").GetInt64()==after.GetProperty("revision").GetInt64(),"Stale approval changed revision");
    Console.WriteLine(JsonSerializer.Serialize(new {scenario,status="committed",sketchId,boxId,
        revision=retained.GetProperty("revision").GetInt64(),initialRevision=fence.Revision,
        symmetricConstraints=1,staleApprovalRejected=true,oneUndoGroup=true}));
    return;
}
GeneratedCadOption AssertUnique(GeneratedCadOption[] options)=>options.Length==1?options[0]:
    throw new InvalidOperationException("Ambiguous semantic symmetric sketch proposal: "+options.Length);
if(scenario=="native-alternative-approval")
{
    var url=Environment.GetEnvironmentVariable("KREODA_CAD_SESSION_URL")!;
    var pair=Environment.GetEnvironmentVariable("KREODA_CAD_PAIR")!;
    var credentialPath=Environment.GetEnvironmentVariable("KREODA_CAD_DEVICE_FILE")!;
    var connection=new PrivateCadConnection(credentialPath,url,pair);
    await using var cad=new CadBridge(connection.ConnectAsync);
    var state=await cad.DescribeAsync();
    Check(state.GetProperty("features").GetArrayLength()==0,"Real alternative proposal requires empty model");
    var catalog=await cad.CatalogAsync();
    var options=GenerativeIntent.ConnectParallelPlates(80,20,5,catalog);
    Check(options.Count==2 && options.Any(o=>o.Id=="round-spacer") && options.Any(o=>o.Id=="rectangular-spacer"),
        "Expected two native catalog-supported design options");
    var check=new CadCheck("measureVolume",JsonSerializer.SerializeToElement(new {featureId="$generated"}),
        "volumeMm3",8000,0.01);
    try { await cad.AcceptAlternativeAsync(options,"missing-design",[check]);throw new InvalidOperationException("Unreviewed alternative accepted"); }
    catch(ArgumentException) { }
    var rejected=await cad.AcceptAlternativeAsync(options,"rectangular-spacer",[
        check with {Expected=1d}]);
    Check(rejected.GetProperty("status").GetString()=="validation_failed","Bad native option measurements were not rejected");
    var afterRejection=await cad.DescribeAsync();
    Check(afterRejection.GetProperty("features").GetArrayLength()==0,"Failed choice published feature");
    var accepted=await cad.AcceptAlternativeAsync(options,"rectangular-spacer",[check]);
    Check(accepted.GetProperty("status").GetString()=="committed","Real selected alternative not committed");
    var persisted=await cad.DescribeAsync();
    for(var i=0;i<40 && persisted.GetProperty("features").GetArrayLength()!=1;i++) {
        await Task.Delay(50);persisted=await cad.DescribeAsync();
    }
    Check(persisted.GetProperty("features").GetArrayLength()==1,"Approved option should create exactly one native feature: "+persisted.GetRawText());
    var feature=persisted.GetProperty("features")[0];
    Check(feature.GetProperty("type").GetString()=="Box","CAD silently chose different solution");
    var id=feature.GetProperty("featureId").GetString()!;
    var volume=await cad.QueryAsync(null,"measureVolume",JsonSerializer.SerializeToElement(new {featureId=id}));
    Check(Math.Abs(volume.GetProperty("volumeMm3").GetDouble()-8000)<.01,"Actual OCCT selected volume invalid");
    Console.WriteLine(JsonSerializer.Serialize(new {scenario,status="committed",featureId=id,
        revision=persisted.GetProperty("revision").GetInt64(),volumeMm3=volume.GetProperty("volumeMm3").GetDouble(),
        choices=options.Select(o=>o.Id).ToArray(),selected="rectangular-spacer",badChoiceRejected=true,
        failedValidationRolledBack=true}));
    return;
}
if (scenario == "automatic-local-connection")
{
    using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(30));
    var peers = await Kreoda.Session.SessionDiscovery.FindAsync(deadline.Token,
        new System.Net.IPEndPoint(System.Net.IPAddress.Loopback, Kreoda.Session.SessionDiscovery.Port));
    var pc = Kreoda.Session.SessionDiscovery.Choose(peers, null) ?? throw new InvalidOperationException("unique PC not discovered");
    var installation = Guid.NewGuid().ToString("D");
    var credential = Kreoda.Session.SessionDiscovery.CreateCredential();
    var device = await Kreoda.Session.SessionDiscovery.PairAsync(pc, installation, credential, deadline.Token, true);
    var logical = "client-" + Guid.NewGuid().ToString("D");
    await using (var session = await Kreoda.Session.SessionClient.ConnectDeviceAsync(pc.Endpoint, device, credential, "quest", deadline.Token, logical))
    {
        Check(session.Model != null && session.Model.Features.Count > 0, "actual automatic Quest session snapshot missing CAD geometry");
    }
    var rediscovered = Kreoda.Session.SessionDiscovery.Choose(await Kreoda.Session.SessionDiscovery.FindAsync(deadline.Token,
        new System.Net.IPEndPoint(System.Net.IPAddress.Loopback, Kreoda.Session.SessionDiscovery.Port)), pc.PcId)!;
    Check(!await Kreoda.Session.SessionDiscovery.VerifyKnownDeviceAsync(rediscovered, device,
        Kreoda.Session.SessionDiscovery.CreateCredential(), deadline.Token, true), "wrong credential accepted PC identity proof");
    Check(await Kreoda.Session.SessionDiscovery.VerifyKnownDeviceAsync(rediscovered, device, credential, deadline.Token, true),
        "rediscovered PC did not prove existing trust before credentials are sent");
    await using var reconnected = await Kreoda.Session.SessionClient.ConnectDeviceAsync(rediscovered.Endpoint, device, credential, "quest", deadline.Token, logical);
    Check(reconnected.Model != null && reconnected.Model.Features.Count > 0, "automatic reconnect snapshot missing");
    Console.WriteLine(JsonSerializer.Serialize(new { scenario, status = "connected-and-reconnected", pcId = pc.PcId,
        manualInputs = 0, verifiedIdentity = true, features = reconnected.Model!.Features.Count, revision = reconnected.Model.Revision }));
    return;
}
if (scenario == "projection-archive-break")
{
    var healthyPath = Environment.GetEnvironmentVariable("KREODA_PROJECTION_HEALTHY_FILE") ?? throw new InvalidOperationException("healthy archive path missing");
    var brokenPath = Environment.GetEnvironmentVariable("KREODA_PROJECTION_BROKEN_FILE") ?? throw new InvalidOperationException("broken archive path missing");
    Console.WriteLine(JsonSerializer.Serialize(ProjectionScenario.BreakPersistedProjectionBindingArchive(healthyPath, brokenPath)));
    return;
}
await using var transport = new HttpClientTransport(new() { Endpoint = new Uri(Environment.GetEnvironmentVariable("KREODA_MCP_PROBE_URL")!) });
await using var client = await McpClient.CreateAsync(transport);
async Task<JsonElement> Tool(string name, Dictionary<string, object?> arguments)
{
    var response = await client.CallToolAsync(name, arguments);Check(response.IsError != true, name + " returned a tool error: " +
        string.Join(" ", response.Content.OfType<TextContentBlock>().Select(c => c.Text)));
    using var json = JsonDocument.Parse(response.Content.OfType<TextContentBlock>().Single().Text);return json.RootElement.Clone();
}
var tools = await client.ListToolsAsync();Check(tools.Count == 7, "MCP discovery did not expose the actual CAD tools");
var resource = await client.ReadResourceAsync("kreoda://project");Check(resource.Contents.OfType<TextResourceContents>().Single().Text.Contains("Hermes owns"), "project resource missing");
var schemas = await Tool("kreoda_query", new() { ["method"] = "getCommandSchema", ["parameters"] = new Dictionary<string, object?>() });
Check(schemas.GetProperty("commands").EnumerateArray().Single(c => c.GetProperty("id").GetString() == "CreateBox").GetProperty("creation").GetProperty("fixedCount").GetInt32() == 1, "runtime creation metadata missing");
if (scenario == "mcp-preflight")
{
    Console.WriteLine(JsonSerializer.Serialize(new { scenario, status = "ready", tools = tools.Count }));
    return;
}
if (scenario == "mcp-inspect")
{
    var model=await Tool("kreoda_describe_model",new());
    Console.WriteLine(JsonSerializer.Serialize(new {scenario,status="inspected",requestActive=model.GetProperty("requestActive").GetBoolean(),
        features=model.GetProperty("features").GetArrayLength(),bodies=model.GetProperty("bodies").GetArrayLength(),
        sketches=model.GetProperty("sketches").GetArrayLength(),datums=model.GetProperty("datums").GetArrayLength()}));
    return;
}
if (scenario == "minimum-thickness-rollback")
{
    var baseline=await Tool("kreoda_describe_model",new());
    Check(!baseline.GetProperty("requestActive").GetBoolean() &&
        new[]{"features","bodies","sketches","datums"}.All(field=>baseline.GetProperty(field).GetArrayLength()==0),
        "Thickness installation check requires an idle empty document; existing work is never changed");
    var opened=await Tool("kreoda_begin_request",new() { ["goal"]="Local thickness installation check; always roll back",
        ["checks"]=new[] {new {method="measureVolume",parameters=new {featureId="$thickness"},path="volumeMm3",expected=6000d,tolerance=1e-6}} });
    var requestId=opened.GetProperty("requestId").GetString()!;
    JsonElement thickness;double volume;
    try {
        var created=await Tool("kreoda_command",new() { ["requestId"]=requestId,["commandId"]="CreateBox",
            ["newFeatureAlias"]="thickness",["parameters"]=new {widthMm=20d,heightMm=30d,depthMm=10d} });
        var featureId=created.GetProperty("featureId").GetString()!;
        thickness=await Tool("kreoda_query",new() { ["requestId"]=requestId,["method"]="measureMinimumThickness",
            ["parameters"]=new {featureId,maxSamples=128} });
        Check(thickness.GetProperty("basis").GetString()=="occt-sampled-normal-rays" &&
            !thickness.GetProperty("isGlobalMinimum").GetBoolean() &&
            Math.Abs(thickness.GetProperty("minimumThicknessMm").GetDouble()-10)<1e-6,
            "Actual MCP/native thickness measurement is incorrect");
        var mass=await Tool("kreoda_query",new() { ["requestId"]=requestId,["method"]="measureVolume",["parameters"]=new {featureId} });
        volume=mass.GetProperty("volumeMm3").GetDouble();Check(Math.Abs(volume-6000)<1e-6,"Thickness changed actual geometry volume");
    } finally {
        var cancelled=await Tool("kreoda_cancel_request",new() { ["requestId"]=requestId });
        Check(cancelled.GetProperty("status").GetString()=="cancelled","Local installation check rollback was not confirmed");
    }
    var restored=await Tool("kreoda_describe_model",new());
    for(var attempt=0;attempt<40 && restored.GetProperty("features").GetArrayLength()!=0;attempt++) {
        await Task.Delay(50);restored=await Tool("kreoda_describe_model",new());
    }
    Check(!restored.GetProperty("requestActive").GetBoolean() &&
        new[]{"features","bodies","sketches","datums"}.All(field=>restored.GetProperty(field).GetArrayLength()==0),
        "Local installation check did not restore the original empty document");
    Console.WriteLine(JsonSerializer.Serialize(new {scenario,status="measured-and-rolled-back",minimumThicknessMm=10d,volumeMm3=volume,
        nativeResult=thickness,committed=false,remainingFeatures=0,remainingBodies=0}));
    return;
}
if (scenario == "native-manual-hole-inference")
{
    var baseline=await Tool("kreoda_describe_model",new());
    Check(baseline.GetProperty("features").GetArrayLength()==0 && baseline.GetProperty("bodies").GetArrayLength()==0,
        "Manual hole inference requires an isolated native document");
    var transaction=await Tool("kreoda_begin_request",new() { ["goal"]="Real manually authored aligned holes",
        ["checks"]=new[] {new {method="getBoundingBox",parameters=new Dictionary<string,object?>(),
            path="volumeMm3",expected=40000-135*Math.PI,tolerance=.01}} });
    var requestId=transaction.GetProperty("requestId").GetString()!;
    try {
        var box=await Tool("kreoda_command",new() { ["requestId"]=requestId,["commandId"]="CreateBox",
            ["newFeatureAlias"]="base",["parameters"]=new {widthMm=100d,heightMm=80d,depthMm=5d} });
        var baseId=box.GetProperty("featureId").GetString()!;
        string parent=baseId;
        var manuallyAuthored=new List<string>();
        foreach(var x in new[] {20d,40d,60d}) {
            var added=await Tool("kreoda_command",new() { ["requestId"]=requestId,["commandId"]="CreateHole",
                ["parameters"]=new {targetId=parent,faceRole="box.+Z",xMm=x,yMm=40d,
                    diameterMm=6d,depthMode="throughAll",depthMm=0d} });
            parent=added.GetProperty("featureId").GetString()!;
            manuallyAuthored.Add(parent);
        }
        var commit=await Tool("kreoda_commit_request",new() { ["requestId"]=requestId });
        Check(commit.GetProperty("status").GetString()=="committed","Manually authored native holes failed geometry acceptance");
        var revision=commit.GetProperty("result").GetProperty("revision").GetInt64();
        var snapshot=await Tool("kreoda_describe_model",new());
        for(var attempt=0;attempt<40 && snapshot.GetProperty("revision").GetInt64()<revision;attempt++) {
            await Task.Delay(50);snapshot=await Tool("kreoda_describe_model",new());
        }
        var selection=SemanticInference.FromNativeHistory(snapshot.GetProperty("sessionId").GetString()!,
            snapshot.GetProperty("documentId").GetString()!,revision,baseId,"box.+Z",snapshot);
        Check(selection.Holes.Count==3 && selection.Holes.Select(h=>h.FeatureId).SequenceEqual(manuallyAuthored),
            "Native semantic feature history lost hole lineage or original creation IDs");
        var suggestion=SemanticInference.Analyze(selection,AgentCommandCatalog.FromReply(schemas))
            .Single(s=>s.Id=="linear-hole-pattern");
        Check(!suggestion.CanExecute && suggestion.ProposedCommand is null,
            "Existing manually authored holes must be advisory only, never recut by CreateHolePattern");
        var measured=await Tool("kreoda_query",new() { ["method"]="getBoundingBox",
            ["parameters"]=new Dictionary<string,object?>() });
        Check(measured.GetProperty("solidCount").GetInt32()==1 &&
            Math.Abs(measured.GetProperty("volumeMm3").GetDouble()-(40000-135*Math.PI))<.01,
            "Manual source holes were not persisted as one correct OCCT solid");
        Console.WriteLine(JsonSerializer.Serialize(new {scenario,status="committed",baseId,
            revision,manualIds=manuallyAuthored,holeCount=selection.Holes.Count,
            spacingMm=20,diameterMm=6,advisoryOnly=true,volumeMm3=measured.GetProperty("volumeMm3").GetDouble(),
            solidCount=measured.GetProperty("solidCount").GetInt32()}));
    } catch {
        try {await Tool("kreoda_cancel_request",new() { ["requestId"]=requestId });} catch {}
        throw;
    }
    return;
}
if (scenario == "native-hole-pattern-acceptance")
{
    var catalog=AgentCommandCatalog.FromReply(schemas);
    var metadata=catalog.Require("CreateHolePattern");
    Check(metadata.Creation.IdArrayParameter=="featureIds", "Runtime does not support canonical persisted pattern IDs");
    var empty=await Tool("kreoda_describe_model",new());
    Check(empty.GetProperty("bodies").GetArrayLength()==0, "Pattern acceptance requires isolated empty document");
    var holeIds=Enumerable.Range(0,3).Select(_=>Guid.NewGuid().ToString("D")).ToArray();
    var begin=await Tool("kreoda_begin_request",new() { ["goal"]="Native candidate hole pattern",
        ["checks"]=new[] {new {method="getBoundingBox",parameters=new Dictionary<string,object?>(),
            path="volumeMm3",expected=100d*80*5-3*Math.PI*9*5,tolerance=.01}} });
    var transaction=begin.GetProperty("requestId").GetString()!;
    try {
        var baseReply=await Tool("kreoda_command",new() { ["requestId"]=transaction,["commandId"]="CreateBox",
            ["newFeatureAlias"]="plate",["parameters"]=new {widthMm=100d,heightMm=80d,depthMm=5d} });
        var baseId=baseReply.GetProperty("featureId").GetString()!;
        var selection=new SemanticSelection(empty.GetProperty("sessionId").GetString()!,empty.GetProperty("documentId").GetString()!,
            empty.GetProperty("revision").GetInt64(),baseId,"box.+Z",[
                new(Guid.NewGuid().ToString(),20,40,6),new(Guid.NewGuid().ToString(),40,40,6),new(Guid.NewGuid().ToString(),60,40,6)],false);
        var proposal=SemanticInference.Analyze(selection,catalog).Single(s=>s.Id=="linear-hole-pattern");
        Check(proposal.CanExecute,"Native supported pattern was not proposed for new points");
        var step=proposal.ProposedCommand!.Steps.Single();
        var parameters=JsonSerializer.Deserialize<Dictionary<string,JsonElement>>(step.Parameters.GetRawText())!;
        parameters["featureIds"]=JsonSerializer.SerializeToElement(holeIds);
        var pattern=await Tool("kreoda_command",new() { ["requestId"]=transaction,["commandId"]=step.CommandId,
            ["parameters"]=parameters.ToDictionary(k=>k.Key,v=>(object?)v.Value) });
        var committed=await Tool("kreoda_commit_request",new() { ["requestId"]=transaction });
        Check(committed.GetProperty("status").GetString()=="committed", "Native pattern measured commit rejected");
        var final=await Tool("kreoda_describe_model",new());
        var committedRevision=committed.GetProperty("result").GetProperty("revision").GetInt64();
        for(var i=0;i<40 && final.GetProperty("revision").GetInt64()<committedRevision;i++) {
            await Task.Delay(50);final=await Tool("kreoda_describe_model",new());
        }
        var measured=await Tool("kreoda_query",new() { ["method"]="getBoundingBox",["parameters"]=new Dictionary<string,object?>() });
        Check(measured.GetProperty("solidCount").GetInt32()==1 &&
            Math.Abs(measured.GetProperty("volumeMm3").GetDouble()-(40000-135*Math.PI))<.01,"Actual native pattern B-Rep is invalid");
        var history=final.GetProperty("features").EnumerateArray().Where(f=>f.TryGetProperty("type",out var t) && t.GetString()=="HolePattern").ToArray();
        Check(history.Length==1,"Native pattern failed to persist single editable HolePattern feature: "+
            final.GetProperty("features").GetRawText());
        Check(history[0].GetProperty("refExtra").GetString()!.Contains("pts=20,40,40,40,60,40",StringComparison.Ordinal),
            "Native hole pattern failed to persist original evenly spaced coordinates");
        var advisory=SemanticInference.Analyze(selection with {ExistingGeometry=true},catalog).Single(s=>s.Id=="linear-hole-pattern");
        Check(!advisory.CanExecute,"Already present holes must not duplicate native cuts");
        // Real rejection path: propose a different native pattern but demand the
        // old complete visible-model volume. Validation must abort the entire draft.
        var beforeRejectRevision=final.GetProperty("revision").GetInt64();
        var failureBegin=await Tool("kreoda_begin_request",new() { ["goal"]="Reject unapproved second pattern",
            ["checks"]=new[] {new {method="getBoundingBox",parameters=new Dictionary<string,object?>(),
                path="volumeMm3",expected=40000-135*Math.PI,tolerance=.01}} });
        var failureRequest=failureBegin.GetProperty("requestId").GetString()!;
        try {
            var rejectionIds=Enumerable.Range(0,3).Select(_=>Guid.NewGuid().ToString("D")).ToArray();
            await Tool("kreoda_command",new() { ["requestId"]=failureRequest,["commandId"]="CreateHolePattern",
                ["parameters"]=new {targetId=baseId,faceRole="box.+Z",featureIds=rejectionIds,
                    pointsMm=new[] {10d,10d,20d,10d,30d,10d},diameterMm=4d,depthMode="throughAll",depthMm=0d} });
            var rejected=await Tool("kreoda_commit_request",new() { ["requestId"]=failureRequest });
            Check(rejected.GetProperty("status").GetString()=="validation_failed",
                "Unexpected acceptance of unapproved second native hole pattern");
        } catch {
            try { await Tool("kreoda_cancel_request",new() { ["requestId"]=failureRequest });} catch {}
            throw;
        }
        var restored=await Tool("kreoda_describe_model",new());
        var restoredGeometry=await Tool("kreoda_query",new() { ["method"]="getBoundingBox",
            ["parameters"]=new Dictionary<string,object?>() });
        var afterRejectRevision=restored.GetProperty("revision").GetInt64();
        Check(afterRejectRevision>=beforeRejectRevision && afterRejectRevision<=beforeRejectRevision+1 &&
            restored.GetProperty("features").GetRawText()==final.GetProperty("features").GetRawText() &&
            !restored.GetProperty("requestActive").GetBoolean() &&
            Math.Abs(restoredGeometry.GetProperty("volumeMm3").GetDouble()-(40000-135*Math.PI))<.01,
            "Pattern rollback changed committed source feature history or geometry: before="+beforeRejectRevision+
            ", after="+afterRejectRevision+
            ", volume="+restoredGeometry.GetProperty("volumeMm3").GetDouble());
        Console.WriteLine(JsonSerializer.Serialize(new {scenario,status="committed",baseId,
            revision=afterRejectRevision,
            volumeMm3=measured.GetProperty("volumeMm3").GetDouble(),solidCount=1,
            patternCreatedIds=JsonSerializer.SerializeToElement(holeIds), persistedPatternCount=history.Length,
            alreadyExistingAdvisory=!advisory.CanExecute,negativePatternRollbackVerified=true,
            rollbackRevisionDelta=afterRejectRevision-beforeRejectRevision}));
    } catch {
        try {await Tool("kreoda_cancel_request",new() { ["requestId"]=transaction });} catch {}
        throw;
    }
    return;
}
if (scenario == "native-seven-benchmark")
{
    var fixtureId = Environment.GetEnvironmentVariable("KREODA_BENCHMARK_FIXTURE") ?? throw new ArgumentException("Fixture ID is required");
    var requirementsFile = Environment.GetEnvironmentVariable("KREODA_BENCHMARK_REQUIREMENTS") ?? throw new ArgumentException("Frozen requirements path required");
    var requirementsBytes=File.ReadAllBytes(requirementsFile);
    var frozenHash=FrozenRequirements.Verify(requirementsBytes);
    using var fixtureDoc = JsonDocument.Parse(requirementsBytes);
    var fixture = fixtureDoc.RootElement.GetProperty("fixtures").EnumerateArray()
        .Single(f => f.GetProperty("id").GetString() == fixtureId).Clone();
    var initial = await Tool("kreoda_describe_model",new());
    Check(initial.GetProperty("features").GetArrayLength()==0 && initial.GetProperty("bodies").GetArrayLength()==0 &&
        initial.GetProperty("sketches").GetArrayLength()==0 && !initial.GetProperty("requestActive").GetBoolean(),
        "Benchmark requires isolated empty committed document");
    var watch = Stopwatch.StartNew();
    var failures = new List<string>();
    string? error = null, lastFeature = null;int commandCount = 0, corrections = 0;
    var createdAliases = new Dictionary<string,string>();
    JsonElement? model=null,bounds=null,faces=null,validation=null;
    var baselineRevision = initial.GetProperty("revision").GetInt64();
    string? requestId=null;
    try {
        var actualCatalog=AgentCommandCatalog.FromReply(schemas);
        if(fixtureId is "hollow-box" or "simple-enclosure" or "mounting-plate" &&
            !actualCatalog.Commands.Any(c=>c.Id=="SetBodyVisibility"))
            throw new InvalidOperationException("Live PC catalog omits SetBodyVisibility/44, available: "+
                string.Join(",",actualCatalog.Commands.Select(c=>c.Id)));
        var plan = NativeFixturePlans.Build(fixtureId,actualCatalog);
        var lastAlias = plan.Steps.Last(s=>s.Alias is not null).Alias!;
        var beginning = await Tool("kreoda_begin_request",new() { ["goal"] = "Frozen benchmark "+fixtureId,
            ["checks"] = new[] {new {method="measureVolume",parameters=new {featureId="$"+lastAlias},
                path="volumeMm3",expected=fixture.GetProperty("volumeMm3").GetDouble(),tolerance=.01}} });
        requestId=beginning.GetProperty("requestId").GetString()!;
        foreach(var step in plan.Steps) {
            var payload=JsonSerializer.Deserialize<Dictionary<string,JsonElement>>(step.Parameters.GetRawText())!;
            if(step.CommandId=="SetBodyVisibility") {
                var placeholder=payload["bodyId"].GetString()!;
                if(!placeholder.StartsWith("$toolbody:",StringComparison.Ordinal))
                    throw new InvalidOperationException("Visibility requires an explicit semantic cutter source");
                var toolAlias=placeholder["$toolbody:".Length..];
                if(!createdAliases.TryGetValue(toolAlias,out var toolFeature))
                    throw new InvalidOperationException("Unknown cutter feature alias, refusing guessed body identity");
                var bodyReply=await Tool("kreoda_query",new() { ["requestId"]=requestId,["method"]="getBodies",
                    ["parameters"]=new Dictionary<string,object?>() });
                var matching=bodyReply.GetProperty("bodies").EnumerateArray()
                    .Where(b=>b.GetProperty("history").EnumerateArray().Any(h=>h.GetString()==toolFeature))
                    .Select(b=>b.GetProperty("bodyId").GetString()!).Distinct().ToArray();
                if(matching.Length!=1)
                    throw new InvalidOperationException("Cutter must resolve to exactly one authoritative native body; found "+matching.Length);
                payload["bodyId"]=JsonSerializer.SerializeToElement(matching[0]);
            }
            if(step.CommandId=="CreateChamfer" && fixtureId=="chamfered-shaft") {
                var shaft=createdAliases["base"];
                var edges=await Tool("kreoda_query",new() { ["requestId"]=requestId,["method"]="findEdges",["parameters"]=new {ownerBody=shaft,curveType="circle"} });
                var circles=edges.GetProperty("edges").EnumerateArray()
                    .Where(e=>!e.GetProperty("ambiguous").GetBoolean())
                    .Where(e=>e.GetProperty("bboxMm").GetArrayLength()==6)
                    .Where(e=> {var z0=e.GetProperty("bboxMm")[2].GetDouble();var z1=e.GetProperty("bboxMm")[5].GetDouble();
                        return Math.Abs(z1-z0)<.001 && (Math.Abs(z0)<.001 || Math.Abs(z0-100)<.001);})
                    .Select(e=>e.GetProperty("persistentEdgeId").GetString()!).Distinct().ToArray();
                if(circles.Length!=2) throw new InvalidOperationException("Expected exactly two unambiguous native terminal circle edges, found "+circles.Length);
                payload["edgeIds"]=JsonSerializer.SerializeToElement(circles);
            }
            var call=await Tool("kreoda_command",new() { ["requestId"] = requestId,["commandId"] = step.CommandId,
                ["newFeatureAlias"] = step.Alias,["parameters"] = payload.ToDictionary(k=>k.Key,v=>(object?)v.Value) });
            commandCount++;
            if(step.Alias is not null) {
                lastFeature=call.GetProperty("featureId").GetString();
                createdAliases.Add(step.Alias,lastFeature!);
            }
        }
        var committed=await Tool("kreoda_commit_request",new() { ["requestId"] = requestId });
        requestId=null;
        if(committed.GetProperty("status").GetString() != "committed")
            throw new InvalidOperationException("Native measured commit rejected: "+committed.GetRawText());
        model=await Tool("kreoda_describe_model",new());
        var revision=committed.GetProperty("result").GetProperty("revision").GetInt64();
        for(var attempt=0;attempt<40 && model.Value.GetProperty("revision").GetInt64()<revision;attempt++) {
            await Task.Delay(50);model=await Tool("kreoda_describe_model",new());
        }
        validation=await Tool("kreoda_query",new() { ["method"]="validateDocument",["parameters"]=new Dictionary<string,object?>() });
        bounds=await Tool("kreoda_query",new() { ["method"]="getBoundingBox",["parameters"]=new Dictionary<string,object?>() });
        faces=await Tool("kreoda_query",new() { ["method"]="findFaces",["parameters"]=new Dictionary<string,object?>() });
        failures.AddRange(GeometryCheck.Evaluate(fixture,model.Value,validation.Value,bounds.Value,faces.Value));
        if(revision!=baselineRevision+1) failures.Add("single-transaction-revision");
    } catch(Exception exception) {
        error=exception.GetType().Name+": "+exception.Message;
        failures.Add("native-plan-or-execution-failed");
        if(requestId is not null) {
            corrections++;
            try {await Tool("kreoda_cancel_request",new() { ["requestId"]=requestId });}
            catch(Exception rollback) {failures.Add("rollback-unconfirmed");error+="; rollback="+rollback.Message;}
        }
    }
    watch.Stop();
    Console.WriteLine(JsonSerializer.Serialize(new {scenario,fixtureId,requirementsSha256=frozenHash,geometryPassed=failures.Count==0,
        accepted=false,failures,error,commandCount,corrections,durationMilliseconds=watch.ElapsedMilliseconds,
        finalFeatureId=lastFeature,aliases=createdAliases,initialRevision=baselineRevision,
        revision=model?.GetProperty("revision").GetInt64(),model,bounds,faces,validation,
        acceptanceBoundary="Deterministic local OCCT command baseline, not the frozen live Hermes LLM/voice benchmark"}));
    return;
}
if (scenario == "generated-mounting-blank")
{
    var catalog = AgentCommandCatalog.FromReply(schemas);
    var option = GenerativeIntent.MountingBlank(140, 90, 6, catalog);
    var step = option.Steps.Single();
    var baseline = await Tool("kreoda_describe_model", new());
    Check(baseline.GetProperty("features").GetArrayLength() == 0 &&
        baseline.GetProperty("bodies").GetArrayLength() == 0 && !baseline.GetProperty("requestActive").GetBoolean(),
        "Generated model acceptance requires isolated empty native document");
    var opened = await Tool("kreoda_begin_request", new() { ["goal"] = option.Description, ["checks"] = new[] {
        new { method = "measureVolume", parameters = new Dictionary<string, object?> { ["featureId"] = "$generated" },
            path = "volumeMm3", expected = 75600d, tolerance = .01 } } });
    var request = opened.GetProperty("requestId").GetString()!;
    try {
        var command = await Tool("kreoda_command", new() { ["requestId"] = request,
            ["commandId"] = step.CommandId, ["newFeatureAlias"] = "generated",
            ["parameters"] = JsonSerializer.Deserialize<Dictionary<string, object?>>(step.Parameters.GetRawText())! });
        var id = command.GetProperty("featureId").GetString()!;
        Check(Guid.TryParseExact(id, "D", out _), "Native generated feature ID is invalid");
        var committed = await Tool("kreoda_commit_request", new() { ["requestId"] = request });
        Check(committed.GetProperty("status").GetString() == "committed", "Native generated operation failed measured validation");
        var volume = await Tool("kreoda_query", new() { ["method"] = "measureVolume", ["parameters"] = new { featureId = id } });
        var bounds = await Tool("kreoda_query", new() { ["method"] = "getBoundingBox", ["parameters"] = new { featureId = id } });
        var parameters = await Tool("kreoda_query", new() { ["method"] = "getParameters", ["parameters"] = new { featureId = id } });
        Check(Math.Abs(volume.GetProperty("volumeMm3").GetDouble() - 75600) < .01 &&
            bounds.GetProperty("solidCount").GetInt32() == 1, "Native B-Rep volume or solidity differs");
        Check(parameters.ValueKind == JsonValueKind.Object && parameters.GetRawText().Length > 2,
            "Native feature has no editable parameter description");
        Check(committed.GetProperty("result").GetProperty("revision").GetInt64() ==
            baseline.GetProperty("revision").GetInt64() + 1, "Native generated feature must occupy one Undo revision");
        // Negative native proof: an impossible measurement must not publish another feature.
        var rejectedBegin = await Tool("kreoda_begin_request", new() { ["goal"] = "Reject invalid generated follow-up",
            ["checks"] = new[] { new { method = "measureVolume", parameters = new { featureId = "$invalid" },
                path = "volumeMm3", expected = 1d, tolerance = .01 } } });
        var rejectedId = rejectedBegin.GetProperty("requestId").GetString()!;
        await Tool("kreoda_command", new() { ["requestId"] = rejectedId, ["commandId"] = "CreateBox",
            ["newFeatureAlias"] = "invalid", ["parameters"] = new { widthMm = 10d, heightMm = 10d, depthMm = 10d } });
        var rejection = await Tool("kreoda_commit_request", new() { ["requestId"] = rejectedId });
        Check(rejection.GetProperty("status").GetString() != "committed", "Incorrect generated volume unexpectedly committed");
        var afterReject = await Tool("kreoda_describe_model", new());
        Check(afterReject.GetProperty("revision").GetInt64() == committed.GetProperty("result").GetProperty("revision").GetInt64(),
            "Rejected generated transaction changed committed revision");
        var stillMeasured = await Tool("kreoda_query", new() { ["method"] = "measureVolume", ["parameters"] = new { featureId = id } });
        Check(Math.Abs(stillMeasured.GetProperty("volumeMm3").GetDouble() - 75600) < .01,
            "Native rejected transaction changed committed generated volume");
        Console.WriteLine(JsonSerializer.Serialize(new { scenario, status = "committed", featureId = id,
            revision = committed.GetProperty("result").GetProperty("revision").GetInt64(),
            volumeMm3 = volume.GetProperty("volumeMm3").GetDouble(), solidCount = 1,
            parameters, rationale = step.Rationale, rejectedFollowUp = rejection.GetProperty("status").GetString(),
            boundary = "Real OCCT MCP command and measurement. Save/open, parameter mutation and Desktop Undo require separate host acceptance." }));
    } catch {
        try { await Tool("kreoda_cancel_request", new() { ["requestId"] = request }); }
        catch { /* Original failure retained; bridge recovery fence remains authoritative. */ }
        throw;
    }
    return;
}
if (scenario is "generated-l-bracket" or "generated-u-bracket" or "generated-open-enclosure")
{
    var shape = scenario == "generated-l-bracket" ? "L" : "U";
    Console.Error.WriteLine("PROFILE_CANONICAL_SCHEMA " + JsonSerializer.Serialize(schemas.GetProperty("commands").EnumerateArray()
        .Where(c => c.GetProperty("id").GetString() is "CreateSketch" or "UpdateSketch" or "CreateExtrude")
        .Select(c => new { id = c.GetProperty("id").GetString(), parameters = c.GetProperty("parameters").Clone(), creation = c.GetProperty("creation").Clone() })));
    var bracketCatalog = AgentCommandCatalog.FromReply(schemas);
    Console.Error.WriteLine("BRACKET_CANONICAL_SCHEMA " + JsonSerializer.Serialize(schemas.GetProperty("commands").EnumerateArray()
        .Where(c => c.GetProperty("id").GetString() is "CreateBox" or "CreateBoolean")
        .Select(c => new { id = c.GetProperty("id").GetString(), parameters = c.GetProperty("parameters").Clone(), creation = c.GetProperty("creation").Clone() })));
    var option = scenario == "generated-open-enclosure" ? GenerativeIntent.OpenEnclosure(100,60,40,5,bracketCatalog) :
        GenerativeIntent.Bracket(shape, 100, 40, 60, 5, bracketCatalog);
    var start = await Tool("kreoda_describe_model", new());
    Check(start.GetProperty("bodies").GetArrayLength() == 0, "Bracket acceptance requires empty document");
    var expectedVolume = scenario == "generated-open-enclosure" ? 60000d : shape == "L" ? 31000d : 42000d;
    var begin = await Tool("kreoda_begin_request", new() { ["goal"] = option.Description,
        ["checks"] = new[] { new { method = "measureVolume", parameters = new { featureId = "$result" },
            path = "volumeMm3", expected = expectedVolume, tolerance = .01 } } });
    var request = begin.GetProperty("requestId").GetString()!;
    var identities = new Dictionary<string,string>();
    try {
        foreach (var step in option.Steps) {
            var fields = JsonSerializer.Deserialize<Dictionary<string,JsonElement>>(step.Parameters.GetRawText())!;
            var arguments = fields.ToDictionary(p => p.Key, p => (object?)p.Value);
            foreach (var key in new[] { "targetId", "toolId" })
                if (fields.TryGetValue(key, out var reference) && reference.ValueKind == JsonValueKind.String &&
                    reference.GetString()!.StartsWith('$')) arguments[key] = "$" + reference.GetString()![1..];
            var created = await Tool("kreoda_command", new() { ["requestId"] = request, ["commandId"] = step.CommandId,
                ["newFeatureAlias"] = step.Alias, ["parameters"] = arguments });
            identities.Add(step.Alias!, created.GetProperty("featureId").GetString()!);
        }
        var committed = await Tool("kreoda_commit_request", new() { ["requestId"] = request });
        Check(committed.GetProperty("status").GetString() == "committed", "Bracket native measured commit rejected: " + committed.GetRawText());
        var resultId = identities[identities.ContainsKey("result") ? "result" : "combined"];
        var measured = await Tool("kreoda_query", new() { ["method"] = "measureVolume", ["parameters"] = new { featureId = resultId } });
        var bounds = await Tool("kreoda_query", new() { ["method"] = "getBoundingBox", ["parameters"] = new { featureId = resultId } });
        var completeBounds = await Tool("kreoda_query", new() { ["method"] = "getBoundingBox", ["parameters"] = new Dictionary<string,object?>() });
        var completeFaces = await Tool("kreoda_query", new() { ["method"] = "findFaces", ["parameters"] = new Dictionary<string,object?>() });
        var nativeValidation = await Tool("kreoda_query", new() { ["method"] = "validateDocument", ["parameters"] = new Dictionary<string,object?>() });
        var editableId = identities.TryGetValue("base", out var baseId) ? baseId : identities.TryGetValue("profile",out var sketchId) ? sketchId : identities["outerSketch"];
        var baseParameters = await Tool("kreoda_describe_model", new());
        for (var attempt=0; attempt<40 && baseParameters.GetProperty("revision").GetInt64() <
             committed.GetProperty("result").GetProperty("revision").GetInt64(); attempt++) {
            await Task.Delay(50);
            baseParameters=await Tool("kreoda_describe_model", new());
        }
        Check(Math.Abs(measured.GetProperty("volumeMm3").GetDouble() - expectedVolume) < .01 &&
            bounds.GetProperty("solidCount").GetInt32() == 1, "Fused bracket B-Rep is not one solid of expected volume");
        Check((identities.ContainsKey("profile") || identities.ContainsKey("outerSketch")) && identities.ContainsKey("result"), "Sketch/extrude identities missing");
        Check(committed.GetProperty("result").GetProperty("revision").GetInt64() == start.GetProperty("revision").GetInt64()+1,
            "Generated bracket did not form one Undo group");
        Console.WriteLine(JsonSerializer.Serialize(new { scenario, status="committed", identities, resultId,
            revision=committed.GetProperty("result").GetProperty("revision").GetInt64(),
            volumeMm3=measured.GetProperty("volumeMm3").GetDouble(), solidCount=bounds.GetProperty("solidCount").GetInt32(),
            completeBounds,completeFaces,nativeValidation,baseParameters }));
    } catch {
        try { await Tool("kreoda_cancel_request", new() { ["requestId"] = request }); } catch { }
        throw;
    }
    return;
}
if (scenario == "projection" || scenario == "projection-repair")
{
    var proof = scenario == "projection"
        ? await ProjectionScenario.CreateAndExerciseAsync(client, Tool)
        : await ProjectionScenario.InspectAndRepairAsync(client, Tool);
    Console.WriteLine(JsonSerializer.Serialize(proof));
    return;
}
if (scenario == "datum")
{
    var definitions = schemas.GetProperty("commands");
    var expected = new[] { ("CreateDatumPlane", 31, 1), ("CreateDatumAxis", 32, 1), ("CreateDatumPoint", 33, 1), ("UpdateDatum", 34, 0), ("RequestDatum", 35, 0) };
    foreach (var (id, type, count) in expected)
    {
        var command = definitions.EnumerateArray().Single(c => c.GetProperty("id").GetString() == id);
        Check(command.GetProperty("nativeType").GetInt32() == type && command.GetProperty("creation").GetProperty("fixedCount").GetInt32() == count,
            $"actual {id} command metadata differs");
    }
    foreach (var (id, type) in new[] { ("CreateSketch", 13), ("CreateExtrude", 15) })
    {
        var command = definitions.EnumerateArray().Single(c => c.GetProperty("id").GetString() == id);
        Check(command.GetProperty("nativeType").GetInt32() == type && command.GetProperty("creation").GetProperty("fixedCount").GetInt32() == 1,
            $"actual {id} creation metadata differs");
    }
    var commandMetadata = expected.Select(item => {
        var command = definitions.EnumerateArray().Single(c => c.GetProperty("id").GetString() == item.Item1);
        return new { id = item.Item1, nativeType = command.GetProperty("nativeType").GetInt32(), creation = command.GetProperty("creation").Clone() };
    }).ToArray();

    var before = await Tool("kreoda_describe_model", new());
    var initialRevision = before.GetProperty("revision").GetInt64();
    Check(before.GetProperty("datums").GetArrayLength() == 0 && before.GetProperty("sketches").GetArrayLength() == 0 &&
        before.GetProperty("bodies").GetArrayLength() == 0 && !before.GetProperty("requestActive").GetBoolean(),
        "datum proof requires an isolated empty committed document");
    var opened = await Tool("kreoda_begin_request", new() { ["goal"] = "Create a 100 by 50 mm supported sketch on an XY datum at 24 mm and extrude 7 mm",
        ["checks"] = new[] { new { method = "measureVolume", parameters = new Dictionary<string, object?> { ["featureId"] = "$solid" },
            path = "volumeMm3", expected = 35000d, tolerance = .01 } } });
    var request = opened.GetProperty("requestId").GetString() ?? throw new InvalidOperationException("MCP request ID missing");
    var planeCreated = await Tool("kreoda_command", new() { ["requestId"] = request, ["commandId"] = "CreateDatumPlane", ["newFeatureAlias"] = "plane",
        ["parameters"] = new Dictionary<string, object?> { ["definition"] = new { type = "offset", @base = new { type = "principal", planeKind = "XY" }, offsetMm = 24d } } });
    var datumId = planeCreated.GetProperty("featureId").GetString() ?? throw new InvalidOperationException("Datum UUID missing");
    Check(Guid.TryParseExact(datumId, "D", out _), "native datum ID is not a real UUID");
    var sketchCreated = await Tool("kreoda_command", new() { ["requestId"] = request, ["commandId"] = "CreateSketch", ["newFeatureAlias"] = "sketch",
        ["parameters"] = new Dictionary<string, object?> { ["supportRef"] = "$plane", ["model"] = new {
            points = new[] { new { id = "p0", x = 0d, y = 0d, @fixed = false }, new { id = "p1", x = 100d, y = 0d, @fixed = false },
                new { id = "p2", x = 100d, y = 50d, @fixed = false }, new { id = "p3", x = 0d, y = 50d, @fixed = false } },
            lines = new[] { new { id = "l0", p1 = "p0", p2 = "p1" }, new { id = "l1", p1 = "p1", p2 = "p2" },
                new { id = "l2", p1 = "p2", p2 = "p3" }, new { id = "l3", p1 = "p3", p2 = "p0" } },
            circles = Array.Empty<object>(), arcs = Array.Empty<object>(), constraints = new[] {
                new { id = "h0", kind = "horizontal", refs = new[] { "l0" }, value = 0d },
                new { id = "h2", kind = "horizontal", refs = new[] { "l2" }, value = 0d },
                new { id = "v1", kind = "vertical", refs = new[] { "l1" }, value = 0d },
                new { id = "v3", kind = "vertical", refs = new[] { "l3" }, value = 0d },
                new { id = "dim-w", kind = "distance", refs = new[] { "p0", "p1" }, value = 100d },
                new { id = "dim-h", kind = "distance", refs = new[] { "p1", "p2" }, value = 50d },
            },
        } } });
    var sketchId = sketchCreated.GetProperty("featureId").GetString() ?? throw new InvalidOperationException("Sketch UUID missing");
    Check(Guid.TryParseExact(sketchId, "D", out _), "native sketch ID is not a real UUID");
    var solidCreated = await Tool("kreoda_command", new() { ["requestId"] = request, ["commandId"] = "CreateExtrude", ["newFeatureAlias"] = "solid",
        ["parameters"] = new Dictionary<string, object?> { ["sketchId"] = "$sketch", ["distanceMm"] = 7d } });
    var solidId = solidCreated.GetProperty("featureId").GetString() ?? throw new InvalidOperationException("Solid UUID missing");
    Check(Guid.TryParseExact(solidId, "D", out _) && new[] { datumId, sketchId, solidId }.Distinct().Count() == 3, "created feature IDs are not unique real UUIDs");
    var validation = await Tool("kreoda_query", new() { ["requestId"] = request, ["method"] = "validateDocument", ["parameters"] = new Dictionary<string, object?>() });
    var committed = await Tool("kreoda_commit_request", new() { ["requestId"] = request });
    if (committed.GetProperty("status").GetString() != "committed")
    {
        Console.WriteLine(JsonSerializer.Serialize(new {
            scenario = "datum", status = committed.GetProperty("status").GetString(), commandMetadata,
            featureIds = new { plane = datumId, sketch = sketchId, solid = solidId }, initialRevision,
            nativeValidation = validation, measurements = committed.GetProperty("measurements"),
            boundary = "Official MCP SDK reached actual native document validation; no commit or undo/redo proof on validation failure.",
        }));
        throw new InvalidOperationException($"MCP group status={committed.GetProperty("status").GetString()}; native validation={validation.GetRawText()}; measurements={committed.GetProperty("measurements").GetRawText()}");
    }
    var finalRevision = committed.GetProperty("result").GetProperty("revision").GetInt64();
    Check(finalRevision == initialRevision + 1, "MCP group did not produce one shared document revision");

    var datum = await Tool("kreoda_query", new() { ["method"] = "getDatum", ["parameters"] = new Dictionary<string, object?> { ["featureId"] = datumId } });
    Check(datum.GetProperty("featureId").GetString() == datumId && datum.GetProperty("kind").GetString() == "DatumPlane" && datum.GetProperty("status").GetString() == "ok",
        "native datum identity or status differs");
    var datumDefinition = datum.GetProperty("definition");
    Check(datumDefinition.GetProperty("type").GetString() == "offset" && datumDefinition.GetProperty("base").GetProperty("planeKind").GetString() == "XY" &&
        Math.Abs(datumDefinition.GetProperty("offsetMm").GetDouble() - 24) < 1e-9, "native datum definition differs");
    Check(Math.Abs(datum.GetProperty("resolved").GetProperty("originMm")[2].GetDouble() - 24) < 1e-9 &&
        Math.Abs(datum.GetProperty("resolved").GetProperty("normal")[2].GetDouble() - 1) < 1e-9, "native datum frame differs");

    var description = await Tool("kreoda_describe_model", new());
    for (var attempt = 0; attempt < 40 && description.GetProperty("revision").GetInt64() < finalRevision; attempt++)
    {
        await Task.Delay(50);
        description = await Tool("kreoda_describe_model", new());
    }
    Check(description.GetProperty("revision").GetInt64() == finalRevision,
        $"Describe model did not reach committed revision {finalRevision}: {description.GetRawText()}");
    var describedDatum = description.GetProperty("datums").EnumerateArray().Single(d => d.GetProperty("featureId").GetString() == datumId);
    Check(describedDatum.GetProperty("status").GetString() == "ok" && describedDatum.GetProperty("definition").GetProperty("type").GetString() == "offset",
        "Describe model omitted the real datum definition or status");
    var describedSketch = description.GetProperty("sketches").EnumerateArray().Single(s => s.GetProperty("featureId").GetString() == sketchId);
    var frame = describedSketch.GetProperty("plane");
    Check(describedSketch.GetProperty("supportRef").GetString() == datumId && describedSketch.GetProperty("points").GetInt32() == 4 &&
        describedSketch.GetProperty("lines").GetInt32() == 4 && Math.Abs(frame.GetProperty("origin")[2].GetDouble() - 24) < 1e-9 &&
        Math.Abs(frame.GetProperty("xAxis")[0].GetDouble() - 1) < 1e-9 && Math.Abs(frame.GetProperty("yAxis")[1].GetDouble() - 1) < 1e-9 &&
        Math.Abs(frame.GetProperty("normal")[2].GetDouble() - 1) < 1e-9, "Describe model omitted the supported sketch or full frame");

    var measured = await Tool("kreoda_query", new() { ["method"] = "measureVolume", ["parameters"] = new Dictionary<string, object?> { ["featureId"] = solidId } });
    var bounds = await Tool("kreoda_query", new() { ["method"] = "getBoundingBox", ["parameters"] = new Dictionary<string, object?> { ["featureId"] = solidId } });
    Check(Math.Abs(measured.GetProperty("volumeMm3").GetDouble() - 35000) < .01 && Math.Abs(bounds.GetProperty("volumeMm3").GetDouble() - 35000) < .01 &&
        bounds.GetProperty("solidCount").GetInt32() == 1 && Math.Abs(bounds.GetProperty("bboxMm")[2].GetDouble() - 24) < 1e-6 &&
        Math.Abs(bounds.GetProperty("bboxMm")[5].GetDouble() - 31) < 1e-6, "native committed B-Rep differs from expected volume or bounds");
    Console.WriteLine(JsonSerializer.Serialize(new {
        scenario = "datum", status = "committed",
        passed = new[] { "official-mcp-http-discovery-and-project-context", "actual-command-metadata31-35-and-creation-budget",
            "official-mcp-native-datum-sketch-solid-transaction", "committed-datum-description-frame-and-brep" },
        commandMetadata, featureIds = new { plane = datumId, sketch = sketchId, solid = solidId }, initialRevision, finalRevision,
        volumeMm3 = measured.GetProperty("volumeMm3").GetDouble(), solidCount = bounds.GetProperty("solidCount").GetInt32(), bboxMm = bounds.GetProperty("bboxMm"),
        datum, sketch = new { featureId = sketchId, supportRef = describedSketch.GetProperty("supportRef"), plane = frame, points = 4, lines = 4 },
        boundary = "Official MCP SDK to actual OCCT via SessionClient and local SessionRelay; Desktop undo/redo is verified by the hidden Electron E2E.",
    }));
}
else
{
var opened = await Tool("kreoda_begin_request", new() { ["goal"] = "Plate 100 by 50 by 20 mm", ["checks"] = new[] {
    new { method = "measureVolume", parameters = new Dictionary<string, object?> { ["bodyId"] = "$plate" }, path = "volumeMm3", expected = 100000d, tolerance = .01 },
} });
var request = opened.GetProperty("requestId").GetString();
var created = await Tool("kreoda_command", new() { ["requestId"] = request, ["commandId"] = "CreateBox", ["newFeatureAlias"] = "plate",
    ["parameters"] = new Dictionary<string, object?> { ["widthMm"] = 100d, ["heightMm"] = 50d, ["depthMm"] = 20d } });
var committed = await Tool("kreoda_commit_request", new() { ["requestId"] = request });
Check(committed.GetProperty("status").GetString() == "committed", "MCP group not committed");
var id = created.GetProperty("featureId").GetString();
var measured = await Tool("kreoda_query", new() { ["method"] = "measureVolume", ["parameters"] = new Dictionary<string, object?> { ["featureId"] = id } });
Check(Math.Abs(measured.GetProperty("volumeMm3").GetDouble() - 100000) < .01, "actual native measure differs");
var bounds = await Tool("kreoda_query", new() { ["method"] = "getBoundingBox", ["parameters"] = new Dictionary<string, object?>() });
Check(bounds.GetProperty("solidCount").GetInt32() == 1, "native B-Rep solid count differs");
Console.WriteLine(JsonSerializer.Serialize(new { passed = new[] { "official-mcp-http-discovery-and-project-context", "runtime-command-schema-and-creation-budget", "native-canonical-checked-transaction" }, featureId = id,
    finalRevision = committed.GetProperty("result").GetProperty("revision").GetInt64(), measuredVolumeMm3 = measured.GetProperty("volumeMm3").GetDouble(), solidCount = bounds.GetProperty("solidCount").GetInt32(),
    boundary = "Official MCP SDK to actual OCCT via SessionClient; not yet a live Hermes Agent or headset voice test." }));
}
