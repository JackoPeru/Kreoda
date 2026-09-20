namespace Kreoda.QuestFoundation;

/// <summary>Render-neutral face range: persistent face id + triangle span.
/// Triangle indices are positions in the index buffer divided by 3 — never
/// scene or array positions owned by the renderer.</summary>
public sealed record FaceRange(string PersistentFaceId, int TriangleStart, int TriangleCount);

/// <summary>Render-neutral edge range: persistent edge id + segment span
/// over the edge-vertex polyline (segment s covers vertices 2s, 2s+1).</summary>
public sealed record EdgeRange(string PersistentEdgeId, int VertexStart, int VertexCount);

/// <summary>One body's render-neutral mesh (§12.3): flat buffers plus the
/// persistent-ID maps. A ray/hand hit on triangle N resolves back to the
/// same semantic CAD reference the Desktop uses.</summary>
public sealed class BodyMesh
{
    public string BodyId { get; }
    public float[] Positions { get; }
    public float[] Normals { get; }
    public uint[] Indices { get; }
    public IReadOnlyList<FaceRange> Faces { get; }
    public IReadOnlyList<EdgeRange> Edges { get; }

    public int TriangleCount => Indices.Length / 3;

    public BodyMesh(
        string bodyId,
        float[] positions,
        float[] normals,
        uint[] indices,
        IReadOnlyList<FaceRange> faces,
        IReadOnlyList<EdgeRange> edges)
    {
        if (string.IsNullOrEmpty(bodyId)) throw new ArgumentException("bodyId is required", nameof(bodyId));
        if (positions.Length % 3 != 0) throw new ArgumentException("positions must be xyz triplets", nameof(positions));
        if (normals.Length != positions.Length) throw new ArgumentException("normals must match positions", nameof(normals));
        if (indices.Length % 3 != 0) throw new ArgumentException("indices must be triplets", nameof(indices));
        BodyId = bodyId;
        Positions = positions;
        Normals = normals;
        Indices = indices;
        Faces = faces;
        Edges = edges;
    }

    /// <summary>Persistent face id owning a triangle, or null when the
    /// triangle falls in no declared range (never throws on hit data).</summary>
    public string? ResolveFace(int triangleIndex)
    {
        if (triangleIndex < 0 || triangleIndex >= TriangleCount) return null;
        foreach (var f in Faces)
        {
            if (triangleIndex >= f.TriangleStart &&
                triangleIndex < f.TriangleStart + f.TriangleCount)
                return f.PersistentFaceId;
        }
        return null;
    }

    /// <summary>Persistent edge id owning a polyline segment, or null.</summary>
    public string? ResolveEdge(int segmentIndex)
    {
        if (segmentIndex < 0) return null;
        int span = 0;
        foreach (var e in Edges)
        {
            // VertexCount counts vertices; segments join consecutive pairs.
            int segs = Math.Max(0, e.VertexCount - 1);
            if (segmentIndex >= span && segmentIndex < span + segs)
                return e.PersistentEdgeId;
            span += segs;
        }
        return null;
    }
}

/// <summary>Client-local scene registry (§12.10): bodies keyed by persistent
/// body id. Upsert on delta, drop on removal — never rebuild the whole scene
/// for one changed hole (§12.4).</summary>
public sealed class SceneRegistry
{
    private readonly Dictionary<string, BodyMesh> _bodies = new();

    public int Count => _bodies.Count;

    public void Upsert(BodyMesh mesh) => _bodies[mesh.BodyId] = mesh;

    public bool Remove(string bodyId) => _bodies.Remove(bodyId);

    public BodyMesh? Find(string bodyId) =>
        _bodies.TryGetValue(bodyId, out var m) ? m : null;

    public IEnumerable<string> BodyIds => _bodies.Keys;
}
