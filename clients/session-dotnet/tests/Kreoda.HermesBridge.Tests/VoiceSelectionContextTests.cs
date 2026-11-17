using System.Text.Json;
using System.Linq;
using Xunit;

namespace Kreoda.HermesBridge.Tests;

public sealed class VoiceSelectionContextTests
{
    static void Check(string json) { using var doc = JsonDocument.Parse(json);VoiceSelectionContext.Validate(doc.RootElement); }

    [Fact]
    public void AcceptsCanonicalFaceAndLegacyVoiceContexts()
    {
        Check("{}");
        Check("{\"selectionIds\":[\"face-id\"],\"selectionContext\":{\"kind\":\"face\",\"persistentId\":\"face-id\",\"bodyId\":\"body\",\"featureId\":\"feature\"}}");
    }

    [Fact]
    public void AcceptsVersionTwoMultipleSelectionsAndPointOnlyContext()
    {
        Check("{\"voiceRequestId\":\"voice-1\",\"sessionId\":\"session\",\"documentId\":\"doc\",\"revision\":3,\"selectionIds\":[\"face-1\",\"edge-1\"],\"selectionContext\":{\"version\":2,\"selections\":[{\"kind\":\"face\",\"persistentId\":\"face-1\",\"bodyId\":\"body\",\"featureId\":\"feature\"},{\"kind\":\"edge\",\"persistentId\":\"edge-1\",\"bodyId\":\"body\",\"featureId\":\"feature\"}],\"referencePoint\":{\"positionMm\":[1.25,-2,3],\"coordinateSystem\":\"cad\",\"source\":\"quest-mr\"}}}");
        Check("{\"voiceRequestId\":\"voice-2\",\"sessionId\":\"session\",\"documentId\":\"doc\",\"revision\":3,\"selectionIds\":[],\"selectionContext\":{\"version\":2,\"selections\":[],\"referencePoint\":{\"positionMm\":[0,0,0],\"coordinateSystem\":\"cad\",\"source\":\"quest-mr\"}}}");
    }

    [Fact]
    public void AcceptsStandaloneVersionTwoSketchWithCanonicalFeatureId()
    {
        Check("{\"voiceRequestId\":\"sketch-v1\",\"sessionId\":\"session\",\"documentId\":\"doc\",\"revision\":0,\"selectionIds\":[\"sketch-1\"],\"selectionContext\":{\"version\":2,\"selections\":[{\"kind\":\"sketch\",\"persistentId\":\"sketch-1\",\"featureId\":\"sketch-1\"}]}}");
    }

    [Fact]
    public void AcceptsLegacySketchOnlyWithCanonicalFeatureId()
    {
        Check("{\"selectionIds\":[\"sketch-1\"],\"selectionContext\":{\"kind\":\"sketch\",\"persistentId\":\"sketch-1\",\"featureId\":\"sketch-1\"}}");
    }

    [Fact]
    public void AcceptsMixedFaceAndSketchWhenCanonicalSelectionOrderMatches()
    {
        Check("{\"voiceRequestId\":\"mixed-v1\",\"sessionId\":\"session\",\"documentId\":\"doc\",\"revision\":2,\"selectionIds\":[\"face-1\",\"sketch-1\"],\"selectionContext\":{\"version\":2,\"selections\":[{\"kind\":\"face\",\"persistentId\":\"face-1\",\"bodyId\":\"body-1\",\"featureId\":\"face-feature\"},{\"kind\":\"sketch\",\"persistentId\":\"sketch-1\",\"featureId\":\"sketch-1\"}]}}");
    }

    [Theory]
    [InlineData("{\"voiceRequestId\":\"v\",\"sessionId\":\"s\",\"documentId\":\"d\",\"revision\":1,\"selectionIds\":[\"sketch-1\"],\"selectionContext\":{\"version\":2,\"selections\":[{\"kind\":\"sketch\",\"persistentId\":\"sketch-1\"}]}}")]
    [InlineData("{\"voiceRequestId\":\"v\",\"sessionId\":\"s\",\"documentId\":\"d\",\"revision\":1,\"selectionIds\":[\"sketch-1\"],\"selectionContext\":{\"version\":2,\"selections\":[{\"kind\":\"sketch\",\"persistentId\":\"sketch-1\",\"featureId\":\"another-feature\"}]}}")]
    [InlineData("{\"selectionIds\":[\"sketch-1\"],\"selectionContext\":{\"kind\":\"sketch\",\"persistentId\":\"sketch-1\"}}")]
    [InlineData("{\"selectionIds\":[\"sketch-1\"],\"selectionContext\":{\"kind\":\"sketch\",\"persistentId\":\"sketch-1\",\"featureId\":\"another-feature\"}}")]
    public void RejectsOwnerlessOrNoncanonicalSketchFeatureIdAcrossContextVersions(string json)
    {
        Assert.Throws<ArgumentException>(() => Check(json));
    }

    [Theory]
    [InlineData("[\"face-1\",\"other-sketch\"]")]
    [InlineData("[\"sketch-1\",\"face-1\"]")]
    public void RejectsMixedSketchSelectionsWhenCanonicalIdsDoNotMatchOrder(string selectionIds)
    {
        var json = "{\"voiceRequestId\":\"v\",\"sessionId\":\"s\",\"documentId\":\"d\",\"revision\":1,\"selectionIds\":" + selectionIds +
            ",\"selectionContext\":{\"version\":2,\"selections\":[{\"kind\":\"face\",\"persistentId\":\"face-1\",\"bodyId\":\"body\",\"featureId\":\"face-feature\"},{\"kind\":\"sketch\",\"persistentId\":\"sketch-1\",\"featureId\":\"sketch-1\"}]}}";
        Assert.Throws<ArgumentException>(() => Check(json));
    }

    [Fact]
    public void RejectsMalformedOptionalOwnerOnSketch()
    {
        Assert.Throws<ArgumentException>(() => Check("{\"voiceRequestId\":\"v\",\"sessionId\":\"s\",\"documentId\":\"d\",\"revision\":1,\"selectionIds\":[\"sketch-1\"],\"selectionContext\":{\"version\":2,\"selections\":[{\"kind\":\"sketch\",\"persistentId\":\"sketch-1\",\"featureId\":\"sketch-1\",\"bodyId\":7}]}}"));
    }

    [Fact]
    public void SpatialVoiceIntentGroundsSketchWithItsCanonicalFeatureId()
    {
        using var context = JsonDocument.Parse("{\"voiceRequestId\":\"v\",\"sessionId\":\"s\",\"documentId\":\"d\",\"revision\":1,\"selectionIds\":[\"sketch-1\"],\"selectionContext\":{\"version\":2,\"selections\":[{\"kind\":\"sketch\",\"persistentId\":\"sketch-1\",\"featureId\":\"sketch-1\"}]}}");
        var input = SpatialVoiceIntent.BuildInput("Spiega questo schizzo", context.RootElement);
        Assert.Contains("sketch (ID persistente \"sketch-1\")", input);
        Assert.Contains("\"kind\":\"sketch\"", input);
        Assert.Contains("\"persistentId\":\"sketch-1\"", input);
        Assert.Contains("\"featureId\":\"sketch-1\"", input);
    }

    static string VersionTwo(string[] ids) => JsonSerializer.Serialize(new {
        voiceRequestId = "v", sessionId = "s", documentId = "d", revision = 1, selectionIds = ids,
        selectionContext = new { version = 2, selections = ids.Select(id => new {
            kind = "face", persistentId = id, bodyId = "body", featureId = "feature",
        }).ToArray() },
    });

    [Fact]
    public void VersionTwoUsesExistingSixtyFourSelectionLimitAndBoundsPersistentIds()
    {
        var accepted = Enumerable.Range(0, 64).Select(index => "face-" + index).ToArray();
        Check(VersionTwo(accepted));
        Assert.Throws<ArgumentException>(() => Check(VersionTwo(Enumerable.Range(0, 65).Select(index => "face-" + index).ToArray())));
        Assert.Throws<ArgumentException>(() => Check(VersionTwo(new[] { new string('x', 513) })));
    }

    [Theory]
    [InlineData("{\"selectionIds\":[\"wrong\"],\"selectionContext\":{\"kind\":\"face\",\"persistentId\":\"face-id\",\"bodyId\":\"body\",\"featureId\":\"feature\"}}")]
    [InlineData("{\"selectionIds\":[\"id\"],\"selectionContext\":{\"kind\":\"executeCommand\",\"persistentId\":\"id\"}}")]
    [InlineData("{\"voiceRequestId\":\"v\",\"sessionId\":\"s\",\"documentId\":\"d\",\"revision\":1,\"selectionIds\":[\"id\"],\"selectionContext\":{\"version\":2,\"selections\":[{\"kind\":\"sketch-extra\",\"persistentId\":\"id\",\"featureId\":\"id\"}]}}")]
    [InlineData("{\"selectionIds\":[\"id\"],\"selectionContext\":{\"kind\":\"edge\",\"persistentId\":\"id\"}}")]
    [InlineData("{\"voiceRequestId\":\"v\",\"sessionId\":\"s\",\"documentId\":\"d\",\"revision\":1,\"selectionIds\":[\"a\",\"b\"],\"selectionContext\":{\"version\":2,\"selections\":[{\"kind\":\"face\",\"persistentId\":\"a\",\"bodyId\":\"b\",\"featureId\":\"f\"},{\"kind\":\"edge\",\"persistentId\":\"b\",\"bodyId\":\"b\",\"featureId\":\"f\"}],\"referencePoint\":{\"positionMm\":[1,2,3],\"coordinateSystem\":\"unity\",\"source\":\"quest-mr\"}}}")]
    [InlineData("{\"voiceRequestId\":\"v\",\"sessionId\":\"s\",\"documentId\":\"d\",\"revision\":1,\"selectionIds\":[\"a\",\"a\"],\"selectionContext\":{\"version\":2,\"selections\":[{\"kind\":\"face\",\"persistentId\":\"a\",\"bodyId\":\"b\",\"featureId\":\"f\"},{\"kind\":\"edge\",\"persistentId\":\"a\",\"bodyId\":\"b\",\"featureId\":\"f\"}]}}")]
    [InlineData("{\"voiceRequestId\":\"v\",\"sessionId\":\"s\",\"documentId\":\"d\",\"revision\":1,\"selectionIds\":[\"a\"],\"selectionContext\":{\"version\":2,\"selections\":[{\"kind\":\"datumPlane\",\"persistentId\":\"a\"}]}}")]
    [InlineData("{\"voiceRequestId\":\"v\",\"sessionId\":\"s\",\"documentId\":\"d\",\"revision\":1,\"selectionIds\":[\"other\"],\"selectionContext\":{\"version\":2,\"selections\":[{\"kind\":\"face\",\"persistentId\":\"a\",\"bodyId\":\"b\",\"featureId\":\"f\"}]}}")]
    [InlineData("{\"voiceRequestId\":\"v\",\"sessionId\":\"s\",\"documentId\":\"d\",\"revision\":1,\"selectionIds\":[],\"selectionContext\":{\"version\":2,\"selections\":[],\"referencePoint\":{\"positionMm\":[1,2,3],\"coordinateSystem\":\"cad\",\"source\":\"quest-mr\",\"featureId\":\"fake-point-feature\"}}}")]
    [InlineData("{\"voiceRequestId\":\"v\",\"sessionId\":\"s\",\"documentId\":\"d\",\"revision\":1,\"selectionIds\":[],\"selectionContext\":{\"version\":3,\"selections\":[],\"referencePoint\":{\"positionMm\":[1,2,3],\"coordinateSystem\":\"cad\",\"source\":\"quest-mr\"}}}")]
    [InlineData("{\"voiceRequestId\":\"v\",\"sessionId\":\"s\",\"documentId\":\"d\",\"revision\":1,\"selectionIds\":[],\"selectionContext\":{\"version\":2,\"selections\":[],\"referencePoint\":{\"positionMm\":[1e9999,2,3],\"coordinateSystem\":\"cad\",\"source\":\"quest-mr\"}}}")]
    [InlineData("{\"voiceRequestId\":\"v\",\"sessionId\":\"s\",\"documentId\":\"d\",\"revision\":1,\"selectionIds\":[],\"selectionContext\":{\"version\":2,\"selections\":[]}}")]
    public void RejectsMismatchedUnknownOrOwnerlessSemanticSelection(string json)
    {
        Assert.Throws<ArgumentException>(() => Check(json));
    }
}
