using System;
using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;

namespace Kreoda.QuestRuntime.Tests
{
    public sealed class QuestRoomSurfaceProviderTests
    {
        [Test]
        public void EditorNeverStartsSceneCaptureOrClaimsAnEnvironmentSurface()
        {
            var go = new GameObject("Isolated opt-in gate");
            try
            {
                var provider = go.AddComponent<QuestRoomSurfaceProvider>();
                Assert.That(provider.OptedIn, Is.False);
                Assert.That(provider.SceneLoaded, Is.False);
                provider.BeginDiscovery();
                Assert.That(provider.OptedIn, Is.False);
                Assert.That(provider.SceneLoaded, Is.False);
                Assert.That(provider.RequestRoomSetup(), Is.False);
                Assert.That(provider.TryGetTableContact(AimAt(new Vector3(0, .8f, 1)), out _),
                    Is.False);
            }
            finally { UnityEngine.Object.DestroyImmediate(go); }
        }

        static QuestRoomSurfaceProvider.RoomPlaneSnapshot Table(
            float x = 0f, float z = 1f, float y = .8f, string label = "TABLE")
        {
            return new QuestRoomSurfaceProvider.RoomPlaneSnapshot
            {
                AnchorId = Guid.NewGuid(),
                FromSceneAnchor = true,
                SpaceValid = true,
                Tracked = true,
                HasBoundedPlane = true,
                Labels = new[] { label },
                LocalToWorld = Matrix4x4.TRS(new Vector3(x, y, z),
                    Quaternion.LookRotation(Vector3.up, Vector3.forward), Vector3.one),
                Boundary = new[] {
                    new Vector2(-.5f, -.5f), new Vector2(.5f, -.5f),
                    new Vector2(.5f, .5f), new Vector2(-.5f, .5f)
                }
            };
        }

        static Ray AimAt(Vector3 target) =>
            new Ray(new Vector3(0f, 1.65f, 0f), (target - new Vector3(0f, 1.65f, 0f)).normalized);

        static bool Find(Ray ray, IEnumerable<QuestRoomSurfaceProvider.RoomPlaneSnapshot> planes,
            out QuestRoomSurfaceProvider.SurfaceHit hit, bool granted = true, bool loaded = true) =>
            QuestRoomSurfaceProvider.TryFindInSnapshots(ray, planes, granted, loaded, out hit);

        [Test]
        public void RequiresExplicitlyLoadedSceneAndAuthorizedSpatialData()
        {
            var table = Table();
            var ray = AimAt(new Vector3(0, .8f, 1));
            Assert.That(Find(ray, new[] { table }, out _, granted: false), Is.False);
            Assert.That(Find(ray, new[] { table }, out _, loaded: false), Is.False);
            Assert.That(Find(ray, Array.Empty<QuestRoomSurfaceProvider.RoomPlaneSnapshot>(), out _), Is.False);
            Assert.That(Find(ray, new[] { table }, out var hit), Is.True);
            Assert.That(hit.AnchorId, Is.EqualTo(table.AnchorId));
            Assert.That(Vector3.Distance(hit.Point, new Vector3(0, .8f, 1)), Is.LessThan(.0001f));
        }

        [TestCase("TABLE", true)]
        [TestCase("DESK", true)]
        [TestCase("FLOOR", false)]
        [TestCase("WALL_FACE", false)]
        [TestCase("", false)]
        public void AcceptsOnlyTableSemanticClasses(string label, bool expected)
        {
            Assert.That(Find(AimAt(new Vector3(0, .8f, 1)), new[] { Table(label: label) }, out _),
                Is.EqualTo(expected));
        }

        [Test]
        public void RejectsSyntheticSceneDataUntrackedAnchorsAndVolumeOnly()
        {
            var ray = AimAt(new Vector3(0, .8f, 1));
            var synthetic = Table(); synthetic.FromSceneAnchor = false;
            var invalidSpace = Table(); invalidSpace.SpaceValid = false;
            var lostTracking = Table(); lostTracking.Tracked = false;
            var volumeOnly = Table(); volumeOnly.HasBoundedPlane = false;
            foreach (var invalid in new[] { synthetic, invalidSpace, lostTracking, volumeOnly })
                Assert.That(Find(ray, new[] { invalid }, out _), Is.False);
        }

        [Test]
        public void RejectsMissingDegenerateAndNotYetLoadedBoundaries()
        {
            var ray = AimAt(new Vector3(0, .8f, 1));
            var noBounds = Table(); noBounds.Boundary = null;
            var pending = Table(); pending.Boundary = Array.Empty<Vector2>();
            var line = Table(); line.Boundary = new[] {
                Vector2.zero, Vector2.right, new Vector2(2, 0) };
            var nonFinite = Table(); nonFinite.Boundary = new[] {
                Vector2.zero, Vector2.right, new Vector2(float.NaN, 1), Vector2.up };
            foreach (var invalid in new[] { noBounds, pending, line, nonFinite })
                Assert.That(Find(ray, new[] { invalid }, out _), Is.False);
        }

        [Test]
        public void IntersectionMustLieInsideRealBoundedPolygonAndWithinRange()
        {
            var table = Table();
            Assert.That(Find(AimAt(new Vector3(0, .8f, 1)), new[] { table }, out _), Is.True);
            Assert.That(Find(AimAt(new Vector3(.5f, .8f, 1)), new[] { table }, out _), Is.True,
                "A valid exact polygon edge is a contact");
            Assert.That(Find(AimAt(new Vector3(.7f, .8f, 1)), new[] { table }, out _), Is.False);
            Assert.That(Find(new Ray(new Vector3(0, 1.65f, 0), Vector3.up),
                new[] { table }, out _), Is.False);
            Assert.That(Find(AimAt(new Vector3(0, .8f, 1)),
                new[] { Table(z: 6.5f) }, out _), Is.False);
        }

        [Test]
        public void PicksNearestValidTableNotAnArbitraryColliderOrFarthestPlane()
        {
            var near = Table(z: 1f);
            var far = Table(z: 2f);
            var ray = new Ray(new Vector3(0, 1.65f, 0), new Vector3(0, -.85f, 1).normalized);
            // Both tables must lie on the same ray to compare travel distance.
            far.LocalToWorld = Matrix4x4.TRS(new Vector3(0, -.05f, 2),
                Quaternion.LookRotation(Vector3.up, Vector3.forward), Vector3.one);
            Assert.That(Find(ray, new[] { far, near }, out var hit), Is.True);
            Assert.That(hit.AnchorId, Is.EqualTo(near.AnchorId));
        }

        [Test]
        public void RejectsVerticalUpsideDownAndNonFiniteTransformsOrRays()
        {
            var table = Table();
            var invalidTransform = Table(); invalidTransform.LocalToWorld = Matrix4x4.TRS(
                new Vector3(float.PositiveInfinity, 0, 0), Quaternion.identity, Vector3.one);
            var wall = Table(); wall.LocalToWorld = Matrix4x4.TRS(new Vector3(0, .8f, 1),
                Quaternion.identity, Vector3.one);
            var underside = Table(); underside.LocalToWorld = Matrix4x4.TRS(new Vector3(0, .8f, 1),
                Quaternion.LookRotation(Vector3.down, Vector3.forward), Vector3.one);
            foreach (var invalid in new[] { invalidTransform, wall, underside })
                Assert.That(Find(AimAt(new Vector3(0, .8f, 1)), new[] { invalid }, out _), Is.False);
            Assert.That(Find(new Ray(Vector3.zero, new Vector3(float.NaN, 0, 1)),
                new[] { table }, out _), Is.False);
            Assert.That(Find(new Ray(Vector3.zero, Vector3.zero), new[] { table }, out _), Is.False);
        }

        [Test]
        public void RejectsStaleSceneAndRevokedPermissionWithoutReusingPriorHit()
        {
            var table = Table();
            var ray = AimAt(new Vector3(0, .8f, 1));
            Assert.That(Find(ray, new[] { table }, out var first), Is.True);
            table.Tracked = false;
            Assert.That(Find(ray, new[] { table }, out var lost), Is.False);
            Assert.That(lost.AnchorId, Is.EqualTo(Guid.Empty));
            table.Tracked = true;
            Assert.That(Find(ray, new[] { table }, out _, loaded: false), Is.False);
            Assert.That(Find(ray, new[] { table }, out _, granted: false), Is.False);
            Assert.That(first.AnchorId, Is.Not.EqualTo(Guid.Empty));
        }

        [Test]
        public void MovingTrackedAnchorInvalidatesOldIntersectionAndUsesNewPose()
        {
            var table = Table();
            var previousRay = AimAt(new Vector3(0, .8f, 1));
            Assert.That(Find(previousRay, new[] { table }, out var first), Is.True);

            // Same authenticated anchor UUID, but its latest SDK pose has moved.
            // No contact point from a previous evaluation may be reused.
            table.LocalToWorld = Matrix4x4.TRS(new Vector3(2, .8f, 1),
                Quaternion.LookRotation(Vector3.up, Vector3.forward), Vector3.one);
            Assert.That(Find(previousRay, new[] { table }, out var oldHit), Is.False);
            Assert.That(oldHit.AnchorId, Is.EqualTo(Guid.Empty));
            Assert.That(Find(AimAt(new Vector3(2, .8f, 1)), new[] { table }, out var moved), Is.True);
            Assert.That(moved.AnchorId, Is.EqualTo(first.AnchorId));
            Assert.That(Vector3.Distance(moved.Point, new Vector3(2, .8f, 1)), Is.LessThan(.0001f));
        }

        [Test]
        public void RotatedPolygonIsTestedInPlaneLocalCoordinates()
        {
            var table = Table();
            table.LocalToWorld = Matrix4x4.TRS(new Vector3(0, .8f, 1),
                Quaternion.LookRotation(Vector3.up, Vector3.forward) * Quaternion.AngleAxis(45, Vector3.forward),
                Vector3.one);
            Assert.That(Find(AimAt(new Vector3(0, .8f, 1)), new[] { table }, out _), Is.True);
            Assert.That(Find(AimAt(new Vector3(.7f, .8f, 1)), new[] { table }, out _), Is.True,
                "Rotate the square around its normal; corner near x=.707 is inside");
            Assert.That(Find(AimAt(new Vector3(.8f, .8f, 1)), new[] { table }, out _), Is.False);
        }
    }
}
