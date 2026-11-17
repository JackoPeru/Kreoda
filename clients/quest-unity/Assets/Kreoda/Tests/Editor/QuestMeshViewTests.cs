using System;
using System.Collections;
using System.IO;
using System.Linq;
using Google.FlatBuffers;
using Kreoda.Protocol;
using Kreoda.QuestFoundation;
using Kreoda.Session;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;
using UnityEditor.SceneManagement;

namespace Kreoda.QuestRuntime.Tests
{
    public class QuestMeshViewTests
    {
        internal static SessionMeshResult NativeFixture()
        {
            var file = Path.GetFullPath(Path.Combine(Application.dataPath,
                "../../../packages/protocol/fixtures/native-blind-hole.meshfb"));
            var raw = File.ReadAllBytes(file);
            var source = MeshUpdate.GetRootAsMeshUpdate(new ByteBuffer(raw));
            float[] Floats(ArraySegment<byte>? segment)
            {
                var bytes = segment.Value;
                var result = new float[bytes.Count / 4];
                Buffer.BlockCopy(bytes.Array, bytes.Offset, result, 0, bytes.Count);
                return result;
            }
            var indicesBytes = source.GetIndicesBytes().Value;
            var indices = new uint[indicesBytes.Count / 4];
            Buffer.BlockCopy(indicesBytes.Array, indicesBytes.Offset, indices, 0, indicesBytes.Count);
            return new SessionMeshResult(new SessionMeshHeader(source.RequestId,
                "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "fixture-doc", source.Revision,
                "body-root", source.FeatureId, source.FeatureId, source.Lod, raw.Length),
                Floats(source.GetPositionsBytes()), Floats(source.GetNormalsBytes()), indices,
                Floats(source.GetEdgeVerticesBytes()),
                Enumerable.Range(0, source.FacesLength).Select(i => source.Faces(i).Value)
                    .Select(f => new SessionMeshFaceRange(f.PersistentFaceId, f.TriangleStart, f.TriangleCount)).ToArray(),
                Enumerable.Range(0, source.EdgesLength).Select(i => source.Edges(i).Value)
                    .Select(e => new SessionMeshEdgeRange(e.PersistentEdgeId, e.VertexStart, e.VertexCount)).ToArray(),
                source.VolumeMm3, Enumerable.Range(0, 6).Select(source.BboxMm).ToArray(), raw.Length,
                "55439bd83ce5ab6ba050576e3e7912da0cde0c433cc5eb0ea4ebc00a0e4f142a");
        }

        [Test]
        public void ActualNativeFacesArePickableFromOutsideWithUnchangedTriangleToSemanticMap()
        {
            var body = new GameObject("CAD fixture");
            try
            {
                var view = body.AddComponent<QuestMeshView>();
                view.Upload(NativeFixture());
                Physics.SyncTransforms();
                Assert.That(body.GetComponent<MeshFilter>(), Is.Not.Null, "native CAD surface was not uploaded");
                Assert.That(body.GetComponent<MeshCollider>(), Is.Not.Null, "native CAD surface cannot be picked");
                var mesh = body.GetComponent<MeshFilter>().sharedMesh;
                var collider = body.GetComponent<MeshCollider>();
                var vertices = mesh.vertices;
                var normals = mesh.normals;
                var indices = mesh.triangles;
                Assert.That(indices.Length / 3, Is.EqualTo(264));
                Assert.That(view.BodyId, Is.EqualTo("body-root"));
                Assert.That(view.FeatureId, Is.EqualTo("hole-blind"));
                foreach (var triangle in new[] { 0, 2, 4, 71, 73, 75, 77, 203 })
                {
                    var a = indices[triangle * 3];
                    var centre = (vertices[a] + vertices[indices[triangle * 3 + 1]] +
                        vertices[indices[triangle * 3 + 2]]) / 3;
                    var outward = normals[a].normalized;
                    Assert.That(collider.Raycast(new Ray(centre + outward * 0.00001f, -outward), out var hit, 0.00003f),
                        Is.True, "outside ray missed native face at triangle " + triangle);
                    Assert.That(hit.triangleIndex, Is.EqualTo(triangle));
                    var semantic = view.ResolveFace(hit.triangleIndex);
                    Assert.That(semantic.RangeStart, Is.LessThanOrEqualTo(triangle));
                    Assert.That(semantic.RangeStart + semantic.RangeCount, Is.GreaterThan(triangle));
                    if (triangle == 203)
                    {
                        Assert.That(semantic.PersistentId, Is.EqualTo("hole-blind:box.+Z"));
                        Assert.That(semantic.ReferenceAmbiguous, Is.True);
                    }
                }
            }
            finally { UnityEngine.Object.DestroyImmediate(body); }
        }

        [Test]
        public void ReplacingOneBodyRetainsItsObjectAndDisposesOnlyItsPreviousMesh()
        {
            var body = new GameObject("changed body");
            var untouched = new GameObject("untouched body");
            try
            {
                var view = body.AddComponent<QuestMeshView>();
                var other = untouched.AddComponent<QuestMeshView>();
                view.Upload(NativeFixture());
                other.Upload(NativeFixture());
                Assert.That(body.GetComponent<MeshFilter>(), Is.Not.Null, "changed body has no rendered CAD mesh");
                var oldMesh = body.GetComponent<MeshFilter>().sharedMesh;
                var retainedMesh = untouched.GetComponent<MeshFilter>().sharedMesh;
                view.Upload(NativeFixture());
                Assert.That(oldMesh == null, Is.True);
                Assert.That(view.gameObject, Is.SameAs(body));
                Assert.That(untouched.GetComponent<MeshFilter>().sharedMesh, Is.SameAs(retainedMesh));
                Assert.That(retainedMesh == null, Is.False);
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(body);
                UnityEngine.Object.DestroyImmediate(untouched);
            }
        }

        [UnityTest]
        public IEnumerator DestroyingBodyDisposesSurfaceEdgesAndSelectionWithoutDestroyingSharedMaterial()
        {
            // OnDestroy is a player lifecycle callback; EditMode never awakens
            // ordinary runtime behaviours. Exercise actual PlayMode destruction.
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            yield return new EnterPlayMode();
            var body = new GameObject("owned CAD resources");
            var material = new Material(Shader.Find("Unlit/Color"));
            Mesh[] owned = Array.Empty<Mesh>();
            try
            {
                var view = body.AddComponent<QuestMeshView>();
                view.SurfaceMaterial = view.EdgeMaterial = view.SelectionMaterial = material;
                view.Upload(NativeFixture());
                view.SelectFace(view.ResolveFace(0));
                owned = body.GetComponentsInChildren<MeshFilter>().Select(filter => filter.sharedMesh).ToArray();
                Assert.That(owned.Length, Is.EqualTo(3));
                Assert.That(owned.All(mesh => mesh != null), Is.True);
                UnityEngine.Object.Destroy(body);
                yield return null;
                Assert.That(owned.All(mesh => mesh == null), Is.True, "destroyed body leaked native Unity meshes");
                Assert.That(material == null, Is.False, "body must not destroy shared material assets");
            }
            finally
            {
                if (body != null) UnityEngine.Object.DestroyImmediate(body);
                UnityEngine.Object.DestroyImmediate(material);
            }
            yield return new ExitPlayMode();
        }
    }
}
