using Kreoda.QuestFoundation;
using Xunit;

namespace Kreoda.SessionClient.Tests;

public sealed class SectionPlaneTests
{
    [Theory]
    [InlineData(SectionAxis.X, 13d, 20d, -5d, 10d, 3d)]
    [InlineData(SectionAxis.Y, 13d, 20d, -5d, 10d, 10d)]
    [InlineData(SectionAxis.Z, 13d, 20d, -5d, -10d, 5d)]
    public void AxisDistanceUsesCadMillimetresAndExactUnityMapping(
        SectionAxis axis, double x, double y, double z, double offset, double expected)
    {
        var plane = SectionPlane.FromAxis(axis, offset);
        Assert.Equal(expected, plane.SignedDistanceCadMm(x, y, z), 9);
        Assert.Equal(expected, plane.SignedDistanceUnityLocalMetres(x * .001, z * .001, y * .001), 6);
    }

    [Theory]
    [InlineData(SectionAxis.X, 9d, 10d, 1d)]
    [InlineData(SectionAxis.Y, -13d, -12d, 1d)]
    [InlineData(SectionAxis.Z, 3d, 4d, 1d)]
    public void InversionReversesSignedSideForEveryAxis(SectionAxis axis, double coordinate, double offset, double expected)
    {
        var plane = SectionPlane.FromAxis(axis, offset, inverted: true);
        var point = axis switch
        {
            SectionAxis.X => (coordinate, 0d, 0d),
            SectionAxis.Y => (0d, coordinate, 0d),
            _ => (0d, 0d, coordinate),
        };
        Assert.Equal(expected, plane.SignedDistanceCadMm(point.Item1, point.Item2, point.Item3));
        Assert.True(plane.IsVisibleCadMm(point.Item1, point.Item2, point.Item3));
        Assert.False(SectionPlane.FromAxis(axis, offset).IsVisibleCadMm(point.Item1, point.Item2, point.Item3));
    }

    [Fact]
    public void BoundaryToleranceAndNegativeQuotaAreFiniteAndExplicit()
    {
        var plane = SectionPlane.FromAxis(SectionAxis.X, -25);
        Assert.True(plane.IsVisibleCadMm(-25 - 0.5e-6, 0, 0));
        Assert.False(plane.IsVisibleCadMm(-25 - 1.1e-6, 0, 0));
        Assert.Equal(-2, plane.WithOffset(-23).SignedDistanceCadMm(-25, 0, 0));
        Assert.False(plane.IsVisibleCadMm(0, 0, 0, double.NaN));
        Assert.False(plane.IsVisibleCadMm(0, 0, 0, -1));
    }

    [Fact]
    public void OffsetBoundsAreInclusiveAndInvalidPlanesAreRejected()
    {
        Assert.Equal(-1_000_000, SectionPlane.FromAxis(SectionAxis.Z, -1_000_000).OffsetMm);
        Assert.Equal(1_000_000, SectionPlane.FromAxis(SectionAxis.Z, 1_000_000).OffsetMm);
        Assert.Throws<ArgumentOutOfRangeException>(() => SectionPlane.FromAxis(SectionAxis.Z, 1_000_000.01));
        Assert.Throws<ArgumentOutOfRangeException>(() => SectionPlane.FromAxis(SectionAxis.X, double.NaN));
        Assert.Throws<ArgumentOutOfRangeException>(() => SectionPlane.FromAxis(SectionAxis.X, double.PositiveInfinity));
        Assert.Throws<ArgumentOutOfRangeException>(() => SectionPlane.FromAxis(SectionAxis.X, double.NegativeInfinity));
        Assert.Throws<ArgumentOutOfRangeException>(() => new SectionPlane(0, 0, 0, 0));
        Assert.Throws<ArgumentOutOfRangeException>(() => new SectionPlane(2, 0, 0, 0));
        Assert.Throws<ArgumentOutOfRangeException>(() => new SectionPlane(double.NaN, 0, 0, 0));
        Assert.Throws<ArgumentOutOfRangeException>(() => new SectionPlane(0, double.PositiveInfinity, 0, 0));
        Assert.Throws<ArgumentOutOfRangeException>(() => new SectionPlane(0, 0, double.NegativeInfinity, 0));
    }

    [Fact]
    public void NonFinitePointsAndNormalChangesCannotCreateVisibleGarbage()
    {
        var plane = SectionPlane.FromAxis(SectionAxis.Z, 0);
        Assert.False(plane.IsVisibleCadMm(double.NaN, 0, 0));
        Assert.False(plane.IsVisibleCadMm(0, double.PositiveInfinity, 0));
        Assert.True(plane.WithInverted(true).Inverted);
        Assert.Equal(plane.OffsetMm, plane.WithInverted(true).OffsetMm);
        Assert.Equal(SectionAxis.X, plane.WithNormal(1, 0, 0).Axis);
        Assert.Throws<ArgumentOutOfRangeException>(() => plane.WithNormal(0, 0, 2));
    }
}
