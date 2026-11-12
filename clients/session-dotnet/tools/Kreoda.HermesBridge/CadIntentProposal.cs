using System.Text.Json;
using System.Text.Json.Serialization;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using Kreoda.ModelingAgent;

namespace Kreoda.HermesBridge;

internal enum CadIntentKind
{
    MountingBlank = 1,
    LBracket,
    UBracket,
    OpenEnclosure,
    ConnectParallelPlates,
    InferHoles,
    InferSketchConstraints,
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record CadIntentContext
{
    [JsonRequired]
    public required string? SessionId { get; init; }

    [JsonRequired]
    public required string? DocumentId { get; init; }

    [JsonRequired]
    public required long Revision { get; init; }

    public GeneratedCadSelectionFence ToSelectionFence()
    {
        if (string.IsNullOrWhiteSpace(SessionId) || SessionId.Length > 128 ||
            string.IsNullOrWhiteSpace(DocumentId) || DocumentId.Length > 128 || Revision < 0)
            throw new ArgumentException("Expected context requires bounded session/document identities and a nonnegative revision");
        return new(SessionId, DocumentId, Revision);
    }

    public static CadIntentContext From(GeneratedCadSelectionFence fence) => new() {
        SessionId = fence.SessionId,
        DocumentId = fence.DocumentId,
        Revision = fence.Revision,
    };
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record CadIntentDimensions
{
    public double? WidthMm { get; init; }
    public double? DepthMm { get; init; }
    public double? HeightMm { get; init; }
    public double? ThicknessMm { get; init; }
    public double? WallMm { get; init; }
    public double? SeparationMm { get; init; }
    public double? SupportWidthMm { get; init; }
    public double? SupportThicknessMm { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record CadIntentRequest
{
    [JsonRequired]
    [AllowedValues("mountingBlank", "lBracket", "uBracket", "openEnclosure", "connectParallelPlates", "inferHoles", "inferSketchConstraints")]
    [Description("Intent kind: mountingBlank, lBracket, uBracket, openEnclosure, connectParallelPlates, inferHoles, or inferSketchConstraints.")]
    public required string Kind { get; init; }

    [JsonRequired]
    public required CadIntentContext? ExpectedContext { get; init; }

    public CadIntentDimensions? Dimensions { get; init; }
    public string? TargetId { get; init; }
    public string? FaceRole { get; init; }
    public string? SketchId { get; init; }

    internal CadIntentKind IntentKind => Kind switch {
        "mountingBlank" => CadIntentKind.MountingBlank,
        "lBracket" => CadIntentKind.LBracket,
        "uBracket" => CadIntentKind.UBracket,
        "openEnclosure" => CadIntentKind.OpenEnclosure,
        "connectParallelPlates" => CadIntentKind.ConnectParallelPlates,
        "inferHoles" => CadIntentKind.InferHoles,
        "inferSketchConstraints" => CadIntentKind.InferSketchConstraints,
        _ => throw new ArgumentException("Unknown intent kind"),
    };

    internal GeneratedCadSelectionFence Validate()
    {
        var kind = IntentKind;
        var fence = ExpectedContext?.ToSelectionFence() ??
            throw new ArgumentException("An expected session/document/revision context is required");
        var dimensionNames = kind switch {
            CadIntentKind.MountingBlank => new[] { "widthMm", "depthMm", "thicknessMm" },
            CadIntentKind.LBracket or CadIntentKind.UBracket => new[] { "widthMm", "depthMm", "heightMm", "thicknessMm" },
            CadIntentKind.OpenEnclosure => new[] { "widthMm", "depthMm", "heightMm", "wallMm" },
            CadIntentKind.ConnectParallelPlates => new[] { "separationMm", "supportWidthMm", "supportThicknessMm" },
            CadIntentKind.InferHoles or CadIntentKind.InferSketchConstraints => Array.Empty<string>(),
            _ => throw new ArgumentException("Unknown intent kind"),
        };

        if (dimensionNames.Length == 0) {
            if (Dimensions is not null) throw new ArgumentException("Inference intents do not accept dimensions");
        } else {
            if (Dimensions is null) throw new ArgumentException("Intent dimensions are required");
            var values = new Dictionary<string, double?> {
                ["widthMm"] = Dimensions.WidthMm,
                ["depthMm"] = Dimensions.DepthMm,
                ["heightMm"] = Dimensions.HeightMm,
                ["thicknessMm"] = Dimensions.ThicknessMm,
                ["wallMm"] = Dimensions.WallMm,
                ["separationMm"] = Dimensions.SeparationMm,
                ["supportWidthMm"] = Dimensions.SupportWidthMm,
                ["supportThicknessMm"] = Dimensions.SupportThicknessMm,
            };
            foreach (var (name, value) in values) {
                if (dimensionNames.Contains(name, StringComparer.Ordinal)) {
                    if (value is not double number || !double.IsFinite(number) || number <= 0 || number > 100000)
                        throw new ArgumentException($"A finite positive {name} dimension in millimetres is required");
                } else if (value.HasValue) {
                    throw new ArgumentException($"Dimension {name} is irrelevant to this intent");
                }
            }
        }

        switch (kind) {
            case CadIntentKind.InferHoles:
                RequireIdentity(TargetId, nameof(TargetId));RequireIdentity(FaceRole, nameof(FaceRole));
                if (SketchId is not null) throw new ArgumentException("Hole inference does not accept a sketch identity");
                break;
            case CadIntentKind.InferSketchConstraints:
                RequireIdentity(SketchId, nameof(SketchId));
                if (TargetId is not null || FaceRole is not null)
                    throw new ArgumentException("Sketch inference does not accept a target or face role");
                break;
            default:
                if (TargetId is not null || FaceRole is not null || SketchId is not null)
                    throw new ArgumentException("Geometric intents do not accept inference identities");
                break;
        }
        return fence;
    }

    static void RequireIdentity(string? value, string name)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 128)
            throw new ArgumentException($"A bounded {name} is required");
    }
}
