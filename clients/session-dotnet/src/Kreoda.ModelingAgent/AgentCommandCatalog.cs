using System.Collections.ObjectModel;
using System.Text.Json;
using Kreoda.Session;

namespace Kreoda.ModelingAgent;

public sealed record AgentCommand(string Id, string Description, JsonElement Parameters, AgentCreationRule Creation)
{
    public int CreatedFeatureCount(JsonElement arguments) => Creation.Count(arguments);
}

public sealed record AgentCreationRule(int? FixedCount, string? IdArrayParameter)
{
    public int Count(JsonElement arguments)
    {
        if (arguments.ValueKind != JsonValueKind.Object) throw new ArgumentException("Command arguments must be an object");
        if (FixedCount.HasValue) return FixedCount.Value;
        if (!arguments.TryGetProperty(IdArrayParameter!, out var ids) || ids.ValueKind != JsonValueKind.Array ||
            ids.GetArrayLength() is < 1 or > 128)
            throw new ArgumentException("Creation ID array is missing or outside limits");
        var unique = new HashSet<string>(StringComparer.Ordinal);
        foreach (var element in ids.EnumerateArray())
        {
            if (element.ValueKind != JsonValueKind.String || !ValidFeatureId(element.GetString()!) || !unique.Add(element.GetString()!))
                throw new ArgumentException("Creation IDs must be unique stable feature IDs");
        }
        return ids.GetArrayLength();
    }

    static bool ValidFeatureId(string id) => id.Length is >= 1 and <= 128 &&
        id.All(c => char.IsAsciiLetterOrDigit(c) || c is '_' or '-');
}

/// <summary>Execution definitions come from the authenticated PC registry. This is not a second registry.</summary>
public sealed class AgentCommandCatalog
{
    readonly IReadOnlyDictionary<string, AgentCommand> _commands;
    public IReadOnlyCollection<AgentCommand> Commands { get; }
    AgentCommandCatalog(Dictionary<string, AgentCommand> commands)
    {
        _commands = new ReadOnlyDictionary<string, AgentCommand>(commands);
        Commands = Array.AsReadOnly(commands.Values.ToArray());
    }
    public AgentCommand Require(string id) => _commands.TryGetValue(id, out var command)
        ? command : throw new ArgumentException("Command is absent from the current PC catalog: " + id);

    public static async Task<AgentCommandCatalog> LoadAsync(SessionClient client, CancellationToken ct = default)
    {
        var reply = await client.CallAsync(SessionMethods.GetCommandSchema, new Dictionary<string, object?>(), ct);
        return FromReply(reply.GetProperty("result"));
    }
    public static AgentCommandCatalog FromReply(JsonElement reply)
    {
        if (reply.ValueKind != JsonValueKind.Object || reply.GetRawText().Length > 1048576 ||
            !reply.TryGetProperty("commands", out var definitions) || definitions.ValueKind != JsonValueKind.Array ||
            definitions.GetArrayLength() is < 1 or > 128) throw new ArgumentException("Invalid PC command catalog");
        var commands = new Dictionary<string, AgentCommand>(StringComparer.Ordinal);
        foreach (var definition in definitions.EnumerateArray()) {
            if (definition.ValueKind != JsonValueKind.Object || !definition.TryGetProperty("id", out var name) ||
                name.ValueKind != JsonValueKind.String || !definition.TryGetProperty("nativeType", out var native) ||
                native.ValueKind != JsonValueKind.Number || !native.TryGetInt32(out var type) || type is < 1 or > 65535 ||
                !definition.TryGetProperty("parameters", out var schema) || schema.ValueKind != JsonValueKind.Object ||
                !schema.TryGetProperty("type", out var schemaType) || schemaType.ValueKind != JsonValueKind.String || schemaType.GetString() != "object")
                throw new ArgumentException("Invalid PC command definition");
            var id = name.GetString()!;
            if (id.Length is < 1 or > 128 || id.Any(c => !char.IsAsciiLetterOrDigit(c) && c != '_'))
                throw new ArgumentException("Invalid command name");
            // History is owned by the high-level transaction, not a model tool.
            if (type is 8 or 9 || id is "Undo" or "Redo") continue;
            var description = definition.TryGetProperty("description", out var text) && text.ValueKind == JsonValueKind.String
                ? text.GetString()! : id;
            var creation = ReadCreation(definition, schema);
            if (description.Length > 4096 || !commands.TryAdd(id, new(id, description, schema.Clone(), creation)))
                throw new ArgumentException("Invalid or duplicate PC command definition");
        }
        if (commands.Count == 0) throw new ArgumentException("No modeling commands available");
        return new(commands);
    }

    static AgentCreationRule ReadCreation(JsonElement definition, JsonElement parameters)
    {
        if (!definition.TryGetProperty("creation", out var creation) || creation.ValueKind != JsonValueKind.Object)
            throw new ArgumentException("Missing command creation metadata");
        var fields = creation.EnumerateObject().ToArray();
        if (fields.Length != 1) throw new ArgumentException("Invalid command creation metadata");
        if (fields[0].NameEquals("fixedCount") && fields[0].Value.ValueKind == JsonValueKind.Number &&
            fields[0].Value.TryGetInt32(out var count) && count is >= 0 and <= 128)
            return new(count, null);
        if (fields[0].NameEquals("idArrayParameter") && fields[0].Value.ValueKind == JsonValueKind.String)
        {
            var name = fields[0].Value.GetString();
            if (string.IsNullOrEmpty(name) || name.Length > 128 ||
                !parameters.TryGetProperty("properties", out var properties) || properties.ValueKind != JsonValueKind.Object ||
                !properties.TryGetProperty(name, out var item) || item.ValueKind != JsonValueKind.Object ||
                !item.TryGetProperty("type", out var type) || type.ValueKind != JsonValueKind.String || type.GetString() != "array" ||
                !item.TryGetProperty("items", out var items) || items.ValueKind != JsonValueKind.Object ||
                !items.TryGetProperty("type", out var itemType) || itemType.ValueKind != JsonValueKind.String || itemType.GetString() != "string")
                throw new ArgumentException("Invalid command creation ID array metadata");
            return new(null, name);
        }
        throw new ArgumentException("Invalid command creation metadata");
    }

    // Permission allowlist only. Query implementations and schemas remain on the PC.
    public static bool IsReadOnlyQuery(string method) => method is
        SessionMethods.DescribeModel or SessionMethods.GetDocumentInfo or SessionMethods.GetBodies or
        SessionMethods.GetFeatures or SessionMethods.GetFeature or SessionMethods.GetDatum or SessionMethods.GetParameters or
        SessionMethods.GetDependencies or SessionMethods.GetModelTree or SessionMethods.GetSelection or
        SessionMethods.ListCommands or SessionMethods.GetCommandSchema or SessionMethods.GetManipulators or
        SessionMethods.FindFaces or SessionMethods.FindEdges or SessionMethods.FindBodies or
        SessionMethods.GetBoundingBox or SessionMethods.MeasureVolume or SessionMethods.MeasureArea or
        SessionMethods.MeasureDistance or SessionMethods.MeasureAngle or SessionMethods.MeasureRadius or
        SessionMethods.MeasureDiameter or SessionMethods.ValidateDocument or SessionMethods.ValidateBody or
        SessionMethods.ValidateFeature or SessionMethods.ValidateReferences;
}
