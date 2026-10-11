using System.Collections.ObjectModel;
using System.Text.Json;

namespace Kreoda.QuestFoundation;

public readonly record struct CadVector(double X, double Y, double Z)
{
    public bool IsFinite => double.IsFinite(X) && double.IsFinite(Y) && double.IsFinite(Z);
    public double Length => Math.Sqrt(Dot(this));
    public double Dot(CadVector b) => X * b.X + Y * b.Y + Z * b.Z;
    public CadVector Cross(CadVector b) => new(Y * b.Z - Z * b.Y, Z * b.X - X * b.Z, X * b.Y - Y * b.X);
    public CadVector Normalized() => IsFinite && Length > 1e-12 && double.IsFinite(Length)
        ? this / Length : throw new ArgumentException("axis or direction must be finite and nonzero");
    public static CadVector operator +(CadVector a, CadVector b) => new(a.X + b.X, a.Y + b.Y, a.Z + b.Z);
    public static CadVector operator -(CadVector a, CadVector b) => new(a.X - b.X, a.Y - b.Y, a.Z - b.Z);
    public static CadVector operator *(CadVector a, double scale) => new(a.X * scale, a.Y * scale, a.Z * scale);
    public static CadVector operator /(CadVector a, double scale) => a * (1 / scale);
    public static CadVector Read(JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.Array || value.GetArrayLength() != 3)
            throw new ArgumentException("vector must have three components");
        var vector = new CadVector(value[0].GetDouble(), value[1].GetDouble(), value[2].GetDouble());
        return vector.IsFinite ? vector : throw new ArgumentException("vector must be finite");
    }
}

/// <summary>Captured world frame of the CAD origin and its three axes. Axes
/// already include Unity's y/z reflection and actual display rotation.</summary>
public sealed class CadDisplayFrame
{
    readonly CadVector _origin, _x, _y, _z;
    readonly double _metresPerMm;
    public CadDisplayFrame(CadVector originWorld, CadVector cadXWorld, CadVector cadYWorld, CadVector cadZWorld, double magnification)
    {
        if (!originWorld.IsFinite || !double.IsFinite(magnification) || magnification <= 0)
            throw new ArgumentException("display frame must be finite with positive magnification");
        _origin = originWorld;_x = cadXWorld.Normalized();_y = cadYWorld.Normalized();_z = cadZWorld.Normalized();
        if (Math.Abs(_x.Dot(_y)) > 1e-6 || Math.Abs(_x.Dot(_z)) > 1e-6 || Math.Abs(_y.Dot(_z)) > 1e-6)
            throw new ArgumentException("display axes must be orthogonal");
        _metresPerMm = magnification * CadMeshTransform.MillimetersToMetres;
        if (!double.IsFinite(_metresPerMm) || _metresPerMm <= 0) throw new ArgumentException("display scale is outside numeric range");
    }
    public CadVector ToWorld(CadVector cadMm) => _origin + (_x * cadMm.X + _y * cadMm.Y + _z * cadMm.Z) * _metresPerMm;
    public CadVector ToCad(CadVector worldMetres)
    {
        if (!worldMetres.IsFinite) throw new ArgumentException("world point must be finite");
        var p = worldMetres - _origin;
        return new(p.Dot(_x) / _metresPerMm, p.Dot(_y) / _metresPerMm, p.Dot(_z) / _metresPerMm);
    }
    public double[] ToCadRotationMatrix(IReadOnlyList<double> worldDelta)
    {
        SpatialEditIntent.RequireRotation(worldDelta);
        var axes = new[] { _x, _y, _z };var result = new double[9];
        for (var i = 0; i < 3; ++i) for (var j = 0; j < 3; ++j) {
            var v = axes[j];var transformed = new CadVector(worldDelta[0] * v.X + worldDelta[1] * v.Y + worldDelta[2] * v.Z,
                worldDelta[3] * v.X + worldDelta[4] * v.Y + worldDelta[5] * v.Z,
                worldDelta[6] * v.X + worldDelta[7] * v.Y + worldDelta[8] * v.Z);
            result[i * 3 + j] = axes[i].Dot(transformed);
        }
        return result;
    }
}

/// <summary>Immutable semantic lock for one gesture; hover cannot retarget it.</summary>
public sealed class SpatialEditIntent
{
    public string SessionId { get; }
    public string DocumentId { get; }
    public long BaseRevision { get; }
    public string FeatureId { get; }
    public string BodyId { get; }
    public string TargetTipId { get; }
    public string ManipulatorId { get; }
    public string Type { get; }
    public string Unit { get; }
    public CadVector Origin { get; }
    public CadVector? Axis { get; }
    public IReadOnlyList<string> Parameters { get; }
    public IReadOnlyDictionary<string, double> InitialValues { get; }
    readonly CadVector[] _basis;

    public SpatialEditIntent(string sessionId, string documentId, long baseRevision, string featureId,
        string bodyId, string targetTipId, JsonElement manipulator, IReadOnlyDictionary<string, double> currentValues)
    {
        if (!Guid.TryParse(sessionId, out _) || string.IsNullOrWhiteSpace(documentId) || baseRevision < 0 || baseRevision > 9007199254740991L ||
            !StableId(featureId) || !StableId(bodyId) || !StableId(targetTipId)) throw new ArgumentException("invalid edit lineage or identity");
        SessionId = sessionId;DocumentId = documentId;BaseRevision = baseRevision;FeatureId = featureId;BodyId = bodyId;TargetTipId = targetTipId;
        ManipulatorId = Text(manipulator, "id");Type = Text(manipulator, "type");Unit = Text(manipulator, "unit");
        if (Type is not ("linear" or "radial" or "angular" or "planar" or "position") ||
            Unit != (Type == "angular" ? "deg" : "mm")) throw new ArgumentException("unsupported manipulator type or unit");
        Origin = CadVector.Read(manipulator.GetProperty("origin"));
        Axis = manipulator.TryGetProperty("axis", out var axis) ? CadVector.Read(axis).Normalized() : null;
        var names = manipulator.TryGetProperty("parameters", out var list)
            ? list.EnumerateArray().Select(p => p.GetString() ?? "").ToArray() : new[] { Text(manipulator, "parameter") };
        var required = Type == "position" ? 3 : Type == "planar" ? 2 : Type == "angular" && names.Length == 3 ? 3 : 1;
        if (names.Length != required || names.Distinct(StringComparer.Ordinal).Count() != names.Length || names.Any(n => !StableId(n)))
            throw new ArgumentException("invalid canonical parameter list");
        Parameters = Array.AsReadOnly(names);
        var values = new Dictionary<string, double>(StringComparer.Ordinal);
        foreach (var name in names) {
            if (!currentValues.TryGetValue(name, out var value) || !double.IsFinite(value)) throw new ArgumentException("missing finite parameter value");
            values.Add(name, value);
        }
        InitialValues = new ReadOnlyDictionary<string, double>(values);
        if (Type == "linear" || Type == "angular" && names.Length == 1) {
            if (Axis is null) throw new ArgumentException("manipulator requires a declared axis");
        }
        if (Type == "planar") {
            _basis = new[] { CadVector.Read(manipulator.GetProperty("xAxis")).Normalized(), CadVector.Read(manipulator.GetProperty("yAxis")).Normalized() };
            var normal = CadVector.Read(manipulator.GetProperty("normal")).Normalized();
            if (Math.Abs(_basis[0].Cross(_basis[1]).Dot(normal)) < 1 - 1e-6) throw new ArgumentException("invalid declared plane");
        } else if (Type == "position" || names.Length == 3) {
            var raw = manipulator.GetProperty("basis");
            if (raw.GetArrayLength() != 3) throw new ArgumentException("three declared axes required");
            _basis = raw.EnumerateArray().Select(v => CadVector.Read(v).Normalized()).ToArray();
            if (names.Length == 3 && Type == "angular" &&
                (Text(manipulator, "rotationConvention") != "extrinsic-ZYX" || !names.SequenceEqual(new[] { "rxDeg", "ryDeg", "rzDeg" })))
                throw new ArgumentException("unsupported rotation convention");
            // Canonical rx/ry/rz are global CAD extrinsic axes, matching the PC
            // Instance transform. A local parameter basis would change semantics.
            if (Type == "angular" && ((_basis[0] - new CadVector(1, 0, 0)).Length > 1e-6 ||
                (_basis[1] - new CadVector(0, 1, 0)).Length > 1e-6 ||
                (_basis[2] - new CadVector(0, 0, 1)).Length > 1e-6))
                throw new ArgumentException("extrinsic-ZYX requires canonical CAD parameter axes");
        } else _basis = Array.Empty<CadVector>();
        for (var i = 0; i < _basis.Length; ++i) for (var j = i + 1; j < _basis.Length; ++j)
            if (Math.Abs(_basis[i].Dot(_basis[j])) > 1e-6) throw new ArgumentException("declared axes must be orthogonal");
    }

    public IReadOnlyDictionary<string, double> PredictDrag(CadVector startMm, CadVector currentMm)
    {
        if (!startMm.IsFinite || !currentMm.IsFinite) throw new ArgumentException("gesture points must be finite");
        var draft = InitialValues.ToDictionary(p => p.Key, p => p.Value);var delta = currentMm - startMm;
        if (Type == "linear") draft[Parameters[0]] += delta.Dot(Axis!.Value);
        else if (Type == "position" || Type == "planar")
            for (var i = 0; i < Parameters.Count; ++i) draft[Parameters[i]] += delta.Dot(_basis[i]);
        else if (Type == "radial") {
            var a = InPlane(startMm - Origin);var b = InPlane(currentMm - Origin);
            draft[Parameters[0]] += (b.Length - a.Length) * (Parameters[0] == "diameterMm" ? 2 : 1);
        } else if (Parameters.Count == 1) {
            var a = InPlane(startMm - Origin).Normalized();var b = InPlane(currentMm - Origin).Normalized();
            draft[Parameters[0]] += Math.Atan2(Axis!.Value.Dot(a.Cross(b)), a.Dot(b)) * 180 / Math.PI;
        } else throw new ArgumentException("multi-axis rotation requires orientation input");
        return Exact(draft);
    }
    CadVector InPlane(CadVector value) => Axis.HasValue ? value - Axis.Value * value.Dot(Axis.Value) : value;

    public IReadOnlyDictionary<string, double> PredictRotation(CadVector deltaDegrees) => PredictRotationMatrix(EulerMatrix(deltaDegrees));
    public IReadOnlyDictionary<string, double> PredictRotationMatrix(IReadOnlyList<double> deltaCad)
    {
        if (Type != "angular" || Parameters.Count != 3) throw new ArgumentException("not a multi-axis rotation intent");
        RequireRotation(deltaCad);
        var initial = new CadVector(InitialValues[Parameters[0]], InitialValues[Parameters[1]], InitialValues[Parameters[2]]);
        var basis = EulerMatrix(initial);var composed = new double[9];
        for (var i = 0; i < 3; ++i) for (var j = 0; j < 3; ++j)
            for (var k = 0; k < 3; ++k) composed[i * 3 + j] += deltaCad[i * 3 + k] * basis[k * 3 + j];
        var y = Math.Asin(Math.Max(-1, Math.Min(1, -composed[6])));
        var x = Math.Abs(Math.Cos(y)) > 1e-8 ? Math.Atan2(composed[7], composed[8]) : Math.Atan2(-composed[5], composed[4]);
        var z = Math.Abs(Math.Cos(y)) > 1e-8 ? Math.Atan2(composed[3], composed[0]) : 0;
        return Exact(new Dictionary<string, double> { [Parameters[0]] = Near(x * 180 / Math.PI, initial.X),
            [Parameters[1]] = Near(y * 180 / Math.PI, initial.Y), [Parameters[2]] = Near(z * 180 / Math.PI, initial.Z) });
    }
    static double Near(double value, double reference) => value + Math.Round((reference - value) / 360) * 360;
    public static double[] EulerMatrix(CadVector degrees)
    {
        if (!degrees.IsFinite) throw new ArgumentException("angles must be finite");
        var x = degrees.X % 360 * Math.PI / 180;var y = degrees.Y % 360 * Math.PI / 180;var z = degrees.Z % 360 * Math.PI / 180;
        var cx = Math.Cos(x);var sx = Math.Sin(x);var cy = Math.Cos(y);var sy = Math.Sin(y);var cz = Math.Cos(z);var sz = Math.Sin(z);
        return new[] { cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
            sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx, -sy, cy * sx, cy * cx };
    }
    internal static void RequireRotation(IReadOnlyList<double> matrix)
    {
        if (matrix.Count != 9 || matrix.Any(v => !double.IsFinite(v))) throw new ArgumentException("rotation must have nine finite elements");
        var a = new CadVector(matrix[0], matrix[1], matrix[2]);var b = new CadVector(matrix[3], matrix[4], matrix[5]);var c = new CadVector(matrix[6], matrix[7], matrix[8]);
        if (Math.Abs(a.Length - 1) > 1e-6 || Math.Abs(b.Length - 1) > 1e-6 || Math.Abs(c.Length - 1) > 1e-6 ||
            Math.Abs(a.Dot(b)) > 1e-6 || Math.Abs(a.Dot(c)) > 1e-6 || Math.Abs(b.Dot(c)) > 1e-6 || Math.Abs(a.Cross(b).Dot(c) - 1) > 1e-6)
            throw new ArgumentException("matrix must be a proper orthogonal rotation");
    }
    public IReadOnlyDictionary<string, double> Exact(IReadOnlyDictionary<string, double> values)
    {
        if (values.Count != Parameters.Count || Parameters.Any(p => !values.TryGetValue(p, out var v) || !double.IsFinite(v)))
            throw new ArgumentException("draft must contain exactly the finite intent parameters");
        return new ReadOnlyDictionary<string, double>(Parameters.ToDictionary(p => p, p => values[p], StringComparer.Ordinal));
    }
    public static double Snap(double value, double step)
    {
        if (!double.IsFinite(value) || !double.IsFinite(step) || step <= 0) throw new ArgumentException("snap values must be finite with positive step");
        var result = Math.Round(value / step, MidpointRounding.AwayFromZero) * step;
        return double.IsFinite(result) ? result : throw new ArgumentException("snap result overflowed");
    }
    static bool StableId(string value) => !string.IsNullOrWhiteSpace(value) && value.Length <= 128 && value.All(c =>
        c is >= 'a' and <= 'z' or >= 'A' and <= 'Z' or >= '0' and <= '9' or '_' or '-');
    static string Text(JsonElement value, string name) => value.TryGetProperty(name, out var property) &&
        property.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(property.GetString())
        ? property.GetString()! : throw new ArgumentException("missing manipulator " + name);
}
