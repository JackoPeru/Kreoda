using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using UnityEngine;

namespace Kreoda.QuestRuntime.Tests
{
    public sealed class QuestSpatialAnchorStoreExceptionClassificationTests
    {
        string _directory;
        QuestAnchorScope _scope;
        TestBackend _backend;
        QuestSpatialAnchorStore _store;

        [SetUp]
        public void SetUp()
        {
            _directory = Path.Combine(Path.GetTempPath(), "kreoda-anchor-exception-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(_directory);
            _scope = new QuestAnchorScope("trusted-pc", "document-A", "session-one", 1, "room-one");
            _backend = new TestBackend();
            _store = new QuestSpatialAnchorStore(_backend, _directory);
            _store.UseSession(_scope);
        }

        [TearDown]
        public void TearDown()
        {
            _store?.Dispose();
            if (Directory.Exists(_directory)) Directory.Delete(_directory, true);
        }

        async Task<QuestAnchorScope> PersistAndOpenForRestore(JsonSerializerOptions options = null)
        {
            _backend.Created = new TestHandle(Guid.NewGuid());
            var saved = await _store.SaveConfirmedAsync(_scope, Pose.identity, Pose.identity,
                1f, Vector3.zero, 0f);
            Assert.That(saved.Status, Is.EqualTo(QuestAnchorStatus.Saved));
            _store.Dispose();
            _store = new QuestSpatialAnchorStore(_backend, _directory,
                new FileQuestAnchorRecordStorage(), options);
            var reconnect = new QuestAnchorScope(_scope.PcId, _scope.DocumentId,
                "session-after-restart", 2, _scope.RoomId);
            _store.UseSession(reconnect);
            return reconnect;
        }

        [Test]
        public async Task JsonSerializerNotSupportedIsStorageFailureAndCannotReportTrackingLoss()
        {
            var options = new JsonSerializerOptions();
            options.Converters.Add(new UnsupportedRecordConverter());
            var reconnect = await PersistAndOpenForRestore(options);
            var json = Directory.GetFiles(_directory, "*.json", SearchOption.AllDirectories).Single();
            var before = File.ReadAllText(json);

            var outcome = await _store.RestoreAsync(reconnect);

            Assert.That(outcome.Status, Is.EqualTo(QuestAnchorStatus.StorageFailed));
            Assert.That(outcome.Success, Is.False);
            Assert.That(outcome.Record, Is.Null);
            Assert.That(_backend.LoadCalls, Is.Zero,
                "Unsupported JSON metadata must fail before any Meta localization request");
            Assert.That(_store.TryGetTrackedDisplayPose(out _, out _), Is.False);
            Assert.That(File.ReadAllText(json), Is.EqualTo(before),
                "A restore failure must not mutate the saved mapping");
        }

        [Test]
        public async Task BackendLocalizationTimeoutRemainsNotLocalized()
        {
            var reconnect = await PersistAndOpenForRestore();
            _backend.LoadError = new TimeoutException("Anchor localization deadline exceeded");

            var outcome = await _store.RestoreAsync(reconnect);

            Assert.That(outcome.Status, Is.EqualTo(QuestAnchorStatus.NotLocalized));
            Assert.That(_backend.LoadCalls, Is.EqualTo(1));
            Assert.That(_store.TryGetTrackedDisplayPose(out _, out _), Is.False);
        }

        [Test]
        public async Task UnexpectedBackendExceptionCannotMasqueradeAsTransientLocalization()
        {
            var reconnect = await PersistAndOpenForRestore();
            _backend.LoadError = new InvalidOperationException("Unexpected SDK invariant failure");

            Assert.ThrowsAsync<InvalidOperationException>(async () =>
                await _store.RestoreAsync(reconnect));
            Assert.That(_backend.LoadCalls, Is.EqualTo(1));
            Assert.That(_store.TryGetTrackedDisplayPose(out _, out _), Is.False);
        }

        [Test]
        public async Task TimedOutOldSessionCannotBeReportedAsCurrentLocalizationFailure()
        {
            var reconnect = await PersistAndOpenForRestore();
            _backend.PendingLoad = new TaskCompletionSource<IQuestSpatialAnchorHandle>(
                TaskCreationOptions.RunContinuationsAsynchronously);
            var pending = _store.RestoreAsync(reconnect);
            Assert.That(_backend.LoadCalls, Is.EqualTo(1));
            Assert.That(pending.IsCompleted, Is.False);

            var subsequent = new QuestAnchorScope(_scope.PcId, _scope.DocumentId,
                "newer-session", 3, _scope.RoomId);
            _store.UseSession(subsequent);
            _backend.PendingLoad.SetException(new TimeoutException("Old generation timed out"));

            var outcome = await pending;
            Assert.That(outcome.Status, Is.EqualTo(QuestAnchorStatus.Superseded));
            Assert.That(_store.TryGetTrackedDisplayPose(out _, out _), Is.False);
        }

        sealed class UnsupportedRecordConverter : JsonConverter<QuestAnchorRecord>
        {
            public override QuestAnchorRecord Read(ref Utf8JsonReader reader, Type typeToConvert,
                JsonSerializerOptions options) =>
                throw new NotSupportedException("AOT serializer metadata for QuestAnchorRecord unavailable");

            public override void Write(Utf8JsonWriter writer, QuestAnchorRecord value,
                JsonSerializerOptions options) =>
                throw new NotSupportedException("Not used for restore");
        }

        sealed class TestBackend : IQuestSpatialAnchorBackend
        {
            public bool IsPermitted => true;
            public TestHandle Created;
            public int LoadCalls;
            public Exception LoadError;
            public TaskCompletionSource<IQuestSpatialAnchorHandle> PendingLoad;

            public Task<IQuestSpatialAnchorHandle> CreateAsync(Pose pose, CancellationToken cancellation) =>
                Task.FromResult<IQuestSpatialAnchorHandle>(Created);

            public Task<IQuestSpatialAnchorHandle> LoadAsync(Guid uuid, CancellationToken cancellation)
            {
                LoadCalls++;
                if (LoadError != null) throw LoadError;
                return PendingLoad?.Task ?? Task.FromResult<IQuestSpatialAnchorHandle>(null);
            }
        }

        sealed class TestHandle : IQuestSpatialAnchorHandle
        {
            public Guid Uuid { get; }
            public TestHandle(Guid uuid) { Uuid = uuid; }
            public bool TryGetTrackedPose(out Pose pose) { pose = Pose.identity; return true; }
            public Task<bool> SaveAsync(CancellationToken cancellation) => Task.FromResult(true);
            public void Dispose() { }
        }
    }
}
