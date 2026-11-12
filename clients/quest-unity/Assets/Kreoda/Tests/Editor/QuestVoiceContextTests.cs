using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using Kreoda.QuestFoundation;
using Kreoda.Session;
using NUnit.Framework;
using UnityEngine;
using Object = UnityEngine.Object;

namespace Kreoda.QuestRuntime.Tests
{
    public sealed class QuestVoiceContextTests
    {
        const BindingFlags Private = BindingFlags.Instance | BindingFlags.NonPublic;
        GameObject _root;
        QuestVoiceContext _context;
        QuestConnection _connection;
        SessionClient _client;
        SessionModelState _model;
        QuestVoiceContext.VoiceFence _fence;

        [SetUp]
        public void SetUp()
        {
            _root = new GameObject("Voice context tests");
            _connection = _root.AddComponent<QuestConnection>();
            _context = _root.AddComponent<QuestVoiceContext>();
            _client = (SessionClient)typeof(SessionClient).GetConstructor(Private, null, Type.EmptyTypes, null).Invoke(null);
            _model = Model(8);
            _fence = Fence(_model, 3);
            _context.EnterExplicit(_fence);
        }

        [TearDown]
        public void TearDown() => Object.DestroyImmediate(_root);

        static SessionModelState Model(long revision) => new SessionModelState("session-a", "document-a", revision,
            Array.Empty<JsonElement>(), Array.Empty<JsonElement>(), Array.Empty<JsonElement>());

        QuestVoiceContext.VoiceFence Fence(SessionModelState model, long generation, string document = "document-a") =>
            new QuestVoiceContext.VoiceFence(_connection, _client, model, generation,
                model.SessionId, document, model.Revision);

        static Dictionary<string, object> Semantic(string kind, string id) =>
            QuestSemanticContext.Build(kind, id, "body-a", "feature-a");

        bool Toggle(string kind, string id, object source = null, Func<bool> current = null, int upload = 1)
        {
            source ??= new object();current ??= () => true;
            return _context.ToggleSelection(_fence, id, Semantic(kind, id), source, upload, current);
        }

        static Vector3 DisplayPoint(Transform root, CadVector cad)
        {
            var world = QuestSpatialEdit.CaptureFrame(root).ToWorld(cad);
            return new Vector3((float)world.X, (float)world.Y, (float)world.Z);
        }

        bool CapturePoint(Transform root, Vector3 world)
        {
            Assert.That(_context.ArmPoint(_fence, 1), Is.True);
            Assert.That(_context.ObservePointGesture(_fence, 1, true, false, false, true, world, root), Is.False,
                "the arming pinch must be released first");
            return _context.ObservePointGesture(_fence, 1, true, true, true, true, world, root);
        }

        [Test]
        public void ExplicitCollectionKeepsTwoFacesAndFourEdgesOrderedAndClearNeverFallsBack()
        {
            var ids = new[] { "box-a:face.0", "box-a:face.1", "box-a:edge.0", "box-a:edge.1", "box-a:edge.2", "box-a:edge.3" };
            var kinds = new[] { "face", "face", "edge", "edge", "edge", "edge" };
            for (var i = 0; i < ids.Length; i++) Assert.That(Toggle(kinds[i], ids[i]), Is.True);

            Assert.That(_context.Count, Is.EqualTo(6));
            Assert.That(_context.TryCaptureSnapshot(_fence, null, out var snapshot, out var error), Is.True, error);
            using (var payload = JsonDocument.Parse(snapshot.ContextJson))
            {
                var selected = payload.RootElement.GetProperty("selections");
                Assert.That(payload.RootElement.GetProperty("version").GetInt32(), Is.EqualTo(2));
                Assert.That(selected.GetArrayLength(), Is.EqualTo(6));
                Assert.That(selected.EnumerateArray().Select(item => item.GetProperty("kind").GetString()), Is.EqualTo(kinds));
                Assert.That(selected.EnumerateArray().Select(item => item.GetProperty("persistentId").GetString()), Is.EqualTo(ids));
                Assert.That(snapshot.SelectionIds, Is.EqualTo(ids));
            }

            Assert.That(Toggle("face", ids[0]), Is.True, "selecting an existing canonical id toggles it off");
            Assert.That(_context.Count, Is.EqualTo(5));
            _context.ClearCollection();
            Assert.That(_context.ExplicitMode, Is.True);
            Assert.That(_context.Count, Is.Zero);
            Assert.That(_context.SemanticContext()["version"], Is.EqualTo(2));
            Assert.That(_context.TryCaptureSnapshot(_fence, null, out _, out error), Is.False);
            Assert.That(error, Does.Contain("riferimento").Or.Contain("punto"));
        }

        [Test]
        public void ExplicitContextAcceptsUpToCanonicalLimit64()
        {
            for (var i = 0; i < QuestVoiceContext.MaxSelections; i++)
                Assert.That(Toggle("edge", "body-a:edge." + i), Is.True);
            Assert.That(Toggle("edge", "body-a:edge.64"), Is.False);
            Assert.That(_context.Count, Is.EqualTo(64));
        }

        [Test]
        public void PointOnlyAndCombinedPayloadUseCadMillimetresWithoutFeatureId()
        {
            var display = new GameObject("Rotated CAD display").transform;
            display.SetParent(_root.transform, false);
            display.position = new Vector3(1.2f, -.7f, 2.3f);
            display.rotation = Quaternion.Euler(17, 41, -13);
            display.localScale = Vector3.one * 1.6f;
            var expected = new CadVector(17.5, -24.25, 39.75);
            var world = DisplayPoint(display, expected);

            Assert.That(Vector3.Dot(Vector3.Cross(display.right, display.forward), display.up), Is.LessThan(-.99f),
                "CAD frame preserves Unity's Y/Z reflection");
            Assert.That(CapturePoint(display, world), Is.True);
            Assert.That(_context.TryCaptureSnapshot(_fence, display, out var pointOnly, out var error), Is.True, error);
            using (var payload = JsonDocument.Parse(pointOnly.ContextJson))
            {
                var selected = payload.RootElement.GetProperty("selections");
                Assert.That(selected.GetArrayLength(), Is.Zero);
                var point = payload.RootElement.GetProperty("referencePoint");
                Assert.That(point.GetProperty("coordinateSystem").GetString(), Is.EqualTo("cad"));
                Assert.That(point.GetProperty("source").GetString(), Is.EqualTo("quest-mr"));
                Assert.That(point.TryGetProperty("featureId", out _), Is.False);
                var values = point.GetProperty("positionMm").EnumerateArray().Select(item => item.GetDouble()).ToArray();
                Assert.That(values[0], Is.EqualTo(expected.X).Within(.001));
                Assert.That(values[1], Is.EqualTo(expected.Y).Within(.001));
                Assert.That(values[2], Is.EqualTo(expected.Z).Within(.001));
            }

            _context.ClearCollection();
            Assert.That(Toggle("face", "box-a:face.7"), Is.True);
            Assert.That(CapturePoint(display, world), Is.True);
            Assert.That(_context.TryCaptureSnapshot(_fence, display, out var combined, out error), Is.True, error);
            using var both = JsonDocument.Parse(combined.ContextJson);
            Assert.That(both.RootElement.GetProperty("selections").GetArrayLength(), Is.EqualTo(1));
            Assert.That(both.RootElement.TryGetProperty("referencePoint", out _), Is.True);
            Object.DestroyImmediate(display.gameObject);
        }

        [Test]
        public void FrameRejectsNonFinitePointsAndNonUniformScale()
        {
            var display = new GameObject("Invalid CAD display").transform;
            display.SetParent(_root.transform, false);
            display.localScale = new Vector3(1, 1.1f, 1);
            Assert.Throws<ArgumentException>(() => QuestSpatialEdit.CaptureFrame(display));
            display.localScale = Vector3.one;
            var frame = QuestSpatialEdit.CaptureFrame(display);
            Assert.Throws<ArgumentException>(() => QuestVoiceContext.ToCadPoint(frame, new Vector3(float.NaN, 0, 0)));
            Object.DestroyImmediate(display.gameObject);
        }

        [Test]
        public void ModelGenerationAndUploadChangesInvalidateCapturedSelections()
        {
            var current = true;
            Assert.That(Toggle("face", "box-a:face.2", new object(), () => current, upload: 4), Is.True);
            var old = Fence(Model(8), 4);
            Assert.That(_context.Refresh(old, null), Is.False, "connection generation change invalidates the collection");
            Assert.That(_context.ExplicitMode, Is.True);
            Assert.That(_context.Count, Is.Zero);

            Assert.That(Toggle("face", "box-a:face.2", new object(), () => true, upload: 5), Is.True);
            var next = Fence(Model(8), 3);
            Assert.That(_context.Refresh(next, null), Is.False, "a replaced model identity cannot inherit references");

            _context.EnterExplicit(_fence);
            Assert.That(Toggle("edge", "box-a:edge.2", new object(), () => current, upload: 4), Is.True);
            current = false;
            Assert.That(_context.Refresh(_fence, null), Is.False, "a replacement upload invalidates the old view capture");
            Assert.That(_context.Count, Is.Zero);
        }

        [Test]
        public void PointIsDroppedOnFrameChangeWhileStableReferencesRemain()
        {
            var display = new GameObject("Moving CAD display").transform;
            display.SetParent(_root.transform, false);
            Assert.That(Toggle("face", "box-a:face.3"), Is.True);
            var world = DisplayPoint(display, new CadVector(4, 5, 6));
            Assert.That(CapturePoint(display, world), Is.True);
            Assert.That(_context.HasPoint, Is.True);
            var captured = CaptureSnapshot(display);
            display.position += Vector3.right * .02f;

            Assert.That(_context.Refresh(_fence, display), Is.True);
            Assert.That(_context.HasPoint, Is.False);
            Assert.That(_context.Count, Is.EqualTo(1));
            Assert.That(CaptureSnapshot(display).Matches(captured), Is.False);
            Object.DestroyImmediate(display.gameObject);
        }

        [Test]
        public void PointArmRequiresReleaseAndCancelsOnTrackingLossSwitchOrExplicitCancel()
        {
            var display = new GameObject("Tracked pointer display").transform;
            display.SetParent(_root.transform, false);
            var world = Vector3.one;
            Assert.That(_context.ArmPoint(_fence, 1), Is.True);
            Assert.That(_context.ObservePointGesture(_fence, 1, true, true, true, true, world, display), Is.False);
            Assert.That(_context.HasPoint, Is.False);
            Assert.That(_context.ObservePointGesture(_fence, 1, false, false, false, true, world, display), Is.False);
            Assert.That(_context.PointArmed, Is.False);

            Assert.That(_context.ArmPoint(_fence, 1), Is.True);
            _context.PointerSourceChanged(2);
            Assert.That(_context.PointArmed, Is.False);
            Assert.That(_context.ArmPoint(_fence, 1), Is.True);
            _context.CancelPointArm();
            Assert.That(_context.PointArmed, Is.False);
            Object.DestroyImmediate(display.gameObject);
        }

        [Test]
        public void VoiceSnapshotCopiesSelectionIdsPayloadSourcesAndUploadFence()
        {
            var source = new object();
            var ids = new[] { "box-a:face.5" };
            const string payload = "{\"version\":2,\"selections\":[{\"kind\":\"face\",\"persistentId\":\"box-a:face.5\"}]}";
            var snapshot = new QuestVoiceContext.VoiceSnapshot(_fence, ids, payload, true, 17,
                new[] { source }, new[] { 9 });
            ids[0] = "mutated";
            var exposed = snapshot.SelectionIds;exposed[0] = "caller mutation";
            Assert.That(snapshot.SelectionIds, Is.EqualTo(new[] { "box-a:face.5" }));

            var same = new QuestVoiceContext.VoiceSnapshot(_fence, new[] { "box-a:face.5" }, payload, true, 17,
                new[] { source }, new[] { 9 });
            var uploadChanged = new QuestVoiceContext.VoiceSnapshot(_fence, new[] { "box-a:face.5" }, payload, true, 17,
                new[] { source }, new[] { 10 });
            var modelChanged = new QuestVoiceContext.VoiceSnapshot(Fence(Model(9), 3), new[] { "box-a:face.5" }, payload,
                true, 17, new[] { source }, new[] { 9 });
            Assert.That(snapshot.Matches(same), Is.True);
            Assert.That(snapshot.Matches(uploadChanged), Is.False);
            Assert.That(snapshot.Matches(modelChanged), Is.False);
        }

        QuestVoiceContext.VoiceSnapshot CaptureSnapshot(Transform display)
        {
            Assert.That(_context.TryCaptureSnapshot(_fence, display, out var snapshot, out var error), Is.True, error);
            return snapshot;
        }
    }
}
