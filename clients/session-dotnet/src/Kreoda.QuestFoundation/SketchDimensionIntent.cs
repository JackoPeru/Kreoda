using System.Text.Json;
using Kreoda.Session;

namespace Kreoda.QuestFoundation;

/// <summary>One actual sketch constraint, with immutable model/plane/entity
/// identity. Angular values are displayed as degrees and stored as radians.</summary>
public sealed class SketchDimensionIntent
{
    public string SessionId { get; }
    public string DocumentId { get; }
    public long BaseRevision { get; }
    public string SketchId { get; }
    public string ConstraintId { get; }
    public string Kind { get; }
    public string Unit => Kind == "angle" ? "deg" : "mm";
    public double Value { get; }
    public JsonElement Sketch { get; }
    public JsonElement Model { get; }
    public SketchDimensionIntent(string sessionId, string documentId, long revision, JsonElement sketch, string constraintId)
    {
        if (!Guid.TryParse(sessionId, out _) || string.IsNullOrWhiteSpace(documentId) || revision < 0 || revision > SessionContract.MaximumRevision)
            throw new ArgumentException("invalid sketch lineage");
        SessionId = sessionId;DocumentId = documentId;BaseRevision = revision;
        Sketch = sketch.Clone();SketchId = Sketch.GetProperty("featureId").GetString() ?? throw new ArgumentException("missing sketch identity");
        Model = Sketch.GetProperty("model");ConstraintId = constraintId;
        var selected = Model.GetProperty("constraints").EnumerateArray().Where(c => c.GetProperty("id").GetString() == constraintId).ToArray();
        if (selected.Length != 1) throw new ArgumentException("constraint must identify one current sketch dimension");
        Kind = selected[0].GetProperty("kind").GetString() ?? "";
        if (Kind is not ("distance" or "radius" or "diameter" or "angle")) throw new ArgumentException("constraint is not dimensional");
        var value = selected[0].GetProperty("value").GetDouble();
        Value = Kind == "angle" ? value * 180 / Math.PI : value;
        if (!double.IsFinite(Value)) throw new ArgumentException("dimension must be finite");
    }
    public JsonElement Draft(double value)
    {
        if (!double.IsFinite(value)) throw new ArgumentException("dimension must be finite");
        var stored = Kind == "angle" ? value * Math.PI / 180 : value;
        if (!double.IsFinite(stored)) throw new ArgumentException("dimension is outside numeric range");
        using var bytes = new MemoryStream();
        using (var writer = new Utf8JsonWriter(bytes)) {
            writer.WriteStartObject();
            foreach (var property in Model.EnumerateObject()) {
                writer.WritePropertyName(property.Name);
                if (property.Name != "constraints") { property.Value.WriteTo(writer);continue; }
                writer.WriteStartArray();
                foreach (var constraint in property.Value.EnumerateArray()) {
                    if (constraint.GetProperty("id").GetString() != ConstraintId) { constraint.WriteTo(writer);continue; }
                    writer.WriteStartObject();
                    foreach (var field in constraint.EnumerateObject()) {
                        writer.WritePropertyName(field.Name);
                        if (field.Name == "value") writer.WriteNumberValue(stored);else field.Value.WriteTo(writer);
                    }
                    writer.WriteEndObject();
                }
                writer.WriteEndArray();
            }
            writer.WriteEndObject();
        }
        using var parsed = JsonDocument.Parse(bytes.ToArray());return parsed.RootElement.Clone();
    }
    public void RequireCurrent(Kreoda.Session.SessionClient client)
    {
        var model = client.Model;
        if (client.SessionId != SessionId || model is null || model.SessionId != SessionId || model.DocumentId != DocumentId ||
            model.Revision != BaseRevision || !model.Sketches.Any(s => s.GetProperty("featureId").GetString() == SketchId))
            throw new SessionException("NEED_FULL_SNAPSHOT", "sketch dimension is no longer current");
    }
    public async Task<JsonElement> PreviewAsync(Kreoda.Session.SessionClient client, double value, CancellationToken ct = default)
    {
        RequireCurrent(client);
        if (!client.ServerCapabilities.Contains(SessionMethods.SketchPreviewV1Capability)) throw new SessionException("NOT_IMPLEMENTED", "PC does not support sketch previews");
        var fields = new Dictionary<string, object?> { ["featureId"] = SketchId, ["model"] = Draft(value), ["documentId"] = DocumentId, ["expectedRevision"] = BaseRevision };
        var reply = await client.CallAsync(SessionMethods.PreviewSketch, fields,
            ct, expectedSessionId: SessionId, beforeSend: () => RequireCurrent(client)).ConfigureAwait(false);
        RequireCurrent(client);
        var result = reply.GetProperty("result");
        if (result.GetProperty("preview").GetBoolean() != true || result.GetProperty("sketch").GetProperty("id").GetString() != SketchId)
            throw new SessionException("BAD_REPLY", "sketch preview identity mismatch");
        return result.GetProperty("sketch").Clone();
    }
    public async Task<JsonElement> CommitAsync(Kreoda.Session.SessionClient client, double value, CancellationToken ct = default)
    {
        RequireCurrent(client);
        return await client.CommandAsync("UpdateSketch", new Dictionary<string, object?> { ["featureId"] = SketchId, ["model"] = Draft(value) },
            DocumentId, baseRevision: BaseRevision, ct: ct).ConfigureAwait(false);
    }
}
