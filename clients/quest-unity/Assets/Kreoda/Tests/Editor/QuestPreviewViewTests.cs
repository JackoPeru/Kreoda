using System;
using System.Collections.Generic;
using System.Text.Json;
using Kreoda.QuestFoundation;
using Kreoda.Session;
using NUnit.Framework;
using UnityEngine;

namespace Kreoda.QuestRuntime.Tests
{
    public class QuestPreviewViewTests
    {
        static SpatialEditIntent Intent()
        {
            using var metadata = JsonDocument.Parse("{\"id\":\"width\",\"type\":\"linear\",\"parameter\":\"widthMm\",\"unit\":\"mm\",\"origin\":[100,25,10],\"axis\":[1,0,0]}");
            return new SpatialEditIntent("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "fixture-doc", 7,
                "owner", "body-root", "hole-blind", metadata.RootElement, new Dictionary<string,double> { ["widthMm"] = 100 });
        }
        static SessionPreviewMeshResult Candidate(long generation)
        {
            var mesh = QuestMeshViewTests.NativeFixture();
            return new SessionPreviewMeshResult(new SessionPreviewMeshHeader("raw-" + generation,
                "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "fixture-doc", 7, "preview-owned", generation,
                "owner", "widthMm", "body-root", "hole-blind", 0, mesh.RawByteLength), mesh);
        }
        [Test]
        public void CandidateIsSeparateUnpickableAndCannotOutliveItsGesture()
        {
            var owned = new GameObject("Owned ghost test");
            var material = new Material(Shader.Find("Kreoda/Selection"));
            try
            {
                var committed = new GameObject("Committed").AddComponent<QuestMeshView>();
                committed.transform.SetParent(owned.transform);committed.Upload(QuestMeshViewTests.NativeFixture());
                var original = committed.GetComponent<MeshFilter>().sharedMesh;
                var ghost = new GameObject("Preview").AddComponent<QuestPreviewView>();
                ghost.transform.SetParent(owned.transform);ghost.Material = material;
                var ticket = ghost.Begin(Intent(), original);
                var baseline = ghost.GetComponent<MeshFilter>().sharedMesh;
                Assert.That(baseline, Is.Not.SameAs(original));
                Assert.That(baseline.vertices, Is.EqualTo(original.vertices));
                Assert.That(ghost.TryUpload(ticket, Candidate(1), () => true), Is.True);
                Assert.That(baseline == null, Is.True, "owned baseline clone must be disposed on authoritative replacement");
                Assert.That(ghost.GetComponentsInChildren<Collider>(), Is.Empty);
                Assert.That(ghost.GetComponentsInChildren<QuestMeshView>(), Is.Empty);
                Assert.That(committed.GetComponent<MeshFilter>().sharedMesh, Is.SameAs(original));
                var first = ghost.GetComponent<MeshFilter>().sharedMesh;
                ghost.Predict(ticket, Vector3.zero, new Vector3(.12f, .025f, .01f));
                Assert.That(ghost.GetComponent<MeshRenderer>().enabled, Is.True, "prediction must retain previous accepted solid");
                Assert.That(ghost.GetComponent<MeshFilter>().sharedMesh, Is.SameAs(first));
                Assert.That(ghost.GetComponentInChildren<LineRenderer>().GetPosition(1), Is.EqualTo(new Vector3(.12f, .025f, .01f)));
                Assert.That(ghost.TryUpload(ticket, Candidate(2), () => false), Is.False);
                Assert.That(ghost.GetComponent<MeshFilter>().sharedMesh, Is.SameAs(first));
                Assert.That(ghost.TryUpload(ticket, Candidate(2), () => true), Is.True);
                Assert.That(first == null, Is.True, "owned replaced mesh must be disposed in EditMode");
                var second = ghost.GetComponent<MeshFilter>().sharedMesh;
                ghost.Clear();Assert.That(second == null, Is.True);
                Assert.That(ghost.TryUpload(ticket, Candidate(3), () => true), Is.False);
                ghost.Begin(Intent());Assert.That(ghost.TryUpload(ticket, Candidate(4), () => true), Is.False);
                Assert.That(material == null, Is.False, "referenced material is shared, not owned");
            }
            finally { UnityEngine.Object.DestroyImmediate(owned);UnityEngine.Object.DestroyImmediate(material); }
        }
    }
}
