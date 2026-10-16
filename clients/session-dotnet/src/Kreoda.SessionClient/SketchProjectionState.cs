using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using Kreoda.Session.Generated;

namespace Kreoda.Session;

public sealed record SessionSketchProjectionDisplay(
    string FeatureId, string? GroupId, string SessionId, string DocumentId, long Revision,
    SketchProjectionResult Result);

/// <summary>Owns only current projection display payloads and per-target request freshness.</summary>
public sealed class SessionSketchProjectionState
{
    private readonly object _gate = new();
    private readonly Dictionary<string, long> _tokens = new(StringComparer.Ordinal);
    private readonly Dictionary<string, SessionSketchProjectionDisplay> _current = new(StringComparer.Ordinal);
    private long _sequence;

    private static string Key(string featureId, string? groupId) => featureId + "\0" + (groupId ?? "");

    public IReadOnlyCollection<SessionSketchProjectionDisplay> Current
    {
        get { lock (_gate) return Array.AsReadOnly(_current.Values.ToArray()); }
    }

    public long BeginRequest(string featureId, string? groupId = null)
    {
        lock (_gate)
        {
            var key = Key(featureId, groupId);
            if (_sequence == long.MaxValue) throw new SessionException("BAD_PARAMS", "projection request sequence exhausted");
            var token = ++_sequence;
            _tokens[key] = token;
            return token;
        }
    }

    public bool TryPublish(long token, SessionSketchProjectionDisplay display, Func<bool> stillCurrent)
    {
        lock (_gate)
        {
            var key = Key(display.FeatureId, display.GroupId);
            if (!_tokens.TryGetValue(key, out var current) || current != token || !stillCurrent()) return false;
            if (display.Result.GeometryCurrent && display.Result.Status == "ok") _current[key] = display;
            else _current.Remove(key);
            return true;
        }
    }

    public bool TryClear(string featureId, string? groupId, long token, Func<bool> stillCurrent)
    {
        lock (_gate)
        {
            var key = Key(featureId, groupId);
            if (!_tokens.TryGetValue(key, out var current) || current != token || !stillCurrent()) return false;
            _current.Remove(key);
            return true;
        }
    }

    public void Clear()
    {
        lock (_gate)
        {
            // Keep the sequence monotonic so a delayed pre-clear request can
            // never share a token with a new request for the same target.
            _tokens.Clear();
            _current.Clear();
        }
    }
}

internal static class SketchProjectionContract
{
    private const int MaxIdUtf8Bytes = 512;
    private const int MaxDefinitionUtf8Bytes = 65536;
    private static readonly JsonSerializerOptions Utf8Json = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };
    private static readonly string[] ProjectionStatuses = ["ok", "broken"];
    private static readonly string[] CurveTypes = ["line", "circle", "ellipse", "hyperbola", "parabola", "bezier", "bspline", "offset", "other"];

    internal static void ValidateStableId(string value, string name)
    {
        if (string.IsNullOrEmpty(value) || value.Length > 128 || value.Any(character =>
            !(character is >= 'A' and <= 'Z' or >= 'a' and <= 'z' or >= '0' and <= '9' or '_' or '-')))
            throw new JsonException($"{name} is not a stable feature id");
    }

    internal static void ValidateResult(JsonElement result)
    {
        Object(result, "projection result", "featureId", "plane", "geometryCurrent", "status", "error", "blockingSourceIds", "groups");
        StableId(result.GetProperty("featureId"), "featureId");
        var plane = result.GetProperty("plane");
        Object(plane, "projection plane", "origin", "xAxis", "yAxis", "normal");
        foreach (var axis in new[] { "origin", "xAxis", "yAxis", "normal" }) Triple(plane.GetProperty(axis), axis);
        if (result.GetProperty("geometryCurrent").ValueKind is not (JsonValueKind.True or JsonValueKind.False))
            throw new JsonException("projection geometryCurrent must be boolean");
        NonEmptyString(result.GetProperty("status"), "status");
        String(result.GetProperty("error"), "error");
        StableIds(result.GetProperty("blockingSourceIds"), "blockingSourceIds");
        var groups = Array(result.GetProperty("groups"), 128, "groups");
        foreach (var group in groups) ValidateGroup(group, withEdges: true);
    }

    internal static void ValidateSnapshotProjections(JsonElement snapshot)
    {
        if (snapshot.ValueKind != JsonValueKind.Object || !snapshot.TryGetProperty("sketches", out var sketches) || sketches.ValueKind != JsonValueKind.Array) return;
        foreach (var sketch in sketches.EnumerateArray())
            ValidateSketchRecord(sketch);
    }

    internal static void ValidateSketchRecord(JsonElement sketch)
    {
        if (sketch.ValueKind != JsonValueKind.Object || !sketch.TryGetProperty("projectionGroups", out var groups)) return;
        foreach (var group in Array(groups, 128, "projectionGroups")) ValidateGroup(group, withEdges: false);
    }

    private static void ValidateGroup(JsonElement group, bool withEdges)
    {
        Object(group, "projection group", withEdges
            ? ["groupId", "definition", "sourceFeatureIds", "status", "error", "blockingSourceIds", "generation", "edges"]
            : ["groupId", "definition", "sourceFeatureIds", "status", "error", "blockingSourceIds", "generation"]);
        StableId(group.GetProperty("groupId"), "groupId");
        ValidateDefinition(group.GetProperty("definition"));
        StableIds(Array(group.GetProperty("sourceFeatureIds"), 65536, "sourceFeatureIds"), "sourceFeatureIds");
        EnumString(group.GetProperty("status"), ProjectionStatuses, "projection group status");
        String(group.GetProperty("error"), "projection group error");
        StableIds(Array(group.GetProperty("blockingSourceIds"), 65536, "blockingSourceIds"), "blockingSourceIds");
        var generation = group.GetProperty("generation");
        if (generation.ValueKind != JsonValueKind.Number || !generation.TryGetInt64(out var value) || value < 0 || value > SessionContract.MaximumRevision)
            throw new JsonException("projection group generation is invalid");
        if (!withEdges) return;
        var edges = Array(group.GetProperty("edges"), 2000, "projection edges");
        foreach (var edge in edges)
        {
            Object(edge, "projection edge", "memberIndex", "curveType", "firstParameter", "lastParameter", "closed", "pointsMm");
            var member = edge.GetProperty("memberIndex");
            if (member.ValueKind != JsonValueKind.Number || !member.TryGetInt64(out var memberIndex) || memberIndex < 0)
                throw new JsonException("projection memberIndex is invalid");
            EnumString(edge.GetProperty("curveType"), CurveTypes, "projection curveType");
            FiniteNumber(edge.GetProperty("firstParameter"), "firstParameter");
            FiniteNumber(edge.GetProperty("lastParameter"), "lastParameter");
            if (edge.GetProperty("closed").ValueKind is not (JsonValueKind.True or JsonValueKind.False)) throw new JsonException("projection closed must be boolean");
            foreach (var point in Array(edge.GetProperty("pointsMm"), 129, "projection points", min: 2)) Triple(point, "projection point");
        }
    }

    private static void ValidateDefinition(JsonElement definition)
    {
        Object(definition, "projection definition", "version", "operation", "sources");
        var version = definition.GetProperty("version");
        if (version.ValueKind != JsonValueKind.Number || !version.TryGetInt32(out var number) || number != 1)
            throw new JsonException("projection definition version must be 1");
        var operation = NonEmptyString(definition.GetProperty("operation"), "projection operation");
        if (operation is not ("projectEdges" or "silhouette" or "section")) throw new JsonException("projection operation is unsupported");
        var sources = Array(definition.GetProperty("sources"), 128, "projection sources", min: 1);
        var identities = new HashSet<string>(StringComparer.Ordinal);
        var shapeCount = 0;
        foreach (var source in sources)
        {
            if (source.ValueKind != JsonValueKind.Object || !source.TryGetProperty("type", out var sourceType))
                throw new JsonException("projection source type is missing");
            var kind = NonEmptyString(sourceType, "projection source type");
            if (kind == "edge")
            {
                Object(source, "edge source", "type", "featureId", "persistentEdgeId");
                var owner = StableId(source.GetProperty("featureId"), "projection source featureId");
                var id = BoundedId(source.GetProperty("persistentEdgeId"), "persistentEdgeId");
                if (!id.StartsWith(owner + ":", StringComparison.Ordinal)) throw new JsonException("projection edge id is not owner-qualified");
                if (!identities.Add($"edge\0{owner}\0{id}")) throw new JsonException("duplicate projection source");
            }
            else if (kind == "sketchEntities")
            {
                Object(source, "sketch entity source", "type", "featureId", "entityIds");
                var owner = StableId(source.GetProperty("featureId"), "projection source featureId");
                var entityIds = Array(source.GetProperty("entityIds"), 128, "entityIds", min: 1);
                var names = new HashSet<string>(StringComparer.Ordinal);
                var values = new List<string>(entityIds.Length);
                foreach (var entityId in entityIds)
                {
                    var id = BoundedId(entityId, "entityId");
                    if (!names.Add(id)) throw new JsonException("projection entityIds must be unique");
                    values.Add(id);
                }
                var identity = JsonSerializer.Serialize(values, Utf8Json);
                if (!identities.Add($"sketchEntities\0{owner}\0{identity}")) throw new JsonException("duplicate projection source");
            }
            else if (kind == "shape")
            {
                Object(source, "shape source", "type", "featureId");
                var owner = StableId(source.GetProperty("featureId"), "projection source featureId");
                shapeCount++;
                if (!identities.Add($"shape\0{owner}")) throw new JsonException("duplicate projection source");
            }
            else throw new JsonException("projection source type is unsupported");
        }
        if ((operation == "projectEdges" && shapeCount != 0) ||
            (operation != "projectEdges" && (shapeCount != 1 || sources.Length != 1)))
            throw new JsonException("projection source kind does not match operation");
        if (JsonSerializer.SerializeToUtf8Bytes(definition, Utf8Json).Length > MaxDefinitionUtf8Bytes)
            throw new JsonException("projection definition exceeds 65536 UTF-8 bytes");
    }

    private static string StableId(JsonElement value, string name)
    {
        var text = String(value, name);
        if (text.Length is < 1 or > 128 || text.Any(character => !(character is >= 'A' and <= 'Z' or >= 'a' and <= 'z' or >= '0' and <= '9' or '_' or '-')))
            throw new JsonException($"{name} is not a stable feature id");
        return text;
    }

    private static string BoundedId(JsonElement value, string name)
    {
        var text = String(value, name);
        if (text.Length == 0 || Encoding.UTF8.GetByteCount(text) > MaxIdUtf8Bytes)
            throw new JsonException($"{name} exceeds 512 UTF-8 bytes");
        return text;
    }

    private static void StableIds(IReadOnlyList<JsonElement> values, string name)
    {
        foreach (var value in values) StableId(value, name);
    }

    private static void StableIds(JsonElement values, string name) =>
        StableIds(Array(values, 65536, name), name);

    private static string String(JsonElement value, string name) => value.ValueKind == JsonValueKind.String
        ? value.GetString()! : throw new JsonException($"{name} must be a string");

    private static string NonEmptyString(JsonElement value, string name)
    {
        var text = String(value, name);
        return text.Length > 0 ? text : throw new JsonException($"{name} must not be empty");
    }

    private static void EnumString(JsonElement value, IReadOnlyCollection<string> allowed, string name)
    {
        var text = String(value, name);
        if (!allowed.Contains(text, StringComparer.Ordinal)) throw new JsonException($"{name} is unsupported");
    }

    private static JsonElement[] Array(JsonElement value, int max, string name, int min = 0)
    {
        if (value.ValueKind != JsonValueKind.Array || value.GetArrayLength() < min || value.GetArrayLength() > max)
            throw new JsonException($"{name} is outside limits");
        return value.EnumerateArray().ToArray();
    }

    private static void Object(JsonElement value, string name, params string[] allowed)
    {
        if (value.ValueKind != JsonValueKind.Object) throw new JsonException($"{name} must be an object");
        var set = allowed.ToHashSet(StringComparer.Ordinal);
        if (value.EnumerateObject().Any(property => !set.Contains(property.Name)) || allowed.Any(field => !value.TryGetProperty(field, out _)))
            throw new JsonException($"{name} has missing or unknown fields");
    }

    private static void Triple(JsonElement value, string name)
    {
        var values = Array(value, 3, name, min: 3);
        if (values.Length != 3) throw new JsonException($"{name} must contain three coordinates");
        foreach (var coordinate in values) FiniteNumber(coordinate, name);
    }

    private static void FiniteNumber(JsonElement value, string name)
    {
        if (value.ValueKind != JsonValueKind.Number || !value.TryGetDouble(out var number) || !double.IsFinite(number))
            throw new JsonException($"{name} must be finite");
    }
}
