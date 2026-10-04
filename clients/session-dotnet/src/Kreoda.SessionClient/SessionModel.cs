using System.Text.Json;

namespace Kreoda.Session;

public sealed record SessionEntityChange(string Kind, string Id, int Index, JsonElement Value);
public sealed record SessionIncrementalDelta(
    string Event, string SessionId, string DocumentId, string OriginClientId,
    long BaseRevision, long NewRevision, long Revision,
    SessionEntityChange[] Added, SessionEntityChange[] Updated,
    string[] RemovedIds, string[] ChangedMeshIds, JsonElement[] ReferenceRemaps, JsonElement[] Warnings);
public enum SessionModelUpdateKind { Applied, Duplicate, NeedsSnapshot }
public sealed record SessionModelUpdate(SessionModelUpdateKind Kind, SessionModelState Model, SessionIncrementalDelta? Delta = null);

/// <summary>Ordered semantic entities. Geometry stays in the native mesh transport.</summary>
public sealed record SessionModelState(
    string SessionId, string DocumentId, long Revision,
    IReadOnlyList<JsonElement> Features, IReadOnlyList<JsonElement> Sketches, IReadOnlyList<JsonElement> Bodies)
{
    private const long MaxSafeRevision = SessionContract.MaximumRevision;
    private static readonly string[] Kinds = ["feature", "sketch", "body"];

    public static SessionModelState FromSnapshot(JsonElement raw)
    {
        try
        {
            var snapshot = GeneratedControl.Read<Generated.SessionSnapshotPayload>(raw, "SessionSnapshotPayload");
            var session = snapshot.SessionId;
            var document = snapshot.DocumentId;
            var revision = snapshot.Revision;
            if (string.IsNullOrEmpty(session) || string.IsNullOrEmpty(document) || !ValidRevision(revision))
                throw new JsonException("invalid snapshot lineage or revision");
            var features = ReadCollection(raw.GetProperty("features"), "feature");
            var sketches = ReadCollection(raw.GetProperty("sketches"), "sketch");
            var bodies = ReadCollection(raw.GetProperty("bodies"), "body");
            return new(session, document, revision, features, sketches, bodies);
        }
        catch (Exception error) when (error is JsonException or InvalidOperationException or KeyNotFoundException or FormatException)
        { throw new SessionException("BAD_MODEL", error.Message); }
    }

    public SessionModelUpdate Apply(JsonElement raw)
    {
        var recovery = new SessionModelUpdate(SessionModelUpdateKind.NeedsSnapshot, this);
        try
        {
            if (raw.ValueKind != JsonValueKind.Object || new[] { "features", "sketches", "bodies", "tips" }.Any(key => raw.TryGetProperty(key, out _))) return recovery;
            // Missing numeric fields cannot silently become zero through deserialization.
            foreach (var key in new[] { "baseRevision", "newRevision", "revision" })
                if (!raw.TryGetProperty(key, out var number) || !number.TryGetInt64(out var revision) || !ValidRevision(revision)) return recovery;
            if (raw.GetProperty("event").GetString() != "delta") return recovery;
            var wire = GeneratedControl.Read<Generated.SessionIncrementalEvent>(raw, "SessionIncrementalEvent");
            var delta = new SessionIncrementalDelta("delta", wire.SessionId, wire.DocumentId, wire.OriginClientId,
                wire.BaseRevision, wire.NewRevision, wire.Revision,
                ReadChanges(raw.GetProperty("added")), ReadChanges(raw.GetProperty("updated")),
                wire.RemovedIds, wire.ChangedMeshIds,
                raw.GetProperty("referenceRemaps").EnumerateArray().Select(value => value.Clone()).ToArray(),
                raw.GetProperty("warnings").EnumerateArray().Select(value => value.Clone()).ToArray());
            if (delta is null || delta.Event != "delta" || string.IsNullOrEmpty(delta.SessionId) ||
                string.IsNullOrEmpty(delta.DocumentId) || string.IsNullOrEmpty(delta.OriginClientId) ||
                delta.Revision != delta.NewRevision || delta.NewRevision <= delta.BaseRevision ||
                delta.Added is null || delta.Updated is null || delta.RemovedIds is null || delta.ChangedMeshIds is null ||
                delta.ReferenceRemaps is null || delta.Warnings is null) return recovery;
            if (delta.RemovedIds.Any(string.IsNullOrEmpty) || delta.ChangedMeshIds.Any(string.IsNullOrEmpty) ||
                delta.RemovedIds.Distinct(StringComparer.Ordinal).Count() != delta.RemovedIds.Length) return recovery;
            var identities = new HashSet<(string, string)>();
            var removed = delta.RemovedIds.ToHashSet(StringComparer.Ordinal);
            foreach (var change in delta.Added.Concat(delta.Updated))
                if (change is null || !Kinds.Contains(change.Kind) || string.IsNullOrEmpty(change.Id) || change.Index < 0 ||
                    GetId(change.Value, change.Kind) != change.Id || removed.Contains(change.Id) || !identities.Add((change.Kind, change.Id))) return recovery;
            if (delta.SessionId != SessionId || delta.DocumentId != DocumentId) return recovery;
            if (delta.NewRevision <= Revision) return new(SessionModelUpdateKind.Duplicate, this, delta);
            if (delta.BaseRevision != Revision) return recovery;
            var features = Patch("feature", Features, delta, removed);
            var sketches = Patch("sketch", Sketches, delta, removed);
            var bodies = Patch("body", Bodies, delta, removed);
            if (features is null || sketches is null || bodies is null) return recovery;
            return new(SessionModelUpdateKind.Applied, new(SessionId, DocumentId, delta.NewRevision, features, sketches, bodies), delta);
        }
        catch (Exception error) when (error is JsonException or InvalidOperationException or KeyNotFoundException or FormatException)
        { return recovery; }
    }

    private static bool ValidRevision(long revision) => revision >= 0 && revision <= MaxSafeRevision;
    private static SessionEntityChange[] ReadChanges(JsonElement raw) => raw.EnumerateArray().Select(value =>
    {
        var change = GeneratedControl.Read<Generated.SessionEntityPatch>(value, "SessionEntityPatch");
        if (change.Index < 0 || change.Index > int.MaxValue) throw new JsonException("invalid entity index");
        return new SessionEntityChange(change.Kind.ToString().ToLowerInvariant(), change.Id, (int)change.Index,
            value.GetProperty("value").Clone());
    }).ToArray();
    private static string? GetId(JsonElement entity, string kind)
    {
        if (entity.ValueKind != JsonValueKind.Object || !entity.TryGetProperty(kind == "body" ? "bodyId" : "featureId", out var id) || id.ValueKind != JsonValueKind.String) return null;
        var value = id.GetString();
        return string.IsNullOrEmpty(value) ? null : value;
    }
    private static IReadOnlyList<JsonElement> ReadCollection(JsonElement raw, string kind)
    {
        if (raw.ValueKind != JsonValueKind.Array) throw new JsonException("snapshot collection must be an array");
        var ids = new HashSet<string>(StringComparer.Ordinal);
        var values = raw.EnumerateArray().Select(value => value.Clone()).ToArray();
        foreach (var value in values)
        {
            var id = GetId(value, kind);
            if (id is null || !ids.Add(id)) throw new JsonException("snapshot entity identity is missing or duplicated");
        }
        return Array.AsReadOnly(values);
    }
    private static IReadOnlyList<JsonElement>? Patch(string kind, IReadOnlyList<JsonElement> before, SessionIncrementalDelta delta, HashSet<string> removed)
    {
        var added = delta.Added.Where(change => change.Kind == kind).ToArray();
        var updated = delta.Updated.Where(change => change.Kind == kind).ToArray();
        var prior = before.Select(value => GetId(value, kind)).ToHashSet(StringComparer.Ordinal);
        if (added.Any(change => prior.Contains(change.Id)) || updated.Any(change => !prior.Contains(change.Id))) return null;
        var kept = before.Where(value => !removed.Contains(GetId(value, kind)!)).ToArray();
        var slots = new JsonElement?[kept.Length + added.Length];
        var changed = added.Concat(updated).ToArray();
        foreach (var change in changed)
        {
            if (change.Index >= slots.Length || slots[change.Index].HasValue) return null;
            slots[change.Index] = change.Value.Clone();
        }
        var changedIds = changed.Select(change => change.Id).ToHashSet(StringComparer.Ordinal);
        var cursor = 0;
        foreach (var value in kept.Where(value => !changedIds.Contains(GetId(value, kind)!)))
        {
            while (cursor < slots.Length && slots[cursor].HasValue) cursor++;
            if (cursor >= slots.Length) return null;
            slots[cursor++] = value;
        }
        if (slots.Any(value => !value.HasValue)) return null;
        return Array.AsReadOnly(slots.Select(value => value!.Value).ToArray());
    }
}
