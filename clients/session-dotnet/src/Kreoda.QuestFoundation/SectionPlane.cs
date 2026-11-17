namespace Kreoda.QuestFoundation;

public enum SectionAxis { X, Y, Z }

/// <summary>Immutable client-local cut plane in CAD millimetres.</summary>
public readonly struct SectionPlane : IEquatable<SectionPlane>
{
    public const double OffsetLimitMm = 1_000_000d;
    public const double PickToleranceMm = 1e-6d;
    const double UnitTolerance = 1e-6d;

    public double NormalX { get; }
    public double NormalY { get; }
    public double NormalZ { get; }
    public double OffsetMm { get; }
    public bool Inverted { get; }

    public SectionAxis? Axis =>
        Math.Abs(NormalX - 1d) <= UnitTolerance && NormalY == 0d && NormalZ == 0d ? SectionAxis.X :
        Math.Abs(NormalY - 1d) <= UnitTolerance && NormalX == 0d && NormalZ == 0d ? SectionAxis.Y :
        Math.Abs(NormalZ - 1d) <= UnitTolerance && NormalX == 0d && NormalY == 0d ? SectionAxis.Z : null;

    public SectionPlane(double normalX, double normalY, double normalZ, double offsetMm, bool inverted = false)
    {
        if (!Finite(normalX) || !Finite(normalY) || !Finite(normalZ))
            throw new ArgumentOutOfRangeException(nameof(normalX), "section normal must be finite");
        var magnitude = Math.Sqrt(normalX * normalX + normalY * normalY + normalZ * normalZ);
        if (Math.Abs(magnitude - 1d) > UnitTolerance)
            throw new ArgumentOutOfRangeException(nameof(normalX), "section normal must be unit length");
        if (!Finite(offsetMm) || Math.Abs(offsetMm) > OffsetLimitMm)
            throw new ArgumentOutOfRangeException(nameof(offsetMm), "section offset must be finite and within CAD bounds");

        NormalX = normalX;
        NormalY = normalY;
        NormalZ = normalZ;
        OffsetMm = offsetMm;
        Inverted = inverted;
    }

    public static SectionPlane FromAxis(SectionAxis axis, double offsetMm, bool inverted = false) => axis switch
    {
        SectionAxis.X => new SectionPlane(1, 0, 0, offsetMm, inverted),
        SectionAxis.Y => new SectionPlane(0, 1, 0, offsetMm, inverted),
        SectionAxis.Z => new SectionPlane(0, 0, 1, offsetMm, inverted),
        _ => throw new ArgumentOutOfRangeException(nameof(axis)),
    };

    public double SignedDistanceCadMm(double x, double y, double z)
    {
        if (!Finite(x) || !Finite(y) || !Finite(z)) return double.NaN;
        var distance = NormalX * x + NormalY * y + NormalZ * z - OffsetMm;
        return Inverted ? -distance : distance;
    }

    /// <summary>Maps Unity local metres (x,y,z) back to CAD (x,z,y) millimetres.</summary>
    public double SignedDistanceUnityLocalMetres(double x, double y, double z) =>
        SignedDistanceCadMm(x * 1000d, z * 1000d, y * 1000d);

    public bool IsVisibleCadMm(double x, double y, double z, double toleranceMm = PickToleranceMm) =>
        Finite(toleranceMm) && toleranceMm >= 0d && SignedDistanceCadMm(x, y, z) >= -toleranceMm;

    public bool IsVisibleUnityLocalMetres(double x, double y, double z, double toleranceMm = PickToleranceMm) =>
        Finite(toleranceMm) && toleranceMm >= 0d && SignedDistanceUnityLocalMetres(x, y, z) >= -toleranceMm;

    public SectionPlane WithOffset(double offsetMm) => new(NormalX, NormalY, NormalZ, offsetMm, Inverted);
    public SectionPlane WithInverted(bool inverted) => new(NormalX, NormalY, NormalZ, OffsetMm, inverted);
    public SectionPlane WithNormal(double x, double y, double z) => new(x, y, z, OffsetMm, Inverted);

    public bool Equals(SectionPlane other) => NormalX.Equals(other.NormalX) && NormalY.Equals(other.NormalY) &&
        NormalZ.Equals(other.NormalZ) && OffsetMm.Equals(other.OffsetMm) && Inverted == other.Inverted;
    public override bool Equals(object? obj) => obj is SectionPlane other && Equals(other);
    public override int GetHashCode() => HashCode.Combine(NormalX, NormalY, NormalZ, OffsetMm, Inverted);
    public static bool operator ==(SectionPlane left, SectionPlane right) => left.Equals(right);
    public static bool operator !=(SectionPlane left, SectionPlane right) => !left.Equals(right);

    static bool Finite(double value) => !double.IsNaN(value) && !double.IsInfinity(value);
}
