// Public convenience records preserve the existing API while serializing
// generated control DTOs. Contract metadata is SessionMethods.g.cs.
using System.Text.Json;
using Kreoda.Session.Generated;
namespace Kreoda.Session;

internal static class GeneratedControl
{
    internal static T Read<T>(JsonElement raw, string schemaName)
    {
        foreach (var field in SessionContract.DtoRequiredFields[schemaName])
            if (!raw.TryGetProperty(field, out _)) throw new JsonException("missing " + field);
        try { return raw.Deserialize<T>(Converter.Settings) ?? throw new JsonException("null control DTO"); }
        // quicktype's standard constraint converters throw plain Exception
        // for invalid enum/length values. Normalize that transport failure.
        catch (Exception error) when (error.GetType() == typeof(Exception) || error is NullReferenceException)
        { throw new JsonException("invalid control DTO", error); }
    }

    internal static Dictionary<string, object?> Parameters(object value) =>
        JsonSerializer.SerializeToElement(value, Converter.Settings).EnumerateObject()
            .ToDictionary(property => property.Name, property => (object?)property.Value.Clone());

    internal static Dictionary<string, object> Fields(IDictionary<string, object?> fields) =>
        fields.ToDictionary(pair => pair.Key, pair => pair.Value!);

    internal static long? Revision(double? value)
    {
        if (!value.HasValue) return null;
        if (!double.IsFinite(value.Value) || value.Value < 0 || value.Value > SessionContract.MaximumRevision || Math.Truncate(value.Value) != value.Value)
            throw new SessionException("BAD_PARAMS", "baseRevision must be a nonnegative safe integer");
        return (long)value.Value;
    }
}

public sealed record InvokeRequest(int Type, IDictionary<string, object?> Fields,
    string DocumentId = "doc-phase1", double? BaseRevision = null, string? TransactionId = null)
{
    public Dictionary<string, object?> ToDictionary() => GeneratedControl.Parameters(new InvokeParams
    {
        Type = Type, Fields = GeneratedControl.Fields(Fields), DocumentId = DocumentId,
        BaseRevision = GeneratedControl.Revision(BaseRevision), TransactionId = TransactionId,
    });
}

public sealed record TxnRequest(string TransactionId, string DocumentId = "doc-phase1")
{
    public Dictionary<string, object?> ToDictionary() => GeneratedControl.Parameters(new TxnParams
        { TransactionId = TransactionId, DocumentId = DocumentId });
}
