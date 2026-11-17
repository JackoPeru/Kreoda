using System.Text.Json;

namespace Kreoda.HermesBridge;

public static class VoiceSelectionContext
{
    const int MaxSelections = 64;
    const int MaxIdLength = 512;
    static readonly HashSet<string> Kinds = new(StringComparer.Ordinal) {
        "face", "edge", "body", "instance", "datumPlane", "datumAxis", "datumPoint", "sketch"
    };

    public static void Validate(JsonElement context)
    {
        if (context.ValueKind != JsonValueKind.Object || context.GetRawText().Length > 65536)
            throw new ArgumentException("Invalid voice context");
        if (!context.TryGetProperty("selectionContext", out var selected) || selected.ValueKind == JsonValueKind.Null) return;
        if (selected.ValueKind != JsonValueKind.Object)
            throw new ArgumentException("Invalid semantic selection");
        if (selected.TryGetProperty("version", out var version)) {
            if (version.ValueKind != JsonValueKind.Number || !version.TryGetInt32(out var value) || value != 2)
                throw new ArgumentException("Unsupported semantic selection version");
            ValidateVersionTwo(context, selected);
            return;
        }
        ValidateLegacy(context, selected);
    }

    static void ValidateLegacy(JsonElement context, JsonElement selected)
    {
        if (!selected.TryGetProperty("kind", out var kindElement) || kindElement.ValueKind != JsonValueKind.String ||
            !Kinds.Contains(kindElement.GetString()!) || !selected.TryGetProperty("persistentId", out var idElement) ||
            idElement.ValueKind != JsonValueKind.String)
            throw new ArgumentException("Invalid semantic selection");
        var id = BoundedString(idElement, MaxIdLength, "Invalid semantic selection");
        if (!context.TryGetProperty("selectionIds", out var ids) || ids.ValueKind != JsonValueKind.Array ||
            ids.GetArrayLength() != 1 || ids[0].ValueKind != JsonValueKind.String || ids[0].GetString() != id)
            throw new ArgumentException("Semantic selection does not match canonical selectionIds");
        ValidateOwners(selected, kindElement.GetString()!, id, strict: false);
    }

    static void ValidateVersionTwo(JsonElement context, JsonElement selected)
    {
        RequiredString(context, "voiceRequestId", 128);
        RequiredString(context, "sessionId", 128);
        RequiredString(context, "documentId", MaxIdLength);
        if (!context.TryGetProperty("revision", out var revision) || revision.ValueKind != JsonValueKind.Number ||
            !revision.TryGetInt64(out var revisionValue) || revisionValue < 0)
            throw new ArgumentException("Invalid voice context revision");
        if (!selected.TryGetProperty("selections", out var selections) || selections.ValueKind != JsonValueKind.Array ||
            selections.GetArrayLength() > MaxSelections)
            throw new ArgumentException("Invalid semantic selection list");

        var persistentIds = new List<string>(selections.GetArrayLength());
        foreach (var item in selections.EnumerateArray()) {
            if (item.ValueKind != JsonValueKind.Object ||
                !item.TryGetProperty("kind", out var kind) || kind.ValueKind != JsonValueKind.String ||
                !Kinds.Contains(kind.GetString()!) || !item.TryGetProperty("persistentId", out var idElement) ||
                idElement.ValueKind != JsonValueKind.String)
                throw new ArgumentException("Invalid semantic selection item");
            var id = BoundedString(idElement, MaxIdLength, "Invalid semantic selection item");
            ValidateOwners(item, kind.GetString()!, id, strict: true);
            persistentIds.Add(id);
        }
        if (persistentIds.Distinct(StringComparer.Ordinal).Count() != persistentIds.Count)
            throw new ArgumentException("Duplicate semantic selection id");
        if (!context.TryGetProperty("selectionIds", out var ids) || ids.ValueKind != JsonValueKind.Array ||
            ids.GetArrayLength() != persistentIds.Count)
            throw new ArgumentException("Semantic selections do not match canonical selectionIds");
        for (var index = 0; index < persistentIds.Count; index++)
            if (ids[index].ValueKind != JsonValueKind.String || ids[index].GetString() != persistentIds[index])
                throw new ArgumentException("Semantic selections do not match canonical selectionIds");

        var hasPoint = selected.TryGetProperty("referencePoint", out var point);
        if (hasPoint) ValidatePoint(point);
        if (persistentIds.Count == 0 && !hasPoint)
            throw new ArgumentException("Version two context requires a selection or reference point");
    }

    static void ValidateOwners(JsonElement selected, string kind, string id, bool strict)
    {
        foreach (var key in new[] { "bodyId", "featureId", "instanceId" })
            if (selected.TryGetProperty(key, out var owner) && owner.ValueKind != JsonValueKind.String)
                throw new ArgumentException("Invalid semantic selection owner");
            else if (selected.TryGetProperty(key, out owner))
                _ = BoundedString(owner, MaxIdLength, "Invalid semantic selection owner");

        if (kind == "sketch" && (!HasOwner(selected, "featureId") || selected.GetProperty("featureId").GetString() != id))
            throw new ArgumentException("Sketch selection requires its canonical feature id");

        if (!strict) {
            if (kind is "face" or "edge" &&
                (!selected.TryGetProperty("bodyId", out _) || !selected.TryGetProperty("featureId", out _)))
                throw new ArgumentException("Topology selection requires CAD ownership");
            return;
        }

        var requiresTopologyOwner = kind is "face" or "edge" or "body" or "instance";
        if (requiresTopologyOwner && (!HasOwner(selected, "bodyId") || !HasOwner(selected, "featureId")))
            throw new ArgumentException("Selection requires CAD ownership");
        if (kind == "instance" && !HasOwner(selected, "instanceId"))
            throw new ArgumentException("Instance selection requires instance ownership");
        if (kind is "datumPlane" or "datumAxis" or "datumPoint" &&
            (!HasOwner(selected, "featureId") || selected.GetProperty("featureId").GetString() != id))
            throw new ArgumentException("Datum selection requires its canonical feature id");
    }

    static bool HasOwner(JsonElement selected, string key) =>
        selected.TryGetProperty(key, out var owner) && owner.ValueKind == JsonValueKind.String &&
        !string.IsNullOrWhiteSpace(owner.GetString());

    static void ValidatePoint(JsonElement point)
    {
        if (point.ValueKind != JsonValueKind.Object || point.GetRawText().Length > 1024 ||
            !point.TryGetProperty("positionMm", out var position) || position.ValueKind != JsonValueKind.Array ||
            position.GetArrayLength() != 3 || !point.TryGetProperty("coordinateSystem", out var coordinateSystem) ||
            coordinateSystem.ValueKind != JsonValueKind.String || coordinateSystem.GetString() != "cad" ||
            !point.TryGetProperty("source", out var source) || source.ValueKind != JsonValueKind.String || source.GetString() != "quest-mr" ||
            point.TryGetProperty("persistentId", out _) || point.TryGetProperty("featureId", out _))
            throw new ArgumentException("Invalid CAD reference point");
        foreach (var coordinate in position.EnumerateArray())
            if (coordinate.ValueKind != JsonValueKind.Number || !coordinate.TryGetDouble(out var value) || !double.IsFinite(value))
                throw new ArgumentException("CAD reference point must be finite");
    }

    static void RequiredString(JsonElement context, string key, int maxLength)
    {
        if (!context.TryGetProperty(key, out var value) || value.ValueKind != JsonValueKind.String)
            throw new ArgumentException("Invalid voice context lineage");
        _ = BoundedString(value, maxLength, "Invalid voice context lineage");
    }

    static string BoundedString(JsonElement value, int maxLength, string error)
    {
        var text = value.GetString();
        if (string.IsNullOrWhiteSpace(text) || text.Length > maxLength) throw new ArgumentException(error);
        return text;
    }
}
