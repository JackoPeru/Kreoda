namespace Kreoda.QuestFoundation;

/// <summary>Render-neutral face range: persistent face id + triangle span.
/// Triangle indices are positions in the index buffer divided by 3 — never
/// scene or array positions owned by the renderer.</summary>
public sealed record FaceRange(string PersistentFaceId, int TriangleStart, int TriangleCount);

/// <summary>Render-neutral edge range: persistent edge id + vertex span of
/// a consecutive polyline (segment s covers vertices VertexStart+s and
/// VertexStart+s+1, mirroring the viewport's segToEdge build).</summary>
public sealed record EdgeRange(string PersistentEdgeId, int VertexStart, int VertexCount);

/// <summary>A ray hit's exact native span. Ambiguous references still identify
/// the clicked span for local highlighting, but cannot be sent as a unique CAD
/// selection or modeling reference.</summary>
public sealed record MeshSemanticHit(string PersistentId, int RangeStart, int RangeCount, bool ReferenceAmbiguous);

/// <summary>One body's render-neutral mesh (§12.3): flat buffers plus the
/// persistent-ID maps. A ray/hand hit on triangle N resolves back to the
/// same semantic CAD reference the Desktop uses.</summary>
public sealed class BodyMesh
{
    public string BodyId { get; }
    public string? InstanceId { get; }
    public SceneObjectKey Key => new(BodyId, InstanceId);
    public float[] Positions { get; }
    public float[] Normals { get; }
    public uint[] Indices { get; }
    public float[] EdgeVertices { get; }
    public IReadOnlyList<FaceRange> Faces { get; }
    public IReadOnlyList<EdgeRange> Edges { get; }

    public int TriangleCount => Indices.Length / 3;

    public BodyMesh(
        string bodyId,
        float[] positions,
        float[] normals,
        uint[] indices,
        IReadOnlyList<FaceRange> faces,
        IReadOnlyList<EdgeRange> edges,
        float[]? edgeVertices = null,
        string? instanceId = null)
    {
        if (string.IsNullOrEmpty(bodyId)) throw new ArgumentException("bodyId is required", nameof(bodyId));
        if (positions.Length % 3 != 0) throw new ArgumentException("positions must be xyz triplets", nameof(positions));
        if (normals.Length != positions.Length) throw new ArgumentException("normals must match positions", nameof(normals));
        if (indices.Length % 3 != 0) throw new ArgumentException("indices must be triplets", nameof(indices));
        BodyId = bodyId;
        Positions = positions;
        Normals = normals;
        Indices = indices;
        EdgeVertices = edgeVertices ?? Array.Empty<float>();
        if (EdgeVertices.Length % 3 != 0) throw new ArgumentException("edgeVertices must be xyz triplets", nameof(edgeVertices));
        if (string.IsNullOrEmpty(instanceId) && instanceId is not null) throw new ArgumentException("instanceId cannot be empty", nameof(instanceId));
        InstanceId = instanceId;
        Faces = faces;
        Edges = edges;
    }

    /// <summary>Exact face span hit by triangle index. Repeated native IDs are
    /// reported as ambiguous while retaining the span for an honest highlight.</summary>
    public MeshSemanticHit? ResolveFaceHit(int triangleIndex)
    {
        if (triangleIndex < 0 || triangleIndex >= TriangleCount) return null;
        foreach (var f in Faces)
        {
            if (triangleIndex >= f.TriangleStart &&
                triangleIndex < f.TriangleStart + f.TriangleCount)
                return new(f.PersistentFaceId, f.TriangleStart, f.TriangleCount,
                    Faces.Count(candidate => candidate.PersistentFaceId == f.PersistentFaceId) > 1);
        }
        return null;
    }

    /// <summary>Unique persistent face id owning a triangle; ambiguous IDs
    /// return null so callers cannot silently select the first semantic match.</summary>
    public string? ResolveFace(int triangleIndex)
    {
        var hit = ResolveFaceHit(triangleIndex);
        return hit is { ReferenceAmbiguous: false } ? hit.PersistentId : null;
    }

    /// <summary>Persistent edge id owning a polyline segment, or null.</summary>
    public string? ResolveEdge(int segmentIndex)
    {
        if (segmentIndex < 0) return null;
        int span = 0;
        foreach (var e in Edges)
        {
            // VertexCount counts vertices; segments join consecutive pairs.
            int segments = Math.Max(0, e.VertexCount - 1);
            if (segmentIndex >= span && segmentIndex < span + segments)
                return e.PersistentEdgeId;
            span += segments;
        }
        return null;
    }

    /// <summary>Resolve a segment using its starting vertex index in the
    /// native edge buffer. This is additive; ResolveEdge keeps its historical
    /// concatenated-segment ordinal contract.</summary>
    public MeshSemanticHit? ResolveEdgeByNativeVertexIndex(int segmentStartVertex)
    {
        if (segmentStartVertex < 0) return null;
        foreach (var e in Edges)
        {
            if (segmentStartVertex >= e.VertexStart &&
                segmentStartVertex < e.VertexStart + Math.Max(0, e.VertexCount - 1))
                return new(e.PersistentEdgeId, e.VertexStart, e.VertexCount,
                    Edges.Count(candidate => candidate.PersistentEdgeId == e.PersistentEdgeId) > 1);
        }
        return null;
    }
}
