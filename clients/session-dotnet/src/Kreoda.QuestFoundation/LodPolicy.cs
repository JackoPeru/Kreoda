namespace Kreoda.QuestFoundation;

/// <summary>Mesh quality levels (§12.5). Values match the core RequestMesh
/// lod parameter: 0 coarse/preview, 1 interactive.</summary>
public enum MeshLod
{
    Preview = 0,
    Interactive = 1,
}

/// <summary>LOD selection for the Quest render budget (§12.5, §12.11):
/// interaction stays at headset rate while core updates arrive slower.
/// Deterministic and dependency-free so Unity and headless clients share it.</summary>
public static class LodPolicy
{
    /// <summary>LOD while a spatial drag is active: always coarse preview —
    /// the authoritative mesh replaces it on commit (§2.7).</summary>
    public static MeshLod ForDrag(bool dragging) =>
        dragging ? MeshLod.Preview : MeshLod.Interactive;

    /// <summary>Downgrade a body when it alone exceeds the triangle budget
    /// (per-body cap keeps one huge import from starving the scene).</summary>
    public static MeshLod ForBody(int triangleCount, int triangleBudget, MeshLod wanted = MeshLod.Interactive)
    {
        if (triangleBudget <= 0) throw new ArgumentException("budget must be positive", nameof(triangleBudget));
        return triangleCount <= triangleBudget ? wanted : MeshLod.Preview;
    }

    /// <summary>Whole-scene decision: preview while interacting, otherwise
    /// the finest level fitting the total budget.</summary>
    public static MeshLod ForScene(int totalTriangles, int triangleBudget, bool interacting)
    {
        if (interacting) return MeshLod.Preview;
        if (totalTriangles <= triangleBudget) return MeshLod.Interactive;
        return MeshLod.Preview;
    }
}
