using System.Text.Json;
using Kreoda.Session;
using Kreoda.SessionClient.Tests;
using Kreoda.ModelingAgent;
using Kreoda.HermesBridge;
using CadClient = Kreoda.Session.SessionClient;
using Xunit;

namespace Kreoda.HermesBridge.Tests;

public sealed class CadBridgeTests
{
    internal sealed class Wire : IAsyncDisposable
    {
        const string Session = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        public readonly LoopbackWsServer Server;
        public int Commands, Commits, Rollbacks, TxnBegins, CatalogReads;
        public int RejectCommandAt = -1;
        public int CancelAfterCommand = -1;
        public Action? CancelOnCommand;
        public bool Valid = true;
        public bool DropCommitAck;
        public bool FailRollback;
        public bool FailProjection;
        public bool BracketCommands;
        public bool ProposalCatalog;
        public bool ConversionCatalog;
        public bool WrongFeatureIdsItemType;
        public bool WrongPointsMmItemType;
        public long Revision = 7;
        public TimeSpan CatalogDelay;
        public Func<Task>? BeforeCatalogReply;
        public object[] Features = Array.Empty<object>();
        public object[] Sketches = Array.Empty<object>();
        public object[] Datums = Array.Empty<object>();
        public string DocumentId = "doc-phase1";
        public readonly List<string> CommitOperations = new();
        readonly HashSet<string> _committed = new();
        public Wire()
        {
            Server = new(Reply);
            Server.ExtendedHandler = async request => {
                if (request.GetProperty("method").GetString() == "getCommandSchema") {
                    await Task.Delay(CatalogDelay);
                    if (BeforeCatalogReply is not null) await BeforeCatalogReply();
                }
                var reply = Reply(request);
                return DropCommitAck && request.GetProperty("method").GetString() == "txnCommit" && CommitOperations.Count == 1
                    ? null : new LoopbackWsResponse(reply);
            };
            Server.Start();
        }
        string Reply(JsonElement request)
        {
            var method = request.GetProperty("method").GetString();
            var result = new Dictionary<string, object?> { ["requestId"] = request.GetProperty("requestId").GetString(), ["ok"] = true };
            if (method == "hello") {
                result["clientId"] = "bridge";result["sessionId"] = Session;result["documentId"] = DocumentId;
                result["revision"] = Revision;result["capabilities"] = SessionMethods.ServerCapabilities;
            } else if (method == "snapshot") {
                result["sessionId"] = Session;result["documentId"] = DocumentId;result["revision"] = Revision;
                result["features"] = Features;result["sketches"] = Sketches;result["bodies"] = Array.Empty<object>();result["datums"] = Datums;
            } else if (method == "getCommandSchema") {
                CatalogReads++;
                static object Number() => new { type = "number" };
                static object String() => new { type = "string" };
                var commands = new List<object> {
                    new { id = "CreateBox", nativeType = 3, description = "Box", creation = new { fixedCount = 1 }, parameters = new { type = "object", properties = new {
                        widthMm = Number(), heightMm = Number(), depthMm = Number(), origin = new { type = "object", properties = new { x = Number(), y = Number(), z = Number() } },
                    } } },
                    new { id = "SetDimension", nativeType = 6, description = "Dimension", creation = new { fixedCount = 0 }, parameters = new { type = "object" } },
                    new { id = "CreateHolePattern", nativeType = 25, description = "Pattern", creation = new { idArrayParameter = "featureIds" }, parameters = new {
                        type = "object", properties = new { featureIds = new { type = "array", items = new { type = "string" } } },
                    } },
                };
                if (ProposalCatalog) {
                    commands.Add(new { id = "CreateCylinder", nativeType = 4, description = "Cylinder", creation = new { fixedCount = 1 }, parameters = new { type = "object", properties = new { radiusMm = Number(), heightMm = Number() } } });
                    commands.Add(new { id = "CreateSketch", nativeType = 5, description = "Sketch", creation = new { fixedCount = 1 }, parameters = new { type = "object", properties = new { planeKind = String(), model = new { type = "object" } } } });
                    commands.Add(new { id = "CreateExtrude", nativeType = 7, description = "Extrude", creation = new { fixedCount = 1 }, parameters = new { type = "object", properties = new { sketchId = String(), distanceMm = Number() } } });
                    commands.Add(new { id = "UpdateSketch", nativeType = 14, description = "Update sketch", creation = new { fixedCount = 0 }, parameters = new { type = "object", properties = new { featureId = String(), model = new { type = "object" } } } });
                }
                if (ConversionCatalog) {
                    commands.RemoveAt(2);
                    commands.Add(new { id = "CreateHolePattern", nativeType = 25, description = "Pattern", creation = new { idArrayParameter = "featureIds" }, parameters = new {
                        type = "object", properties = new { targetId = String(), faceRole = String(), featureIds = new { type = "array", items = new { type = WrongFeatureIdsItemType ? "number" : "string" } },
                            pointsMm = new { type = "array", items = new { type = WrongPointsMmItemType ? "string" : "number" } }, diameterMm = Number(), depthMode = new { type = "string", @enum = new[] { "throughAll", "blind" } }, depthMm = Number() },
                        required = new[] { "targetId", "faceRole", "featureIds", "pointsMm", "diameterMm", "depthMode" },
                    } });
                    commands.Add(new { id = "DeleteFeature", nativeType = 7, description = "Delete terminal feature", creation = new { fixedCount = 0 },
                        parameters = new { type = "object", properties = new { featureId = String() }, required = new[] { "featureId" } } });
                }
                if (BracketCommands || ProposalCatalog) commands.Add(new { id = "CreateBoolean", nativeType = 19, description = "Fuse", creation = new { fixedCount = 1 }, parameters = new { type = "object", properties = new { op = new { type = "string" }, targetId = new { type = "string" }, toolId = new { type = "string" } } } });
                result["result"] = new { commands };
            } else if (method == SessionMethods.GetSketchProjection) {
                if (FailProjection) { result["ok"] = false;result["errorCode"] = "SESSION_FAILED";result["error"] = "projection query failed"; }
                else {
                    result["sessionId"] = Session;result["documentId"] = "doc-phase1";result["revision"] = 7;
                    result["result"] = new { featureId = "target", geometryCurrent = true, status = "ok", error = "", blockingSourceIds = Array.Empty<string>(),
                        plane = new { origin = new[] { 0d, 0d, 0d }, xAxis = new[] { 1d, 0d, 0d }, yAxis = new[] { 0d, 1d, 0d }, normal = new[] { 0d, 0d, 1d } },
                        groups = Array.Empty<object>() };
                }
            } else if (method == "validateDocument" || method == "validateReferences") result["result"] = new { valid = Valid };
            else if (method == "measureVolume") result["result"] = new { volumeMm3 = 100000d };
            else if (method == SessionMethods.GetDatum) result["result"] = new { featureId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", kind = "DatumPlane", status = "ok", definition = new { type = "offset", @base = new { type = "principal", planeKind = "XY" }, offsetMm = 24d }, resolved = new { originMm = new[] { 0d, 0d, 24d }, normal = new[] { 0d, 0d, 1d } } };
            else if (method == "txnBegin") { TxnBegins++;result["status"] = "ok"; }
            else if (method == "command") {
                Commands++;
                if (Commands == RejectCommandAt) { result["status"] = "dependency_rejected";result["errorCode"] = "DEPENDENCY_ERROR";result["error"] = "Feature has a native dependent"; }
                else { result["status"] = "ok";result["revision"] = Revision; }
                if (Commands == CancelAfterCommand) CancelOnCommand?.Invoke();
            }
            else if (method == "txnCommit") {
                var operation = request.GetProperty("operationId").GetString()!;CommitOperations.Add(operation);
                if (_committed.Add(operation)) Commits++;
                result["status"] = "ok";result["revision"] = Revision + 1;
            }
            else if (method == "txnRollback") {
                Rollbacks++;
                if (FailRollback) { result["ok"] = false;result["errorCode"] = "INTERNAL_ERROR";result["error"] = "rollback rejected"; }
                else result["status"] = "ok";
            }
            else result["status"] = "ok";
            return JsonSerializer.Serialize(result);
        }
        public Task<CadClient> Connect() => CadClient.ConnectAsync(new Uri($"ws://127.0.0.1:{Server.Port}/"), "test-token", "hermes-mcp");
        public async Task AdvanceRevisionAsync(long revision)
        {
            var previous = Revision;Revision = revision;
            await Server.PushAsync(JsonSerializer.Serialize(new {
                @event = "delta", sessionId = Session, documentId = DocumentId, originClientId = "other-client",
                baseRevision = previous, newRevision = revision, revision,
                added = Array.Empty<object>(), updated = Array.Empty<object>(), removedIds = Array.Empty<string>(),
                changedMeshIds = Array.Empty<string>(), referenceRemaps = Array.Empty<object>(), warnings = Array.Empty<object>(),
            }));
        }
        public ValueTask DisposeAsync() => Server.DisposeAsync();
    }
    static JsonElement Json(string text) { using var doc = JsonDocument.Parse(text);return doc.RootElement.Clone(); }
    static GeneratedCadOption Generated(JsonElement option)
    {
        var steps = option.GetProperty("steps").EnumerateArray().Select(step => new GeneratedCadStep(
            step.GetProperty("commandId").GetString()!, step.GetProperty("parameters").Clone(),
            step.GetProperty("rationale").GetString()!)).ToArray();
        var fence = option.GetProperty("selectionFence");
        return new(option.GetProperty("id").GetString()!, option.GetProperty("description").GetString()!, steps,
            new(fence.GetProperty("sessionId").GetString()!, fence.GetProperty("documentId").GetString()!,
                fence.GetProperty("revision").GetInt64()));
    }
    static CadCheck Check(double expected = 100000) => new("measureVolume", Json("{\"bodyId\":\"$plate\"}"), "volumeMm3", expected, .01);
    static CadIntentContext Fence(long revision = 7, string documentId = "doc-phase1") => new() {
        SessionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", DocumentId = documentId, Revision = revision,
    };
    static CadIntentRequest MountingIntent(long revision = 7) => new() {
        Kind = "mountingBlank", ExpectedContext = Fence(revision),
        Dimensions = new() { WidthMm = 100, DepthMm = 50, ThicknessMm = 8 },
    };
    static object Hole(string id, double x) => new {
        featureId = id, type = "Hole", dependsOn = new[] { "plate" },
        refExtra = $"face=box.+Z;x={x};y=0;mode=through", paramsMm = new[] { 6d, 0d },
    };
    // Native C5 fixture native-sketch-record.json, SHA256 7cff9e0e9ff15c9c55a1f2babe312be145b9972e6c96cc2f4ab6c6a4a4655bd4.
    // Only featureId/id UUIDs normalize to "sketch"; envelope, counts and model geometry match the fixture.
    static object Sketch(string id = "sketch") => SketchEnvelope(NativeSketchModel(), id);
    static Dictionary<string, object?> SketchEnvelope(object? model, string id = "sketch", string supportRef = "",
        double planeZ = 0, int pointCount = 4, int lineCount = 1, int circleCount = 0,
        int constraintCount = 0, bool includeModel = true)
    {
        var record = new Dictionary<string, object?> {
            ["featureId"] = id, ["type"] = "Sketch", ["planeKind"] = "XY",
            ["points"] = pointCount, ["lines"] = lineCount, ["circles"] = circleCount,
            ["constraints"] = constraintCount, ["supportRef"] = supportRef,
            ["plane"] = new { origin = new[] { 0d, 0d, planeZ }, xAxis = new[] { 1d, 0d, 0d },
                yAxis = new[] { 0d, 1d, 0d }, normal = new[] { 0d, 0d, 1d } },
            ["geometryCurrent"] = true, ["status"] = "ok", ["projectionGroups"] = Array.Empty<object>(),
            ["id"] = id,
        };
        if (includeModel) record["model"] = model;
        return record;
    }
    static Dictionary<string, object?> NativeSketchModel() => new() {
        ["points"] = new object[] {
            new { id = "a", x = -10d, y = 5d, @fixed = false },
            new { id = "b", x = 10d, y = 5d, @fixed = false },
            new { id = "top", x = 0d, y = 20d, @fixed = false },
            new { id = "bottom", x = 0d, y = 0d, @fixed = false },
        },
        ["lines"] = new object[] { new { id = "axis", p1 = "top", p2 = "bottom" } },
        ["circles"] = Array.Empty<object>(), ["arcs"] = Array.Empty<object>(),
        ["ellipses"] = Array.Empty<object>(), ["splines"] = Array.Empty<object>(),
        ["constructionIds"] = Array.Empty<string>(), ["constraints"] = Array.Empty<object>(),
    };
    static Dictionary<string, object?> EmptySketchModel() => new() {
        ["points"] = Array.Empty<object>(), ["lines"] = Array.Empty<object>(),
        ["circles"] = Array.Empty<object>(), ["arcs"] = Array.Empty<object>(),
        ["ellipses"] = Array.Empty<object>(), ["splines"] = Array.Empty<object>(),
        ["constructionIds"] = Array.Empty<string>(), ["constraints"] = Array.Empty<object>(),
    };

    static async Task Disconnect(Wire wire, CadClient client)
    {
        wire.Server.DisconnectLastClient();
        for(var attempt=0;attempt<100 && client.IsConnected;attempt++) await Task.Delay(10);
        Assert.False(client.IsConnected);
    }

    [Fact]
    public async Task ProposalReturnsCanonicalFencedMountingBlankWithoutTransactionOrCommand()
    {
        await using var wire = new Wire { ProposalCatalog = true };
        await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client));

        var proposal = await bridge.ProposeIntentAsync(MountingIntent());

        Assert.Equal("proposed", proposal.GetProperty("status").GetString());
        Assert.Equal("mountingBlank", proposal.GetProperty("kind").GetString());
        Assert.Equal("mm", proposal.GetProperty("units").GetString());
        Assert.False(proposal.GetProperty("requiresExplicitChoice").GetBoolean());
        var option = proposal.GetProperty("options")[0];
        Assert.Equal("CreateBox", option.GetProperty("steps")[0].GetProperty("commandId").GetString());
        var parameters = option.GetProperty("steps")[0].GetProperty("parameters");
        Assert.Equal(100, parameters.GetProperty("widthMm").GetDouble());
        Assert.Equal(50, parameters.GetProperty("heightMm").GetDouble());
        Assert.Equal(8, parameters.GetProperty("depthMm").GetDouble());
        Assert.False(string.IsNullOrWhiteSpace(option.GetProperty("steps")[0].GetProperty("rationale").GetString()));
        Assert.Equal("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", option.GetProperty("selectionFence").GetProperty("sessionId").GetString());
        Assert.Equal(7, option.GetProperty("selectionFence").GetProperty("revision").GetInt64());
        Assert.Equal(0, wire.Commands);Assert.Equal(0, wire.TxnBegins);Assert.Equal(0, wire.Rollbacks);
    }

    [Fact]
    public async Task ProposalReturnsEverySupportedParallelPlateAlternativeAndRequiresChoice()
    {
        await using var wire = new Wire { ProposalCatalog = true };
        await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client));
        var proposal = await bridge.ProposeIntentAsync(new CadIntentRequest {
            Kind = "connectParallelPlates", ExpectedContext = Fence(),
            Dimensions = new() { SeparationMm = 40, SupportWidthMm = 20, SupportThicknessMm = 4 },
        });

        Assert.True(proposal.GetProperty("requiresExplicitChoice").GetBoolean());
        var options = proposal.GetProperty("options").EnumerateArray().ToArray();
        Assert.Equal(new[] { "round-spacer", "rectangular-spacer" }, options.Select(option => option.GetProperty("id").GetString()));
        Assert.Equal(new[] { "CreateCylinder", "CreateBox" }, options.Select(option => option.GetProperty("steps")[0].GetProperty("commandId").GetString()));
        Assert.All(options, option => {
            Assert.Equal(7, option.GetProperty("selectionFence").GetProperty("revision").GetInt64());
            Assert.False(string.IsNullOrWhiteSpace(option.GetProperty("steps")[0].GetProperty("rationale").GetString()));
        });
        Assert.Equal(0, wire.Commands);Assert.Equal(0, wire.TxnBegins);Assert.Equal(0, wire.Rollbacks);
    }

    [Fact]
    public async Task ProposalMapsBracketAndEnclosureKindsToCanonicalOptions()
    {
        await using var wire = new Wire { ProposalCatalog = true };
        await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client));

        var l = await bridge.ProposeIntentAsync(new CadIntentRequest {
            Kind = "lBracket", ExpectedContext = Fence(),
            Dimensions = new() { WidthMm = 100, DepthMm = 40, HeightMm = 50, ThicknessMm = 5 },
        });
        var u = await bridge.ProposeIntentAsync(new CadIntentRequest {
            Kind = "uBracket", ExpectedContext = Fence(),
            Dimensions = new() { WidthMm = 100, DepthMm = 40, HeightMm = 50, ThicknessMm = 5 },
        });
        var enclosure = await bridge.ProposeIntentAsync(new CadIntentRequest {
            Kind = "openEnclosure", ExpectedContext = Fence(),
            Dimensions = new() { WidthMm = 100, DepthMm = 80, HeightMm = 40, WallMm = 4 },
        });

        Assert.Equal("lBracket", l.GetProperty("kind").GetString());
        Assert.Equal("uBracket", u.GetProperty("kind").GetString());
        Assert.Equal("openEnclosure", enclosure.GetProperty("kind").GetString());
        Assert.Equal(new[] { "CreateBox", "CreateBox", "CreateBoolean" },
            l.GetProperty("options")[0].GetProperty("steps").EnumerateArray().Select(step => step.GetProperty("commandId").GetString()));
        Assert.Equal(5, u.GetProperty("options")[0].GetProperty("steps").GetArrayLength());
        Assert.Equal(new[] { "CreateSketch", "CreateExtrude", "CreateSketch", "CreateExtrude", "CreateBoolean" },
            enclosure.GetProperty("options")[0].GetProperty("steps").EnumerateArray().Select(step => step.GetProperty("commandId").GetString()));
        Assert.All(new[] { l, u, enclosure }, proposal => Assert.All(proposal.GetProperty("options").EnumerateArray(), option =>
            Assert.Equal(7, option.GetProperty("selectionFence").GetProperty("revision").GetInt64())));
        Assert.Equal(0, wire.Commands);Assert.Equal(0, wire.TxnBegins);Assert.Equal(0, wire.Rollbacks);
    }

    [Fact]
    public async Task ActualTerminalHoleChainProposesReviewedConversionWithoutMutation()
    {
        await using var wire = new Wire { ConversionCatalog = true, Features = NativeHoleChain() };
        await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client));
        var proposal = await bridge.ProposeIntentAsync(new CadIntentRequest {
            Kind = "inferHoles", ExpectedContext = Fence(), TargetId = "plate", FaceRole = "box.+Z",
        });
        var option = Assert.Single(proposal.GetProperty("options").EnumerateArray());
        Assert.True(proposal.GetProperty("requiresExplicitChoice").GetBoolean());
        var steps = option.GetProperty("steps").EnumerateArray().ToArray();
        Assert.Equal(new[] { "DeleteFeature", "DeleteFeature", "DeleteFeature", "CreateHolePattern" },
            steps.Select(s => s.GetProperty("commandId").GetString()));
        Assert.Equal(new[] { "hole3", "hole2", "hole1" }, steps.Take(3).Select(s => s.GetProperty("parameters").GetProperty("featureId").GetString()));
        var pattern = steps[^1].GetProperty("parameters");
        Assert.Equal("plate", pattern.GetProperty("targetId").GetString());
        Assert.Equal(new[] { 20d, 40d, 40d, 40d, 60d, 40d }, pattern.GetProperty("pointsMm").EnumerateArray().Select(x => x.GetDouble()));
        Assert.Equal(6d, pattern.GetProperty("diameterMm").GetDouble());
        Assert.Equal("throughAll", pattern.GetProperty("depthMode").GetString());
        Assert.Equal(0d, pattern.GetProperty("depthMm").GetDouble());
        var newIds = pattern.GetProperty("featureIds").EnumerateArray().Select(x => x.GetString()!).ToArray();
        Assert.Equal(3, newIds.Distinct(StringComparer.Ordinal).Count());
        Assert.DoesNotContain(newIds, id => new[] { "hole1", "hole2", "hole3" }.Contains(id, StringComparer.Ordinal));
        Assert.True(!steps[^1].TryGetProperty("alias", out var alias) || alias.ValueKind == JsonValueKind.Null);
        Assert.Equal(7, option.GetProperty("selectionFence").GetProperty("revision").GetInt64());
        Assert.All(steps, step => Assert.False(string.IsNullOrWhiteSpace(step.GetProperty("rationale").GetString())));
        Assert.Equal(0, wire.Commands);Assert.Equal(0, wire.TxnBegins);Assert.Equal(0, wire.Commits);Assert.Equal(0, wire.Rollbacks);
    }

    [Fact]
    public async Task UniformBlindHoleChainPreservesExactDepthAndMode()
    {
        await using var wire = new Wire { ConversionCatalog = true, Features = NativeHoleChain(depth: 5, mode: "blind") };
        await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client));
        var proposal = await bridge.ProposeIntentAsync(new CadIntentRequest {
            Kind = "inferHoles", ExpectedContext = Fence(), TargetId = "plate", FaceRole = "box.+Z",
        });

        var option = Assert.Single(proposal.GetProperty("options").EnumerateArray());
        var pattern = option.GetProperty("steps")[3].GetProperty("parameters");
        Assert.Equal("blind", pattern.GetProperty("depthMode").GetString());
        Assert.Equal(5d, pattern.GetProperty("depthMm").GetDouble());
        Assert.Equal(6d, pattern.GetProperty("diameterMm").GetDouble());
        Assert.Equal(new[] { 20d, 40d, 40d, 40d, 60d, 40d }, pattern.GetProperty("pointsMm").EnumerateArray().Select(x => x.GetDouble()));
        Assert.True(proposal.GetProperty("requiresExplicitChoice").GetBoolean());
        Assert.Equal(0, wire.Commands);Assert.Equal(0, wire.TxnBegins);
    }

    [Fact]
    public async Task NearEqualMixedAndUnprovenHoleHistoriesStayAdvisory()
    {
        var cases = new List<(object[] Features, Action<Wire>? Configure)> {
            (NativeHoleChain(secondDiameter: 6.005), null),
            (NativeHoleChain(secondDepth: 5), null),
            (NativeHoleChain(secondDepth: 5, secondMode: "blind"), null),
            (NativeHoleChain(wrongFaceAt: 2), null),
            (NativeHoleChain(terminal: false), null),
            (NativeHoleChain(current: false), null),
            (NativeHoleChain(count: 5), null),
            (NativeHoleChain(), wire => wire.Features = [..wire.Features,
                new { featureId = "branch", type = "Fillet", dependsOn = new[] { "plate" }, bodyId = "body-other", bodyTip = false }]),
            (NativeHoleChain(), wire => wire.Features = [..wire.Features,
                new { featureId = "other-tip", type = "Fillet", bodyId = "body-plate", bodyTip = true }]),
            (NativeHoleChain(), wire => wire.Features = [..wire.Features,
                new { featureId = "dependent", type = "Extrude", dependsOn = new[] { "hole2" }, bodyId = "body-other", bodyTip = true }]),
            (NativeHoleChain(), wire => wire.Sketches = [new { featureId = "sketch-ref", supportRef = "hole2" }]),
            (NativeHoleChain(), wire => wire.Datums = [new { featureId = "datum-ref", supportRef = "hole2" }]),
            (NativeHoleChain(expressions: true), null),
            ([
                new { featureId = "plate", type = "Box", paramsMm = new[] { 100d, 80d, 20d }, dependsOn = Array.Empty<string>(), expressions = new { }, refExtra = "", bodyId = "body-plate", bodyVisible = true, bodyTip = true, geometryCurrent = true, status = "ok" } as object,
                new { featureId = "aggregate", type = "HolePattern", paramsMm = new[] { 6d, 0d, 3d }, dependsOn = new[] { "plate" }, refExtra = "pattern", bodyId = "body-plate", bodyTip = true, geometryCurrent = true, status = "ok" },
            ], null),
        };

        foreach (var (features, configure) in cases) {
            await using var wire = new Wire { ConversionCatalog = true, Features = features };
            configure?.Invoke(wire);
            await using var client = await wire.Connect();
            await using var bridge = new CadBridge(_ => Task.FromResult(client));
            var proposal = await bridge.ProposeIntentAsync(new CadIntentRequest {
                Kind = "inferHoles", ExpectedContext = Fence(), TargetId = "plate", FaceRole = "box.+Z",
            });
            Assert.Empty(proposal.GetProperty("options").EnumerateArray());
            Assert.All(proposal.GetProperty("suggestions").EnumerateArray().Where(s => s.GetProperty("id").GetString() == "linear-hole-pattern"), suggestion => {
                Assert.False(suggestion.GetProperty("canExecute").GetBoolean());
                Assert.Equal(JsonValueKind.Null, suggestion.GetProperty("proposedCommand").ValueKind);
            });
            Assert.Equal(0, wire.Commands);Assert.Equal(0, wire.TxnBegins);Assert.Equal(0, wire.Commits);Assert.Equal(0, wire.Rollbacks);
        }
    }

    [Fact]
    public async Task ConversionRequiresCompleteCurrentArrayItemSchemas()
    {
        await using (var wire = new Wire { ConversionCatalog = true, WrongPointsMmItemType = true, Features = NativeHoleChain() }) {
            await using var client = await wire.Connect();await using var bridge = new CadBridge(_ => Task.FromResult(client));
            var proposal = await bridge.ProposeIntentAsync(new CadIntentRequest {
                Kind = "inferHoles", ExpectedContext = Fence(), TargetId = "plate", FaceRole = "box.+Z",
            });
            Assert.Empty(proposal.GetProperty("options").EnumerateArray());
            Assert.Equal(0, wire.Commands);Assert.Equal(0, wire.TxnBegins);
        }
        await using (var wire = new Wire { ConversionCatalog = true, WrongFeatureIdsItemType = true, Features = NativeHoleChain() }) {
            await using var client = await wire.Connect();await using var bridge = new CadBridge(_ => Task.FromResult(client));
            await Assert.ThrowsAsync<ArgumentException>(() => bridge.ProposeIntentAsync(new CadIntentRequest {
                Kind = "inferHoles", ExpectedContext = Fence(), TargetId = "plate", FaceRole = "box.+Z",
            }));
            Assert.Equal(0, wire.Commands);Assert.Equal(0, wire.TxnBegins);
        }
        await using (var wire = new Wire { Features = NativeHoleChain() }) {
            await using var client = await wire.Connect();await using var bridge = new CadBridge(_ => Task.FromResult(client));
            var proposal = await bridge.ProposeIntentAsync(new CadIntentRequest {
                Kind = "inferHoles", ExpectedContext = Fence(), TargetId = "plate", FaceRole = "box.+Z",
            });
            Assert.Empty(proposal.GetProperty("options").EnumerateArray());
            Assert.Equal(0, wire.Commands);Assert.Equal(0, wire.TxnBegins);
        }
    }

    [Fact]
    public async Task AcceptedNativeHoleConversionRunsOneFencedTransactionWithoutAlias()
    {
        await using var wire = new Wire { ConversionCatalog = true, Features = NativeHoleChain() };
        await using var client = await wire.Connect();await using var bridge = new CadBridge(_ => Task.FromResult(client));
        var proposal = await bridge.ProposeIntentAsync(new CadIntentRequest {
            Kind = "inferHoles", ExpectedContext = Fence(), TargetId = "plate", FaceRole = "box.+Z",
        });
        var option = Generated(Assert.Single(proposal.GetProperty("options").EnumerateArray()));
        var result = await bridge.ExecuteGeneratedAsync(option, [new CadCheck("measureVolume", Json("{}"), "volumeMm3", 100000)]);

        Assert.Equal("committed", result.GetProperty("status").GetString());
        Assert.Equal(1, wire.TxnBegins);Assert.Equal(4, wire.Commands);Assert.Equal(1, wire.Commits);Assert.Equal(0, wire.Rollbacks);
        var commands = wire.Server.Received.Select(Json).Where(x => x.GetProperty("method").GetString() == "command").ToArray();
        Assert.Equal(new[] { "DeleteFeature", "DeleteFeature", "DeleteFeature", "CreateHolePattern" },
            commands.Select(x => x.GetProperty("params").GetProperty("commandId").GetString()));
        Assert.Equal(new[] { "hole3", "hole2", "hole1" }, commands.Take(3).Select(x =>
            x.GetProperty("params").GetProperty("parameters").GetProperty("featureId").GetString()));
        var patternCommand = commands[^1].GetProperty("params");
        Assert.False(patternCommand.TryGetProperty("featureId", out _));
        Assert.Equal(new[] { 20d, 40d, 40d, 40d, 60d, 40d }, patternCommand.GetProperty("parameters").GetProperty("pointsMm").EnumerateArray().Select(x => x.GetDouble()));
        Assert.Equal(1, wire.Server.Received.Select(Json).Count(x => x.GetProperty("method").GetString() == "txnBegin"));
    }

    [Fact]
    public async Task NativeDeleteRejectionAndCancellationRollbackConversionAtomically()
    {
        await using (var wire = new Wire { ConversionCatalog = true, Features = NativeHoleChain(), RejectCommandAt = 2 }) {
            await using var client = await wire.Connect();await using var bridge = new CadBridge(_ => Task.FromResult(client));
            var proposal = await bridge.ProposeIntentAsync(new CadIntentRequest {
                Kind = "inferHoles", ExpectedContext = Fence(), TargetId = "plate", FaceRole = "box.+Z",
            });
            await Assert.ThrowsAsync<SessionException>(() => bridge.ExecuteGeneratedAsync(Generated(Assert.Single(proposal.GetProperty("options").EnumerateArray())),
                [new CadCheck("measureVolume", Json("{}"), "volumeMm3", 100000)]));
            Assert.Equal(1, wire.TxnBegins);Assert.Equal(2, wire.Commands);Assert.Equal(0, wire.Commits);Assert.Equal(1, wire.Rollbacks);
        }
        await using (var wire = new Wire { ConversionCatalog = true, Features = NativeHoleChain() }) {
            using var cancellation = new CancellationTokenSource();wire.CancelAfterCommand = 1;wire.CancelOnCommand = cancellation.Cancel;
            await using var client = await wire.Connect();await using var bridge = new CadBridge(_ => Task.FromResult(client));
            var proposal = await bridge.ProposeIntentAsync(new CadIntentRequest {
                Kind = "inferHoles", ExpectedContext = Fence(), TargetId = "plate", FaceRole = "box.+Z",
            });
            var cancelled = await Assert.ThrowsAsync<SessionException>(() => bridge.ExecuteGeneratedAsync(Generated(Assert.Single(proposal.GetProperty("options").EnumerateArray())),
                [new CadCheck("measureVolume", Json("{}"), "volumeMm3", 100000)], cancellation.Token));
            Assert.Equal("CANCELLED", cancelled.Code);
            Assert.Equal(1, wire.TxnBegins);Assert.Equal(1, wire.Commands);Assert.Equal(0, wire.Commits);Assert.Equal(1, wire.Rollbacks);
        }
        await using (var wire = new Wire { ConversionCatalog = true, Features = NativeHoleChain(), RejectCommandAt = 2, FailRollback = true }) {
            await using var client = await wire.Connect();await using var bridge = new CadBridge(_ => Task.FromResult(client));
            var proposal = await bridge.ProposeIntentAsync(new CadIntentRequest {
                Kind = "inferHoles", ExpectedContext = Fence(), TargetId = "plate", FaceRole = "box.+Z",
            });
            await Assert.ThrowsAsync<CadRecoveryRequiredException>(() => bridge.ExecuteGeneratedAsync(Generated(Assert.Single(proposal.GetProperty("options").EnumerateArray())),
                [new CadCheck("measureVolume", Json("{}"), "volumeMm3", 100000)]));
            var status = await bridge.DescribeAsync();
            Assert.Equal("uncertain", status.GetProperty("status").GetString());
            Assert.Equal("ROLLBACK_UNCONFIRMED", status.GetProperty("errorCode").GetString());
            await Assert.ThrowsAsync<CadRecoveryRequiredException>(() => bridge.BeginAsync("blocked after uncertain rollback", [Check()]));
            Assert.Equal(1, wire.TxnBegins);Assert.Equal(2, wire.Commands);Assert.Equal(0, wire.Commits);Assert.Equal(1, wire.Rollbacks);
        }
    }

    [Fact]
    public async Task StaleNativeHoleConversionFenceRejectsBeforeTransaction()
    {
        await using var wire = new Wire { ConversionCatalog = true, Features = NativeHoleChain() };
        await using var client = await wire.Connect();await using var bridge = new CadBridge(_ => Task.FromResult(client));
        var proposal = await bridge.ProposeIntentAsync(new CadIntentRequest {
            Kind = "inferHoles", ExpectedContext = Fence(), TargetId = "plate", FaceRole = "box.+Z",
        });
        await wire.AdvanceRevisionAsync(8);
        for (var attempt = 0; attempt < 100 && client.Model?.Revision != 8; attempt++) await Task.Delay(10);
        await Assert.ThrowsAsync<SessionException>(() => bridge.ExecuteGeneratedAsync(Generated(Assert.Single(proposal.GetProperty("options").EnumerateArray())),
            [new CadCheck("measureVolume", Json("{}"), "volumeMm3", 100000)]));
        Assert.Equal(0, wire.TxnBegins);Assert.Equal(0, wire.Commands);Assert.Equal(0, wire.Commits);Assert.Equal(0, wire.Rollbacks);
    }

    // Actual C5 manual-hole-native-snapshot.json, UUIDs normalized; all native provenance fields retained.
    static object[] NativeHoleChain(int count = 3, double diameter = 6, double? secondDiameter = null,
        double depth = 0, double? secondDepth = null, string mode = "throughAll", string? secondMode = null,
        int wrongFaceAt = -1, bool terminal = true, bool current = true, bool expressions = false)
    {
        var features = new List<object> { new { featureId = "plate", type = "Box", paramsMm = new[] { 100d, 80d, 20d },
            dependsOn = Array.Empty<string>(), expressions = new { }, refExtra = "", bodyId = "body-plate", bodyVisible = true,
            bodyTip = false, geometryCurrent = true, status = "ok" } };
        var parent = "plate";
        for (var i = 0; i < count; i++) {
            var id = "hole" + (i + 1).ToString(System.Globalization.CultureInfo.InvariantCulture);
            features.Add(NativeHole(id, parent, 20 + 20 * i, i == count - 1 && terminal,
                i == 1 && secondDiameter.HasValue ? secondDiameter.Value : diameter,
                i == 1 && secondDepth.HasValue ? secondDepth.Value : depth,
                i == 1 && secondMode is not null ? secondMode : mode,
                i == wrongFaceAt - 1 ? "box.+X" : "box.+Z", current, expressions && i == 1));
            parent = id;
        }
        return features.ToArray();
    }
    static object NativeHole(string id, string parent, double x, bool tip, double diameter = 6, double depth = 0,
        string mode = "throughAll", string face = "box.+Z", bool current = true, bool expressions = false) => new {
        featureId = id, type = "Hole", paramsMm = new[] { diameter, depth }, dependsOn = new[] { parent },
        expressions = expressions ? new Dictionary<string, object?> { ["diameterMm"] = "pilot" } : new Dictionary<string, object?>(),
        refExtra = FormattableString.Invariant($"face={face};x={x};y=40;mode={mode}"), bodyId = "body-plate", bodyVisible = true,
        bodyTip = tip, geometryCurrent = current, status = current ? "ok" : "stale",
    };

    [Fact]
    public async Task ExistingHoleHistoryIsAuthoritativeAndRemainsAdvisory()
    {
        await using var wire = new Wire { Features = [new { featureId = "plate", type = "Box" }, Hole("hole1", 0), Hole("hole2", 20), Hole("hole3", 40)] };
        await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client));
        var proposal = await bridge.ProposeIntentAsync(new CadIntentRequest {
            Kind = "inferHoles", ExpectedContext = Fence(), TargetId = "plate", FaceRole = "box.+Z",
        });

        Assert.Empty(proposal.GetProperty("options").EnumerateArray());
        Assert.Contains(proposal.GetProperty("suggestions").EnumerateArray(), suggestion =>
            suggestion.GetProperty("id").GetString() == "linear-hole-pattern" &&
            !suggestion.GetProperty("canExecute").GetBoolean() &&
            suggestion.GetProperty("proposedCommand").ValueKind == JsonValueKind.Null);
        Assert.Equal(0, wire.Commands);Assert.Equal(0, wire.TxnBegins);Assert.Equal(0, wire.Rollbacks);
    }

    [Fact]
    public async Task SparseHoleHistoryReturnsNoSuggestionsAndUnknownTargetIsRejected()
    {
        await using var wire = new Wire { Features = [new { featureId = "plate", type = "Box" }, Hole("hole1", 0)] };
        await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client));
        var sparse = await bridge.ProposeIntentAsync(new CadIntentRequest {
            Kind = "inferHoles", ExpectedContext = Fence(), TargetId = "plate", FaceRole = "box.+Z",
        });
        Assert.Empty(sparse.GetProperty("suggestions").EnumerateArray());
        await Assert.ThrowsAsync<ArgumentException>(() => bridge.ProposeIntentAsync(new CadIntentRequest {
            Kind = "inferHoles", ExpectedContext = Fence(), TargetId = "unknown", FaceRole = "box.+Z",
        }));
        Assert.Equal(0, wire.Commands);Assert.Equal(0, wire.TxnBegins);Assert.Equal(0, wire.Rollbacks);
    }

    [Fact]
    public async Task ProposalRejectsMissingIrrelevantAndNonFiniteDimensions()
    {
        await using var wire = new Wire { ProposalCatalog = true };
        await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client));
        var invalid = new[] {
            new CadIntentRequest { Kind = "mountingBlank", ExpectedContext = Fence(), Dimensions = new() { DepthMm = 50, ThicknessMm = 8 } },
            new CadIntentRequest { Kind = "mountingBlank", ExpectedContext = Fence(), Dimensions = new() { WidthMm = double.NaN, DepthMm = 50, ThicknessMm = 8 } },
            new CadIntentRequest { Kind = "mountingBlank", ExpectedContext = Fence(), Dimensions = new() { WidthMm = 100, DepthMm = 50, ThicknessMm = 8, HeightMm = 20 } },
            new CadIntentRequest { Kind = "mountingBlank", ExpectedContext = Fence(), Dimensions = new() { WidthMm = 100, DepthMm = 50, ThicknessMm = 8 }, TargetId = "plate" },
            new CadIntentRequest { Kind = "unknownKind", ExpectedContext = Fence(), Dimensions = new() { WidthMm = 100, DepthMm = 50, ThicknessMm = 8 } },
        };
        foreach (var request in invalid)
            await Assert.ThrowsAsync<ArgumentException>(() => bridge.ProposeIntentAsync(request));
        Assert.Equal(0, wire.CatalogReads);Assert.Equal(0, wire.Commands);Assert.Equal(0, wire.TxnBegins);Assert.Equal(0, wire.Rollbacks);
    }

    [Fact]
    public async Task SketchInferenceUsesNativeC5EnvelopeAndReturnsFencedSymmetryConstraint()
    {
        await using var wire = new Wire { ProposalCatalog = true, Sketches = [Sketch()] };
        await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client));
        var proposal = await bridge.ProposeIntentAsync(new CadIntentRequest {
            Kind = "inferSketchConstraints", ExpectedContext = Fence(), SketchId = "sketch",
        });

        Assert.Contains(proposal.GetProperty("suggestions").EnumerateArray(), suggestion =>
            suggestion.GetProperty("kind").GetString() == "symmetric" &&
            suggestion.GetProperty("acceptedCommand").ValueKind == JsonValueKind.Object);
        var option = Assert.Single(proposal.GetProperty("options").EnumerateArray());
        var step = Assert.Single(option.GetProperty("steps").EnumerateArray());
        Assert.Equal("UpdateSketch", step.GetProperty("commandId").GetString());
        Assert.Equal("sketch", step.GetProperty("parameters").GetProperty("featureId").GetString());
        Assert.Equal(7, option.GetProperty("selectionFence").GetProperty("revision").GetInt64());
        Assert.Equal(0, wire.Commands);Assert.Equal(0, wire.TxnBegins);Assert.Equal(0, wire.Rollbacks);
    }

    [Fact]
    public async Task SketchInferenceUpdatePreservesNestedModelAndExistingConstraints()
    {
        var model = NativeSketchModel();
        model["ellipses"] = new object[] { new { id = "ellipse-keep", center = "a", majorRadius = 4d, minorRadius = 2d } };
        model["splines"] = new object[] { new { id = "spline-keep", controlPoints = new[] { "a", "b", "top" } } };
        model["constructionIds"] = new[] { "spline-keep" };
        model["constraints"] = new object[] { new { id = "existing", kind = "coincident", refs = new[] { "a", "top" } } };
        var expectedModel = JsonSerializer.SerializeToElement(model);
        await using var wire = new Wire { ProposalCatalog = true, Sketches = [SketchEnvelope(model, constraintCount: 1)] };
        await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client));

        var proposal = await bridge.ProposeIntentAsync(new CadIntentRequest {
            Kind = "inferSketchConstraints", ExpectedContext = Fence(), SketchId = "sketch",
        });

        var suggestion = Assert.Single(proposal.GetProperty("suggestions").EnumerateArray());
        Assert.Equal("symmetric", suggestion.GetProperty("kind").GetString());
        Assert.Equal(JsonValueKind.Object, suggestion.GetProperty("acceptedCommand").ValueKind);
        var option = Assert.Single(proposal.GetProperty("options").EnumerateArray());
        var parameters = Assert.Single(option.GetProperty("steps").EnumerateArray()).GetProperty("parameters");
        var updatedModel = parameters.GetProperty("model");
        Assert.Equal(new[] { "featureId", "model" }, parameters.EnumerateObject().Select(property => property.Name).OrderBy(name => name, StringComparer.Ordinal));
        Assert.Equal(expectedModel.EnumerateObject().Select(property => property.Name).OrderBy(name => name, StringComparer.Ordinal),
            updatedModel.EnumerateObject().Select(property => property.Name).OrderBy(name => name, StringComparer.Ordinal));
        foreach (var property in expectedModel.EnumerateObject().Where(property => property.Name != "constraints"))
            Assert.Equal(property.Value.GetRawText(), updatedModel.GetProperty(property.Name).GetRawText());
        var constraints = updatedModel.GetProperty("constraints");
        Assert.Equal(2, constraints.GetArrayLength());
        Assert.Equal(expectedModel.GetProperty("constraints")[0].GetRawText(), constraints[0].GetRawText());
        Assert.Equal("symmetric", constraints[1].GetProperty("kind").GetString());
        Assert.Equal(new[] { "a", "b", "axis" }, constraints[1].GetProperty("refs").EnumerateArray().Select(reference => reference.GetString()));
        Assert.Equal(0, wire.Commands);Assert.Equal(0, wire.TxnBegins);Assert.Equal(0, wire.Rollbacks);
    }

    [Fact]
    public async Task SketchInferenceRejectsMalformedModelBeforeMutation()
    {
        foreach (var record in new object[] {
            SketchEnvelope(null, includeModel: false), SketchEnvelope(null), SketchEnvelope("not-an-object"),
        }) {
            await using var wire = new Wire { ProposalCatalog = true, Sketches = [record] };
            await using var client = await wire.Connect();
            await using var bridge = new CadBridge(_ => Task.FromResult(client));

            var error = await Record.ExceptionAsync(() => bridge.ProposeIntentAsync(new CadIntentRequest {
                Kind = "inferSketchConstraints", ExpectedContext = Fence(), SketchId = "sketch",
            }));

            Assert.NotNull(error);
            if (error is SessionException sessionError)
                Assert.Contains(sessionError.Code, new[] { "BAD_MODEL", "NEED_FULL_SNAPSHOT" });
            else Assert.Contains("Committed sketch is missing semantic model object", Assert.IsType<ArgumentException>(error).Message);
            Assert.Equal(0, wire.Commands);Assert.Equal(0, wire.TxnBegins);Assert.Equal(0, wire.Rollbacks);
        }
    }

    [Fact]
    public async Task SketchInferenceRejectsMissingRequiredNestedArraysBeforeMutation()
    {
        var invalid = new List<(object Record, string Message)>();
        foreach (var name in new[] { "points", "lines", "circles", "arcs", "ellipses", "splines", "constructionIds", "constraints" }) {
            var model = NativeSketchModel();
            model.Remove(name);
            invalid.Add((SketchEnvelope(model), "Committed sketch is missing semantic array " + name));
        }
        foreach (var (record, message) in invalid) {
            await using var wire = new Wire { ProposalCatalog = true, Sketches = [record] };
            await using var client = await wire.Connect();
            await using var bridge = new CadBridge(_ => Task.FromResult(client));

            var error = await Assert.ThrowsAsync<ArgumentException>(() => bridge.ProposeIntentAsync(new CadIntentRequest {
                Kind = "inferSketchConstraints", ExpectedContext = Fence(), SketchId = "sketch",
            }));

            Assert.Contains(message, error.Message);
            Assert.Equal(0, wire.Commands);Assert.Equal(0, wire.TxnBegins);Assert.Equal(0, wire.Rollbacks);
        }
    }

    [Fact]
    public async Task SketchInferenceRejectsNonArraySemanticPropertiesBeforeMutation()
    {
        foreach (var name in new[] { "points", "lines", "circles", "arcs", "ellipses", "splines", "constructionIds", "constraints" }) {
            var model = NativeSketchModel();
            model[name] = name == "constructionIds" ? "not-an-array" : 7;
            await using var wire = new Wire { ProposalCatalog = true, Sketches = [SketchEnvelope(model)] };
            await using var client = await wire.Connect();
            await using var bridge = new CadBridge(_ => Task.FromResult(client));

            var error = await Record.ExceptionAsync(() => bridge.ProposeIntentAsync(new CadIntentRequest {
                Kind = "inferSketchConstraints", ExpectedContext = Fence(), SketchId = "sketch",
            }));

            Assert.NotNull(error);
            if (error is SessionException sessionError)
                Assert.Contains(sessionError.Code, new[] { "BAD_MODEL", "NEED_FULL_SNAPSHOT" });
            else Assert.Contains("Committed sketch is missing semantic array " + name, Assert.IsType<ArgumentException>(error).Message);
            Assert.Equal(0, wire.Commands);Assert.Equal(0, wire.TxnBegins);Assert.Equal(0, wire.Rollbacks);
        }
    }

    [Fact]
    public async Task SketchInferenceBoundsEveryNestedSemanticArrayAt64()
    {
        foreach (var name in new[] { "points", "lines", "circles", "arcs", "ellipses", "splines", "constructionIds", "constraints" }) {
            var model = NativeSketchModel();
            object[] oversized = name == "constructionIds"
                ? Enumerable.Range(0, 65).Select(index => (object)$"construction-{index}").ToArray()
                : Enumerable.Range(0, 65).Select(index => (object)new { id = $"{name}-{index}" }).ToArray();
            model[name] = oversized;
            await using var wire = new Wire { ProposalCatalog = true, Sketches = [SketchEnvelope(model)] };
            await using var client = await wire.Connect();
            await using var bridge = new CadBridge(_ => Task.FromResult(client));

            var error = await Assert.ThrowsAsync<ArgumentException>(() => bridge.ProposeIntentAsync(new CadIntentRequest {
                Kind = "inferSketchConstraints", ExpectedContext = Fence(), SketchId = "sketch",
            }));

            Assert.Contains("Committed sketch exceeds the bounded inference limit", error.Message);
            Assert.Equal(0, wire.Commands);Assert.Equal(0, wire.TxnBegins);Assert.Equal(0, wire.Rollbacks);
        }
    }

    [Fact]
    public async Task SketchInferenceAcceptsExactly64NestedConstructionIds()
    {
        var model = NativeSketchModel();
        model["constructionIds"] = Enumerable.Range(0, 64).Select(index => $"construction-{index}").ToArray();
        await using var wire = new Wire { ProposalCatalog = true, Sketches = [SketchEnvelope(model)] };
        await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client));

        var proposal = await bridge.ProposeIntentAsync(new CadIntentRequest {
            Kind = "inferSketchConstraints", ExpectedContext = Fence(), SketchId = "sketch",
        });

        Assert.Contains(proposal.GetProperty("suggestions").EnumerateArray(), suggestion =>
            suggestion.GetProperty("kind").GetString() == "symmetric");
        Assert.Equal(0, wire.Commands);Assert.Equal(0, wire.TxnBegins);Assert.Equal(0, wire.Rollbacks);
    }

    [Fact]
    public async Task ProposalRejectsAnOversizedSketchArrayAndExcessiveSuggestionSet()
    {
        var points = Enumerable.Range(0, 65).Select(index => (object)new { id = $"p{index}", x = (double)index, y = 0d }).ToArray();
        var oversizedModel = NativeSketchModel();
        oversizedModel["points"] = points;
        await using var wire = new Wire { ProposalCatalog = true, Sketches = [SketchEnvelope(oversizedModel, pointCount: 65)] };
        await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client));
        var request = new CadIntentRequest { Kind = "inferSketchConstraints", ExpectedContext = Fence(), SketchId = "sketch" };
        var oversizedError = await Assert.ThrowsAsync<ArgumentException>(() => bridge.ProposeIntentAsync(request));
        Assert.Contains("Committed sketch exceeds the bounded inference limit", oversizedError.Message);

        var manyPoints = Enumerable.Range(0, 34).Select(index => (object)new { id = $"m{index}", x = (double)(index % 2) * 10, y = (double)(index / 2) }).ToArray();
        var manyLines = Enumerable.Range(0, 17).Select(index => (object)new { id = $"line{index}", p1 = $"m{index * 2}", p2 = $"m{index * 2 + 1}" }).ToArray();
        Assert.Equal(0, wire.Commands);Assert.Equal(0, wire.TxnBegins);Assert.Equal(0, wire.Rollbacks);

        var excessiveModel = NativeSketchModel();
        excessiveModel["points"] = manyPoints;excessiveModel["lines"] = manyLines;
        var excessive = SketchEnvelope(excessiveModel, pointCount: 34, lineCount: 17);
        await using var excessiveWire = new Wire { ProposalCatalog = true, Sketches = [excessive] };
        await using var excessiveClient = await excessiveWire.Connect();
        await using var excessiveBridge = new CadBridge(_ => Task.FromResult(excessiveClient));
        var excessiveError = await Assert.ThrowsAsync<ArgumentException>(() => excessiveBridge.ProposeIntentAsync(request));
        Assert.Contains("Sketch inference exceeds the bounded suggestion limit", excessiveError.Message);
        Assert.Equal(0, excessiveWire.Commands);Assert.Equal(0, excessiveWire.TxnBegins);Assert.Equal(0, excessiveWire.Rollbacks);
    }

    [Fact]
    public async Task ProposalRejectsStaleContextAndCatalogRaceWithoutOpeningTransaction()
    {
        await using var wire = new Wire { ProposalCatalog = true };
        await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client));
        var stale = MountingIntent(6);
        var error = await Assert.ThrowsAsync<SessionException>(() => bridge.ProposeIntentAsync(stale));
        Assert.Equal("NEED_FULL_SNAPSHOT", error.Code);
        Assert.Equal(0, wire.TxnBegins);Assert.Equal(0, wire.Commands);Assert.Equal(0, wire.Rollbacks);

        wire.BeforeCatalogReply = async () => {
            await wire.AdvanceRevisionAsync(8);
            for (var attempt = 0; attempt < 100 && client.Model?.Revision != 8; attempt++) await Task.Delay(10);
            Assert.Equal(8, client.Model?.Revision);
        };
        var changed = await Assert.ThrowsAsync<SessionException>(() => bridge.ProposeIntentAsync(MountingIntent()));
        Assert.Equal("NEED_FULL_SNAPSHOT", changed.Code);
        Assert.Equal(0, wire.TxnBegins);Assert.Equal(0, wire.Commands);Assert.Equal(0, wire.Rollbacks);
    }

    [Fact]
    public async Task ProposalHonorsActiveRequestRecoveryVoiceBudgetAndCancellation()
    {
        await using var wire = new Wire { ProposalCatalog = true };
        await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client));
        var requestId = await bridge.BeginAsync("active", [Check()]);
        var busy = await Assert.ThrowsAsync<SessionException>(() => bridge.ProposeIntentAsync(MountingIntent()));
        Assert.Equal("LOCKED", busy.Code);
        await bridge.CancelAsync(requestId);
        Assert.Equal(1, wire.TxnBegins);Assert.Equal(1, wire.Rollbacks);Assert.Equal(0, wire.Commands);

        var connects = 0;
        await using var recovered = new CadBridge(_ => { connects++;return Task.FromResult(client); },
            initialRecovery: Json("{\"transactionId\":\"uncertain\"}"));
        await Assert.ThrowsAsync<CadRecoveryRequiredException>(() => recovered.ProposeIntentAsync(MountingIntent()));
        Assert.Equal(0, connects);

        await using var voiceBridge = new CadBridge(_ => Task.FromResult(client));
        await voiceBridge.BeginVoiceAsync(Json("{\"voiceRequestId\":\"voice-budget\",\"sessionId\":\"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\",\"documentId\":\"doc-phase1\",\"revision\":7}"), limits: new AgentLimits(maxActions: 1));
        var voiceMismatch = MountingIntent();
        voiceMismatch = voiceMismatch with { ExpectedContext = Fence(7, "doc-other") };
        var scopeFailure = await Assert.ThrowsAsync<SessionException>(() => voiceBridge.ProposeIntentAsync(voiceMismatch));
        Assert.Equal("NEED_FULL_SNAPSHOT", scopeFailure.Code);
        await voiceBridge.DescribeAsync();
        await Assert.ThrowsAsync<AgentBudgetExceededException>(() => voiceBridge.ProposeIntentAsync(MountingIntent()));
        Assert.Equal(0, wire.Commands);Assert.Equal(1, wire.TxnBegins);Assert.Equal(1, wire.Rollbacks);
        await voiceBridge.EndVoiceAsync("voice-budget");

        var canceledConnects = 0;
        await using var canceledBridge = new CadBridge(_ => { canceledConnects++;return Task.FromResult(client); });
        using var canceled = new CancellationTokenSource();canceled.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => canceledBridge.ProposeIntentAsync(MountingIntent(), canceled.Token));
        Assert.Equal(0, canceledConnects);
    }

    [Fact]
    public async Task BeginExpectedContextRejectsMalformedStaleAndSendRaceWithoutRollback()
    {
        var connects = 0;
        await using (var malformed = new CadBridge(_ => { connects++;throw new InvalidOperationException("must not connect"); })) {
            await Assert.ThrowsAsync<ArgumentException>(() => malformed.BeginAsync("plate", [Check()], expectedContext: new() {
                SessionId = "", DocumentId = "doc-phase1", Revision = 7,
            }));
            Assert.Equal(0, connects);
        }

        await using (var wire = new Wire()) {
            await using var client = await wire.Connect();
            await using var bridge = new CadBridge(_ => Task.FromResult(client));
            var stale = await Assert.ThrowsAsync<SessionException>(() => bridge.BeginAsync("plate", [Check()], expectedContext: Fence(6)));
            Assert.Equal("NEED_FULL_SNAPSHOT", stale.Code);
            Assert.Equal(0, wire.TxnBegins);Assert.Equal(0, wire.Rollbacks);Assert.Equal(0, wire.CatalogReads);

            wire.BeforeCatalogReply = async () => {
                await wire.AdvanceRevisionAsync(8);
                for (var attempt = 0; attempt < 100 && client.Model?.Revision != 8; attempt++) await Task.Delay(10);
                Assert.Equal(8, client.Model?.Revision);
            };
            var changed = await Assert.ThrowsAsync<SessionException>(() => bridge.BeginAsync("plate", [Check()], expectedContext: Fence()));
            Assert.Equal("NEED_FULL_SNAPSHOT", changed.Code);
            Assert.Equal(0, wire.TxnBegins);Assert.Equal(0, wire.Rollbacks);Assert.Equal(0, wire.Commands);
        }
    }

    [Fact]
    public async Task IdleDisconnectedClientIsReplacedBeforeDescribingANewDocument()
    {
        await using var first = new Wire();await using var second = new Wire { DocumentId = "doc-after-restart" };
        await using var oldClient = await first.Connect();await using var newClient = await second.Connect();
        var connects=0;
        await using var bridge = new CadBridge(_ => Task.FromResult(++connects == 1 ? oldClient : newClient));
        Assert.Equal("doc-phase1", (await bridge.DescribeAsync()).GetProperty("documentId").GetString());
        await Disconnect(first, oldClient);
        Assert.Equal("doc-after-restart", (await bridge.DescribeAsync()).GetProperty("documentId").GetString());
        Assert.Equal(2, connects);Assert.Equal(0, second.Commands);
    }

    [Fact]
    public async Task DisconnectionDuringOwnedRequestFencesRecoveryWithoutConnectingToAnotherDocument()
    {
        await using var first = new Wire();await using var second = new Wire { DocumentId = "doc-foreign" };
        await using var oldClient = await first.Connect();await using var newClient = await second.Connect();
        var connects=0;
        await using var bridge = new CadBridge(_ => Task.FromResult(++connects == 1 ? oldClient : newClient));
        var request = await bridge.BeginAsync("plate", new[] { Check() });
        await Disconnect(first, oldClient);
        await Assert.ThrowsAsync<CadRecoveryRequiredException>(() => bridge.QueryAsync(request,"measureVolume",Json("{}")));
        Assert.Equal("uncertain", (await bridge.DescribeAsync()).GetProperty("status").GetString());
        Assert.Equal(1, connects);Assert.Equal(0, second.Commands);Assert.Equal(0, second.Commits);
    }

    [Fact]
    public async Task DisconnectedVoiceScopeCannotFollowANewDocumentUntilItsTurnEnds()
    {
        await using var first = new Wire();await using var second = new Wire { DocumentId = "doc-new-voice" };
        await using var oldClient = await first.Connect();await using var newClient = await second.Connect();
        var connects=0;
        await using var bridge = new CadBridge(_ => Task.FromResult(++connects == 1 ? oldClient : newClient));
        var origin = await bridge.BeginVoiceAsync(Json("{\"voiceRequestId\":\"voice-reconnect\",\"sessionId\":\"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\",\"documentId\":\"doc-phase1\",\"revision\":7}"));
        await Disconnect(first, oldClient);
        await Assert.ThrowsAsync<SessionException>(() => bridge.DescribeAsync());
        Assert.Equal(1, connects);
        await bridge.EndVoiceAsync(origin);
        Assert.Equal("doc-new-voice", (await bridge.DescribeAsync()).GetProperty("documentId").GetString());
        Assert.Equal(2, connects);
    }

    [Fact]
    public async Task ChosenFunctionalAlternativeCommitsOnlyReviewedOption()
    {
        await using var wire=new Wire();await using var client=await wire.Connect();
        await using var bridge=new CadBridge(_=>Task.FromResult(client));
        var options=new[] {
            new GeneratedCadOption("round","Round",[new GeneratedCadStep("CreateBox",Json("{\"widthMm\":10}"),"Round candidate")]),
            new GeneratedCadOption("rectangular","Rectangular",[new GeneratedCadStep("CreateBox",Json("{\"widthMm\":15}"),"Rectangular candidate")])
        };
        await Assert.ThrowsAsync<ArgumentException>(()=>bridge.AcceptAlternativeAsync(options,"unreviewed",[Check()]));
        Assert.Equal(0,wire.Commands);Assert.Equal(0,wire.Commits);
        var result=await bridge.AcceptAlternativeAsync(options,"rectangular",[new CadCheck("measureVolume",Json("{\"featureId\":\"$generated\"}"),"volumeMm3",100000)]);
        Assert.Equal("committed",result.GetProperty("status").GetString());
        Assert.Equal(1,wire.Commands);Assert.Equal(1,wire.Commits);
        var payload=wire.Server.Received.Select(Json).Single(x=>x.GetProperty("method").GetString()=="command");
        Assert.Equal(15,payload.GetProperty("params").GetProperty("parameters").GetProperty("widthMm").GetInt32());
    }

    [Fact]
    public async Task ExplicitMultiHolePatternAcceptsThreeCanonicalIdsWithoutSingleFeatureAlias()
    {
        await using var wire = new Wire();await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client));
        var ids=Enumerable.Range(0,3).Select(_=>Guid.NewGuid().ToString("D")).ToArray();
        var option=new GeneratedCadOption("linear-hole-pattern","Explicit native three-hole pattern",[
            new GeneratedCadStep("CreateHolePattern",JsonSerializer.SerializeToElement(new {
                targetId=Guid.NewGuid().ToString("D"),faceRole="box.+Z",featureIds=ids,
                pointsMm=new[] {20d,40d,40d,40d,60d,40d},diameterMm=6d,
                depthMode="throughAll",depthMm=0d }),"Equal distance, equal diameter")],
            new GeneratedCadSelectionFence("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","doc-phase1",7));
        var completed=await bridge.ExecuteGeneratedAsync(option,[new CadCheck("measureVolume",Json("{}"),"volumeMm3",100000)]);
        Assert.Equal("committed",completed.GetProperty("status").GetString());
        Assert.Equal(1,wire.Commands);Assert.Equal(1,wire.Commits);Assert.Equal(0,wire.Rollbacks);
        var sent=wire.Server.Received.Select(Json).Single(x=>x.GetProperty("method").GetString()=="command").GetProperty("params");
        Assert.Equal("CreateHolePattern",sent.GetProperty("commandId").GetString());
        Assert.False(sent.TryGetProperty("featureId",out _));
        Assert.Equal(ids,sent.GetProperty("parameters").GetProperty("featureIds").EnumerateArray().Select(x=>x.GetString()));
    }

    [Fact]
    public async Task StaleSemanticPatternFenceRejectsBeforeTransactionOrCommand()
    {
        await using var wire=new Wire();await using var client=await wire.Connect();
        await using var bridge=new CadBridge(_=>Task.FromResult(client));
        var option=new GeneratedCadOption("pattern","Reject stale selection",[
            new GeneratedCadStep("CreateHolePattern",Json("{\"featureIds\":[\"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\"]}"),"sample")],
            new GeneratedCadSelectionFence("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","doc-phase1",6));
        var failure=await Assert.ThrowsAsync<SessionException>(()=>bridge.ExecuteGeneratedAsync(option,
            [new CadCheck("measureVolume",Json("{}"),"volumeMm3",100000)]));
        Assert.Equal("NEED_FULL_SNAPSHOT",failure.Code);
        Assert.Equal(0,wire.TxnBegins);Assert.Equal(0,wire.Commands);Assert.Equal(0,wire.Commits);Assert.Equal(0,wire.Rollbacks);
    }

    [Fact]
    public async Task MultiFeatureBooleanUsesAuthoritativeCreatedIdsInOneTransaction()
    {
        await using var wire = new Wire { BracketCommands = true };
        await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client));
        var option = new GeneratedCadOption("L", "Editable L bracket", [
            new GeneratedCadStep("CreateBox", Json("{\"widthMm\":100,\"heightMm\":40,\"depthMm\":5}"), "base", "base"),
            new GeneratedCadStep("CreateBox", Json("{\"widthMm\":5,\"heightMm\":40,\"depthMm\":55,\"origin\":{\"x\":0,\"y\":0,\"z\":5}}"), "wall", "wall"),
            new GeneratedCadStep("CreateBoolean", Json("{\"op\":\"fuse\",\"targetId\":\"$base\",\"toolId\":\"$wall\"}"), "join", "result"),
        ]);
        var result = await bridge.ExecuteGeneratedAsync(option, [new CadCheck("measureVolume", Json("{\"featureId\":\"$result\"}"), "volumeMm3", 100000)]);
        Assert.Equal("committed", result.GetProperty("status").GetString());
        Assert.Equal(3, wire.Commands);
        Assert.Equal(1, wire.Commits);
        var commands = wire.Server.Received.Select(Json).Where(x => x.GetProperty("method").GetString() == "command").ToArray();
        var boxIds = commands.Take(2).Select(x => x.GetProperty("params").GetProperty("featureId").GetString()).ToArray();
        Assert.All(boxIds, id => Assert.True(Guid.TryParse(id, out _)));
        Assert.NotEqual(boxIds[0], boxIds[1]);
        var boolean = commands[2].GetProperty("params").GetProperty("parameters");
        Assert.Equal(boxIds[0], boolean.GetProperty("targetId").GetString());
        Assert.Equal(boxIds[1], boolean.GetProperty("toolId").GetString());
    }

    [Fact]
    public async Task SelectedGeneratorCommitsOneValidatedNativeUndoGroup()
    {
        await using var wire = new Wire();await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client));
        var option = new GeneratedCadOption("blank", "Editable mounting blank", [
            new GeneratedCadStep("CreateBox", Json("{\"widthMm\":100,\"heightMm\":50,\"depthMm\":20}"), "Parametric native solid")]);

        var result = await bridge.ExecuteGeneratedAsync(option, [new CadCheck("measureVolume", Json("{\"bodyId\":\"$generated\"}"), "volumeMm3", 100000)]);

        Assert.Equal("committed", result.GetProperty("status").GetString());
        Assert.Equal(1, wire.Commands);
        Assert.Equal(1, wire.Commits);
        Assert.Equal(0, wire.Rollbacks);
        var sent = wire.Server.Received.Select(Json).Single(x => x.GetProperty("method").GetString() == "command");
        Assert.Equal("CreateBox", sent.GetProperty("params").GetProperty("commandId").GetString());
    }

    [Fact]
    public async Task InvalidGeneratedCommandRollsBackAndNeverCommits()
    {
        await using var wire = new Wire();await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client));
        var option = new GeneratedCadOption("unsupported", "Unsupported command", [
            new GeneratedCadStep("InventedOpaqueMesh", Json("{}"), "Unrecognized")]);

        await Assert.ThrowsAsync<ArgumentException>(() => bridge.ExecuteGeneratedAsync(option, [Check()]));

        Assert.Equal(0, wire.Commands);
        Assert.Equal(0, wire.Commits);
        Assert.Equal(1, wire.Rollbacks);
    }

    [Fact]
    public async Task GeneratedFailureWithUnconfirmedRollbackFencesSubsequentWork()
    {
        await using var wire = new Wire();wire.FailRollback = true;
        await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client));
        var option = new GeneratedCadOption("failed", "Unsupported", [
            new GeneratedCadStep("UnknownCommand", Json("{}"), "Unsupported feature")]);

        var failure = await Assert.ThrowsAsync<CadRecoveryRequiredException>(() =>
            bridge.ExecuteGeneratedAsync(option, [Check()]));
        Assert.True(failure.Recovery.ValueKind == JsonValueKind.Object);
        var fenced = await bridge.DescribeAsync();
        Assert.Equal("uncertain", fenced.GetProperty("status").GetString());
        Assert.Equal("ROLLBACK_UNCONFIRMED", fenced.GetProperty("errorCode").GetString());
        await Assert.ThrowsAsync<CadRecoveryRequiredException>(() => bridge.BeginAsync("second", [Check()]));
        Assert.Equal(0, wire.Commits);
        Assert.Equal(1, wire.Rollbacks);
    }

    [Fact]
    public async Task DescribeIncludesDatumDescriptorsAndSupportedSketchFrames()
    {
        const string datumId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
        await using var wire = new Wire();
        wire.Datums = [new { featureId = datumId, kind = "DatumPlane", status = "ok", definition = new { type = "offset", @base = new { type = "principal", planeKind = "XY" }, offsetMm = 24d }, resolved = new { originMm = new[] { 0d, 0d, 24d }, normal = new[] { 0d, 0d, 1d } } }];
        wire.Sketches = [SketchEnvelope(EmptySketchModel(), id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            supportRef: datumId, planeZ: 24, pointCount: 0, lineCount: 0, circleCount: 0, constraintCount: 0)];
        await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client));

        var description = await bridge.DescribeAsync();

        Assert.Equal(datumId, description.GetProperty("datums")[0].GetProperty("featureId").GetString());
        Assert.Equal(24d, description.GetProperty("datums")[0].GetProperty("resolved").GetProperty("originMm")[2].GetDouble());
        Assert.Equal(datumId, description.GetProperty("sketches")[0].GetProperty("supportRef").GetString());
        Assert.Equal(24d, description.GetProperty("sketches")[0].GetProperty("plane").GetProperty("origin")[2].GetDouble());
        Assert.Equal(1d, description.GetProperty("sketches")[0].GetProperty("plane").GetProperty("normal")[2].GetDouble());
    }

    [Fact]
    public async Task GetDatumQueryReturnsNativeDescriptorWithoutMutation()
    {
        await using var wire = new Wire();await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client));

        var result = await bridge.QueryAsync(null, SessionMethods.GetDatum, Json("{\"featureId\":\"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb\"}"));

        Assert.Equal("DatumPlane", result.GetProperty("kind").GetString());
        Assert.Equal(24d, result.GetProperty("resolved").GetProperty("originMm")[2].GetDouble());
        Assert.Equal(0, wire.Commands);
        var query = wire.Server.Received.Select(Json).Single(request => request.GetProperty("method").GetString() == SessionMethods.GetDatum);
        Assert.Equal("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", query.GetProperty("params").GetProperty("featureId").GetString());
    }

    [Fact]
    public async Task SketchProjectionQueryUsesTypedRevisionFenceAndClearsCachedDisplayOnFailure()
    {
        await using var wire = new Wire();await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client));

        var result = await bridge.QueryAsync(null, SessionMethods.GetSketchProjection, Json("{\"featureId\":\"target\"}"));
        Assert.Equal("target", result.GetProperty("featureId").GetString());
        Assert.True(client.SketchProjectionState.Current.Single().Result.GeometryCurrent);
        var request = wire.Server.Received.Select(Json).Single(message => message.GetProperty("method").GetString() == SessionMethods.GetSketchProjection);
        Assert.Equal("doc-phase1", request.GetProperty("params").GetProperty("documentId").GetString());
        Assert.Equal(7, request.GetProperty("params").GetProperty("expectedRevision").GetInt64());
        Assert.Equal(0, wire.Commands);

        wire.FailProjection = true;
        await Assert.ThrowsAsync<SessionException>(() => client.GetSketchProjectionAsync("target"));
        Assert.Empty(client.SketchProjectionState.Current);
        Assert.Equal(0, wire.Commands);
    }

    [Fact]
    public async Task FailedValidationRollbackPersistsRecoveryAndSurvivesBridgeRestart()
    {
        await using var wire = new Wire { FailRollback = true, Valid = false };await using var client = await wire.Connect();
        JsonElement? saved = null;
        await using var bridge = new CadBridge(_ => Task.FromResult(client), persistRecovery: state => { saved = state.Clone();return Task.CompletedTask; });
        var request = await bridge.BeginAsync("plate", new[] { Check() });
        var result = await new CadTools(bridge).Commit(request, CancellationToken.None);
        Assert.True(result.IsError);Assert.NotNull(saved);
        using var reply = JsonDocument.Parse(((ModelContextProtocol.Protocol.TextContentBlock)result.Content.Single()).Text);
        Assert.Equal("uncertain", reply.RootElement.GetProperty("status").GetString());
        Assert.True(reply.RootElement.GetProperty("recoveryPersisted").GetBoolean());Assert.Equal(0, wire.Commits);
        await using var restarted = new CadBridge(_ => throw new InvalidOperationException("Recovery fence must precede reconnect"), initialRecovery: saved);
        Assert.Equal("uncertain", (await restarted.DescribeAsync()).GetProperty("status").GetString());
        await Assert.ThrowsAsync<CadRecoveryRequiredException>(() => restarted.BeginAsync("retry", new[] { Check() }));
    }

    [Fact]
    public async Task FailedIdleRollbackRecordsRecoveryWithoutAnUnobservedExpiryFailure()
    {
        await using var wire = new Wire { FailRollback = true };await using var client = await wire.Connect();
        var saved = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        await using var bridge = new CadBridge(_ => Task.FromResult(client), persistRecovery: state => { saved.TrySetResult(state.Clone());return Task.CompletedTask; });
        var request = await bridge.BeginAsync("plate", new[] { Check() }, new AgentLimits(maxDuration: TimeSpan.FromMilliseconds(100)));
        var recovery = await saved.Task.WaitAsync(TimeSpan.FromSeconds(3));
        Assert.Equal(request, recovery.GetProperty("requestId").GetString());
        var description = await bridge.DescribeAsync();Assert.Equal("uncertain", description.GetProperty("status").GetString());
        Assert.Equal(1, wire.Rollbacks);
    }

    [Fact]
    public async Task FailedRollbackCannotReportCancellationAndBlocksNewWorkWithRecoveryIdentity()
    {
        await using var wire = new Wire { FailRollback = true };await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client));
        var request = await bridge.BeginAsync("plate", new[] { Check() });
        var result = await new CadTools(bridge).Cancel(request, CancellationToken.None);
        Assert.True(result.IsError);
        using var data = JsonDocument.Parse(((ModelContextProtocol.Protocol.TextContentBlock)result.Content.Single()).Text);
        Assert.Equal("uncertain", data.RootElement.GetProperty("status").GetString());
        var recovery = data.RootElement.GetProperty("recovery");
        Assert.Equal(request, recovery.GetProperty("requestId").GetString());
        var begin = wire.Server.Received.Select(Json).Single(r => r.GetProperty("method").GetString() == "txnBegin");
        Assert.Equal(begin.GetProperty("params").GetProperty("transactionId").GetString(), recovery.GetProperty("transactionId").GetString());
        var retry = await new CadTools(bridge).Begin("another", new[] { Check() });
        Assert.True(retry.IsError);
    }

    [Fact]
    public async Task SinglePatternAliasResolvesItsDeclaredIdWithoutAnAllocatedEnvelopeId()
    {
        await using var wire = new Wire();await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client));
        var request = await bridge.BeginAsync("one hole", new[] { Check() });
        var id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
        var result = await bridge.CommandAsync(request, "CreateHolePattern", Json("{\"featureIds\":[\"" + id + "\"]}"), "singleHole");
        Assert.Equal(id, result.GetProperty("featureId").GetString());
        await bridge.QueryAsync(request, "measureVolume", Json("{\"featureId\":\"$singleHole\"}"));
        var measured = wire.Server.Received.Select(Json).Single(r => r.GetProperty("method").GetString() == "measureVolume");
        Assert.Equal(id, measured.GetProperty("params").GetProperty("featureId").GetString());
        var command = wire.Server.Received.Select(Json).Single(r => r.GetProperty("method").GetString() == "command");
        Assert.False(command.GetProperty("params").TryGetProperty("featureId", out _));
        await bridge.CancelAsync(request);
    }

    [Fact]
    public async Task EditOmitsUnallocatedFeatureIdAndPreservesExistingTargetInParameters()
    {
        await using var wire = new Wire();await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client));
        var request = await bridge.BeginAsync("resize", new[] { Check() });
        var target = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
        await bridge.CommandAsync(request, "SetDimension", Json("{\"featureId\":\"" + target + "\",\"paramName\":\"widthMm\",\"valueMm\":120}"));
        var command = wire.Server.Received.Select(Json).Single(r => r.GetProperty("method").GetString() == "command").GetProperty("params");
        Assert.False(command.TryGetProperty("featureId", out _));
        Assert.Equal(target, command.GetProperty("parameters").GetProperty("featureId").GetString());
        Assert.Equal(1, wire.Commands);await bridge.CancelAsync(request);
    }

    [Fact]
    public async Task ExpiryDuringCatalogLoadCannotLeaveAnAssignedRequestWithoutCleanup()
    {
        await using var wire = new Wire { CatalogDelay = TimeSpan.FromMilliseconds(250) };
        await using var client = await wire.Connect();await using var bridge = new CadBridge(_ => Task.FromResult(client));
        var origin = await bridge.BeginVoiceAsync(Json("{\"voiceRequestId\":\"voice-expiry\",\"sessionId\":\"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\",\"documentId\":\"doc-phase1\",\"revision\":7}"), limits: new AgentLimits(maxDuration: TimeSpan.FromMilliseconds(100)));
        await Assert.ThrowsAsync<AgentBudgetExceededException>(() => bridge.BeginAsync("plate", new[] { Check() }, originRequestId: origin));
        // The second attempt must report the expired budget, not LOCKED by a leaked request.
        await Assert.ThrowsAsync<AgentBudgetExceededException>(() => bridge.BeginAsync("plate", new[] { Check() }, originRequestId: origin));
        Assert.Equal(0, wire.Commands);Assert.Equal(0, wire.Rollbacks);
        Assert.False(await bridge.EndVoiceAsync(origin));
        wire.CatalogDelay = TimeSpan.Zero;
        var next = await bridge.BeginAsync("fresh request", new[] { Check() });await bridge.CancelAsync(next);
    }

    [Fact]
    public async Task CanonicalRequestChecksRealQueryThenCommitsOneGroup()
    {
        await using var wire = new Wire();await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client));
        var request = await bridge.BeginAsync("plate", new[] { Check() });
        await bridge.CommandAsync(request, "CreateBox", Json("{\"widthMm\":100,\"heightMm\":50,\"depthMm\":20}"), "plate");
        var outcome = await bridge.CommitAsync(request);
        Assert.Equal("committed", outcome.GetProperty("status").GetString());
        Assert.Equal(1, wire.Commands);Assert.Equal(1, wire.Commits);Assert.Equal(0, wire.Rollbacks);
        var command = wire.Server.Received.Select(Json).Single(r => r.GetProperty("method").GetString() == "command");
        Assert.Equal("CreateBox", command.GetProperty("params").GetProperty("commandId").GetString());
        Assert.Equal(7, command.GetProperty("params").GetProperty("baseRevision").GetInt64());
        Assert.True(command.GetProperty("params").TryGetProperty("transactionId", out _));
        Assert.True(command.TryGetProperty("operationId", out _));
    }

    [Fact]
    public async Task WrongGoalMeasurementRollsBackAndCannotReportSuccess()
    {
        await using var wire = new Wire();await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client));
        var request = await bridge.BeginAsync("plate", new[] { Check(200000) });
        await bridge.CommandAsync(request, "CreateBox", Json("{}"), "plate");
        var outcome = await bridge.CommitAsync(request);
        Assert.Equal("validation_failed", outcome.GetProperty("status").GetString());
        Assert.Equal(0, wire.Commits);Assert.Equal(1, wire.Rollbacks);
    }

    [Fact]
    public async Task ForeignRequestAndRawInvokeCannotMutateOrReadStagedGeometry()
    {
        await using var wire = new Wire();await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client));
        var request = await bridge.BeginAsync("plate", new[] { Check() });
        await Assert.ThrowsAsync<SessionException>(() => bridge.BeginAsync("other", new[] { Check() }));
        await Assert.ThrowsAsync<SessionException>(() => bridge.CommandAsync("foreign", "CreateBox", Json("{}"), "plate"));
        await Assert.ThrowsAsync<ArgumentException>(() => bridge.QueryAsync(request, "invoke", Json("{\"type\":3}")));
        await Assert.ThrowsAsync<SessionException>(() => bridge.QueryAsync(null, "getFeatures", Json("{}")));
        Assert.Equal(0, wire.Commands);
        await bridge.CancelAsync(request);Assert.Equal(1, wire.Rollbacks);
    }

    [Fact]
    public async Task LimitsAndMissingPredicatesFailBeforeMutation()
    {
        await using var wire = new Wire();await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client));
        await Assert.ThrowsAsync<ArgumentException>(() => bridge.BeginAsync("plate", Array.Empty<CadCheck>()));
        var request = await bridge.BeginAsync("plate", new[] { Check() }, new AgentLimits(maxFeatures: 1));
        await bridge.CommandAsync(request, "CreateBox", Json("{}"), "plate");
        await Assert.ThrowsAsync<AgentBudgetExceededException>(() => bridge.CommandAsync(request, "CreateBox", Json("{}"), "other"));
        Assert.Equal(1, wire.Commands);await bridge.CancelAsync(request);
    }

    [Fact]
    public async Task LostCommitAckReconcilesAndReplaysOnlyTheSameOperation()
    {
        await using var wire = new Wire { DropCommitAck = true };await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client), TimeSpan.FromMilliseconds(100));
        var request = await bridge.BeginAsync("plate", new[] { Check() });
        await bridge.CommandAsync(request, "CreateBox", Json("{}"), "plate");
        var outcome = await bridge.CommitAsync(request);
        Assert.Equal("committed", outcome.GetProperty("status").GetString());
        Assert.Equal(1, wire.Commits);Assert.Equal(2, wire.CommitOperations.Count);
        Assert.Equal(wire.CommitOperations[0], wire.CommitOperations[1]);
    }

    [Fact]
    public async Task IdleRequestExpiresAndReleasesItsOwnedTransaction()
    {
        await using var wire = new Wire();await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client));
        await bridge.BeginAsync("plate", new[] { Check() }, new AgentLimits(maxDuration: TimeSpan.FromMilliseconds(100)));
        await Task.Delay(250);
        Assert.Equal(1, wire.Rollbacks);
        var next = await bridge.BeginAsync("next", new[] { Check() });
        await bridge.CancelAsync(next);
    }

    [Fact]
    public async Task MissingMeasurementReturnsAnExplicitFailedValidation()
    {
        await using var wire = new Wire();await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client));
        var request = await bridge.BeginAsync("plate", new[] { Check() with { Path = "missing" } });
        await bridge.CommandAsync(request, "CreateBox", Json("{}"), "plate");
        var result = await bridge.CommitAsync(request);
        Assert.Equal("validation_failed", result.GetProperty("status").GetString());
        Assert.Equal(JsonValueKind.Null, result.GetProperty("measurements")[0].GetProperty("actual").ValueKind);
        Assert.Equal(1, wire.Rollbacks);Assert.Equal(0, wire.Commits);
    }

    [Fact]
    public async Task VoiceCancellationRollsBackOnlyItsOwnedRequestAndRejectsLateOrigin()
    {
        await using var wire = new Wire();await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client));
        var context = Json("{\"voiceRequestId\":\"voice-1\",\"sessionId\":\"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\",\"documentId\":\"doc-phase1\",\"revision\":7}");
        var origin = await bridge.BeginVoiceAsync(context);
        await Assert.ThrowsAsync<SessionException>(() => bridge.BeginAsync("other", new[] { Check() }, originRequestId: "foreign"));
        var request = await bridge.BeginAsync("voice plate", new[] { Check() }, originRequestId: origin);
        await bridge.CommandAsync(request, "CreateBox", Json("{}"), "plate");
        Assert.True(await bridge.EndVoiceAsync(origin));Assert.Equal(1, wire.Rollbacks);
        await Assert.ThrowsAsync<SessionException>(() => bridge.BeginAsync("late", new[] { Check() }, originRequestId: origin));
    }

    [Fact]
    public async Task AgentBeginWithoutOriginJoinsTheActiveVoiceTurn()
    {
        await using var wire = new Wire();await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client));
        var context = Json("{\"voiceRequestId\":\"voice-implicit\",\"sessionId\":\"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\",\"documentId\":\"doc-phase1\",\"revision\":7}");
        var origin = await bridge.BeginVoiceAsync(context);
        var request = await bridge.BeginAsync("implicit plate", new[] { Check() });
        await bridge.CommandAsync(request, "CreateBox", Json("{}"), "plate");
        var committed = await bridge.CommitAsync(request);
        Assert.Equal("committed", committed.GetProperty("status").GetString());
        Assert.False(await bridge.EndVoiceAsync(origin));
        Assert.Equal(1, wire.Commits);
    }

    [Fact]
    public async Task StaleQuestVoiceContextFailsBeforeStartingAgentOrTransaction()
    {
        await using var wire = new Wire();await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client));
        await Assert.ThrowsAsync<SessionException>(() => bridge.BeginVoiceAsync(Json("{\"voiceRequestId\":\"v\",\"sessionId\":\"other\",\"documentId\":\"doc-phase1\",\"revision\":7}")));
        Assert.Equal(0, wire.Commands);Assert.Equal(0, wire.Commits);
    }

    [Fact]
    public async Task MalformedVersionTwoContextFailsBeforeConnectingOrRegisteringVoice()
    {
        var connects = 0;
        await using var bridge = new CadBridge(_ => { connects++;throw new InvalidOperationException("must not connect"); });
        var context = Json("{\"voiceRequestId\":\"v2\",\"sessionId\":\"session\",\"documentId\":\"doc\",\"revision\":1,\"selectionIds\":[],\"selectionContext\":{\"version\":2,\"selections\":[]}}");
        await Assert.ThrowsAsync<ArgumentException>(() => bridge.BeginVoiceAsync(context));
        Assert.Equal(0, connects);
    }

    [Fact]
    public async Task VoiceCorrectionCannotResetCommandIterationBudget()
    {
        await using var wire = new Wire();await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client));
        var origin = await bridge.BeginVoiceAsync(Json("{\"voiceRequestId\":\"voice-1\",\"sessionId\":\"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\",\"documentId\":\"doc-phase1\",\"revision\":7}"), limits: new AgentLimits(maxIterations: 1));
        var first = await bridge.BeginAsync("plate", new[] { Check() }, originRequestId: origin);
        await bridge.CommandAsync(first, "CreateBox", Json("{}"), "plate");await bridge.CancelAsync(first);
        var correction = await bridge.BeginAsync("correct", new[] { Check() }, originRequestId: origin);
        var error = await Assert.ThrowsAsync<AgentBudgetExceededException>(() => bridge.CommandAsync(correction, "CreateBox", Json("{}"), "plate"));
        Assert.Equal("iterations", error.Limit);Assert.Equal(1, wire.Commands);
        await bridge.EndVoiceAsync(origin);
    }

    [Fact]
    public async Task VoiceCorrectionCannotResetFeatureBudgetOrWeakenOriginalGoal()
    {
        await using var wire = new Wire();await using var client = await wire.Connect();
        await using var bridge = new CadBridge(_ => Task.FromResult(client));
        var origin = await bridge.BeginVoiceAsync(Json("{\"voiceRequestId\":\"voice-1\",\"sessionId\":\"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\",\"documentId\":\"doc-phase1\",\"revision\":7}"), limits: new AgentLimits(maxFeatures: 1));
        var first = await bridge.BeginAsync("plate", new[] { Check() }, originRequestId: origin);
        await bridge.CommandAsync(first, "CreateBox", Json("{}"), "plate");await bridge.CancelAsync(first);
        await Assert.ThrowsAsync<ArgumentException>(() => bridge.BeginAsync("weaker", new[] { Check(50000) }, originRequestId: origin));
        var correction = await bridge.BeginAsync("correct", new[] { Check() }, originRequestId: origin);
        await Assert.ThrowsAsync<AgentBudgetExceededException>(() => bridge.CommandAsync(correction, "CreateBox", Json("{}"), "plate"));
        Assert.Equal(1, wire.Commands);await bridge.EndVoiceAsync(origin);
    }
}
