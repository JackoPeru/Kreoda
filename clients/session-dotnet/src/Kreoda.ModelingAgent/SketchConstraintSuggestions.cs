using System.Text.Json;

namespace Kreoda.ModelingAgent;

public sealed record SketchConstraintSuggestion(string Kind, string Explanation, string[] References,
    GeneratedCadOption? AcceptedCommand)
{
    public bool CanAccept => AcceptedCommand is not null;
}

/// <summary>Read-only deterministic suggestions from an authoritative semantic sketch model.</summary>
public static class SketchConstraintSuggestions
{
    public static IReadOnlyList<SketchConstraintSuggestion> Infer(string sketchId, JsonElement model,
        AgentCommandCatalog catalog, double toleranceMm = .01,
        GeneratedCadSelectionFence? selectionFence = null)
    {
        if (!AgentCreationRule.ValidFeatureId(sketchId) || model.ValueKind != JsonValueKind.Object || catalog is null ||
            !double.IsFinite(toleranceMm) || toleranceMm <= 0 || toleranceMm > 1)
            throw new ArgumentException("Invalid semantic sketch input");
        var points = Read(model, "points").ToDictionary(p => Id(p), p =>
            (X: Number(p, "x"), Y: Number(p, "y")), StringComparer.Ordinal);
        var lines = Read(model, "lines").Select(l => new { Id = Id(l), P1 = l.GetProperty("p1").GetString()!, P2 = l.GetProperty("p2").GetString()! }).ToArray();
        var circles = Read(model, "circles").Select(c => new { Id = Id(c), Center = c.GetProperty("center").GetString()!, Radius = Number(c, "r") }).ToArray();
        var constraints = Read(model, "constraints").Select(c => new { Kind = c.GetProperty("kind").GetString(),
            Refs = ReadRefs(c).ToArray() }).ToArray();
        if (points.Values.Any(p => !double.IsFinite(p.X) || !double.IsFinite(p.Y)) ||
            lines.Any(l => !points.ContainsKey(l.P1) || !points.ContainsKey(l.P2)) ||
            circles.Any(c => !points.ContainsKey(c.Center) || c.Radius <= 0)) throw new ArgumentException("Broken semantic references");
        var proposed = new List<SketchConstraintSuggestion>();
        void Suggest(string kind, string[] refs, string explanation)
        {
            if (constraints.Any(c => c.Kind == kind && c.Refs.Order(StringComparer.Ordinal).SequenceEqual(refs.Order(StringComparer.Ordinal)))) return;
            // UpdateSketch is a full-model replacement, not an append-only relation tool.
            // Construct an immutable replacement with all existing entities preserved.
            GeneratedCadOption? command = null;
            try {
                var definition = catalog.Require("UpdateSketch");
                if (kind is "parallel" or "perpendicular" or "equalRadius" or "symmetric" && definition.Creation.FixedCount == 0 && definition.Parameters.TryGetProperty("properties", out var properties) &&
                    properties.TryGetProperty("featureId", out _) && properties.TryGetProperty("model", out _)) {
                    var next = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(model.GetRawText())!;
                    var previous = Read(model, "constraints").Select(c => c.Clone()).ToList();
                    previous.Add(JsonSerializer.SerializeToElement(new { id = "suggested-" + Guid.NewGuid().ToString("N"), kind, refs, value = 0d }));
                    next["constraints"] = JsonSerializer.SerializeToElement(previous);
                    command = new GeneratedCadOption(kind + "-constraint", explanation, [new GeneratedCadStep("UpdateSketch",
                        JsonSerializer.SerializeToElement(new { featureId = sketchId, model = next }), explanation)],selectionFence);
                }
            } catch (ArgumentException) { /* No canonical edit mechanism. */ }
            proposed.Add(new(kind, explanation, refs, command));
        }
        for (var i = 0; i < lines.Length; i++) for (var j = i + 1; j < lines.Length; j++) {
            var a = lines[i];var b = lines[j];
            var pa = points[a.P1];var qa = points[a.P2];var pb = points[b.P1];var qb = points[b.P2];
            var ax = qa.X-pa.X;var ay = qa.Y-pa.Y;var bx = qb.X-pb.X;var by = qb.Y-pb.Y;
            var la = Math.Sqrt(ax*ax+ay*ay);var lb = Math.Sqrt(bx*bx+by*by);
            if (la <= toleranceMm || lb <= toleranceMm) continue;
            var refs = new[] { a.Id, b.Id };
            if (Math.Abs(ax*by-ay*bx)/(la*lb) <= toleranceMm/Math.Max(la,lb)) Suggest("parallel", refs, "Selected lines have parallel directions");
            if (Math.Abs(ax*bx+ay*by)/(la*lb) <= toleranceMm/Math.Max(la,lb)) Suggest("perpendicular", refs, "Selected lines meet at a right angle in direction");
            if (Math.Abs(la-lb) <= toleranceMm) Suggest("equal-length", refs, "Selected lines have equal measured length; no canonical equal-length constraint exists");
        }
        for (var i = 0; i < circles.Length; i++) for (var j = i+1; j < circles.Length; j++)
            if (Math.Abs(circles[i].Radius-circles[j].Radius) <= toleranceMm)
                Suggest("equalRadius", [circles[i].Id, circles[j].Id], "Selected circles have equal radii");
        foreach (var line in lines) {
            var a = points[line.P1];var b = points[line.P2];
            foreach (var point in points) {
                if (point.Key == line.P1 || point.Key == line.P2) continue;
                if (Math.Abs(point.Value.X - (a.X+b.X)/2) <= toleranceMm &&
                    Math.Abs(point.Value.Y - (a.Y+b.Y)/2) <= toleranceMm)
                    Suggest("midpoint", [point.Key, line.Id], "Point lies at the measured midpoint; no canonical midpoint constraint exists");
            }
        }
        // Exact persisted symmetric relation: two points reflected across a selected
        // line. Do not guess between multiple eligible axes for the same pair.
        var pointList=points.OrderBy(p=>p.Key,StringComparer.Ordinal).ToArray();
        for(var i=0;i<pointList.Length;i++) for(var j=i+1;j<pointList.Length;j++) {
            var first=pointList[i];var second=pointList[j];
            var possible=new List<string>();
            foreach(var axis in lines) {
                if(axis.P1==first.Key || axis.P2==first.Key || axis.P1==second.Key || axis.P2==second.Key) continue;
                var p=points[axis.P1];var q=points[axis.P2];
                var dx=q.X-p.X;var dy=q.Y-p.Y;var length=Math.Sqrt(dx*dx+dy*dy);
                if(length<=toleranceMm) continue;
                var mx=(first.Value.X+second.Value.X)/2-p.X;
                var my=(first.Value.Y+second.Value.Y)/2-p.Y;
                var separation=Math.Sqrt(Math.Pow(first.Value.X-second.Value.X,2)+Math.Pow(first.Value.Y-second.Value.Y,2));
                if(separation<=toleranceMm) continue;
                var midpointOffset=Math.Abs(mx*dy-my*dx)/length;
                var parallelProjection=Math.Abs((first.Value.X-second.Value.X)*dx+(first.Value.Y-second.Value.Y)*dy)/length;
                if(midpointOffset<=toleranceMm && parallelProjection<=toleranceMm) possible.Add(axis.Id);
            }
            if(possible.Count==1) Suggest("symmetric",[first.Key,second.Key,possible[0]],
                "Points have mirrored coordinates across the uniquely determined sketch axis; persist a symmetric relation");
            else if(possible.Count>1) proposed.Add(new("symmetric-ambiguous",
                "Multiple sketch axes fit this mirrored point pair; select one axis explicitly",[first.Key,second.Key],null));
        }
        return proposed.AsReadOnly();
    }

    static JsonElement[] Read(JsonElement value, string name) => value.TryGetProperty(name, out var elements) && elements.ValueKind == JsonValueKind.Array
        ? elements.EnumerateArray().Select(e => e.Clone()).ToArray() : throw new ArgumentException("Missing semantic sketch array " + name);
    static string Id(JsonElement value) => value.GetProperty("id").GetString() ?? throw new ArgumentException("Missing semantic identity");
    static double Number(JsonElement value, string name) { var n = value.GetProperty(name).GetDouble();if (!double.IsFinite(n)) throw new ArgumentException("Nonfinite geometry");return n; }
    static IEnumerable<string> ReadRefs(JsonElement constraint) => Read(constraint, "refs").Select(r => r.GetString()!);
}
