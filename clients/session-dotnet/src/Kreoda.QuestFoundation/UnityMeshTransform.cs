namespace Kreoda.QuestFoundation;

/// <summary>Unity-ready coordinates derived from authoritative CAD buffers.</summary>
public sealed record UnityMeshBuffers(
    float[] Positions,
    float[] Normals,
    uint[] Indices,
    float[] EdgeVertices,
    IReadOnlyList<FaceRange> Faces,
    IReadOnlyList<EdgeRange> Edges,
    double[] BboxMetres);

/// <summary>CAD is right-handed Z-up millimeters; Unity is Y-up meters.</summary>
public static class CadMeshTransform
{
    public const double MillimetersToMetres = 0.001d;

    public static UnityMeshBuffers Convert(
        float[] positionsMm,
        float[] normals,
        uint[] indices,
        float[] edgeVerticesMm,
        IReadOnlyList<FaceRange> faces,
        IReadOnlyList<EdgeRange> edges,
        double[] bboxMm)
    {
        if (positionsMm is null) throw new ArgumentNullException(nameof(positionsMm));
        if (normals is null) throw new ArgumentNullException(nameof(normals));
        if (indices is null) throw new ArgumentNullException(nameof(indices));
        if (edgeVerticesMm is null) throw new ArgumentNullException(nameof(edgeVerticesMm));
        if (faces is null) throw new ArgumentNullException(nameof(faces));
        if (edges is null) throw new ArgumentNullException(nameof(edges));
        if (bboxMm is null) throw new ArgumentNullException(nameof(bboxMm));
        if (positionsMm.Length == 0 || positionsMm.Length % 3 != 0 || normals.Length != positionsMm.Length ||
            indices.Length == 0 || indices.Length % 3 != 0 || edgeVerticesMm.Length % 3 != 0)
            throw new ArgumentException("mesh vector sizes are inconsistent");
        RequireFinite(positionsMm, nameof(positionsMm));
        RequireFinite(normals, nameof(normals));
        RequireFinite(edgeVerticesMm, nameof(edgeVerticesMm));
        var vertexCount = positionsMm.Length / 3;
        foreach (var index in indices)
            if (index >= vertexCount) throw new ArgumentException("mesh index is outside vertex data", nameof(indices));
        foreach (var face in faces)
            if (face.TriangleStart < 0 || face.TriangleCount <= 0 || face.TriangleStart + face.TriangleCount > indices.Length / 3)
                throw new ArgumentException("face triangle span is outside mesh data", nameof(faces));
        foreach (var edge in edges)
            if (edge.VertexStart < 0 || edge.VertexCount <= 0 || edge.VertexStart + edge.VertexCount > edgeVerticesMm.Length / 3)
                throw new ArgumentException("edge vertex span is outside mesh data", nameof(edges));
        if (bboxMm.Length != 6 || bboxMm.Any(value => !IsFinite(value)) ||
            bboxMm[0] > bboxMm[3] || bboxMm[1] > bboxMm[4] || bboxMm[2] > bboxMm[5])
            throw new ArgumentException("bounding box must contain ordered finite min/max triples", nameof(bboxMm));

        var positions = ConvertTriplets(positionsMm);
        // OCCT reversed faces supply outward normals with unflipped indices.
        // Normalize their winding, then account for the y/z reflection. Only
        // vertices within each triangle change order; semantic spans stay fixed.
        var convertedIndices = (uint[])indices.Clone();
        for (var index = 0; index < convertedIndices.Length; index += 3)
        {
            var a = checked((int)indices[index] * 3);
            var b = checked((int)indices[index + 1] * 3);
            var c = checked((int)indices[index + 2] * 3);
            double ux = (double)positionsMm[b] - positionsMm[a], uy = (double)positionsMm[b + 1] - positionsMm[a + 1],
                uz = (double)positionsMm[b + 2] - positionsMm[a + 2];
            double vx = (double)positionsMm[c] - positionsMm[a], vy = (double)positionsMm[c + 1] - positionsMm[a + 1],
                vz = (double)positionsMm[c + 2] - positionsMm[a + 2];
            var outward = (uy * vz - uz * vy) * normals[a] + (uz * vx - ux * vz) * normals[a + 1] +
                (ux * vy - uy * vx) * normals[a + 2];
            if (outward >= 0)
                (convertedIndices[index + 1], convertedIndices[index + 2]) =
                    (convertedIndices[index + 2], convertedIndices[index + 1]);
        }
        var convertedNormals = ConvertNormals(normals);
        var convertedEdges = ConvertTriplets(edgeVerticesMm);
        var bbox = new[]
        {
            bboxMm[0] * MillimetersToMetres, bboxMm[2] * MillimetersToMetres, bboxMm[1] * MillimetersToMetres,
            bboxMm[3] * MillimetersToMetres, bboxMm[5] * MillimetersToMetres, bboxMm[4] * MillimetersToMetres,
        };
        return new(positions, convertedNormals, convertedIndices, convertedEdges,
            Array.AsReadOnly(faces.ToArray()), Array.AsReadOnly(edges.ToArray()), bbox);
    }

    private static float[] ConvertTriplets(float[] source)
    {
        var result = new float[source.Length];
        for (var index = 0; index < source.Length; index += 3)
        {
            result[index] = (float)(source[index] * MillimetersToMetres);
            result[index + 1] = (float)(source[index + 2] * MillimetersToMetres);
            result[index + 2] = (float)(source[index + 1] * MillimetersToMetres);
        }
        return result;
    }

    private static float[] ConvertNormals(float[] source)
    {
        var result = new float[source.Length];
        for (var index = 0; index < source.Length; index += 3)
        {
            result[index] = source[index];
            result[index + 1] = source[index + 2];
            result[index + 2] = source[index + 1];
        }
        return result;
    }

    private static void RequireFinite(float[] values, string parameter)
    {
        if (values.Any(value => !IsFinite(value)))
            throw new ArgumentException("mesh contains a non-finite value", parameter);
    }

    private static bool IsFinite(float value) => !float.IsNaN(value) && !float.IsInfinity(value);
    private static bool IsFinite(double value) => !double.IsNaN(value) && !double.IsInfinity(value);
}
