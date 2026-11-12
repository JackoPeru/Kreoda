using System.Text.Json;
using System.Globalization;

namespace Kreoda.ModelingAgent;

public sealed record SemanticHole(string FeatureId, double Xmm, double Ymm, double DiameterMm);
public sealed record SemanticSelection(string SessionId, string DocumentId, long Revision, string TargetId,
    string FaceRole, IReadOnlyList<SemanticHole> Holes, bool ExistingGeometry = true);
public sealed record SemanticSuggestion(string Id, string Explanation, bool CanExecute, GeneratedCadOption? ProposedCommand);

/// <summary>Deterministic suggestions over explicit PC/Quest semantic identities; never mutates the document.</summary>
public static class SemanticInference
{
    /// <summary>Extract only actual persisted CreateHole features from a native model snapshot.
    /// A missing or ambiguous parent/parameter identity is rejected rather than guessed.</summary>
    public static SemanticSelection FromNativeHistory(string sessionId, string documentId, long revision,
        string targetId, string faceRole, JsonElement model)
    {
        if (model.ValueKind != JsonValueKind.Object || !model.TryGetProperty("features", out var features) ||
            features.ValueKind != JsonValueKind.Array) throw new ArgumentException("Native feature history unavailable");
        var history = features.EnumerateArray().Select(f => f.Clone()).ToArray();
        var holes = new List<SemanticHole>();
        var knownLineage = new HashSet<string>(StringComparer.Ordinal) {targetId};
        foreach (var feature in history) {
            if (feature.ValueKind != JsonValueKind.Object) throw new ArgumentException("Invalid native feature history");
            if (!feature.TryGetProperty("type",out var type) || type.ValueKind!=JsonValueKind.String) continue;
            var kind=type.GetString();
            if (kind is not ("Hole" or "HolePattern")) continue;
            if (!feature.TryGetProperty("featureId",out var id) || id.ValueKind!=JsonValueKind.String ||
                !feature.TryGetProperty("dependsOn",out var dependencies) || dependencies.ValueKind!=JsonValueKind.Array ||
                dependencies.GetArrayLength()!=1 || dependencies[0].ValueKind!=JsonValueKind.String ||
                !AgentCreationRule.ValidFeatureId(id.GetString()) || !feature.TryGetProperty("refExtra",out var extra) ||
                extra.ValueKind!=JsonValueKind.String || !feature.TryGetProperty("paramsMm",out var numeric) ||
                numeric.ValueKind!=JsonValueKind.Array || numeric.GetArrayLength()<2 ||
                numeric[0].ValueKind!=JsonValueKind.Number || numeric[1].ValueKind!=JsonValueKind.Number ||
                !numeric[0].TryGetDouble(out var diameter) || !double.IsFinite(diameter) ||
                !numeric[1].TryGetDouble(out var depth) || !double.IsFinite(depth))
                throw new ArgumentException("Cannot prove full persisted native hole provenance");
            var upstream=dependencies[0].GetString()!;
            if (!knownLineage.Contains(upstream)) continue;
            var fields=extra.GetString()!.Split(';',StringSplitOptions.None);
            if (kind=="HolePattern") {
                // A pattern is one persistent feature, not manually authored individual holes.
                // Do not silently interpret or duplicate it as a set of independent hole commands.
                continue;
            }
            if (fields.Length!=4 || !fields[0].StartsWith("face=",StringComparison.Ordinal) ||
                !fields[1].StartsWith("x=",StringComparison.Ordinal) ||
                !fields[2].StartsWith("y=",StringComparison.Ordinal) ||
                !fields[3].StartsWith("mode=",StringComparison.Ordinal) ||
                !double.TryParse(fields[1][2..],NumberStyles.Float,CultureInfo.InvariantCulture,out var x) ||
                !double.TryParse(fields[2][2..],NumberStyles.Float,CultureInfo.InvariantCulture,out var y) ||
                !double.IsFinite(x) || !double.IsFinite(y))
                throw new ArgumentException("Unsupported native hole coordinate encoding");
            if (fields[0][5..]!=faceRole) continue;
            holes.Add(new(id.GetString()!,x,y,diameter));
            knownLineage.Add(id.GetString()!);
        }
        return new SemanticSelection(sessionId, documentId, revision, targetId, faceRole, holes, true);
    }

    /// <summary>Only a complete native history can authorize replacement of existing cuts.
    /// Caller-authored selections passed to Analyze remain advisory.</summary>
    public static IReadOnlyList<SemanticSuggestion> AnalyzeNativeHistory(string sessionId, string documentId, long revision,
        string targetId, string faceRole, JsonElement model, AgentCommandCatalog catalog)
    {
        var selection = FromNativeHistory(sessionId, documentId, revision, targetId, faceRole, model);
        if (selection.Holes.Count < 2) return Array.Empty<SemanticSuggestion>();
        var suggestions = Analyze(selection, catalog).ToArray();
        var index = Array.FindIndex(suggestions, s => s.Id == "linear-hole-pattern");
        // The current native pattern supports at most four points. Larger histories stay advisory.
        if (index < 0 || selection.Holes.Count > 4 || !SupportsConversion(catalog)) return suggestions;
        if (!model.TryGetProperty("sketches", out var sketches) || sketches.ValueKind != JsonValueKind.Array ||
            !model.TryGetProperty("datums", out var datums) || datums.ValueKind != JsonValueKind.Array) return suggestions;

        var history = model.GetProperty("features").EnumerateArray().ToArray();
        var records = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        foreach (var record in history) {
            if (record.ValueKind != JsonValueKind.Object || !record.TryGetProperty("featureId", out var id) ||
                id.ValueKind != JsonValueKind.String || !AgentCreationRule.ValidFeatureId(id.GetString()) ||
                !records.TryAdd(id.GetString()!, record)) return suggestions;
        }
        if (!records.TryGetValue(targetId, out var target) || !Current(target) ||
            !target.TryGetProperty("bodyId", out var body) || body.ValueKind != JsonValueKind.String ||
            string.IsNullOrWhiteSpace(body.GetString()) || !target.TryGetProperty("bodyTip", out var targetTip) ||
            targetTip.ValueKind != JsonValueKind.False) return suggestions;
        var ids = selection.Holes.Select(h => h.FeatureId).ToHashSet(StringComparer.Ordinal);
        var previous = targetId;
        string? depthMode = null;
        double depth = 0;
        for (var i = 0; i < selection.Holes.Count; i++) {
            var hole = selection.Holes[i];
            var terminal = i == selection.Holes.Count - 1;
            if (!records.TryGetValue(hole.FeatureId, out var record) || !Current(record) ||
                !record.TryGetProperty("bodyId", out var holeBody) || holeBody.ValueKind != JsonValueKind.String ||
                holeBody.GetString() != body.GetString() ||
                !record.TryGetProperty("bodyTip", out var bodyTip) ||
                bodyTip.ValueKind != (terminal ? JsonValueKind.True : JsonValueKind.False) ||
                !record.TryGetProperty("dependsOn", out var dependencies) || dependencies.ValueKind != JsonValueKind.Array ||
                dependencies.GetArrayLength() != 1 || dependencies[0].ValueKind != JsonValueKind.String ||
                dependencies[0].GetString() != previous ||
                !record.TryGetProperty("expressions", out var expressions) || expressions.ValueKind != JsonValueKind.Object ||
                expressions.EnumerateObject().Any() || hole.DiameterMm != selection.Holes[0].DiameterMm) return suggestions;
            var numeric = record.GetProperty("paramsMm");
            if (numeric.GetArrayLength() != 2 || !numeric[1].TryGetDouble(out var actualDepth) ||
                !double.IsFinite(actualDepth) || actualDepth < 0 || actualDepth > 100000) return suggestions;
            var mode = record.GetProperty("refExtra").GetString()!.Split(';')[3][5..];
            if (mode is not ("throughAll" or "blind") || mode == "blind" && actualDepth <= 0) return suggestions;
            if (i == 0) { depthMode = mode;depth = actualDepth; }
            else if (mode != depthMode || actualDepth != depth) return suggestions;
            previous = hole.FeatureId;
        }
        var tip = records[previous];
        if (!tip.TryGetProperty("bodyTip", out var isTip) || isTip.ValueKind != JsonValueKind.True) return suggestions;
        foreach (var pair in records) {
            if (ids.Contains(pair.Key)) continue;
            var record = pair.Value;
            if (References(record, ids)) return suggestions;
            // Any additional feature branching from the pre-hole target makes the lineage ambiguous.
            if (pair.Key != targetId && record.TryGetProperty("dependsOn", out var dependencies) && dependencies.ValueKind == JsonValueKind.Array &&
                dependencies.EnumerateArray().Any(d => d.ValueKind == JsonValueKind.String && d.GetString() == targetId)) return suggestions;
            if (record.TryGetProperty("bodyId", out var otherBody) && otherBody.ValueKind == JsonValueKind.String &&
                otherBody.GetString() == body.GetString() && record.TryGetProperty("bodyTip", out var otherTip) &&
                otherTip.ValueKind == JsonValueKind.True) return suggestions;
        }
        if (References(sketches, ids) || References(datums, ids)) return suggestions;

        var newIds = Enumerable.Range(0, selection.Holes.Count).Select(_ => Guid.NewGuid().ToString("D")).ToArray();
        if (newIds.Distinct(StringComparer.Ordinal).Count() != newIds.Length || newIds.Any(records.ContainsKey)) return suggestions;
        var steps = selection.Holes.Reverse().Select(h => new GeneratedCadStep("DeleteFeature",
            JsonSerializer.SerializeToElement(new { featureId = h.FeatureId }),
            "Replace only this terminal manual cut, in reverse dependency order, inside the same reversible request")).ToList();
        steps.Add(new("CreateHolePattern", JsonSerializer.SerializeToElement(new {
            targetId, faceRole, featureIds = newIds,
            pointsMm = selection.Holes.SelectMany(h => new[] { h.Xmm, h.Ymm }).ToArray(),
            diameterMm = selection.Holes[0].DiameterMm, depthMode, depthMm = depth,
        }), "Create one editable pattern on the original target with the exact original positions, diameter and depth"));
        var option = new GeneratedCadOption("convert-linear-hole-pattern", "Convert manual holes to one editable pattern", steps,
            new GeneratedCadSelectionFence(sessionId, documentId, revision));
        suggestions[index] = new("linear-hole-pattern",
            "Convert this terminal manual hole chain only after explicit choice. Native dependency checks may reject application; the request must roll back without losing the original history.", true, option);
        return suggestions;
    }

    static bool Current(JsonElement record) => record.TryGetProperty("geometryCurrent", out var current) &&
        current.ValueKind == JsonValueKind.True && record.TryGetProperty("status", out var status) &&
        status.ValueKind == JsonValueKind.String && status.GetString() == "ok";

    static bool References(JsonElement value, HashSet<string> ids)
    {
        if (value.ValueKind == JsonValueKind.Array) return value.EnumerateArray().Any(v => References(v, ids));
        if (value.ValueKind == JsonValueKind.Object) return value.EnumerateObject().Any(p => References(p.Value, ids));
        if (value.ValueKind != JsonValueKind.String) return false;
        var text = value.GetString()!;
        foreach (var id in ids) {
            for (var start = 0; start <= text.Length - id.Length;) {
                var at = text.IndexOf(id, start, StringComparison.Ordinal);
                if (at < 0) break;
                static bool IdChar(char c) => char.IsAsciiLetterOrDigit(c) || c is '_' or '-';
                if ((at == 0 || !IdChar(text[at - 1])) &&
                    (at + id.Length == text.Length || !IdChar(text[at + id.Length]))) return true;
                start = at + id.Length;
            }
        }
        return false;
    }

    static bool SupportsConversion(AgentCommandCatalog catalog)
    {
        if (!SupportsPattern(catalog)) return false;
        AgentCommand delete;
        try { delete = catalog.Require("DeleteFeature"); }
        catch (ArgumentException) { return false; }
        if (delete.Creation.FixedCount != 0 || !delete.Parameters.TryGetProperty("properties", out var deleteFields) ||
            deleteFields.ValueKind != JsonValueKind.Object || !FieldType(deleteFields, "featureId", "string") ||
            !Requires(delete.Parameters, "featureId")) return false;
        var pattern = catalog.Require("CreateHolePattern");
        var fields = pattern.Parameters.GetProperty("properties");
        return Requires(pattern.Parameters, "targetId", "faceRole", "featureIds", "pointsMm", "diameterMm", "depthMode") &&
            FieldType(fields, "targetId", "string") && FieldType(fields, "faceRole", "string") &&
            FieldType(fields, "diameterMm", "number") && FieldType(fields, "depthMode", "string") && FieldType(fields, "depthMm", "number") &&
            ArrayItemType(fields, "featureIds", "string") && ArrayItemType(fields, "pointsMm", "number") &&
            EnumContains(fields, "depthMode", "throughAll") && EnumContains(fields, "depthMode", "blind");
    }

    static bool Requires(JsonElement schema, params string[] names) => schema.TryGetProperty("required", out var required) &&
        required.ValueKind == JsonValueKind.Array && names.All(name => required.EnumerateArray().Any(item =>
            item.ValueKind == JsonValueKind.String && item.GetString() == name));

    static bool EnumContains(JsonElement fields, string name, string expected) => fields.TryGetProperty(name, out var field) &&
        field.ValueKind == JsonValueKind.Object && field.TryGetProperty("enum", out var values) && values.ValueKind == JsonValueKind.Array &&
        values.EnumerateArray().Any(value => value.ValueKind == JsonValueKind.String && value.GetString() == expected);

    static bool ArrayItemType(JsonElement fields, string name, string expected) => fields.TryGetProperty(name, out var field) &&
        HasType(field, "array") && field.TryGetProperty("items", out var items) && HasType(items, expected);

    static bool FieldType(JsonElement fields, string name, string expected) => fields.TryGetProperty(name, out var field) &&
        HasType(field, expected);

    static bool HasType(JsonElement schema, string expected) => schema.ValueKind == JsonValueKind.Object &&
        schema.TryGetProperty("type", out var type) &&
        type.ValueKind == JsonValueKind.String && type.GetString() == expected;

    public static IReadOnlyList<SemanticSuggestion> Analyze(SemanticSelection selection, AgentCommandCatalog catalog,
        double toleranceMm = .01)
    {
        if (selection is null || catalog is null || string.IsNullOrWhiteSpace(selection.SessionId) ||
            string.IsNullOrWhiteSpace(selection.DocumentId) || selection.Revision < 0 ||
            !AgentCreationRule.ValidFeatureId(selection.TargetId) || string.IsNullOrWhiteSpace(selection.FaceRole) ||
            selection.Holes is null || selection.Holes.Count is < 2 or > 128 ||
            !double.IsFinite(toleranceMm) || toleranceMm <= 0 || toleranceMm > 1 ||
            selection.Holes.Any(h => !AgentCreationRule.ValidFeatureId(h.FeatureId) || !double.IsFinite(h.Xmm) ||
                !double.IsFinite(h.Ymm) || !double.IsFinite(h.DiameterMm) || h.DiameterMm <= 0 || h.DiameterMm > 100000) ||
            selection.Holes.Select(h => h.FeatureId).Distinct(StringComparer.Ordinal).Count() != selection.Holes.Count)
            throw new ArgumentException("Invalid or stale-prone semantic selection");

        var holes = selection.Holes.OrderBy(h => h.Xmm).ThenBy(h => h.Ymm).ToArray();
        var suggestions = new List<SemanticSuggestion>();
        var sameDiameter = holes.All(h => Math.Abs(h.DiameterMm - holes[0].DiameterMm) <= toleranceMm);
        var sameY = holes.All(h => Math.Abs(h.Ymm - holes[0].Ymm) <= toleranceMm);
        var sameX = holes.All(h => Math.Abs(h.Xmm - holes[0].Xmm) <= toleranceMm);
        var coordinates = sameY ? holes.Select(h => h.Xmm).ToArray() :
            sameX ? holes.Select(h => h.Ymm).Order().ToArray() : Array.Empty<double>();
        var equallySpaced = coordinates.Length >= 3 && coordinates.Zip(coordinates.Skip(1), (a,b) => b-a)
            .All(gap => gap > toleranceMm && Math.Abs(gap - (coordinates[1]-coordinates[0])) <= toleranceMm);
        if (sameDiameter && equallySpaced)
        {
            GeneratedCadOption? proposed = null;
            // CreateHolePattern adds material cuts; it cannot convert existing holes in place.
            // Only suggested prospective locations can safely execute this native command.
            if (!selection.ExistingGeometry && holes.Length <= 4 && SupportsPattern(catalog)) {
                var ids = Enumerable.Range(0, holes.Length).Select(_ => Guid.NewGuid().ToString("D")).ToArray();
                proposed = new GeneratedCadOption("linear-hole-pattern", "Create editable native hole pattern", [
                    new GeneratedCadStep("CreateHolePattern", JsonSerializer.SerializeToElement(new {
                        targetId = selection.TargetId, faceRole = selection.FaceRole, featureIds = ids,
                        pointsMm = holes.SelectMany(h => new[] { h.Xmm, h.Ymm }).ToArray(),
                        diameterMm = holes[0].DiameterMm, depthMode = "throughAll", depthMm = 0d,
                    }), "Equally spaced equal-diameter holes on one selected face")],
                    new GeneratedCadSelectionFence(selection.SessionId,selection.DocumentId,selection.Revision));
            }
            suggestions.Add(new("linear-hole-pattern", $"{holes.Length} equally spaced holes of diameter {holes[0].DiameterMm:G} mm; existing holes require a conversion command, while prospective points can create a native pattern after confirmation and through-depth validation.", proposed is not null, proposed));
        }
        var centerX = (holes.Min(h => h.Xmm) + holes.Max(h => h.Xmm)) / 2;
        var centerY = (holes.Min(h => h.Ymm) + holes.Max(h => h.Ymm)) / 2;
        var mirrored = holes.All(h => holes.Any(other => Math.Abs(other.Xmm - (2*centerX-h.Xmm)) <= toleranceMm &&
            Math.Abs(other.Ymm-h.Ymm) <= toleranceMm && Math.Abs(other.DiameterMm-h.DiameterMm) <= toleranceMm));
        if (mirrored && holes.Select(h => Math.Round(h.Xmm/toleranceMm)).Distinct().Count() > 1)
            suggestions.Add(new("mirror-about-x", $"Selected holes are symmetric about X={centerX:G} mm. Explicit symmetry relationship requires a supported native constraint command.", false, null));
        return suggestions.AsReadOnly();
    }

    static bool SupportsPattern(AgentCommandCatalog catalog)
    {
        AgentCommand command;
        try { command = catalog.Require("CreateHolePattern"); }
        catch (ArgumentException) { return false; }
        if (command.Creation.IdArrayParameter != "featureIds" ||
            !command.Parameters.TryGetProperty("properties", out var fields) || fields.ValueKind != JsonValueKind.Object) return false;
        return new[] { "targetId", "faceRole", "featureIds", "pointsMm", "diameterMm", "depthMode", "depthMm" }
            .All(field => fields.TryGetProperty(field, out _));
    }
}
