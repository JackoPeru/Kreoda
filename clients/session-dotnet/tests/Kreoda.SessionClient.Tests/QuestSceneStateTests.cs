using Kreoda.QuestFoundation;
using Xunit;

namespace Kreoda.SessionClient.Tests;

public sealed class QuestSceneStateTests
{
    private const string SessionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    private const string DocumentId = "doc-a";

    [Fact]
    public void ExplicitLodRefreshSupersedesOnlyItsCurrentObjectAndRejectsOldLineage()
    {
        var scene = new QuestSceneState();
        var generation = scene.BeginConnection();
        var body = Target("body-a", null, "tip-a", 1);
        var other = Target("body-b", null, "tip-b", 1);
        foreach (var request in Observe(scene, 1, [body, other], snapshot: true).Requests) scene.Complete(request);
        var first = scene.RequestRefresh(body.Key);
        Assert.NotNull(first);
        var replacement = scene.RequestRefresh(body.Key);
        Assert.NotNull(replacement);
        Assert.False(scene.IsCurrent(first));
        Assert.True(scene.IsCurrent(replacement));
        Assert.Equal(other, scene.GetAppliedTarget(other.Key));
        scene.CaptureObservation(generation, SessionId, DocumentId, 2, ["body-a"]);
        Assert.Null(scene.RequestRefresh(body.Key));
        scene.InvalidateConnection();
        Assert.Null(scene.RequestRefresh(other.Key));
    }

    [Fact]
    public void FailedRequestCanRetryWithoutAnOldFailureReleasingItsReplacement()
    {
        var scene = new QuestSceneState();
        scene.BeginConnection();
        var target = Target("body-a", null, "tip-a", 1);
        var failed = Observe(scene, 1, [target], snapshot: true).Requests.Single();
        Assert.True(scene.Abandon(failed));
        var replacement = Observe(scene, 1, [target]).Requests.Single();
        Assert.False(scene.Abandon(failed));
        Assert.True(scene.IsCurrent(replacement));
        Assert.Equal(MeshCompletionDisposition.Apply, scene.Complete(replacement));
    }

    [Fact]
    public void NewReceivedModelRejectsAnOlderQueuedObservationBeforeReconciliation()
    {
        var scene = new QuestSceneState();
        var generation = scene.BeginConnection();
        var old = scene.CaptureObservation(generation, SessionId, DocumentId, 1);
        scene.CaptureObservation(generation, SessionId, DocumentId, 2, ["body-a"]);

        var ignored = scene.Reconcile(old, [Target("body-a", null, "tip-old", 1)], snapshot: true);

        Assert.True(ignored.IgnoredStaleObservation);
        Assert.Empty(ignored.Requests);
    }

    [Fact]
    public void FailedUnityUploadLeavesNoAppliedMeshAndCanRetryTheSameRevision()
    {
        var scene = new QuestSceneState();
        scene.BeginConnection();
        var target = Target("body-a", null, "tip-a", 1);
        var ticket = Observe(scene, 1, [target], snapshot: true).Requests.Single();
        Assert.Throws<InvalidOperationException>(() => scene.Complete(ticket,
            () => throw new InvalidOperationException("failed mesh upload")));
        Assert.Null(scene.GetAppliedTarget(Key("body-a")));

        var retry = Observe(scene, 1, [target]).Requests.Single();
        Assert.Equal(MeshCompletionDisposition.IgnoreStale, scene.Complete(ticket));
        var uploads = 0;
        Assert.Equal(MeshCompletionDisposition.Apply, scene.Complete(retry, () => uploads++));
        Assert.Equal(1, uploads);
    }

    [Fact]
    public void AuthenticBlindHoleWindingMatchesOutwardNormalsAndPreservesSemanticTriangleSpans()
    {
        var raw = File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, "Fixtures", "native-blind-hole.meshfb"));
        var update = Kreoda.Protocol.MeshUpdate.GetRootAsMeshUpdate(new Google.FlatBuffers.ByteBuffer(raw));
        static float[] Floats(ArraySegment<byte>? bytes)
        {
            var data = bytes!.Value;
            var values = new float[data.Count / 4];
            Buffer.BlockCopy(data.Array!, data.Offset, values, 0, data.Count);
            return values;
        }
        var indexBytes = update.GetIndicesBytes()!.Value;
        var indices = new uint[indexBytes.Count / 4];
        Buffer.BlockCopy(indexBytes.Array!, indexBytes.Offset, indices, 0, indexBytes.Count);
        var faces = Enumerable.Range(0, update.FacesLength).Select(i => update.Faces(i)!.Value)
            .Select(f => new FaceRange(f.PersistentFaceId!, (int)f.TriangleStart, (int)f.TriangleCount)).ToArray();
        var edges = Enumerable.Range(0, update.EdgesLength).Select(i => update.Edges(i)!.Value)
            .Select(e => new EdgeRange(e.PersistentEdgeId!, (int)e.VertexStart, (int)e.VertexCount)).ToArray();
        var converted = CadMeshTransform.Convert(Floats(update.GetPositionsBytes()), Floats(update.GetNormalsBytes()),
            indices, Floats(update.GetEdgeVerticesBytes()), faces, edges,
            Enumerable.Range(0, 6).Select(update.BboxMm).ToArray());

        Assert.Equal(264, converted.Indices.Length / 3);
        Assert.Equal(new FaceRange("hole-blind:box.+Z", 203, 61), converted.Faces[7]);
        Assert.Equal(faces, converted.Faces);
        for (var t = 0; t < converted.Indices.Length; t += 3)
        {
            var a = (int)converted.Indices[t] * 3;
            var b = (int)converted.Indices[t + 1] * 3;
            var c = (int)converted.Indices[t + 2] * 3;
            var p = converted.Positions;
            var n = converted.Normals;
            double ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
            double vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
            var outward = (uy * vz - uz * vy) * n[a] + (uz * vx - ux * vz) * n[a + 1] +
                (ux * vy - uy * vx) * n[a + 2];
            Assert.True(outward > 0, $"triangle {t / 3} faces inward despite its supplied outward normal");
        }
    }

    [Fact]
    public void CadCoordinatesConvertMillimetersAxesNormalsAndWindingOnce()
    {
        var faces = new[] { new FaceRange("face-a", 0, 1) };
        var edges = new[] { new EdgeRange("edge-a", 0, 2) };
        var result = CadMeshTransform.Convert(
            [12, 23, 34, -5, 10, 75, 2, -7, 9],
            [1, 2, 3, -1, 4, 2, 0, 0, 1],
            [0, 1, 2],
            [11, 22, 33, 44, 55, 66],
            faces,
            edges,
            [10, 20, 30, 40, 50, 60]);

        AssertNear(new float[] { .012f, .034f, .023f, -.005f, .075f, .010f, .002f, .009f, -.007f }, result.Positions);
        Assert.Equal(new float[] { 1, 3, 2, -1, 2, 4, 0, 1, 0 }, result.Normals);
        Assert.Equal(new uint[] { 0, 2, 1 }, result.Indices);
        AssertNear(new float[] { .011f, .033f, .022f, .044f, .066f, .055f }, result.EdgeVertices);
        Assert.Equal(faces, result.Faces);
        Assert.Equal(edges, result.Edges);
        Assert.Equal(new double[] { .01, .03, .02, .04, .06, .05 }, result.BboxMetres);
    }

    [Fact]
    public void SceneCoalescesAndRefreshesChangedSourceAndItsInstancesOnly()
    {
        var scene = new QuestSceneState();
        var generation = scene.BeginConnection();
        var bodyA = Target("body-a", null, "tip-a", 1);
        var instanceA = Target("body-a", "instance-a", "instance-a", 1);
        var bodyB = Target("body-b", null, "tip-b", 1);
        var initial = Observe(scene, 1, [bodyA, instanceA, bodyB], snapshot: true);
        Assert.Equal(3, initial.Requests.Count);
        Assert.All(initial.Requests, ticket => Assert.Equal(generation, ticket.ConnectionGeneration));
        Assert.Empty(Observe(scene, 1, [bodyA, instanceA, bodyB]).Requests);
        foreach (var ticket in initial.Requests) Assert.Equal(MeshCompletionDisposition.Apply, scene.Complete(ticket));

        var oldA = Observe(scene, 2, [Target("body-a", null, "tip-a2", 2), Target("body-a", "instance-a", "instance-a", 2),
            Target("body-b", null, "tip-b", 2)], ["body-a"]);
        Assert.Equal(new[] { "body-a", "instance-a" }, oldA.Requests.Select(ticket => ticket.Key.InstanceId ?? ticket.Key.BodyId).Order().ToArray());
        Assert.Equal(2, scene.GetAppliedTarget(Key("body-b"))!.Revision);

        var stale = Observe(scene, 3, [Target("body-a", null, "tip-a3", 3), Target("body-a", "instance-a", "instance-a", 3),
            Target("body-b", null, "tip-b", 3)], ["body-a"]);
        Assert.Equal(MeshCompletionDisposition.IgnoreStale, scene.Complete(oldA.Requests[0]));
        Assert.Equal(2, stale.Requests.Count);
        Assert.All(stale.Requests, ticket => Assert.Equal(3, ticket.Target.Revision));
    }

    [Fact]
    public void PendingUnchangedBodyIsRetriedAtCurrentRevisionWhenAnotherBodyChanges()
    {
        var scene = new QuestSceneState();
        scene.BeginConnection();
        var initial = Observe(scene, 1, [Target("body-a", null, "tip-a", 1), Target("body-b", null, "tip-b", 1)], snapshot: true);
        var pendingB = initial.Requests.Single(ticket => ticket.Key.BodyId == "body-b");
        var appliedA = initial.Requests.Single(ticket => ticket.Key.BodyId == "body-a");
        Assert.Equal(MeshCompletionDisposition.Apply, scene.Complete(appliedA));

        var update = Observe(scene, 2,
            [Target("body-a", null, "tip-a2", 2), Target("body-b", null, "tip-b", 2)], ["body-a"]);

        Assert.Contains(Key("body-b"), update.Superseded);
        Assert.Equal(MeshCompletionDisposition.IgnoreStale, scene.Complete(pendingB));
        var currentB = update.Requests.Single(ticket => ticket.Key.BodyId == "body-b");
        Assert.Equal(2, currentB.Target.Revision);
        Assert.Equal(MeshCompletionDisposition.Apply, scene.Complete(currentB));
        Assert.Equal(2, scene.GetAppliedTarget(Key("body-b"))!.Revision);
    }

    [Fact]
    public void ObservationsRejectOutOfOrderRevisionsDocumentsAndConnectionCallbacks()
    {
        var scene = new QuestSceneState();
        scene.BeginConnection();
        var initialStamp = scene.CaptureObservation(scene.ConnectionGeneration, SessionId, DocumentId, 1);
        var initial = scene.Reconcile(initialStamp, [Target("body-a", null, "tip-a", 1)], snapshot: true);
        Assert.Equal(MeshCompletionDisposition.Apply, scene.Complete(initial.Requests.Single()));

        var delayedRevision = scene.CaptureObservation(scene.ConnectionGeneration, SessionId, DocumentId, 2, ["body-a"]);
        var newestRevision = scene.CaptureObservation(scene.ConnectionGeneration, SessionId, DocumentId, 3);
        var current = scene.Reconcile(newestRevision, [Target("body-a", null, "tip-a", 3)]);
        Assert.Single(current.Requests); // unchanged tip, but the skipped rev-2 edit is retained
        Assert.True(scene.Reconcile(delayedRevision, [Target("body-a", null, "tip-old", 2)]).IgnoredStaleObservation);
        Assert.Equal(MeshCompletionDisposition.Apply, scene.Complete(current.Requests.Single()));

        var delayedDocument = scene.CaptureObservation(scene.ConnectionGeneration, SessionId, DocumentId, 4, ["body-a"]);
        var replacementDocument = scene.CaptureObservation(scene.ConnectionGeneration, SessionId, "doc-b", 0);
        var replacement = scene.Reconcile(replacementDocument, [Target("body-a", null, "tip-new", 0, documentId: "doc-b")], snapshot: true);
        Assert.Single(replacement.Requests);
        Assert.True(scene.Reconcile(delayedDocument, [Target("body-a", null, "tip-a", 4)]).IgnoredStaleObservation);
        Assert.Equal(MeshCompletionDisposition.Apply, scene.Complete(replacement.Requests.Single()));

        var oldConnection = scene.CaptureObservation(scene.ConnectionGeneration, SessionId, "doc-b", 1, ["body-a"]);
        scene.InvalidateConnection();
        scene.BeginConnection();
        var newConnection = scene.CaptureObservation(scene.ConnectionGeneration, SessionId, "doc-b", 2);
        var connected = scene.Reconcile(newConnection, [Target("body-a", null, "tip-new", 2, documentId: "doc-b")], snapshot: true);
        Assert.Single(connected.Requests);
        Assert.True(scene.Reconcile(oldConnection, [Target("body-a", null, "tip-old", 1, documentId: "doc-b")]).IgnoredStaleObservation);
    }

    [Fact]
    public void ChangedIdsAccumulateAcrossSkippedDeltasAndRefreshSameTipOnlyOnce()
    {
        var scene = new QuestSceneState();
        scene.BeginConnection();
        var initial = Observe(scene, 1,
            [Target("body-a", null, "tip-a", 1), Target("body-b", null, "tip-b", 1)], snapshot: true);
        foreach (var ticket in initial.Requests) Assert.Equal(MeshCompletionDisposition.Apply, scene.Complete(ticket));

        // These are captured when received, before their associated async snapshots finish.
        var skippedA = scene.CaptureObservation(scene.ConnectionGeneration, SessionId, DocumentId, 2, ["body-a"]);
        scene.CaptureObservation(scene.ConnectionGeneration, SessionId, DocumentId, 3, ["body-b"]);
        var latest = scene.CaptureObservation(scene.ConnectionGeneration, SessionId, DocumentId, 3);
        var changed = scene.Reconcile(latest,
            [Target("body-a", null, "tip-a", 3), Target("body-b", null, "tip-b2", 3)]);
        Assert.Equal(new[] { "body-a", "body-b" }, changed.Requests.Select(ticket => ticket.Key.BodyId).Order().ToArray());
        Assert.True(scene.Reconcile(skippedA,
            [Target("body-a", null, "tip-a-old", 2), Target("body-b", null, "tip-b", 2)]).IgnoredStaleObservation);
        foreach (var ticket in changed.Requests) Assert.Equal(MeshCompletionDisposition.Apply, scene.Complete(ticket));

        var steady = Observe(scene, 4,
            [Target("body-a", null, "tip-a", 4), Target("body-b", null, "tip-b2", 4)]);
        Assert.Empty(steady.Requests);
    }

    [Fact]
    public void RemovedObjectAndOldConnectionCallbacksCannotResurrectGeometry()
    {
        var scene = new QuestSceneState();
        scene.BeginConnection();
        var initial = Observe(scene, 1, [Target("body-a", null, "tip-a", 1)], snapshot: true);
        var first = initial.Requests.Single();
        Assert.Equal(MeshCompletionDisposition.Apply, scene.Complete(first));

        var pending = Observe(scene, 2, [Target("body-a", null, "tip-a2", 2)], ["body-a"]).Requests.Single();
        var removed = Observe(scene, 3, []);
        Assert.Contains(Key("body-a"), removed.Removed);
        Assert.Equal(MeshCompletionDisposition.IgnoreStale, scene.Complete(pending));
        Assert.Null(scene.GetAppliedTarget(Key("body-a")));

        var afterReconnect = Observe(scene, 4, [Target("body-a", null, "tip-a2", 4)], snapshot: true).Requests.Single();
        Assert.Equal(MeshCompletionDisposition.Apply, scene.Complete(afterReconnect));
        var previousConnection = Observe(scene, 5, [Target("body-a", null, "tip-a3", 5)], ["body-a"]).Requests.Single();
        scene.InvalidateConnection();
        var nextGeneration = scene.BeginConnection();
        var reconnectedStamp = scene.CaptureObservation(scene.ConnectionGeneration, SessionId, DocumentId, 5);
        var reconnected = scene.Reconcile(reconnectedStamp, [Target("body-a", null, "tip-a3", 5)], snapshot: true).Requests.Single();
        Assert.True(reconnected.ConnectionGeneration > previousConnection.ConnectionGeneration);
        Assert.Equal(MeshCompletionDisposition.IgnoreStale, scene.Complete(previousConnection));
        Assert.Equal(nextGeneration, reconnected.ConnectionGeneration);
    }

    [Fact]
    public void NativeEdgeHitLookupIsAdditiveAndReportsRepeatedReferences()
    {
        var mesh = new BodyMesh("body-a", new float[9], new float[9], [0, 1, 2], new List<FaceRange>(),
            [new("edge-a", 4, 3), new("edge-a", 10, 2)]);
        var first = mesh.ResolveEdgeByNativeVertexIndex(4)!;
        var second = mesh.ResolveEdgeByNativeVertexIndex(10)!;
        Assert.Equal(new MeshSemanticHit("edge-a", 4, 3, true), first);
        Assert.Equal(new MeshSemanticHit("edge-a", 10, 2, true), second);
        Assert.Null(mesh.ResolveEdgeByNativeVertexIndex(0));
        Assert.Equal("edge-a", mesh.ResolveEdge(0));
        Assert.Equal("edge-a", mesh.ResolveEdge(2));
        Assert.Null(mesh.ResolveEdge(3));
    }

    [Fact]
    public void RepeatedFaceIdKeepsClickedSpanAndWithholdsAmbiguousSemanticSelection()
    {
        var mesh = new BodyMesh("hole-blind", new float[264 * 3], new float[264 * 3],
            Enumerable.Range(0, 264 * 3).Select(index => (uint)(index % 264)).ToArray(),
            [new("hole-blind:box.+Z", 4, 67), new("hole-blind:box.+Z", 203, 61)],
            new List<EdgeRange>());

        var hit = mesh.ResolveFaceHit(205);

        Assert.Equal(new MeshSemanticHit("hole-blind:box.+Z", 203, 61, true), hit);
        Assert.Null(mesh.ResolveFace(205));
        Assert.Null(mesh.ResolveFace(100));
    }

    private static SceneMeshTarget Target(string bodyId, string? instanceId, string featureId, long revision,
        string sessionId = SessionId, string documentId = DocumentId) =>
        new(bodyId, instanceId, featureId, sessionId, documentId, revision);

    private static SceneReconcilePlan Observe(QuestSceneState scene, long revision, IEnumerable<SceneMeshTarget> targets,
        IEnumerable<string>? changedBodyIds = null, bool snapshot = false) =>
        scene.Reconcile(scene.CaptureObservation(scene.ConnectionGeneration, SessionId, DocumentId, revision, changedBodyIds), targets, snapshot);

    private static SceneObjectKey Key(string bodyId, string? instanceId = null) => new(bodyId, instanceId);

    private static void AssertNear(float[] expected, float[] actual)
    {
        Assert.Equal(expected.Length, actual.Length);
        for (var index = 0; index < expected.Length; index++)
            Assert.InRange(Math.Abs(expected[index] - actual[index]), 0, 0.000001f);
    }
}
