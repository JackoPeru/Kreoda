using System.Text.Json;
using Kreoda.Session;
using Xunit;

namespace Kreoda.SessionClient.Tests;

public sealed class SessionModelTests
{
    private static JsonElement Json(string value) => JsonDocument.Parse(value).RootElement.Clone();

    [Fact]
    public void OrderedChangesPreserveOtherEntitiesAndApplySharedFeatureSketchIds()
    {
        var model = SessionModelState.FromSnapshot(Json("""{"sessionId":"s","documentId":"d","revision":0,"features":[{"featureId":"a"},{"featureId":"sk"}],"sketches":[{"featureId":"sk","model":{"x":1}}],"bodies":[]}"""));
        var update = model.Apply(Json("""{"event":"delta","sessionId":"s","documentId":"d","baseRevision":0,"newRevision":1,"revision":1,"originClientId":"c","added":[{"kind":"feature","id":"b","index":0,"value":{"featureId":"b"}}],"updated":[{"kind":"sketch","id":"sk","index":0,"value":{"featureId":"sk","model":{"x":2}}}],"removedIds":[],"changedMeshIds":["b"],"referenceRemaps":[],"warnings":[]}"""));
        Assert.Equal(SessionModelUpdateKind.Applied, update.Kind);
        Assert.Equal(new[] { "b", "a", "sk" }, update.Model.Features.Select(value => value.GetProperty("featureId").GetString()));
        Assert.Equal(model.Features[0], update.Model.Features[1]);
        Assert.Equal(2, update.Model.Sketches[0].GetProperty("model").GetProperty("x").GetInt32());
        Assert.Equal(new[] { "b" }, update.Delta!.ChangedMeshIds);
    }

    [Theory]
    [InlineData("s", 0, 1, SessionModelUpdateKind.Duplicate)]
    [InlineData("s", 3, 4, SessionModelUpdateKind.NeedsSnapshot)]
    [InlineData("new-session", 0, 1, SessionModelUpdateKind.NeedsSnapshot)]
    public void DuplicateGapAndNewLineageHaveDifferentOutcomes(string sessionId, int before, int after, SessionModelUpdateKind expected)
    {
        var model = SessionModelState.FromSnapshot(Json("""{"sessionId":"s","documentId":"d","revision":2,"features":[],"sketches":[],"bodies":[]}"""));
        var update = model.Apply(Json(JsonSerializer.Serialize(new { @event = "delta", sessionId, documentId = "d", baseRevision = before, newRevision = after, revision = after, originClientId = "c", added = Array.Empty<object>(), updated = Array.Empty<object>(), removedIds = Array.Empty<string>(), changedMeshIds = Array.Empty<string>(), referenceRemaps = Array.Empty<object>(), warnings = Array.Empty<object>() })));
        Assert.Equal(expected, update.Kind);
    }

    [Fact]
    public void MalformedIndexAndFullArraysRequireRecoveryWithoutPartialApplication()
    {
        var model = SessionModelState.FromSnapshot(Json("""{"sessionId":"s","documentId":"d","revision":0,"features":[],"sketches":[],"bodies":[]}"""));
        var malformed = Json("""{"event":"delta","sessionId":"s","documentId":"d","baseRevision":0,"newRevision":1,"revision":1,"originClientId":"c","added":[{"kind":"feature","id":"b","index":9,"value":{"featureId":"b"}}],"updated":[],"removedIds":[],"changedMeshIds":[],"referenceRemaps":[],"warnings":[]}""");
        Assert.Equal(SessionModelUpdateKind.NeedsSnapshot, model.Apply(malformed).Kind);
        Assert.Empty(model.Features);
        Assert.Equal(SessionModelUpdateKind.NeedsSnapshot, model.Apply(Json(malformed.GetRawText().Replace("\"added\":", "\"features\":[],\"added\":"))).Kind);
    }
}
