using Google.FlatBuffers;
using Kreoda.Protocol;
using Xunit;

namespace Kreoda.SessionClient.Tests;

/// <summary>Generated C# bindings (§11.2) actually serialize: protocol enum
/// values, a mesh update round-trip and a model delta carrying it.</summary>
public sealed class BindingsTests
{
    [Fact]
    public void CommandTypeValuesMatchCore()
    {
        // Locked with native dispatcher.h + TS CommandType: never drift.
        Assert.Equal(24, (ushort)CommandType.CreateInstance);
        Assert.Equal(25, (ushort)CommandType.CreateHolePattern);
        Assert.Equal(26, (ushort)CommandType.RequestSnapshot);
        Assert.Equal(27, (ushort)CommandType.BeginTransaction);
        Assert.Equal(28, (ushort)CommandType.CommitTransaction);
        Assert.Equal(29, (ushort)CommandType.RollbackTransaction);
    }

    [Fact]
    public void MeshUpdateRoundTrips()
    {
        var builder = new FlatBufferBuilder(256);
        var featureId = builder.CreateString("box-1");
        var requestId = builder.CreateString("req-9");
        var positions = new byte[] { 0, 0, 0, 0, 0, 0, 128, 63 };
        var posVec = MeshUpdate.CreatePositionsVector(builder, positions);
        var mesh = MeshUpdate.CreateMeshUpdate(
            builder,
            feature_idOffset: featureId,
            request_idOffset: requestId,
            positions_count: 2,
            positionsOffset: posVec,
            volume_mm3: 1000.0,
            revision: 4);
        builder.Finish(mesh.Value);

        var update = MeshUpdate.GetRootAsMeshUpdate(new ByteBuffer(builder.SizedByteArray()));
        Assert.Equal("box-1", update.FeatureId);
        Assert.Equal("req-9", update.RequestId);
        Assert.Equal(2u, update.PositionsCount);
        Assert.Equal(1000.0, update.VolumeMm3);
        Assert.Equal(4L, update.Revision);
        Assert.Equal(new byte[] { 0, 0, 0, 0, 0, 0, 128, 63 }, update.GetPositionsArray());
    }

    [Fact]
    public void ModelDeltaCarriesMeshes()
    {
        var builder = new FlatBufferBuilder(256);
        var mesh = MeshUpdate.CreateMeshUpdate(
            builder,
            feature_idOffset: builder.CreateString("box-1"),
            volume_mm3: 1000.0,
            revision: 4);
        var meshes = ModelDelta.CreateChangedMeshesVector(
            builder, new Offset<MeshUpdate>[] { mesh });
        var delta = ModelDelta.CreateModelDelta(
            builder,
            base_revision: 3,
            revision: 4,
            changed_meshesOffset: meshes);
        builder.Finish(delta.Value);

        var read = ModelDelta.GetRootAsModelDelta(new ByteBuffer(builder.SizedByteArray()));
        Assert.Equal(3L, read.BaseRevision);
        Assert.Equal(4L, read.Revision);
        Assert.Equal(1, read.ChangedMeshesLength);
        var nested = read.ChangedMeshes(0);
        Assert.NotNull(nested);
        Assert.Equal("box-1", nested.Value.FeatureId);
        Assert.Equal(1000.0, nested.Value.VolumeMm3);
    }

    [Fact]
    public void HolePatternCommandBuilds()
    {
        var builder = new FlatBufferBuilder(256);
        var ids = CreateHolePatternCommand.CreateFeatureIdsVector(
            builder, new StringOffset[] { builder.CreateString("ho-1") });
        var points = CreateHolePatternCommand.CreatePointsMmVector(
            builder, new double[] { 8.0, 8.0 });
        var cmd = CreateHolePatternCommand.CreateCreateHolePatternCommand(
            builder,
            target_idOffset: builder.CreateString("box-1"),
            face_roleOffset: builder.CreateString("box.+Z"),
            feature_idsOffset: ids,
            points_mmOffset: points,
            diameter_mm: 6.0,
            depth_modeOffset: builder.CreateString("throughAll"),
            depth_mm: 0.0);
        builder.Finish(cmd.Value);

        var read = CreateHolePatternCommand.GetRootAsCreateHolePatternCommand(
            new ByteBuffer(builder.SizedByteArray()));
        Assert.Equal("box-1", read.TargetId);
        Assert.Equal(1, read.FeatureIdsLength);
        Assert.Equal("ho-1", read.FeatureIds(0));
        Assert.Equal(2, read.PointsMmLength);
        Assert.Equal(8.0, read.PointsMm(1));
        Assert.Equal(6.0, read.DiameterMm);
    }
}
