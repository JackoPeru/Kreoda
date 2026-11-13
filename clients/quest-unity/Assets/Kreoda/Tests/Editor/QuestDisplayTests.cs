using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using Kreoda.QuestFoundation;
using NUnit.Framework;
using UnityEngine;
using Object = UnityEngine.Object;

namespace Kreoda.QuestRuntime.Tests
{
    public class QuestDisplayTests
    {
        GameObject _owned;
        QuestDisplay _display;
        QuestMeshView _view;
        Transform Root => _display.Connection.DisplayRoot;
        Dictionary<SceneObjectKey, QuestMeshView> Views => (Dictionary<SceneObjectKey, QuestMeshView>)typeof(QuestConnection)
            .GetField("_views", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(_display.Connection);

        [SetUp]
        public void CreateActualNativeCadDisplay()
        {
            _owned = new GameObject("Owned display test");
            var connection = _owned.AddComponent<QuestConnection>();
            connection.DisplayRoot = new GameObject("Independent CAD root").transform;
            connection.DisplayRoot.SetParent(_owned.transform);
            _display = _owned.AddComponent<QuestDisplay>();
            _display.Connection = connection;
            _view = new GameObject("Actual native fixture").AddComponent<QuestMeshView>();
            _view.transform.SetParent(Root, false);
            _view.Upload(QuestMeshViewTests.NativeFixture());
            var views = (Dictionary<SceneObjectKey, QuestMeshView>)typeof(QuestConnection)
                .GetField("_views", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(connection);
            views.Add(new SceneObjectKey(_view.BodyId), _view);
        }

        [TearDown]
        public void DisposeOwnedDisplay() => Object.DestroyImmediate(_owned);

        Vector3 Bottom()
        {
            var box = _view.BboxMetres;
            return new Vector3((float)(box[0] + box[3]) / 2, (float)box[1], (float)(box[2] + box[5]) / 2);
        }

        static void RunDisplayUpdate(QuestDisplay display) => typeof(QuestDisplay)
            .GetMethod("Update", BindingFlags.NonPublic | BindingFlags.Instance).Invoke(display, null);

        static void SetEditorAnchorClock(QuestDisplay display, Func<float> clock)
        {
            var field = typeof(QuestDisplay).GetField("EditorAnchorClock",
                BindingFlags.NonPublic | BindingFlags.Instance);
            Assert.That(field, Is.Not.Null, "A deterministic, Editor-only clock is required to test bounded retry");
            field.SetValue(display, clock);
        }

        static QuestAnchorScope AnchorScope(string document = "cad-document", string pc = "trusted-pc",
            string session = "session-1", long generation = 1) =>
            new QuestAnchorScope(pc, document, session, generation);

        [Test]
        public async Task PhysicalConfirmStoresRealAnchorAndSecondAppSessionRestoresChangedTrackingOrigin()
        {
            var storage = Path.Combine(Path.GetTempPath(), "kreoda-display-anchor-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(storage);
            var backend = new EditorFakeAnchorBackend();
            var initialContact = new Vector3(1.1f, .84f, 2.2f);
            var restoredWorldAnchor = new Pose(new Vector3(-2.4f, 1.15f, 3.2f),
                Quaternion.Euler(0, 100, 0));
            try
            {
                _display.EditorAnchorBackend = backend;
                _display.EditorAnchorStoragePath = storage;
                _display.EditorAuthenticatedScope = AnchorScope();
                RunDisplayUpdate(_display);
                Assert.That(backend.LoadCalls, Is.Zero);
                Assert.That(_display.BeginPlacement(), Is.True);
                _display.UpdatePointerPlacement(initialContact, 35f, true, true,
                    QuestPlacementProvenance.MetaRoomTable);
                _display.FreezePlacement();
                Assert.That(_display.ConfirmPlacement(true), Is.True);
                Assert.That(_display.EditorSaveOperation, Is.Not.Null,
                    "Only the real Confirm action may schedule persistence");
                var saved = await _display.EditorSaveOperation;
                Assert.That(saved.Status, Is.EqualTo(QuestAnchorStatus.Saved));
                Assert.That(backend.CreateCalls, Is.EqualTo(1));
                Assert.That(backend.CreatePose.position.y, Is.EqualTo(initialContact.y).Within(.0001f));
                Assert.That(Directory.GetFiles(storage, "*.json", SearchOption.AllDirectories), Has.Length.EqualTo(1));
                var formerRootPose = new Pose(Root.position, Root.rotation);
                var previousContact = saved.Record.ContactModelPoint;
                Assert.That(Vector3.Distance(Root.TransformPoint(previousContact), initialContact), Is.LessThan(.0005f));
                Assert.That(saved.Record.TryGetWorldDisplayPose(restoredWorldAnchor, out var expectedRestored), Is.True);

                // Destruction/recreation matches an actual app relaunch: no
                // saved root transform, new generation, different tracking origin.
                DisposeOwnedDisplay();
                CreateActualNativeCadDisplay();
                backend.Loaded = new EditorFakeAnchorHandle(saved.Record.AnchorUuid, restoredWorldAnchor);
                _display.EditorAnchorBackend = backend;
                _display.EditorAnchorStoragePath = storage;
                _display.EditorAuthenticatedScope = AnchorScope(session: "session-restarted", generation: 9);
                RunDisplayUpdate(_display);
                Assert.That(_display.EditorRestoreOperation, Is.Not.Null);
                var restored = await _display.EditorRestoreOperation;
                Assert.That(restored.Status, Is.EqualTo(QuestAnchorStatus.Restored));
                Assert.That(backend.LoadCalls, Is.EqualTo(1));
                Assert.That(Vector3.Distance(Root.position, expectedRestored.position), Is.LessThan(.0005f));
                Assert.That(Quaternion.Angle(Root.rotation, expectedRestored.rotation), Is.LessThan(.01f));
                Assert.That(Vector3.Distance(Root.position, formerRootPose.position), Is.GreaterThan(1f));
                Assert.That(_display.AnchorPersistenceStatus, Does.Contain("verifica allineamento"));
                Assert.That(_display.ConfirmedProvenance, Is.EqualTo(QuestPlacementProvenance.Unknown),
                    "saved local UUID is not evidence that a Meta TABLE classification was reobserved");
            }
            finally { if (Directory.Exists(storage)) Directory.Delete(storage, true); }
        }

        [Test]
        public async Task ChangingDocumentOrAuthenticatedPcClearsAnchorAndCannotReuseOtherModelRecord()
        {
            var storage = Path.Combine(Path.GetTempPath(), "kreoda-display-switch-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(storage);
            try
            {
                var backend = new EditorFakeAnchorBackend();
                _display.EditorAnchorBackend = backend;
                _display.EditorAnchorStoragePath = storage;
                _display.EditorAuthenticatedScope = AnchorScope();
                RunDisplayUpdate(_display);
                Assert.That(_display.BeginPlacement(), Is.True);
                _display.UpdatePointerPlacement(new Vector3(.9f, .8f, 1.4f), 0, true, true,
                    QuestPlacementProvenance.ManualProjection);
                _display.FreezePlacement();
                Assert.That(_display.ConfirmPlacement(true), Is.True);
                Assert.That((await _display.EditorSaveOperation).Success, Is.True);
                Assert.That(backend.CreateCalls, Is.EqualTo(1));

                _display.EditorAuthenticatedScope = AnchorScope(document: "other-document", session: "new-session", generation: 2);
                RunDisplayUpdate(_display);
                Assert.That(_display.EditorRestoreOperation, Is.Not.Null);
                Assert.That((await _display.EditorRestoreOperation).Status, Is.EqualTo(QuestAnchorStatus.Missing));
                Assert.That(backend.LoadCalls, Is.Zero);
                Assert.That(_display.ConfirmedProvenance, Is.EqualTo(QuestPlacementProvenance.Unknown));
                Assert.That(_display.AnchorPersistenceStatus, Does.Contain("vista temporanea"));

                _display.EditorAuthenticatedScope = AnchorScope(pc: "unrelated-pc", session: "other-session", generation: 3);
                RunDisplayUpdate(_display);
                Assert.That((await _display.EditorRestoreOperation).Status, Is.EqualTo(QuestAnchorStatus.Missing));
                Assert.That(backend.LoadCalls, Is.Zero);
                Assert.That(_display.ConfirmedProvenance, Is.EqualTo(QuestPlacementProvenance.Unknown));
                Assert.That(_display.AnchorPersistenceStatus, Does.Contain("vista temporanea"));
            }
            finally { if (Directory.Exists(storage)) Directory.Delete(storage, true); }
        }

        [Test]
        public void MissingAuthenticatedContextCannotSaveMetaAnchorOnConfirmEvenWhenSdkWouldPermit()
        {
            var storage = Path.Combine(Path.GetTempPath(), "kreoda-display-denied-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(storage);
            try
            {
                var backend = new EditorFakeAnchorBackend();
                _display.EditorAnchorBackend = backend;
                _display.EditorAnchorStoragePath = storage;
                // No EditorAuthenticatedScope: the test connection has no real
                // authenticated active SessionClient and cannot be fabricated.
                RunDisplayUpdate(_display);
                Assert.That(_display.BeginPlacement(), Is.True);
                _display.UpdatePointerPlacement(new Vector3(0, .8f, 1), 0, true, true,
                    QuestPlacementProvenance.ManualProjection);
                _display.FreezePlacement();
                Assert.That(_display.ConfirmPlacement(true), Is.True);
                Assert.That(backend.CreateCalls, Is.Zero);
                Assert.That(_display.EditorSaveOperation, Is.Null);
                Assert.That(Directory.GetFiles(storage, "*.json", SearchOption.AllDirectories), Is.Empty);
                Assert.That(_display.AnchorPersistenceStatus, Does.Contain("Nessun PC/documento autenticato"));
            }
            finally { if (Directory.Exists(storage)) Directory.Delete(storage, true); }
        }

        [Test]
        public async Task DelayedPermissionFromEarlierConfirmedPlacementCannotOverwriteLaterSameScopeConfirm()
        {
            var storage = Path.Combine(Path.GetTempPath(), "kreoda-anchor-consent-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(storage);
            try
            {
                var backend = new EditorFakeAnchorBackend { IsPermitted = false };
                Action delayedGrant = null;
                _display.EditorAnchorBackend = backend;
                _display.EditorAnchorStoragePath = storage;
                _display.EditorAuthenticatedScope = AnchorScope();
                _display.EditorPermissionRequest = (granted, denied, deniedForever) => delayedGrant = granted;
                RunDisplayUpdate(_display);
                Assert.That(_display.BeginPlacement(), Is.True);
                _display.UpdatePointerPlacement(new Vector3(1, .8f, 1), 10, true, true,
                    QuestPlacementProvenance.ManualProjection);
                _display.FreezePlacement();
                Assert.That(_display.ConfirmPlacement(true), Is.True);
                Assert.That(delayedGrant, Is.Not.Null);
                Assert.That(backend.CreateCalls, Is.Zero);

                backend.IsPermitted = true;
                Assert.That(_display.BeginPlacement(), Is.True);
                _display.UpdatePointerPlacement(new Vector3(2, .8f, 1), 25, true, true,
                    QuestPlacementProvenance.ManualProjection);
                _display.FreezePlacement();
                Assert.That(_display.ConfirmPlacement(true), Is.True);
                Assert.That((await _display.EditorSaveOperation).Success, Is.True);
                Assert.That(backend.CreateCalls, Is.EqualTo(1));
                var previousFile = Directory.GetFiles(storage, "*.json", SearchOption.AllDirectories).Single();
                var expectedJson = File.ReadAllText(previousFile);
                delayedGrant();
                Assert.That(backend.CreateCalls, Is.EqualTo(1),
                    "An old permission callback must not save placement A after B was confirmed");
                Assert.That(File.ReadAllText(previousFile), Is.EqualTo(expectedJson));
            }
            finally { if (Directory.Exists(storage)) Directory.Delete(storage, true); }
        }

        [Test]
        public void PermanentAnchorPermissionDenialCompletesRequestAndIgnoresLateGrant()
        {
            var field = typeof(QuestDisplay).GetField("EditorPermissionRequest",
                BindingFlags.NonPublic | BindingFlags.Instance);
            Assert.That(field, Is.Not.Null);
            Assert.That(field.FieldType, Is.EqualTo(typeof(Action<Action, Action, Action>)),
                "Permanent Android denial requires its own testable callback branch");
            var storage = Path.Combine(Path.GetTempPath(), "kreoda-anchor-permanent-deny-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(storage);
            try
            {
                var backend = new EditorFakeAnchorBackend { IsPermitted = false };
                Action grant = null, permanentDeny = null;
                _display.EditorAnchorBackend = backend;
                _display.EditorAnchorStoragePath = storage;
                _display.EditorAuthenticatedScope = AnchorScope();
                field.SetValue(_display, (Action<Action, Action, Action>)((granted, denied, deniedForever) =>
                {
                    grant = granted;
                    permanentDeny = deniedForever;
                }));
                RunDisplayUpdate(_display);
                Assert.That(_display.BeginPlacement(), Is.True);
                _display.UpdatePointerPlacement(new Vector3(.4f, .8f, 1), 0, true, true,
                    QuestPlacementProvenance.ManualProjection);
                _display.FreezePlacement();
                Assert.That(_display.ConfirmPlacement(true), Is.True);
                Assert.That(permanentDeny, Is.Not.Null);
                Assert.That(grant, Is.Not.Null);
                permanentDeny();
                Assert.That(_display.Status, Does.Contain("negato"));
                Assert.That(_display.AnchorPersistenceStatus, Does.Contain("negato"));
                Assert.That(_display.EditorSaveOperation, Is.Null);
                Assert.That(backend.CreateCalls, Is.Zero);
                // A callback arriving out of order after denial must never persist.
                backend.IsPermitted = true;
                grant();
                Assert.That(_display.EditorSaveOperation, Is.Null);
                Assert.That(backend.CreateCalls, Is.Zero);
                Assert.That(Directory.GetFiles(storage, "*.json", SearchOption.AllDirectories), Is.Empty);
            }
            finally { if (Directory.Exists(storage)) Directory.Delete(storage, true); }
        }

        [Test]
        public async Task TransientNotLocalizedRestoreRetriesOnlyAfterDelayInSameScope()
        {
            var storage = Path.Combine(Path.GetTempPath(), "kreoda-anchor-retry-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(storage);
            try
            {
                var backend = new EditorFakeAnchorBackend();
                _display.EditorAnchorBackend = backend;
                _display.EditorAnchorStoragePath = storage;
                _display.EditorAuthenticatedScope = AnchorScope();
                RunDisplayUpdate(_display);
                Assert.That(_display.BeginPlacement(), Is.True);
                _display.UpdatePointerPlacement(new Vector3(.5f, .8f, 1), 0, true, true,
                    QuestPlacementProvenance.MetaRoomTable);
                _display.FreezePlacement();
                Assert.That(_display.ConfirmPlacement(true), Is.True);
                var saved = await _display.EditorSaveOperation;
                Assert.That(saved.Status, Is.EqualTo(QuestAnchorStatus.Saved));
                DisposeOwnedDisplay();
                CreateActualNativeCadDisplay();

                float now = 100;
                _display.EditorAnchorBackend = backend;
                _display.EditorAnchorStoragePath = storage;
                _display.EditorAuthenticatedScope = AnchorScope(session: "reconnected", generation: 7);
                SetEditorAnchorClock(_display, () => now);
                // The record exists, but the Meta backend cannot yet localize its UUID.
                backend.Loaded = null;
                RunDisplayUpdate(_display);
                Assert.That((await _display.EditorRestoreOperation).Status, Is.EqualTo(QuestAnchorStatus.NotLocalized));
                Assert.That(backend.LoadCalls, Is.EqualTo(1));
                Assert.That(_display.AnchorPersistenceStatus, Does.Contain("vista temporanea"));
                var localView = Root.position;
                backend.Loaded = new EditorFakeAnchorHandle(saved.Record.AnchorUuid,
                    new Pose(new Vector3(2, 1, 3), Quaternion.Euler(0, 70, 0)));
                now = 101;
                RunDisplayUpdate(_display);
                Assert.That(backend.LoadCalls, Is.EqualTo(1), "Do not retry every frame");
                now = 105;
                RunDisplayUpdate(_display);
                Assert.That(backend.LoadCalls, Is.EqualTo(2), "Retry bounded same-scope NotLocalized after backoff");
                Assert.That((await _display.EditorRestoreOperation).Status, Is.EqualTo(QuestAnchorStatus.Restored));
                Assert.That(_display.AnchorPersistenceStatus, Does.Contain("ricaricata"));
                Assert.That(Vector3.Distance(Root.position, localView), Is.GreaterThan(.1f));
                now = 1000;
                RunDisplayUpdate(_display);
                Assert.That(backend.LoadCalls, Is.EqualTo(2), "A successful restore stops the retry loop");
            }
            finally { if (Directory.Exists(storage)) Directory.Delete(storage, true); }
        }

        [Test]
        public async Task RestoreNotLocalizedRetryIsBoundedAndCanceledByExplicitPlacement()
        {
            var storage = Path.Combine(Path.GetTempPath(), "kreoda-anchor-retry-limit-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(storage);
            try
            {
                var backend = new EditorFakeAnchorBackend();
                _display.EditorAnchorBackend = backend;
                _display.EditorAnchorStoragePath = storage;
                _display.EditorAuthenticatedScope = AnchorScope();
                RunDisplayUpdate(_display);
                Assert.That(_display.BeginPlacement(), Is.True);
                _display.UpdatePointerPlacement(new Vector3(.7f, .8f, 1), 0, true, true,
                    QuestPlacementProvenance.ManualProjection);
                _display.FreezePlacement();
                Assert.That(_display.ConfirmPlacement(true), Is.True);
                Assert.That((await _display.EditorSaveOperation).Status, Is.EqualTo(QuestAnchorStatus.Saved));
                DisposeOwnedDisplay();
                CreateActualNativeCadDisplay();
                float now = 0;
                _display.EditorAnchorBackend = backend;
                _display.EditorAnchorStoragePath = storage;
                _display.EditorAuthenticatedScope = AnchorScope(session: "new", generation: 2);
                SetEditorAnchorClock(_display, () => now);
                backend.Loaded = null;
                RunDisplayUpdate(_display);
                Assert.That((await _display.EditorRestoreOperation).Status, Is.EqualTo(QuestAnchorStatus.NotLocalized));
                Assert.That(backend.LoadCalls, Is.EqualTo(1));
                now = 3;
                RunDisplayUpdate(_display);
                Assert.That((await _display.EditorRestoreOperation).Status, Is.EqualTo(QuestAnchorStatus.NotLocalized));
                Assert.That(backend.LoadCalls, Is.EqualTo(2));
                now = 8;
                RunDisplayUpdate(_display);
                Assert.That((await _display.EditorRestoreOperation).Status, Is.EqualTo(QuestAnchorStatus.NotLocalized));
                Assert.That(backend.LoadCalls, Is.EqualTo(3));
                now = 500;
                RunDisplayUpdate(_display);
                Assert.That(backend.LoadCalls, Is.EqualTo(3),
                    "NotLocalized must have a hard attempt cap, not unbounded frame polling");
                Assert.That(_display.BeginPlacement(), Is.True);
                _display.CancelPlacement();
                now = 1000;
                RunDisplayUpdate(_display);
                Assert.That(backend.LoadCalls, Is.EqualTo(3),
                    "An explicit user placement must not revive the old retry intent");
            }
            finally { if (Directory.Exists(storage)) Directory.Delete(storage, true); }
        }

        [Test]
        public async Task PendingRestoreRetryCannotApplyAnOldDocumentAfterScopeChange()
        {
            var storage = Path.Combine(Path.GetTempPath(), "kreoda-anchor-retry-scope-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(storage);
            try
            {
                var backend = new EditorFakeAnchorBackend();
                _display.EditorAnchorBackend = backend;
                _display.EditorAnchorStoragePath = storage;
                _display.EditorAuthenticatedScope = AnchorScope();
                RunDisplayUpdate(_display);
                Assert.That(_display.BeginPlacement(), Is.True);
                _display.UpdatePointerPlacement(new Vector3(.7f, .8f, 1), 0, true, true,
                    QuestPlacementProvenance.ManualProjection);
                _display.FreezePlacement();
                Assert.That(_display.ConfirmPlacement(true), Is.True);
                var saved = await _display.EditorSaveOperation;
                Assert.That(saved.Status, Is.EqualTo(QuestAnchorStatus.Saved));
                DisposeOwnedDisplay();
                CreateActualNativeCadDisplay();
                float now = 10;
                _display.EditorAnchorBackend = backend;
                _display.EditorAnchorStoragePath = storage;
                _display.EditorAuthenticatedScope = AnchorScope(session: "new", generation: 2);
                SetEditorAnchorClock(_display, () => now);
                backend.Loaded = null;
                RunDisplayUpdate(_display);
                Assert.That((await _display.EditorRestoreOperation).Status, Is.EqualTo(QuestAnchorStatus.NotLocalized));
                Assert.That(backend.LoadCalls, Is.EqualTo(1));
                // Old UUID becomes available, but the application is now
                // showing a different document under the same PC.
                backend.Loaded = new EditorFakeAnchorHandle(saved.Record.AnchorUuid,
                    new Pose(new Vector3(9, 1, 9), Quaternion.identity));
                _display.EditorAuthenticatedScope = AnchorScope(document: "different-document",
                    session: "other-session", generation: 3);
                RunDisplayUpdate(_display);
                Assert.That((await _display.EditorRestoreOperation).Status, Is.EqualTo(QuestAnchorStatus.Missing));
                now = 100;
                RunDisplayUpdate(_display);
                Assert.That(backend.LoadCalls, Is.EqualTo(1),
                    "The scheduled old-document retry must be canceled by scope invalidation");
                Assert.That(_display.ConfirmedProvenance, Is.EqualTo(QuestPlacementProvenance.Unknown));
            }
            finally { if (Directory.Exists(storage)) Directory.Delete(storage, true); }
        }

        [Test]
        public async Task ChangedCadContactRejectsRestoredOutcomeRatherThanReportingSuccess()
        {
            var storage = Path.Combine(Path.GetTempPath(), "kreoda-anchor-geometry-reject-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(storage);
            try
            {
                var backend = new EditorFakeAnchorBackend();
                _display.EditorAnchorBackend = backend;
                _display.EditorAnchorStoragePath = storage;
                _display.EditorAuthenticatedScope = AnchorScope();
                RunDisplayUpdate(_display);
                Assert.That(_display.BeginPlacement(), Is.True);
                _display.UpdatePointerPlacement(new Vector3(.5f, .8f, 1), 0, true, true,
                    QuestPlacementProvenance.MetaRoomTable);
                _display.FreezePlacement();
                Assert.That(_display.ConfirmPlacement(true), Is.True);
                var saved = await _display.EditorSaveOperation;
                Assert.That(saved.Status, Is.EqualTo(QuestAnchorStatus.Saved));
                DisposeOwnedDisplay();
                CreateActualNativeCadDisplay();
                _display.EditorAnchorBackend = backend;
                _display.EditorAnchorStoragePath = storage;
                _display.EditorAuthenticatedScope = AnchorScope(session: "new-session", generation: 5);
                backend.Loaded = new EditorFakeAnchorHandle(saved.Record.AnchorUuid,
                    new Pose(new Vector3(4, 1.1f, 2), Quaternion.identity));
                var box = (double[])_view.BboxMetres.Clone();
                box[0] += .02;
                typeof(QuestMeshView).GetProperty("BboxMetres").SetValue(_view, box);
                RunDisplayUpdate(_display);
                var result = await _display.EditorRestoreOperation;
                Assert.That(result.Status, Is.EqualTo(QuestAnchorStatus.InvalidContext),
                    "A Meta UUID can localize while the restored CAD contact is stale");
                Assert.That(result.Success, Is.False, "Rejected geometry cannot report successful placement");
                Assert.That(_display.AnchorPersistenceStatus, Does.Contain("Geometria CAD modificata"));
                Assert.That(_display.ConfirmedProvenance, Is.EqualTo(QuestPlacementProvenance.Unknown));
            }
            finally { if (Directory.Exists(storage)) Directory.Delete(storage, true); }
        }

        [Test]
        public async Task RecenterAfterSaveLeavesLocalRecordAndExplainsThatOldAnchorReturnsAtRelaunch()
        {
            var storage = Path.Combine(Path.GetTempPath(), "kreoda-anchor-recenter-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(storage);
            try
            {
                var backend = new EditorFakeAnchorBackend();
                _display.EditorAnchorBackend = backend;
                _display.EditorAnchorStoragePath = storage;
                _display.EditorAuthenticatedScope = AnchorScope();
                RunDisplayUpdate(_display);
                Assert.That(_display.BeginPlacement(), Is.True);
                _display.UpdatePointerPlacement(new Vector3(.4f, .83f, 1), 0, true, true,
                    QuestPlacementProvenance.MetaRoomTable);
                _display.FreezePlacement();
                Assert.That(_display.ConfirmPlacement(true), Is.True);
                Assert.That((await _display.EditorSaveOperation).Success, Is.True);
                var currentFile = Directory.GetFiles(storage, "*.json", SearchOption.AllDirectories).Single();
                var savedBytes = File.ReadAllBytes(currentFile);
                // An explicit recenter is temporary: do not erase the Meta
                // local anchor or imply that this new pose was durably saved.
                _display.Recenter();
                Assert.That(_display.Status, Does.Contain("vecchio ancoraggio"));
                Assert.That(_display.AnchorPersistenceStatus, Does.Contain("prossimo avvio"));
                Assert.That(File.ReadAllBytes(currentFile), Is.EqualTo(savedBytes));
                Assert.That(backend.CreateCalls, Is.EqualTo(1));
            }
            finally { if (Directory.Exists(storage)) Directory.Delete(storage, true); }
        }

        [Test]
        public async Task TrackingLossAndAnchorDriftReresolvePoseWithoutUsingStaleUnityCoordinates()
        {
            var storage = Path.Combine(Path.GetTempPath(), "kreoda-anchor-drift-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(storage);
            try
            {
                var backend = new EditorFakeAnchorBackend();
                _display.EditorAnchorBackend = backend;
                _display.EditorAnchorStoragePath = storage;
                _display.EditorAuthenticatedScope = AnchorScope();
                RunDisplayUpdate(_display);
                Assert.That(_display.BeginPlacement(), Is.True);
                _display.UpdatePointerPlacement(new Vector3(.4f, .83f, 1), 0, true, true,
                    QuestPlacementProvenance.MetaRoomTable);
                _display.FreezePlacement();
                Assert.That(_display.ConfirmPlacement(true), Is.True);
                Assert.That((await _display.EditorSaveOperation).Success, Is.True);
                var previous = Root.position;
                backend.Created.Tracked = false;
                RunDisplayUpdate(_display);
                Assert.That(_display.Status, Does.Contain("Tracking ancora Meta perso"));
                Assert.That(Root.gameObject.activeSelf, Is.False,
                    "A stale CAD world pose must not remain displayed as physically aligned");
                backend.Created.Pose = new Pose(backend.Created.Pose.position + Vector3.right,
                    backend.Created.Pose.rotation);
                backend.Created.Tracked = true;
                RunDisplayUpdate(_display);
                Assert.That(Root.gameObject.activeSelf, Is.True,
                    "Real Meta relocalization should restore the CAD geometry without a saved Unity world pose");
                Assert.That(Root.position.x, Is.EqualTo(previous.x + 1f).Within(.001f));
                Assert.That(_display.AnchorPersistenceStatus, Does.Not.Contain("corruzione"));
            }
            finally { if (Directory.Exists(storage)) Directory.Delete(storage, true); }
        }

        sealed class EditorFakeAnchorBackend : IQuestSpatialAnchorBackend
        {
            public bool IsPermitted { get; set; } = true;
            public int CreateCalls, LoadCalls;
            public Pose CreatePose;
            public EditorFakeAnchorHandle Created;
            public EditorFakeAnchorHandle Loaded;

            public Task<IQuestSpatialAnchorHandle> CreateAsync(Pose worldPose, CancellationToken token)
            {
                CreateCalls++;
                CreatePose = worldPose;
                Created = new EditorFakeAnchorHandle(Guid.NewGuid().ToString("D"), worldPose);
                return Task.FromResult<IQuestSpatialAnchorHandle>(Created);
            }

            public Task<IQuestSpatialAnchorHandle> LoadAsync(Guid uuid, CancellationToken token)
            {
                LoadCalls++;
                return Task.FromResult<IQuestSpatialAnchorHandle>(Loaded);
            }
        }

        sealed class EditorFakeAnchorHandle : IQuestSpatialAnchorHandle
        {
            readonly Guid _uuid;
            public Pose Pose;
            public bool Tracked = true;
            bool _disposed;
            public Guid Uuid => _uuid;

            public EditorFakeAnchorHandle(string uuid, Pose pose)
            {
                _uuid = Guid.Parse(uuid);
                Pose = pose;
            }

            public bool TryGetTrackedPose(out Pose pose)
            {
                pose = Pose;
                return !_disposed && Tracked;
            }

            public Task<bool> SaveAsync(CancellationToken token) => Task.FromResult(!_disposed);
            public void Dispose() { _disposed = true; }
        }

        [Test]
        public void MalformedCadBoundsCannotCreatePlacementGuidesOrMoveDisplay()
        {
            var property = typeof(QuestMeshView).GetProperty("BboxMetres",
                BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
            Assert.That(property, Is.Not.Null);
            var original = _view.BboxMetres;
            var invalid = new[]
            {
                new double[] { 0, 0, 0 },
                new double[] { 0, 0, 0, double.NaN, 1, 1 },
                new double[] { 0, 0, 0, double.PositiveInfinity, 1, 1 },
                new double[] { 2, 0, 0, 1, 1, 1 }
            };
            try
            {
                foreach (var bounds in invalid)
                {
                    property.SetValue(_view, bounds);
                    var position = Root.position;
                    var rotation = Root.rotation;
                    var scale = Root.localScale;
                    Assert.That(_display.BeginPlacement(), Is.False,
                        "invalid bounds must not create a physical placement preview");
                    Assert.That(_display.Place(new Vector3(.4f, .8f, 1.2f), 60), Is.False,
                        "invalid bounds must not be accepted as a physical contact");
                    Assert.That(_display.PlacementActive, Is.False);
                    Assert.That(Root.position, Is.EqualTo(position));
                    Assert.That(Root.rotation, Is.EqualTo(rotation));
                    Assert.That(Root.localScale, Is.EqualTo(scale));
                    Assert.That(typeof(QuestDisplay).GetField("_marker",
                        BindingFlags.Instance | BindingFlags.NonPublic).GetValue(_display), Is.Null,
                        "invalid CAD bounds must not leave a ray-interfering preview");
                }
            }
            finally { property.SetValue(_view, original); }
        }

        [TestCase("1:10", .1f)]
        [TestCase("1:5", .2f)]
        [TestCase("1:1", 1f)]
        [TestCase("2:1", 2f)]
        [TestCase("10:1", 10f)]
        public void DisplayMagnificationPreservesChosenSurfaceContactAndNativeVertices(string preset, float scale)
        {
            var before = _view.GetComponent<MeshFilter>().sharedMesh.vertices;
            var anchor = new Vector3(.8f, .75f, 1.2f);
            Assert.That(_display.Place(anchor, 90), Is.True);
            Assert.That(_display.SetScale(preset), Is.True);
            Assert.That(Root.localScale.x, Is.EqualTo(scale).Within(.00001f), "0.001 conversion must not be applied twice");
            Assert.That(Vector3.Distance(Root.TransformPoint(Bottom()), anchor), Is.LessThan(.00001f));
            Assert.That(_view.GetComponent<MeshFilter>().sharedMesh.vertices, Is.EqualTo(before));
            Assert.That(Root.parent, Is.SameAs(_owned.transform));
        }

        [Test]
        public void FitUsesActualMetreBoundsAndCancelRestoresPlacementAfterTrackingLoss()
        {
            var anchor = new Vector3(.3f, .8f, 1);
            Assert.That(_display.Place(anchor, 35), Is.True);
            Assert.That(_display.SetScale("Fit"), Is.True);
            var box = _view.BboxMetres;
            var largest = Mathf.Max((float)(box[3] - box[0]), (float)(box[4] - box[1]), (float)(box[5] - box[2]));
            Assert.That(largest * Root.localScale.x, Is.EqualTo(.35f).Within(.00001f));
            var position = Root.position; var rotation = Root.rotation; var scale = Root.localScale;
            Assert.That(_display.BeginPlacement(), Is.True);
            _display.UpdatePlacement(new Vector3(2, 1, 3), 120, true);
            _display.FreezePlacement();
            Assert.That(_display.ConfirmPlacement(false), Is.False, "tracking loss cannot confirm a physical anchor");
            _display.CancelPlacement();
            Assert.That(Root.position, Is.EqualTo(position));
            Assert.That(Root.rotation, Is.EqualTo(rotation));
            Assert.That(Root.localScale, Is.EqualTo(scale));
            Assert.That(_display.PlacementActive, Is.False);
        }

        [Test]
        public void PlacementFootprintTracksTrueCadBoundsScaleAndTrackingWithoutStealingRaycasts()
        {
            var shader = Shader.Find("Kreoda/QuestUi") ?? Shader.Find("Standard");
            Assert.That(shader, Is.Not.Null);
            var source = new Material(shader);
            _display.MarkerMaterial = source;
            try
            {
                Assert.That(_display.BeginPlacement(), Is.True);
                var marker = (GameObject)typeof(QuestDisplay)
                    .GetField("_marker", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(_display);
                Assert.That(marker, Is.Not.Null);
                Assert.That(marker.transform.childCount, Is.EqualTo(11),
                    "one contact point, four authentic CAD edges and six local X/Z direction segments");
                _display.UpdatePlacement(new Vector3(.4f, .75f, 1.3f), 45, true);
                Assert.That(marker.activeSelf, Is.True);
                Assert.That(marker.transform.position, Is.EqualTo(new Vector3(.4f, .75f, 1.3f)));
                Assert.That(Quaternion.Angle(marker.transform.rotation, Root.rotation), Is.LessThan(.001f));
                var bounds = _view.BboxMetres;
                var expectedWidth = (float)(bounds[3] - bounds[0]);
                var expectedDepth = (float)(bounds[5] - bounds[2]);
                var horizontal = marker.transform.Find("CAD footprint edge 0");
                var vertical = marker.transform.Find("CAD footprint edge 2");
                Assert.That(horizontal, Is.Not.Null);
                Assert.That(vertical, Is.Not.Null);
                Assert.That(horizontal.localScale.x, Is.EqualTo(expectedWidth).Within(.00001f));
                Assert.That(vertical.localScale.z, Is.EqualTo(expectedDepth).Within(.00001f));
                var xLength = Mathf.Min(expectedWidth * .26f, .09f);
                var zLength = Mathf.Min(expectedDepth * .26f, .09f);
                for (var axis = 0; axis < 6; axis++)
                {
                    var guide = marker.transform.Find("CAD local " + (axis < 3 ? "X" : "Z") +
                        " direction " + (axis % 3));
                    Assert.That(guide, Is.Not.Null);
                    var visible = axis < 3 ? xLength >= .015f : zLength >= .015f;
                    Assert.That(guide.gameObject.activeSelf, Is.EqualTo(visible));
                    if (visible)
                        Assert.That(guide.localScale.magnitude, Is.GreaterThan(.001f),
                            "visible direction guides require nondegenerate geometry");
                }
                var x = marker.transform.Find("CAD local X direction 0");
                var z = marker.transform.Find("CAD local Z direction 0");
                if (xLength >= .015f && zLength >= .015f)
                {
                    Assert.That(x.localScale.x, Is.EqualTo(xLength).Within(.0001f));
                    Assert.That(z.localScale.x, Is.EqualTo(zLength).Within(.0001f));
                    Assert.That(Vector3.Dot(x.TransformDirection(Vector3.right),
                        z.TransformDirection(Vector3.right)), Is.EqualTo(0f).Within(.01f),
                        "local X/Z direction strokes must remain perpendicular under yaw");
                }
                for (var i = 0; i < marker.transform.childCount; i++)
                    Assert.That(marker.transform.GetChild(i).GetComponent<Collider>().enabled, Is.False,
                        "placement preview must never intercept CAD selection or pinch raycasts");
                Assert.That(_display.SetScale("2:1"), Is.True);
                Assert.That(horizontal.localScale.x, Is.EqualTo(expectedWidth * 2f).Within(.00001f));
                Assert.That(vertical.localScale.z, Is.EqualTo(expectedDepth * 2f).Within(.00001f));
                _display.UpdatePlacement(default, 45, false);
                Assert.That(marker.activeSelf, Is.False, "lost tracking cannot show a false valid contact");
                _display.CancelPlacement();
                Assert.That(marker == null, Is.True, "preview is removed after cancellation");
            }
            finally
            {
                _display.MarkerMaterial = null;
                Object.DestroyImmediate(source);
            }
        }

        [Test]
        public void TwoHandGestureChangesOnlyDisplayAndTrackingLossRestoresItsStart()
        {
            _display.Place(new Vector3(0, 1, 1), 0);
            var before = _view.GetComponent<MeshFilter>().sharedMesh.vertices;
            var original = Root.position;var originalScale = Root.localScale;
            Assert.That(_display.BeginTwoHand(new Vector3(-.1f, 1, 1), new Vector3(.1f, 1, 1)), Is.True);
            _display.UpdateTwoHand(new Vector3(0, 1, 1), new Vector3(.4f, 1, 1), true);
            Assert.That(Root.localScale.x, Is.EqualTo(2).Within(.0001));
            Assert.That(_view.GetComponent<MeshFilter>().sharedMesh.vertices, Is.EqualTo(before));
            _display.EndTwoHand(false);
            Assert.That(Root.position, Is.EqualTo(original));Assert.That(Root.localScale, Is.EqualTo(originalScale));
            Assert.That(_display.TwoHandActive, Is.False);
        }

        QuestMeshView AddAlreadyPlacedInstance()
        {
            var source = QuestMeshViewTests.NativeFixture();
            var positions = (float[])source.Positions.Clone();
            var edges = (float[])source.EdgeVertices.Clone();
            for (int i = 0; i < positions.Length; i += 3) positions[i] += 500;
            for (int i = 0; i < edges.Length; i += 3) edges[i] += 500;
            var box = (double[])source.BboxMm.Clone(); box[0] += 500; box[3] += 500;
            var header = new Kreoda.Session.SessionMeshHeader(source.Header.NativeRequestId, source.Header.SessionId,
                source.Header.DocumentId, source.Header.Revision, _view.BodyId, "placed-instance", "placed-instance",
                source.Header.Quality, source.Header.ByteLength, "placed-instance");
            var instance = new GameObject("Pretransformed instance fixture").AddComponent<QuestMeshView>();
            instance.transform.SetParent(Root, false);
            instance.Upload(new Kreoda.Session.SessionMeshResult(header, positions, source.Normals, source.Indices,
                edges, source.Faces, source.Edges, source.VolumeMm3, box, source.RawByteLength, source.RawPayloadSha256));
            Views.Add(new SceneObjectKey(_view.BodyId, "placed-instance"), instance);
            return instance;
        }

        [Test]
        public void InitialFitWaitsForTheWholeModelAndDoesNotOverwriteAnExplicitAnchor()
        {
            var scene = (QuestSceneState)typeof(QuestConnection).GetField("_scene", BindingFlags.Instance | BindingFlags.NonPublic)
                .GetValue(_display.Connection);
            var source = QuestMeshViewTests.NativeFixture().Header;
            var generation = scene.BeginConnection();
            var targets = new[] {
                new SceneMeshTarget(_view.BodyId, null, _view.FeatureId, source.SessionId, source.DocumentId, source.Revision),
                new SceneMeshTarget(_view.BodyId, "placed-instance", "placed-instance", source.SessionId, source.DocumentId, source.Revision) };
            var plan = scene.Reconcile(scene.CaptureObservation(generation, source.SessionId, source.DocumentId, source.Revision), targets, true);
            scene.Complete(plan.Requests.Single(ticket => ticket.Target.InstanceId == null));
            var firstModel = typeof(QuestDisplay).GetMethod("FirstModel", BindingFlags.Instance | BindingFlags.NonPublic);
            firstModel.Invoke(_display, null);
            Assert.That(Root.localScale, Is.EqualTo(Vector3.one), "Fit ran before the remaining body/instance arrived");
            var instance = AddAlreadyPlacedInstance();
            scene.Complete(plan.Requests.Single(ticket => ticket.Target.InstanceId != null));
            firstModel.Invoke(_display, null);
            var extent = (float)(instance.BboxMetres[3] - _view.BboxMetres[0]);
            Assert.That(Root.localScale.x * extent, Is.EqualTo(.35f).Within(.00001f));
            Assert.That(instance.transform.localPosition, Is.EqualTo(Vector3.zero), "instance placement must not be applied again");
            var anchor = new Vector3(.4f, .7f, 1.3f);
            _display.Place(anchor, 60);
            var before = Root.position;
            firstModel.Invoke(_display, null);
            Assert.That(Root.position, Is.EqualTo(before), "network hydration overwrote the explicit local anchor");
        }

        [Test]
        public void FitRejectsEmptyOrDegenerateBoundsWithoutChangingPlacement()
        {
            _display.Place(new Vector3(.3f, .8f, 1), 45);
            var before = Root.position; var scale = Root.localScale;
            Views.Clear();
            Assert.That(_display.SetScale("Fit"), Is.False);
            Assert.That(Root.position, Is.EqualTo(before));
            Views.Add(new SceneObjectKey(_view.BodyId), _view);
            typeof(QuestMeshView).GetProperty("BboxMetres").SetValue(_view, new double[6]);
            Assert.That(_display.SetScale("Fit"), Is.False);
            Assert.That(Root.position, Is.EqualTo(before));
            Assert.That(Root.localScale, Is.EqualTo(scale));
        }

        [Test]
        public void ExplicitPlacementBeforeFirstHydrationPreventsAutomaticRecenterAndScale()
        {
            _display.Place(new Vector3(.4f, .75f, 1.4f), 70);
            var position = Root.position; var scale = Root.localScale; var rotation = Root.rotation;
            typeof(QuestDisplay).GetMethod("FirstModel", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(_display, null);
            Assert.That(Root.position, Is.EqualTo(position), "initial hydration must respect a user-chosen anchor");
            Assert.That(Root.localScale, Is.EqualTo(scale));
            Assert.That(Root.rotation, Is.EqualTo(rotation));
        }

        [Test]
        public void PlacementPreviewIsDistinctTranslucentAndRestoresMaterialsWithoutReplacingGeometry()
        {
            var surface = new Material(Shader.Find("Standard"));
            var preview = new Material(Shader.Find("Kreoda/Selection")) { color = new Color(0, .7f, 1, .22f) };
            var selection = new Material(Shader.Find("Kreoda/Selection")) { color = new Color(0, .8f, 1, .45f) };
            try
            {
                _view.SurfaceMaterial = surface; _view.PreviewMaterial = preview; _view.SelectionMaterial = selection;
                _view.Upload(QuestMeshViewTests.NativeFixture());
                var mesh = _view.GetComponent<MeshFilter>().sharedMesh;
                Assert.That(_display.BeginPlacement(), Is.True);
                Assert.That(_view.GetComponent<MeshRenderer>().sharedMaterial, Is.SameAs(preview),
                    "placement still renders opaque authoritative style instead of distinct translucent preview");
                Assert.That(preview.color.a, Is.LessThan(1));
                Assert.That(preview, Is.Not.SameAs(selection));
                Assert.That(_view.GetComponent<MeshFilter>().sharedMesh, Is.SameAs(mesh));
                _view.Upload(QuestMeshViewTests.NativeFixture());
                Assert.That(_view.GetComponent<MeshRenderer>().sharedMaterial, Is.SameAs(preview), "incoming mesh lost active preview style");
                var incoming = AddAlreadyPlacedInstance();
                incoming.SurfaceMaterial = surface; incoming.PreviewMaterial = preview;
                typeof(QuestDisplay).GetMethod("FirstModel", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(_display, null);
                Assert.That(incoming.GetComponent<MeshRenderer>().sharedMaterial, Is.SameAs(preview));
                _display.CancelPlacement();
                Assert.That(_view.GetComponent<MeshRenderer>().sharedMaterial, Is.SameAs(surface));
                Assert.That(incoming.GetComponent<MeshRenderer>().sharedMaterial, Is.SameAs(surface));
                _display.BeginPlacement(); _display.UpdatePlacement(new Vector3(.3f, .75f, 1), 45, true);
                _display.FreezePlacement(); Assert.That(_display.ConfirmPlacement(true), Is.True);
                Assert.That(_view.GetComponent<MeshRenderer>().sharedMaterial, Is.SameAs(surface));
                Assert.That(surface == null || preview == null || selection == null, Is.False, "shared style assets must survive preview cleanup");
            }
            finally { Object.DestroyImmediate(surface); Object.DestroyImmediate(preview); Object.DestroyImmediate(selection); }
        }
    }
}
