using System.Text.Json;

namespace Kreoda.ModelingAgent;

/// <summary>Explicit, editable native-command options for functional CAD requests.</summary>
public sealed record GeneratedCadStep(string CommandId, JsonElement Parameters, string Rationale, string? Alias = null);
public sealed record GeneratedCadSelectionFence(string SessionId, string DocumentId, long Revision);
public sealed record GeneratedCadOption(string Id, string Description, IReadOnlyList<GeneratedCadStep> Steps,
    GeneratedCadSelectionFence? SelectionFence = null);

public static class GenerativeIntent
{
    /// <summary>Offer alternatives without choosing a structural solution on behalf of the user.</summary>
    public static IReadOnlyList<GeneratedCadOption> ConnectParallelPlates(double separationMm,
        double supportWidthMm, double supportThicknessMm, AgentCommandCatalog catalog)
    {
        Positive(separationMm, nameof(separationMm));
        Positive(supportWidthMm, nameof(supportWidthMm));
        Positive(supportThicknessMm, nameof(supportThicknessMm));
        if (supportThicknessMm >= separationMm)
            throw new ArgumentOutOfRangeException(nameof(supportThicknessMm), "Support thickness must be smaller than the gap");

        var options = new List<GeneratedCadOption>();
        if (Supports(catalog, "CreateCylinder", "radiusMm", "heightMm"))
            options.Add(new("round-spacer", "Cylindrical spacer; connection strength and attachment require engineering review",
                [Step("CreateCylinder", new { radiusMm = supportWidthMm / 2, heightMm = separationMm },
                    "A cylindrical spacer spans the specified separation") ]));
        if (Supports(catalog, "CreateBox", "widthMm", "heightMm", "depthMm"))
            options.Add(new("rectangular-spacer", "Rectangular spacer; connection strength and attachment require engineering review",
                [Step("CreateBox", new { widthMm = supportWidthMm, heightMm = separationMm, depthMm = supportThicknessMm },
                    "A rectangular spacer spans the specified separation") ]));
        return options.AsReadOnly();
    }

    public static GeneratedCadOption MountingBlank(double widthMm, double depthMm, double thicknessMm,
        AgentCommandCatalog catalog)
    {
        Positive(widthMm, nameof(widthMm));Positive(depthMm, nameof(depthMm));Positive(thicknessMm, nameof(thicknessMm));
        if (!Supports(catalog, "CreateBox", "widthMm", "heightMm", "depthMm"))
            throw new ArgumentException("Current PC catalog cannot create an editable mounting blank", nameof(catalog));
        return new("mounting-blank", "Editable plate blank; mounting holes must be specified separately",
            [Step("CreateBox", new { widthMm, heightMm = depthMm, depthMm = thicknessMm },
                "The native parametric box defines the plate dimensions")]);
    }

    public static GeneratedCadOption Bracket(string shape, double widthMm, double depthMm,
        double heightMm, double thicknessMm, AgentCommandCatalog catalog)
    {
        if (shape is not ("L" or "U")) throw new ArgumentException("Supported bracket shapes are L and U", nameof(shape));
        Positive(widthMm, nameof(widthMm));Positive(depthMm, nameof(depthMm));
        Positive(heightMm, nameof(heightMm));Positive(thicknessMm, nameof(thicknessMm));
        if (heightMm <= thicknessMm || widthMm <= (shape == "U" ? 2 : 1) * thicknessMm)
            throw new ArgumentOutOfRangeException(nameof(thicknessMm), "Bracket walls require positive clear space");
        if ((!Supports(catalog, "CreateBox", "widthMm", "heightMm", "depthMm") ||
            !HasOrigin(catalog) || !SupportsBoolean(catalog)) && SupportsProfile(catalog))
            return ProfileBracket(shape, widthMm, depthMm, heightMm, thicknessMm);
        if (!Supports(catalog, "CreateBox", "widthMm", "heightMm", "depthMm") ||
            !HasOrigin(catalog) || !SupportsBoolean(catalog))
            throw new ArgumentException("Canonical origin-enabled boxes or sketch/extrude are required", nameof(catalog));
        var steps = new List<GeneratedCadStep> {
            new("CreateBox", JsonSerializer.SerializeToElement(new { widthMm, heightMm = depthMm, depthMm = thicknessMm,
                origin = new { x = 0d, y = 0d, z = 0d } }), "Editable horizontal base", "base"),
            new("CreateBox", JsonSerializer.SerializeToElement(new { widthMm = thicknessMm, heightMm = depthMm,
                depthMm = heightMm - thicknessMm, origin = new { x = 0d, y = 0d, z = thicknessMm } }),
                "Editable left upright", "left"),
            new("CreateBoolean", JsonSerializer.SerializeToElement(new { op = "fuse", targetId = "$base", toolId = "$left" }),
                "Union of the base and left upright", "combined"),
        };
        if (shape == "U") {
            steps.Add(new("CreateBox", JsonSerializer.SerializeToElement(new { widthMm = thicknessMm, heightMm = depthMm,
                depthMm = heightMm - thicknessMm, origin = new { x = widthMm - thicknessMm, y = 0d, z = thicknessMm } }),
                "Editable right upright", "right"));
            steps.Add(new("CreateBoolean", JsonSerializer.SerializeToElement(new { op = "fuse", targetId = "$combined", toolId = "$right" }),
                "Final union preserves individual editable source features", "result"));
        }
        return new($"{shape.ToLowerInvariant()}-bracket", $"Editable {shape}-bracket, {widthMm} × {depthMm} × {heightMm} mm",
            steps.AsReadOnly());
    }

    static bool SupportsProfile(AgentCommandCatalog catalog)
    {
        try {
            var sketch = catalog.Require("CreateSketch");var extrusion = catalog.Require("CreateExtrude");
            return sketch.Creation.FixedCount == 1 && extrusion.Creation.FixedCount == 1 &&
                sketch.Parameters.GetProperty("properties").TryGetProperty("model", out _) &&
                extrusion.Parameters.GetProperty("properties").TryGetProperty("sketchId", out _) &&
                extrusion.Parameters.GetProperty("properties").TryGetProperty("distanceMm", out _);
        } catch (Exception ex) when (ex is ArgumentException or KeyNotFoundException or InvalidOperationException) { return false; }
    }

    static GeneratedCadOption ProfileBracket(string shape, double width, double depth, double height, double thickness)
    {
        (double x,double y)[] outline = shape == "L" ?
            [(0,0),(width,0),(width,thickness),(thickness,thickness),(thickness,height),(0,height)] :
            [(0,0),(width,0),(width,height),(width-thickness,height),(width-thickness,thickness),
             (thickness,thickness),(thickness,height),(0,height)];
        var points = outline.Select((p,i) => new { id=$"p{i}", x=p.x, y=p.y, @fixed=false }).ToArray();
        var lines = outline.Select((p,i) => new { id=$"l{i}", p1=$"p{i}", p2=$"p{(i+1)%outline.Length}" }).ToArray();
        var model = new { points, lines, circles=Array.Empty<object>(), arcs=Array.Empty<object>(), constraints=Array.Empty<object>() };
        return new($"{shape.ToLowerInvariant()}-bracket", $"Editable {shape}-bracket from a closed parametric sketch and extrusion", [
            new("CreateSketch", JsonSerializer.SerializeToElement(new { planeKind="XZ", model }),
                "Closed L/U outline with native sketch points and edges", "profile"),
            new("CreateExtrude", JsonSerializer.SerializeToElement(new { sketchId="$profile", distanceMm=depth }),
                "Single native extrusion creates the bracket solid", "result")]);
    }

    /// <summary>Open-ended parametric rectangular enclosure sleeve (no floor/lid).</summary>
    public static GeneratedCadOption OpenEnclosure(double widthMm, double depthMm, double heightMm,
        double wallMm, AgentCommandCatalog catalog)
    {
        Positive(widthMm,nameof(widthMm));Positive(depthMm,nameof(depthMm));
        Positive(heightMm,nameof(heightMm));Positive(wallMm,nameof(wallMm));
        if (wallMm*2 >= Math.Min(widthMm,depthMm)) throw new ArgumentOutOfRangeException(nameof(wallMm));
        if (!SupportsProfile(catalog) || !SupportsBoolean(catalog))
            throw new ArgumentException("Editable enclosure requires CreateSketch, CreateExtrude and CreateBoolean cut",nameof(catalog));
        object Rectangle(double x0,double y0,double x1,double y1) {
            var corners = new[] {(x0,y0),(x1,y0),(x1,y1),(x0,y1)};
            return new { points=corners.Select((p,i)=>new {id=$"p{i}",x=p.Item1,y=p.Item2,@fixed=false}).ToArray(),
                lines=Enumerable.Range(0,4).Select(i=>new {id=$"l{i}",p1=$"p{i}",p2=$"p{(i+1)%4}"}).ToArray(),
                circles=Array.Empty<object>(),arcs=Array.Empty<object>(),constraints=Array.Empty<object>() };
        }
        return new("open-enclosure", "Editable open-ended enclosure; no floor, lid or mounting holes", [
            new("CreateSketch",JsonSerializer.SerializeToElement(new {planeKind="XY",model=Rectangle(0,0,widthMm,depthMm)}),"Outer footprint","outerSketch"),
            new("CreateExtrude",JsonSerializer.SerializeToElement(new {sketchId="$outerSketch",distanceMm=heightMm}),"Outer editable solid","outer"),
            new("CreateSketch",JsonSerializer.SerializeToElement(new {planeKind="XY",model=Rectangle(wallMm,wallMm,widthMm-wallMm,depthMm-wallMm)}),"Offset cavity footprint","innerSketch"),
            new("CreateExtrude",JsonSerializer.SerializeToElement(new {sketchId="$innerSketch",distanceMm=heightMm}),"Through cavity cutter","cutter"),
            new("CreateBoolean",JsonSerializer.SerializeToElement(new {op="cut",targetId="$outer",toolId="$cutter"}),"Open sleeve with uniform wall thickness","result")
        ]);
    }

    static bool HasOrigin(AgentCommandCatalog catalog) {
        var properties = catalog.Require("CreateBox").Parameters.GetProperty("properties");
        if (!properties.TryGetProperty("origin", out var origin) || origin.ValueKind != JsonValueKind.Object ||
            !origin.TryGetProperty("properties", out var coords) || coords.ValueKind != JsonValueKind.Object) return false;
        return new[] { "x", "y", "z" }.All(axis => coords.TryGetProperty(axis, out var field) &&
            field.TryGetProperty("type", out var type) && type.GetString() == "number");
    }

    static bool SupportsBoolean(AgentCommandCatalog catalog) {
        AgentCommand command;
        try { command = catalog.Require("CreateBoolean"); }
        catch (ArgumentException) { return false; }
        if (command.Creation.FixedCount != 1 || !command.Parameters.TryGetProperty("properties", out var props)) return false;
        return new[] { "op", "targetId", "toolId" }.All(name => props.TryGetProperty(name, out _));
    }

    static GeneratedCadStep Step(string command, object parameters, string rationale) =>
        new(command, JsonSerializer.SerializeToElement(parameters), rationale);

    static bool Supports(AgentCommandCatalog catalog, string commandId, params string[] parameters)
    {
        AgentCommand command;
        try { command = catalog.Require(commandId); }
        catch (ArgumentException) { return false; }
        if (command.Creation.FixedCount != 1 || !command.Parameters.TryGetProperty("properties", out var properties) ||
            properties.ValueKind != JsonValueKind.Object) return false;
        return parameters.All(p => properties.TryGetProperty(p, out var field) && field.ValueKind == JsonValueKind.Object &&
            field.TryGetProperty("type", out var type) && type.ValueKind == JsonValueKind.String && type.GetString() == "number");
    }

    static void Positive(double value, string name)
    {
        if (!double.IsFinite(value) || value <= 0 || value > 100000)
            throw new ArgumentOutOfRangeException(name, "CAD dimensions must be finite positive millimetres");
    }
}
