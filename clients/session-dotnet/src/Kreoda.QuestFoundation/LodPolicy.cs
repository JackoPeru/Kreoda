namespace Kreoda.QuestFoundation;

/// <summary>Mesh quality levels (§12.5). Values match the core RequestMesh
/// lod parameter: 0 coarse/preview, 1 interactive, 2 export/inspection.</summary>
public enum MeshLod
{
    Preview = 0,
    Interactive = 1,
    Inspection = 2,
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
        if (triangleCount <= triangleBudget) return wanted;
        // One step down per doubling over budget, floored at Preview.
        var steps = 0;
        var over = (double)triangleCount / triangleBudget;
        while (over >= 2.0 && steps < 2)
        {
            over /= 2.0;
            steps++;
        }
        var level = Math.Max((int)MeshLod.Preview, (int)wanted - Math.Max(1, steps));
        return (MeshLod)level;
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
