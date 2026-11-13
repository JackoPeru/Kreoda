using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using UnityEngine;

namespace Kreoda.QuestRuntime.Tests
{
    public sealed class QuestSpatialAnchorStoreTests
    {
        string _directory;
        FakeBackend _backend;
        QuestSpatialAnchorStore _store;

        static QuestAnchorScope Scope(string session = "session-1", long generation = 1,
            string pc = "trusted-pc-1", string document = "document-A", string room = "room-one") =>
            new QuestAnchorScope(pc, document, session, generation, room);

        static Pose PoseAt(float x, float y, float z, float yaw = 0) =>
            new Pose(new Vector3(x, y, z), Quaternion.Euler(0, yaw, 0));

        [SetUp]
        public void SetUp()
        {
            _directory = Path.Combine(Path.GetTempPath(), "kreoda-anchor-tests-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(_directory);
            _backend = new FakeBackend();
            _store = new QuestSpatialAnchorStore(_backend, _directory);
            _store.UseSession(Scope());
        }

        [TearDown]
        public void TearDown()
        {
            _store.Dispose();
            if (Directory.Exists(_directory)) Directory.Delete(_directory, true);
        }

        static void AssertPoseNear(Pose actual, Pose expected)
        {
            Assert.That(Vector3.Distance(actual.position, expected.position), Is.LessThan(.0001f));
            Assert.That(Quaternion.Angle(actual.rotation, expected.rotation), Is.LessThan(.01f));
        }

        async Task<QuestAnchorOutcome> Save(Pose atAnchor, Pose display,
            QuestAnchorScope? scope = null, float scale = 2f)
        {
            var context = scope ?? Scope();
            _backend.Created = new FakeHandle(Guid.NewGuid(), atAnchor);
            return await _store.SaveConfirmedAsync(context, atAnchor, display, scale,
                new Vector3(.02f, -.01f, 0f), .005f);
        }

        string OnlyRecord()
        {
            var files = Directory.GetFiles(Path.Combine(_directory, "kreoda-spatial-anchors-v1"), "*.json");
            Assert.That(files, Has.Length.EqualTo(1));
            return files[0];
        }

        [Test]
        public async Task SaveAndRestoreAcrossAppRestartUsesLocalizedAnchorNotUncalibratedUnityWorld()
        {
            var previousAnchor = PoseAt(101, .8f, 204, 90);
            var previousDisplay = PoseAt(102, .9f, 203, 135);
            var saved = await Save(previousAnchor, previousDisplay);
            Assert.That(saved.Status, Is.EqualTo(QuestAnchorStatus.Saved));
            Assert.That(saved.Record.IsValid(), Is.True);
            Assert.That(saved.Record.PcId, Is.EqualTo("trusted-pc-1"));
            Assert.That(saved.Record.DocumentId, Is.EqualTo("document-A"));
            Assert.That(saved.Record.DisplayScale, Is.EqualTo(2f));
            Assert.That(saved.Record.ContactModelPoint, Is.EqualTo(new Vector3(.02f, -.01f, 0f)));
            Assert.That(saved.Record.HeightCalibrationMetres, Is.EqualTo(.005f));
            var serialized = File.ReadAllText(OnlyRecord());
            Assert.That(serialized, Does.Contain("AnchorRelativePositionMetres"));
            Assert.That(serialized, Does.Not.Contain("SessionId"),
                "The volatile network session must not become physical alignment data");

            _store.Dispose();
            _backend.Loaded = new FakeHandle(_backend.Created.Uuid, PoseAt(-3, 1.2f, 6, 180));
            _store = new QuestSpatialAnchorStore(_backend, _directory);
            _store.UseSession(Scope("different-session-after-restart", 25));
            var restored = await _store.RestoreAsync(Scope("different-session-after-restart", 25));
            Assert.That(restored.Status, Is.EqualTo(QuestAnchorStatus.Restored));
            var delta = Quaternion.Inverse(previousAnchor.rotation) * (previousDisplay.position - previousAnchor.position);
            var yaw = Quaternion.Inverse(previousAnchor.rotation) * previousDisplay.rotation;
            AssertPoseNear(restored.DisplayWorldPose, new Pose(
                _backend.Loaded.WorldPose.position + _backend.Loaded.WorldPose.rotation * delta,
                _backend.Loaded.WorldPose.rotation * yaw));
            Assert.That(Vector3.Distance(restored.DisplayWorldPose.position, previousDisplay.position),
                Is.GreaterThan(5f), "Reusing old Unity world position would place CAD in the wrong room frame");
            Assert.That(_backend.LoadCalls, Is.EqualTo(1));
            Assert.That(_backend.LastLoadedUuid, Is.EqualTo(_backend.Created.Uuid));
        }

        [Test]
        public async Task DeniedAnchorPermissionCannotCreateLoadOrWritePersistentMapping()
        {
            _backend.Permitted = false;
            var save = await Save(PoseAt(1, 1, 1), PoseAt(2, 1, 1));
            Assert.That(save.Status, Is.EqualTo(QuestAnchorStatus.PermissionDenied));
            Assert.That(_backend.CreateCalls, Is.Zero);
            var restore = await _store.RestoreAsync(Scope());
            Assert.That(restore.Status, Is.EqualTo(QuestAnchorStatus.PermissionDenied));
            Assert.That(_backend.LoadCalls, Is.Zero);
            Assert.That(Directory.GetFiles(_directory, "*.json", SearchOption.AllDirectories), Is.Empty);
        }

        [Test]
        public async Task SaveFailOrUntrackedAnchorDoesNotCommitFalsePersistence()
        {
            _backend.Created = new FakeHandle(Guid.NewGuid(), PoseAt(1, 1, 1)) { SaveSucceeds = false };
            var failure = await _store.SaveConfirmedAsync(Scope(), PoseAt(1, 1, 1), PoseAt(2, 1, 1),
                1f, Vector3.zero, 0);
            Assert.That(failure.Status, Is.EqualTo(QuestAnchorStatus.SaveFailed));
            Assert.That(_backend.Created.Disposed, Is.True);
            Assert.That(Directory.GetFiles(_directory, "*.json", SearchOption.AllDirectories), Is.Empty);

            _backend.Created = new FakeHandle(Guid.NewGuid(), PoseAt(1, 1, 1)) { Tracked = false };
            var untracked = await _store.SaveConfirmedAsync(Scope(), PoseAt(1, 1, 1), PoseAt(2, 1, 1),
                1f, Vector3.zero, 0);
            Assert.That(untracked.Status, Is.EqualTo(QuestAnchorStatus.NotLocalized));
            Assert.That(_backend.Created.SaveCalls, Is.Zero);
            Assert.That(Directory.GetFiles(_directory, "*.json", SearchOption.AllDirectories), Is.Empty);
        }

        [Test]
        public async Task CorruptedJsonAndWrongVersionFailClosedBeforeAnySdkLoad()
        {
            var saved = await Save(PoseAt(1, .7f, 1), PoseAt(1, .7f, 1));
            Assert.That(saved.Success, Is.True);
            var path = OnlyRecord();
            _store.UseSession(Scope("new-session", 2));

            File.WriteAllText(path, "{not valid JSON");
            var malformed = await _store.RestoreAsync(Scope("new-session", 2));
            Assert.That(malformed.Status, Is.EqualTo(QuestAnchorStatus.CorruptRecord));
            Assert.That(_backend.LoadCalls, Is.Zero);

            var wrongVersion = saved.Record;
            wrongVersion.Version = 999;
            File.WriteAllText(path, JsonSerializer.Serialize(wrongVersion));
            var future = await _store.RestoreAsync(Scope("new-session", 2));
            Assert.That(future.Status, Is.EqualTo(QuestAnchorStatus.CorruptRecord));
            Assert.That(_backend.LoadCalls, Is.Zero);

            wrongVersion.Version = QuestAnchorRecord.CurrentVersion;
            wrongVersion.AnchorRelativePositionMetres[0] = float.NaN;
            File.WriteAllText(path, "{\"Version\":1,\"PcId\":\"trusted-pc-1\",\"DocumentId\":\"document-A\",\"RoomId\":\"room-one\",\"AnchorUuid\":\"" +
                saved.Record.AnchorUuid + "\",\"AnchorRelativePositionMetres\":[\"NaN\",0,0]}");
            var nonFinite = await _store.RestoreAsync(Scope("new-session", 2));
            Assert.That(nonFinite.Status, Is.EqualTo(QuestAnchorStatus.CorruptRecord));
        }

        [Test]
        public async Task PcDocumentRoomMismatchCannotLoadAnotherModelsPlacement()
        {
            Assert.That((await Save(PoseAt(0, 1, 1), PoseAt(0, 1, 1))).Success, Is.True);
            _store.UseSession(Scope("new-session", 2, pc: "other-pc"));
            Assert.That((await _store.RestoreAsync(Scope("new-session", 2, pc: "other-pc"))).Status,
                Is.EqualTo(QuestAnchorStatus.Missing));
            _store.UseSession(Scope("new-session", 3, document: "other-document"));
            Assert.That((await _store.RestoreAsync(Scope("new-session", 3, document: "other-document"))).Status,
                Is.EqualTo(QuestAnchorStatus.Missing));
            _store.UseSession(Scope("new-session", 4, room: "other-room"));
            Assert.That((await _store.RestoreAsync(Scope("new-session", 4, room: "other-room"))).Status,
                Is.EqualTo(QuestAnchorStatus.Missing));
            Assert.That(_backend.LoadCalls, Is.Zero);
        }

        [Test]
        public async Task InFlightSaveFromOldSessionCannotCommitAfterGenerationChanges()
        {
            var fake = new FakeHandle(Guid.NewGuid(), PoseAt(1, 1, 1))
            {
                PendingSave = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously)
            };
            _backend.Created = fake;
            var pending = _store.SaveConfirmedAsync(Scope(), PoseAt(1, 1, 1), PoseAt(1.5f, 1, 1),
                1f, Vector3.zero, 0);
            Assert.That(pending.IsCompleted, Is.False);
            Assert.That(fake.SaveCalls, Is.EqualTo(1));
            _store.UseSession(Scope("subsequent-session", 2, document: "document-B"));
            fake.PendingSave.SetResult(true);
            Assert.That((await pending).Status, Is.EqualTo(QuestAnchorStatus.Superseded));
            Assert.That(fake.Disposed, Is.True);
            Assert.That(Directory.GetFiles(_directory, "*.json", SearchOption.AllDirectories), Is.Empty);
        }

        [Test]
        public async Task RevokingPermissionAfterAnchorCreationRejectsCommit()
        {
            var fake = new FakeHandle(Guid.NewGuid(), PoseAt(1, 1, 1))
            {
                PendingSave = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously)
            };
            _backend.Created = fake;
            var pending = _store.SaveConfirmedAsync(Scope(), PoseAt(1, 1, 1), PoseAt(1, 1, 1),
                1f, Vector3.zero, 0);
            _backend.Permitted = false;
            fake.PendingSave.SetResult(true);
            Assert.That((await pending).Status, Is.EqualTo(QuestAnchorStatus.PermissionDenied));
            Assert.That(Directory.GetFiles(_directory, "*.json", SearchOption.AllDirectories), Is.Empty);
        }

        [Test]
        public async Task FailedReplacementPreservesPreviouslySavedAnchorRecord()
        {
            var first = await Save(PoseAt(1, 1, 1), PoseAt(2, 1, 1));
            Assert.That(first.Success, Is.True);
            var previousJson = File.ReadAllText(OnlyRecord());
            _backend.Created = new FakeHandle(Guid.NewGuid(), PoseAt(10, 1, 10)) { SaveSucceeds = false };
            var second = await _store.SaveConfirmedAsync(Scope(), PoseAt(10, 1, 10), PoseAt(11, 1, 10),
                1f, Vector3.zero, 0);
            Assert.That(second.Status, Is.EqualTo(QuestAnchorStatus.SaveFailed));
            Assert.That(File.ReadAllText(OnlyRecord()), Is.EqualTo(previousJson));
        }

        [Test]
        public async Task TrackingLossRefusesStalePoseWhileRelocalizationRebasesContinuously()
        {
            var saved = await Save(PoseAt(1, 1, 1), PoseAt(1.3f, 1.1f, 1.1f));
            Assert.That(saved.Success, Is.True);
            Assert.That(_store.TryGetTrackedDisplayPose(out var first, out var record), Is.True);
            Assert.That(record.AnchorUuid, Is.EqualTo(saved.Record.AnchorUuid));
            _backend.Created.Tracked = false;
            Assert.That(_store.TryGetTrackedDisplayPose(out _, out _), Is.False);
            _backend.Created.WorldPose = PoseAt(2, 1, 1);
            _backend.Created.Tracked = true;
            Assert.That(_store.TryGetTrackedDisplayPose(out var moved, out _), Is.True);
            Assert.That(moved.position.x, Is.EqualTo(first.position.x + 1).Within(.0001f));
        }

        [Test]
        public void NonUnitQuaternionAndInvalidNumbersCannotBecomePhysicalAlignment()
        {
            Assert.That(QuestAnchorRecord.Create(Scope(), Guid.Empty, PoseAt(0, 1, 0),
                PoseAt(0, 1, 0), 1, Vector3.zero, 0), Is.Null);
            Assert.That(QuestAnchorRecord.Create(Scope(), Guid.NewGuid(), PoseAt(0, 1, 0),
                PoseAt(0, 1, 0), float.NaN, Vector3.zero, 0), Is.Null);
            Assert.That(QuestAnchorRecord.Create(Scope(), Guid.NewGuid(), PoseAt(0, 1, 0),
                PoseAt(0, 1, 0), 1, Vector3.positiveInfinity, 0), Is.Null);
            var badRotation = new Pose(Vector3.zero, new Quaternion(0, 0, 0, 0));
            Assert.That(QuestAnchorRecord.Create(Scope(), Guid.NewGuid(), PoseAt(0, 1, 0),
                badRotation, 1, Vector3.zero, 0), Is.Null);
            Assert.That(QuestAnchorRecord.Create(Scope(), Guid.NewGuid(), PoseAt(0, 1, 0),
                PoseAt(0, 1, 0), 1, Vector3.zero, .5f), Is.Null);
        }

        sealed class FakeBackend : IQuestSpatialAnchorBackend
        {
            public bool Permitted = true;
            public int CreateCalls, LoadCalls;
            public Guid LastLoadedUuid;
            public FakeHandle Created, Loaded;
            public bool IsPermitted => Permitted;

            public Task<IQuestSpatialAnchorHandle> CreateAsync(Pose pose, CancellationToken cancellation)
            {
                CreateCalls++;
                return Task.FromResult<IQuestSpatialAnchorHandle>(Created);
            }

            public Task<IQuestSpatialAnchorHandle> LoadAsync(Guid uuid, CancellationToken cancellation)
            {
                LoadCalls++;
                LastLoadedUuid = uuid;
                return Task.FromResult<IQuestSpatialAnchorHandle>(Loaded);
            }
        }

        sealed class FakeHandle : IQuestSpatialAnchorHandle
        {
            public Guid Uuid { get; }
            public Pose WorldPose;
            public bool Tracked = true, Disposed, SaveSucceeds = true;
            public int SaveCalls;
            public TaskCompletionSource<bool> PendingSave;

            public FakeHandle(Guid uuid, Pose worldPose) { Uuid = uuid; WorldPose = worldPose; }
            public bool TryGetTrackedPose(out Pose pose) { pose = WorldPose; return Tracked && !Disposed; }
            public Task<bool> SaveAsync(CancellationToken cancellation)
            {
                SaveCalls++;
                return PendingSave?.Task ?? Task.FromResult(SaveSucceeds);
            }
            public void Dispose() { Disposed = true; }
        }
    }
}
