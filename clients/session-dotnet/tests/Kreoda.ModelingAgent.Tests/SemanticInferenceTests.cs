using System.Text.Json;
using Xunit;

namespace Kreoda.ModelingAgent.Tests;

public sealed class SemanticInferenceTests
{
    static readonly string Target = Guid.NewGuid().ToString();
    static AgentCommandCatalog Catalog(bool pattern)
    {
        var command = pattern ? """{"id":"CreateHolePattern","nativeType":25,"creation":{"idArrayParameter":"featureIds"},"parameters":{"type":"object","properties":{"targetId":{"type":"string"},"faceRole":{"type":"string"},"featureIds":{"type":"array","items":{"type":"string"}},"pointsMm":{"type":"array"},"diameterMm":{"type":"number"},"depthMode":{"type":"string"},"depthMm":{"type":"number"}}}}""" :
            """{"id":"CreateBox","nativeType":3,"creation":{"fixedCount":1},"parameters":{"type":"object"}}""";
        using var doc = JsonDocument.Parse("{\"commands\":[" + command + "]}");
        return AgentCommandCatalog.FromReply(doc.RootElement);
    }
    static AgentCommandCatalog ConversionCatalog(bool delete = true, string featureIdsItem = "string", string pointsItem = "number",
        bool completeRequiredFields = true)
    {
        var pattern = new {
            id = "CreateHolePattern", nativeType = 25, creation = new { idArrayParameter = "featureIds" },
            parameters = new {
                type = "object",
                properties = new {
                    targetId = new { type = "string" }, faceRole = new { type = "string" },
                    featureIds = new { type = "array", items = new { type = featureIdsItem } },
                    pointsMm = new { type = "array", items = new { type = pointsItem } },
                    diameterMm = new { type = "number" }, depthMode = new { type = "string", @enum = new[] { "throughAll", "blind" } },
                    depthMm = new { type = "number" },
                },
                required = completeRequiredFields
                    ? new[] { "targetId", "faceRole", "featureIds", "pointsMm", "diameterMm", "depthMode" }
                    : new[] { "targetId" },
            },
        };
        var commands = delete ? new object[] { pattern, new {
            id = "DeleteFeature", nativeType = 7, creation = new { fixedCount = 0 },
            parameters = new { type = "object", properties = new { featureId = new { type = "string" } }, required = new[] { "featureId" } },
        } } : new object[] { pattern };
        return AgentCommandCatalog.FromReply(JsonSerializer.SerializeToElement(new { commands }));
    }
    static SemanticSelection Input(params (double x, double y, double diameter)[] holes) =>
        new("session", "doc", 7, Target, "top", holes.Select(h => new SemanticHole(Guid.NewGuid().ToString(), h.x, h.y, h.diameter)).ToArray());

    static JsonElement NativeChain(int count = 3, double secondDiameter = 6, double secondDepth = 0,
        string secondMode = "throughAll", string secondFace = "box.+Z", bool branch = false, bool dependent = false,
        bool expressions = false, bool current = true, bool terminal = true, bool aggregate = false,
        bool sketchReference = false, bool datumReference = false, bool extraBodyTip = false)
    {
        var features = new List<object> { new {
            featureId = "plate", type = "Box", paramsMm = new[] { 100d, 80d, 20d }, dependsOn = Array.Empty<string>(),
            expressions = new { }, refExtra = "", bodyId = "body-plate", bodyTip = false,
            geometryCurrent = true, status = "ok",
        } };
        var parent = "plate";
        for (var i = 0; i < count; i++) {
            var id = "hole" + (i + 1).ToString(System.Globalization.CultureInfo.InvariantCulture);
            var diameter = i == 1 ? secondDiameter : 6d;
            var depth = i == 1 ? secondDepth : 0d;
            var mode = i == 1 ? secondMode : "throughAll";
            var face = i == 1 ? secondFace : "box.+Z";
            var sourceExpressions = expressions && i == 1
                ? new Dictionary<string, object?> { ["diameterMm"] = "pilot" }
                : new Dictionary<string, object?>();
            features.Add(new {
                featureId = id, type = "Hole", paramsMm = new[] { diameter, depth }, dependsOn = new[] { parent },
                expressions = sourceExpressions,
                refExtra = FormattableString.Invariant($"face={face};x={20 + 20 * i};y=40;mode={mode}"),
                bodyId = "body-plate", bodyTip = terminal && i == count - 1,
                geometryCurrent = current, status = current ? "ok" : "stale",
            });
            parent = id;
        }
        if (branch) features.Add(new { featureId = "branch", type = "Fillet", dependsOn = new[] { "plate" }, bodyId = "body-other", bodyTip = false });
        if (dependent) features.Add(new { featureId = "dependent", type = "Extrude", dependsOn = new[] { "hole2" }, bodyId = "body-other", bodyTip = true });
        if (extraBodyTip) features.Add(new { featureId = "other-tip", type = "Fillet", bodyId = "body-plate", bodyTip = true });
        if (aggregate) features.Add(new { featureId = "pattern", type = "HolePattern", paramsMm = new[] { 6d, 0d },
            dependsOn = new[] { "plate" }, refExtra = "pattern", bodyId = "body-plate", bodyTip = false, geometryCurrent = true, status = "ok" });
        var sketches = sketchReference ? new object[] { new { featureId = "sketch-ref", supportRef = "hole2" } } : Array.Empty<object>();
        var datums = datumReference ? new object[] { new { featureId = "datum-ref", supportRef = "hole2" } } : Array.Empty<object>();
        return JsonSerializer.SerializeToElement(new { features, sketches, datums });
    }

    [Fact]
    public void UniformHolesInferCanonicalEditablePatternAndSymmetry()
    {
        var suggestions = SemanticInference.Analyze(Input((0, 0, 6), (20, 0, 6), (40, 0, 6)) with { ExistingGeometry = false }, Catalog(true));
        var pattern = Assert.Single(suggestions, s => s.Id == "linear-hole-pattern");
        Assert.True(pattern.CanExecute);
        var step = Assert.Single(pattern.ProposedCommand!.Steps);
        Assert.Equal("CreateHolePattern", step.CommandId);
        Assert.Equal(3, step.Parameters.GetProperty("featureIds").GetArrayLength());
        Assert.Equal(6, step.Parameters.GetProperty("pointsMm").GetArrayLength());
        Assert.Contains("equally spaced", pattern.Explanation);
        Assert.False(Assert.Single(suggestions, s => s.Id == "mirror-about-x").CanExecute);
    }

    [Fact]
    public void MissingCanonicalPatternCommandLeavesSuggestionNonExecutable()
    {
        var suggestion = Assert.Single(SemanticInference.Analyze(Input((0, 0, 6), (20, 0, 6), (40, 0, 6)), Catalog(false)), x => x.Id == "linear-hole-pattern");
        Assert.False(suggestion.CanExecute);
        Assert.Null(suggestion.ProposedCommand);
    }

    [Fact]
    public void ExistingFeatureHistoryNeverCreatesDuplicateHoles()
    {
        var suggestion = Assert.Single(SemanticInference.Analyze(Input((0, 0, 6), (20, 0, 6), (40, 0, 6)), Catalog(true)),
            x => x.Id == "linear-hole-pattern");
        Assert.False(suggestion.CanExecute);
        Assert.Null(suggestion.ProposedCommand);
    }

    [Fact]
    public void IrregularOrMismatchedHolesNeverProposePattern()
    {
        Assert.DoesNotContain(SemanticInference.Analyze(Input((0, 0, 6), (21, 0, 6), (40, 0, 6)), Catalog(true)), x => x.Id == "linear-hole-pattern");
        Assert.DoesNotContain(SemanticInference.Analyze(Input((0, 0, 6), (20, 0, 7), (40, 0, 6)), Catalog(true)), x => x.Id == "linear-hole-pattern");
    }

    [Fact]
    public void InvalidGeometryAndDuplicateReferencesFailClosed()
    {
        var input = Input((0, 0, 6), (20, 0, 6));
        Assert.Throws<ArgumentException>(() => SemanticInference.Analyze(input with { TargetId = "bad:target" }, Catalog(true)));
        Assert.Throws<ArgumentException>(() => SemanticInference.Analyze(input with { Holes = [input.Holes[0], input.Holes[0]] }, Catalog(true)));
        Assert.Throws<ArgumentException>(() => SemanticInference.Analyze(input, Catalog(true), double.NaN));
    }

    [Fact]
    public void ArbitraryStableFeatureIdsWithoutUuidSuffixAreAccepted()
    {
        var selection = new SemanticSelection("session", "doc", 7, "body_main_1", "top", [
            new SemanticHole("hole_front", 0, 0, 6),
            new SemanticHole("hole_middle", 20, 0, 6),
            new SemanticHole("hole_back", 40, 0, 6),
        ]);

        var suggestion = Assert.Single(SemanticInference.Analyze(selection, Catalog(true)), s => s.Id == "linear-hole-pattern");
        Assert.False(suggestion.CanExecute);
        Assert.Null(suggestion.ProposedCommand);
    }

    [Fact]
    public void InvalidStableFeatureIdsAreRejectedForTargetsAndHoles()
    {
        var invalidIds = new string?[] { null, "", new string('x', 129), "caf\u00e9", "bad:id", "bad/id", "bad id" };
        var input = Input((0, 0, 6), (20, 0, 6));

        foreach (var id in invalidIds)
        {
            Assert.Throws<ArgumentException>(() => SemanticInference.Analyze(input with { TargetId = id! }, Catalog(true)));
            var holes = input.Holes.ToArray();
            holes[0] = holes[0] with { FeatureId = id! };
            Assert.Throws<ArgumentException>(() => SemanticInference.Analyze(input with { Holes = holes }, Catalog(true)));
        }
    }

    [Fact]
    public void ActualPersistedNativeHoleRecordsInferSpacingWithoutDuplicatingCuts()
    {
        var target="box-c708d669-008e-49f6-a7f5-ed65e2fb34c9";
        var a="hole-first";var b="hole-middle";var c="hole-last";
        var snapshot=JsonSerializer.SerializeToElement(new {features=new object[] {
            new {featureId=target,type="Box",paramsMm=new[] {100d,80d,5d},dependsOn=Array.Empty<string>(),refExtra=""},
            new {featureId=a,type="Hole",paramsMm=new[] {6d,0d},dependsOn=new[] {target},refExtra="face=box.+Z;x=20;y=40;mode=throughAll"},
            new {featureId=b,type="Hole",paramsMm=new[] {6d,0d},dependsOn=new[] {a},refExtra="face=box.+Z;x=40;y=40;mode=throughAll"},
            new {featureId=c,type="Hole",paramsMm=new[] {6d,0d},dependsOn=new[] {b},refExtra="face=box.+Z;x=60;y=40;mode=throughAll"},
        }});
        var selection=SemanticInference.FromNativeHistory("session","doc",12,target,"box.+Z",snapshot);
        Assert.True(selection.ExistingGeometry);
        Assert.Equal(new[] {20d,40d,60d},selection.Holes.Select(h=>h.Xmm));
        Assert.Equal(new[] {a,b,c},selection.Holes.Select(h=>h.FeatureId));
        Assert.All(selection.Holes,h=>Assert.Equal(6,h.DiameterMm));
        var suggestion=Assert.Single(SemanticInference.Analyze(selection,Catalog(true)),s=>s.Id=="linear-hole-pattern");
        Assert.False(suggestion.CanExecute);
        Assert.Null(suggestion.ProposedCommand);
    }

    [Fact]
    public void ProvenNativeHoleChainProducesExactFencedReverseDeleteConversion()
    {
        var suggestions = SemanticInference.AnalyzeNativeHistory("session", "doc", 7, "plate", "box.+Z",
            NativeChain(), ConversionCatalog());
        var suggestion = Assert.Single(suggestions, item => item.Id == "linear-hole-pattern");
        Assert.True(suggestion.CanExecute);
        Assert.Contains("explicit choice", suggestion.Explanation);
        Assert.Contains("roll back", suggestion.Explanation);
        var option = suggestion.ProposedCommand!;
        Assert.Equal("convert-linear-hole-pattern", option.Id);
        Assert.Equal(new GeneratedCadSelectionFence("session", "doc", 7), option.SelectionFence);
        Assert.Equal(new[] { "DeleteFeature", "DeleteFeature", "DeleteFeature", "CreateHolePattern" },
            option.Steps.Select(step => step.CommandId));
        Assert.Equal(new[] { "hole3", "hole2", "hole1" }, option.Steps.Take(3).Select(step =>
            step.Parameters.GetProperty("featureId").GetString()));
        var pattern = option.Steps[^1].Parameters;
        Assert.Equal("plate", pattern.GetProperty("targetId").GetString());
        Assert.Equal(new[] { 20d, 40d, 40d, 40d, 60d, 40d }, pattern.GetProperty("pointsMm").EnumerateArray().Select(value => value.GetDouble()));
        Assert.Equal(6d, pattern.GetProperty("diameterMm").GetDouble());
        Assert.Equal("throughAll", pattern.GetProperty("depthMode").GetString());
        Assert.Equal(0d, pattern.GetProperty("depthMm").GetDouble());
        var ids = pattern.GetProperty("featureIds").EnumerateArray().Select(value => value.GetString()!).ToArray();
        Assert.Equal(3, ids.Distinct(StringComparer.Ordinal).Count());
        Assert.DoesNotContain(ids, id => new[] { "hole1", "hole2", "hole3" }.Contains(id, StringComparer.Ordinal));
        Assert.All(option.Steps, step => Assert.Null(step.Alias));
    }

    [Fact]
    public void UniformBlindNativeChainPreservesExactDepth()
    {
        var history = JsonSerializer.SerializeToElement(new {
            features = new object[] {
                new { featureId = "plate", type = "Box", paramsMm = new[] { 100d, 80d, 20d }, dependsOn = Array.Empty<string>(),
                    expressions = new { }, refExtra = "", bodyId = "body-plate", bodyTip = false, geometryCurrent = true, status = "ok" },
                new { featureId = "hole1", type = "Hole", paramsMm = new[] { 6d, 5d }, dependsOn = new[] { "plate" }, expressions = new { },
                    refExtra = "face=box.+Z;x=20;y=40;mode=blind", bodyId = "body-plate", bodyTip = false, geometryCurrent = true, status = "ok" },
                new { featureId = "hole2", type = "Hole", paramsMm = new[] { 6d, 5d }, dependsOn = new[] { "hole1" }, expressions = new { },
                    refExtra = "face=box.+Z;x=40;y=40;mode=blind", bodyId = "body-plate", bodyTip = false, geometryCurrent = true, status = "ok" },
                new { featureId = "hole3", type = "Hole", paramsMm = new[] { 6d, 5d }, dependsOn = new[] { "hole2" }, expressions = new { },
                    refExtra = "face=box.+Z;x=60;y=40;mode=blind", bodyId = "body-plate", bodyTip = true, geometryCurrent = true, status = "ok" },
            }, sketches = Array.Empty<object>(), datums = Array.Empty<object>(),
        });
        var suggestion = Assert.Single(SemanticInference.AnalyzeNativeHistory("session", "doc", 7, "plate", "box.+Z", history,
            ConversionCatalog()), item => item.Id == "linear-hole-pattern");
        Assert.True(suggestion.CanExecute);
        var pattern = suggestion.ProposedCommand!.Steps[^1].Parameters;
        Assert.Equal("blind", pattern.GetProperty("depthMode").GetString());
        Assert.Equal(5d, pattern.GetProperty("depthMm").GetDouble());
    }

    [Fact]
    public void NearEqualOrUnprovenNativeHistoriesRemainNonExecutable()
    {
        var rejected = new[] {
            NativeChain(secondDiameter: 6.005), NativeChain(secondDepth: 5),
            NativeChain(secondDepth: 5, secondMode: "blind"), NativeChain(secondFace: "box.+X"),
            NativeChain(branch: true), NativeChain(dependent: true), NativeChain(expressions: true),
            NativeChain(current: false), NativeChain(terminal: false), NativeChain(count: 5),
            NativeChain(aggregate: true), NativeChain(sketchReference: true), NativeChain(datumReference: true),
            NativeChain(extraBodyTip: true),
        };
        foreach (var history in rejected) {
            var suggestions = SemanticInference.AnalyzeNativeHistory("session", "doc", 7, "plate", "box.+Z", history,
                ConversionCatalog());
            Assert.DoesNotContain(suggestions, item => item.ProposedCommand is not null);
            Assert.All(suggestions.Where(item => item.Id == "linear-hole-pattern"), item => Assert.False(item.CanExecute));
        }
    }

    [Fact]
    public void ConversionRequiresNativeCommandsAndTheirExactArrayItemSchemas()
    {
        var history = NativeChain();
        foreach (var catalog in new[] {
            ConversionCatalog(delete: false), ConversionCatalog(pointsItem: "string"), ConversionCatalog(completeRequiredFields: false),
        }) {
            var suggestions = SemanticInference.AnalyzeNativeHistory("session", "doc", 7, "plate", "box.+Z", history, catalog);
            Assert.DoesNotContain(suggestions, item => item.ProposedCommand is not null);
        }
        Assert.Throws<ArgumentException>(() => ConversionCatalog(featureIdsItem: "number"));
    }

    [Fact]
    public void MalformedNativeHoleProvenanceAndPatternAggregateFailClosed()
    {
        var target=Guid.NewGuid().ToString("D");var id=Guid.NewGuid().ToString("D");
        var malformed=JsonSerializer.SerializeToElement(new {features=new[] {
            new {featureId=id,type="Hole",paramsMm=new[] {6d,0d},dependsOn=new[] {target},refExtra="x=20;y=40"}
        }});
        Assert.Throws<ArgumentException>(()=>SemanticInference.FromNativeHistory("s","d",1,target,"box.+Z",malformed));
        var aggregate=JsonSerializer.SerializeToElement(new {features=new[] {
            new {featureId=id,type="HolePattern",paramsMm=new[] {6d,0d,3d},dependsOn=new[] {target},
                refExtra="pattern:face=box.+Z;mode=throughAll;pts=20,40,40,40,60,40"}
        }});
        Assert.Empty(SemanticInference.FromNativeHistory("s","d",1,target,"box.+Z",aggregate).Holes);
    }
}
