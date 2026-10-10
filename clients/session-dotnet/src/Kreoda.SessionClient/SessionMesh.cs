namespace Kreoda.Session;

/// <summary>Identity and freshness fence for one raw native mesh payload.</summary>
public sealed record SessionMeshHeader(
    string NativeRequestId,
    string SessionId,
    string DocumentId,
    long Revision,
    string BodyId,
    string FeatureId,
    string TipId,
    int Quality,
    int ByteLength,
    string? InstanceId = null);

public sealed record SessionMeshFaceRange(string PersistentFaceId, uint TriangleStart, uint TriangleCount);
public sealed record SessionMeshEdgeRange(string PersistentEdgeId, uint VertexStart, uint VertexCount);

/// <summary>Validated binary MeshUpdate with its protocol identity header.</summary>
public sealed record SessionMeshResult(
    SessionMeshHeader Header,
    float[] Positions,
    float[] Normals,
    uint[] Indices,
    float[] EdgeVertices,
    IReadOnlyList<SessionMeshFaceRange> Faces,
    IReadOnlyList<SessionMeshEdgeRange> Edges,
    double VolumeMm3,
    double[] BboxMm,
    int RawByteLength,
    string RawPayloadSha256);
