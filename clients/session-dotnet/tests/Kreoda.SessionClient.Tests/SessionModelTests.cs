using System.Text;
using System.Text.Json;
using Kreoda.Session;
using Xunit;

namespace Kreoda.SessionClient.Tests;

public sealed class SessionModelTests
{
    private static JsonElement Json(string value) => JsonDocument.Parse(value).RootElement.Clone();

    private static object ProjectionSketch(string[] entityIds) => new
    {
        featureId = "target",
        projectionGroups = new[] { new
        {
            groupId = "group", definition = new { version = 1, operation = "projectEdges", sources = new[] { new { type = "sketchEntities", featureId = "source", entityIds } } },
            sourceFeatureIds = new[] { "source" }, status = "ok", error = "", blockingSourceIds = Array.Empty<string>(), generation = 1,
        } },
    };

    private static JsonElement SketchDelta(object sketch) => Json(JsonSerializer.Serialize(new
    {
        @event = "delta", sessionId = "s", documentId = "d", baseRevision = 0, newRevision = 1, revision = 1,
        originClientId = "c", added = Array.Empty<object>(), updated = new[] { new { kind = "sketch", id = "target", index = 0, value = sketch } },
        removedIds = Array.Empty<string>(), changedMeshIds = Array.Empty<string>(), referenceRemaps = Array.Empty<object>(), warnings = Array.Empty<object>(),
    }));

    [Fact]
    public void DatumSnapshotsAndDeltasPreserveDefinitionsFramesAndLegacyConstructor()
    {
        var legacy = new SessionModelState("s", "d", 0, Array.Empty<JsonElement>(), Array.Empty<JsonElement>(), Array.Empty<JsonElement>());
        Assert.Empty(legacy.Datums);
        var snapshot = SessionModelState.FromSnapshot(Json("""{"sessionId":"s","documentId":"d","revision":0,"features":[],"sketches":[],"bodies":[],"datums":[{"featureId":"plane","kind":"DatumPlane","definition":{"type":"principal","planeKind":"XY"},"dependsOn":[],"resolved":{"originMm":[10,20,30],"xAxis":[1,0,0],"yAxis":[0,1,0],"normal":[0,0,1]},"status":"ok"}]}"""));
        var datums = snapshot.Datums;
        Assert.Equal(30, datums[0].GetProperty("resolved").GetProperty("originMm")[2].GetDouble());
        var delta = Json("""{"event":"delta","sessionId":"s","documentId":"d","baseRevision":0,"newRevision":1,"revision":1,"originClientId":"c","added":[],"updated":[],"removedIds":["plane"],"changedMeshIds":[],"referenceRemaps":[],"warnings":[]}""");
        var update = snapshot.Apply(delta); Assert.Equal(SessionModelUpdateKind.Applied, update.Kind);
        Assert.Empty(update.Model.Datums);
        Assert.Single(datums); Assert.Empty(update.Model.Features); Assert.Empty(update.Model.Bodies);
    }

    [Fact]
    public void GeneratedRequiredFieldsRejectMissingPatchMetadataAndNullArrays()
    {
        var model = SessionModelState.FromSnapshot(Json("""{"sessionId":"s","documentId":"d","revision":0,"features":[],"sketches":[],"bodies":[]}"""));
        var valid = """{"event":"delta","sessionId":"s","documentId":"d","baseRevision":0,"newRevision":1,"revision":1,"originClientId":"c","added":[{"kind":"body","id":"b","index":0,"value":{"bodyId":"b"}}],"updated":[],"removedIds":[],"changedMeshIds":[],"referenceRemaps":[],"warnings":[]}""";
        foreach (var invalid in new[] {
            valid.Replace("\"index\":0,", ""), valid.Replace("\"kind\":\"body\",", ""),
            valid.Replace("\"event\":\"delta\",", ""), valid.Replace("\"changedMeshIds\":[]", "\"changedMeshIds\":null"),
            valid.Replace("\"kind\":\"body\"", "\"kind\":\"unknown\""),
        }) Assert.Equal(SessionModelUpdateKind.NeedsSnapshot, model.Apply(Json(invalid)).Kind);
        Assert.Empty(model.Bodies);
    }

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

    [Fact]
    public void ProjectionGroupsSurviveValidSketchDeltasAndInvalidUtf8OrDefinitionsRequireRecovery()
    {
        var baselineJson = """{"sessionId":"s","documentId":"d","revision":0,"features":[],"sketches":[{"featureId":"target","model":{}}],"bodies":[]}""";
        var baseline = SessionModelState.FromSnapshot(Json(baselineJson));
        var valid = baseline.Apply(SketchDelta(ProjectionSketch(["entity-1"])));
        Assert.Equal(SessionModelUpdateKind.Applied, valid.Kind);
        Assert.Equal("group", valid.Model.Sketches[0].GetProperty("projectionGroups")[0].GetProperty("groupId").GetString());
        Assert.Equal("entity-1", valid.Model.Sketches[0].GetProperty("projectionGroups")[0]
            .GetProperty("definition").GetProperty("sources")[0].GetProperty("entityIds")[0].GetString());

        var overlongUtf8Id = new string('é', 303) + "a"; // 607 UTF-8 bytes, while remaining under 512 UTF-16 chars.
        var oversizedDefinitionIds = Enumerable.Range(0, 128).Select(index => new string('a', 509) + index.ToString("D3")).ToArray();
        Assert.All(oversizedDefinitionIds, id => Assert.InRange(Encoding.UTF8.GetByteCount(id), 1, 512));
        using (var largeSketch = JsonDocument.Parse(JsonSerializer.Serialize(ProjectionSketch(oversizedDefinitionIds))))
            Assert.True(Encoding.UTF8.GetByteCount(largeSketch.RootElement.GetProperty("projectionGroups")[0].GetProperty("definition").GetRawText()) > 65536);
        foreach (var invalidSketch in new[] { ProjectionSketch([overlongUtf8Id]), ProjectionSketch(oversizedDefinitionIds) })
        {
            Assert.Equal(SessionModelUpdateKind.NeedsSnapshot, baseline.Apply(SketchDelta(invalidSketch)).Kind);
            var snapshot = Json(JsonSerializer.Serialize(new
            {
                sessionId = "s", documentId = "d", revision = 1, features = Array.Empty<object>(),
                sketches = new[] { invalidSketch }, bodies = Array.Empty<object>(),
            }));
            var error = Assert.Throws<SessionException>(() => SessionModelState.FromSnapshot(snapshot));
            Assert.Equal("BAD_MODEL", error.Code);
        }
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
