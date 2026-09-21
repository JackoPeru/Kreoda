using Kreoda.QuestFoundation;
using Xunit;

namespace Kreoda.SessionClient.Tests;

/// <summary>Phase 12 foundation (engine-agnostic): persistent-ID scene maps,
/// display placement math, LOD policy.</summary>
public sealed class QuestFoundationTests
{
    private static BodyMesh BoxMesh(string id = "box-1")
    {
        // 12-triangle box: 6 faces × 2 triangles, stable persistent ids.
        var positions = new float[8 * 3];
        var normals = new float[8 * 3];
        for (var i = 0; i < 8; i++) normals[i * 3 + 2] = 1f;
        var indices = new uint[12 * 3];
        for (uint i = 0; i < 36; i++) indices[i] = i % 8;
        var faces = new List<FaceRange>
        {
            new($"{id}:box.+Z", 0, 2),
            new($"{id}:box.-Z", 2, 2),
            new($"{id}:box.+X", 4, 2),
            new($"{id}:box.-X", 6, 2),
            new($"{id}:box.+Y", 8, 2),
            new($"{id}:box.-Y", 10, 2),
        };
        var edges = new List<EdgeRange> { new($"{id}:edge.lin", 0, 4) };
        return new BodyMesh(id, positions, normals, indices, faces, edges);
    }

    [Fact]
    public void TriangleResolvesToPersistentFace()
    {
        var mesh = BoxMesh();
        Assert.Equal("box-1:box.+Z", mesh.ResolveFace(0));
        Assert.Equal("box-1:box.+Z", mesh.ResolveFace(1));
        Assert.Equal("box-1:box.-Y", mesh.ResolveFace(11));
        Assert.Null(mesh.ResolveFace(-1));
        Assert.Null(mesh.ResolveFace(12));
    }

    [Fact]
    public void SegmentResolvesToPersistentEdge()
    {
        // Consecutive-polyline layout (mirrors viewport segToEdge): edge one
        // owns segments 0-1, edge two starts at vertex 2.
        var mesh = new BodyMesh("e", new float[4 * 3], new float[4 * 3],
            new uint[3], new List<FaceRange>(),
            new List<EdgeRange> { new("e:one", 0, 3), new("e:two", 2, 2) });
        Assert.Equal("e:one", mesh.ResolveEdge(0));
        Assert.Equal("e:one", mesh.ResolveEdge(1));
        Assert.Equal("e:two", mesh.ResolveEdge(2));
        Assert.Null(mesh.ResolveEdge(3));
        Assert.Null(mesh.ResolveEdge(-1));
    }

    [Fact]
    public void DisplayPresetsNeverTouchCadUnits()
    {
        var point = new[] { 100.0, 60.0, 10.0 };
        Assert.Equal(point, DisplayTransform.Preset("1:1").ToDisplay(point));
        Assert.Equal(new[] { 10.0, 6.0, 1.0 }, DisplayTransform.Preset("1:10").ToDisplay(point));
        Assert.Equal(new[] { 1000.0, 600.0, 100.0 }, DisplayTransform.Preset("10:1").ToDisplay(point));
        // Round-trip is exact.
        var t = DisplayTransform.Preset("1:5").WithOffset(1, 2, 3);
        var back = t.ToCad(t.ToDisplay(point));
        Assert.Equal(point[0], back[0], 9);
        Assert.Equal(point[1], back[1], 9);
        Assert.Equal(point[2], back[2], 9);
    }

    [Fact]
    public void FitCentersLargestExtent()
    {
        var t = DisplayTransform.Fit(
            new[] { 0.0, 0.0, 0.0 }, new[] { 100.0, 60.0, 10.0 }, 1.0);
        Assert.Equal(0.01, t.Scale, 9);
        // Bbox middle lands on the anchor.
        Assert.Equal(new[] { 0.0, 0.0, 0.0 }, t.ToDisplay(new[] { 50.0, 30.0, 5.0 }));
        Assert.Throws<ArgumentException>(() =>
            DisplayTransform.Fit(new[] { 0.0, 0.0, 0.0 }, new[] { 0.0, 0.0, 0.0 }, 1.0));
    }

    [Fact]
    public void LodPolicyKeepsInteractionCoarse()
    {
        Assert.Equal(MeshLod.Preview, LodPolicy.ForDrag(true));
        Assert.Equal(MeshLod.Interactive, LodPolicy.ForDrag(false));
        Assert.Equal(MeshLod.Interactive, LodPolicy.ForBody(5000, 100_000));
        Assert.Equal(MeshLod.Preview, LodPolicy.ForBody(500_000, 100_000));
        Assert.Equal(MeshLod.Preview, LodPolicy.ForScene(5_000_000, 100_000, interacting: false));
        Assert.Equal(MeshLod.Interactive, LodPolicy.ForScene(5_000, 100_000, interacting: false));
        Assert.Equal((int)MeshLod.Preview, 0);
        Assert.Equal((int)MeshLod.Interactive, 1);
    }
}
