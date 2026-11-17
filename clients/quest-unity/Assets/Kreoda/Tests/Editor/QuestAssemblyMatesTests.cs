using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Kreoda.QuestFoundation;
using Kreoda.QuestRuntime;
using Kreoda.Session;
using NUnit.Framework;
using UnityEngine;

namespace Kreoda.QuestRuntime.Tests
{
    public sealed class QuestAssemblyMatesTests
    {
        static readonly BindingFlags Private = BindingFlags.Instance | BindingFlags.NonPublic;

        sealed class Fixture : IDisposable
        {
            public readonly GameObject Root = new GameObject("Assembly mates test");
            public QuestConnection Connection;
            public QuestAssemblyMates Mates;
            public SessionClient Client;
            public SessionModelState Model;
            public QuestMeshView MovingView, FixedView;
            public long Generation;
            public readonly List<(string Method, IDictionary<string, object?> Parameters, string Session)> Requests =
                new List<(string, IDictionary<string, object?>, string)>();

            public Fixture()
            {
                Connection = Root.AddComponent<QuestConnection>();
                Mates = Root.AddComponent<QuestAssemblyMates>();
                Mates.Connection = Connection;
                Model = MakeModel(4);
                Client = NewClient(Model);
                typeof(QuestConnection).GetField("_client", Private).SetValue(Connection, Client);
                typeof(QuestConnection).GetProperty("Connected", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic)
                    .SetValue(Connection, true);
                var scene = (QuestSceneState)typeof(QuestConnection).GetField("_scene", Private).GetValue(Connection);
                Generation = scene.BeginConnection();
                MovingView = AddView("body-a", "instance-a", "instance-a");
                FixedView = AddView("body-b", "instance-b", "instance-b");
                var stamp = scene.CaptureObservation(Generation, Model.SessionId, Model.DocumentId, Model.Revision);
                var plan = scene.Reconcile(stamp, new[]
                {
                    new SceneMeshTarget(MovingView.BodyId, MovingView.InstanceId, MovingView.FeatureId,
                        Model.SessionId, Model.DocumentId, Model.Revision),
                    new SceneMeshTarget(FixedView.BodyId, FixedView.InstanceId, FixedView.FeatureId,
                        Model.SessionId, Model.DocumentId, Model.Revision),
                }, snapshot: true);
                Assert.That(plan.Requests, Has.Count.EqualTo(2));
                foreach (var ticket in plan.Requests)
                    Assert.That(scene.Complete(ticket), Is.EqualTo(MeshCompletionDisposition.Apply));
                Assert.That(Connection.IsCurrentView(MovingView), Is.True, "moving fixture view must be current");
                Assert.That(Connection.IsCurrentView(FixedView), Is.True, "fixed fixture view must be current");
                Mates.SendOverride = (method, parameters, token, sessionId, beforeSend) =>
                {
                    beforeSend?.Invoke();
                    Requests.Add((method, parameters, sessionId));
                    if (method == "command")
                    {
                        AdvanceModel(5);
                        return Task.FromResult(Reply(new { ok = true, revision = 5 }));
                    }
                    var instance = (string)parameters["featureId"];
                    var source = instance == "instance-a" ? "part-a" : "part-b";
                    var result = new
                    {
                        ok = true, sessionId = Model.SessionId, documentId = Model.DocumentId, revision = Model.Revision,
                        result = new
                        {
                            faces = new object[]
                            {
                                new { persistentId = instance + ":unsupported", captureRevision = Model.Revision,
                                    sourceBinding = new { type = "face", featureId = source, persistentFaceId = "sphere.0", geometryKind = "sphere" } },
                                new { featureId = instance, ambiguous = false, persistentId = instance + ":box.+Z", captureRevision = Model.Revision,
                                    sourceBinding = new { type = "face", featureId = source, persistentFaceId = "box.+Z", geometryKind = "plane" } },
                            }
                        }
                    };
                    return Task.FromResult(Reply(result));
                };
            }

            QuestMeshView AddView(string body, string instance, string feature)
            {
                var viewObject = new GameObject(instance);
                viewObject.transform.SetParent(Root.transform, false);
                var view = viewObject.AddComponent<QuestMeshView>();
                Set(view, "BodyId", body);Set(view, "InstanceId", instance);Set(view, "FeatureId", feature);Set(view, "UploadVersion", 1);
                var views = (Dictionary<SceneObjectKey, QuestMeshView>)typeof(QuestConnection).GetField("_views", Private).GetValue(Connection);
                views.Add(new SceneObjectKey(body, instance), view);
                return view;
            }

            public void Dispose() => UnityEngine.Object.DestroyImmediate(Root);

            public void AdvanceModel(long revision, string documentId = null)
            {
                Model = MakeModel(revision, documentId ?? Model.DocumentId);
                typeof(SessionClient).GetField("_model", Private).SetValue(Client, Model);
                var changed = typeof(SessionClient).GetField("ModelChanged", Private)?.GetValue(Client) as Action<SessionModelUpdate>;
                changed?.Invoke(new SessionModelUpdate(SessionModelUpdateKind.Applied, Model));
            }

            public void Reconnect()
            {
                var scene = (QuestSceneState)typeof(QuestConnection).GetField("_scene", Private).GetValue(Connection);
                Generation = scene.BeginConnection();
            }
        }

        [Test]
        public async Task CapturesExactInstanceGeometryAndCreatesNativeRegistryCommand()
        {
            using var fixture = new Fixture();
            fixture.Mates.NextKind();fixture.Mates.NextKind();fixture.Mates.NextKind();
            var movingHit = new MeshSemanticHit("instance-a:box.+Z", 0, 1, false);
            var fixedHit = new MeshSemanticHit("instance-b:box.+Z", 0, 1, false);
            await fixture.Mates.CaptureAsync(true, fixture.MovingView, movingHit, 1, () => true);
            await fixture.Mates.CaptureAsync(false, fixture.FixedView, fixedHit, 1, () => true);
            Assert.That(fixture.Mates.MovingLabel, Does.Contain("piano"));
            Assert.That(fixture.Mates.FixedLabel, Does.Contain("piano"));
            Assert.That(fixture.Mates.CanApply(out var reason), Is.True, reason);

            await fixture.Mates.ApplyAsync();
            Assert.That(fixture.Mates.Status, Does.Contain("Vincolo registrato").And.Contain("5"));
            Assert.That(fixture.Requests.Select(request => request.Method), Is.EqualTo(new[] { "findFaces", "findFaces", "command" }));
            Assert.That(fixture.Requests[0].Parameters, Does.ContainKey("expectedRevision").And.ContainKey("documentId"));
            Assert.That(fixture.Requests[0].Session, Is.EqualTo(fixture.Model.SessionId));
            var command = (IDictionary<string, object?>)fixture.Requests[2].Parameters["parameters"];
            Assert.That(command["kind"], Is.EqualTo("parallel"));
            Assert.That(command["movingId"], Is.EqualTo("instance-a"));
            Assert.That(command["fixedId"], Is.EqualTo("instance-b"));
            Assert.That(command["movingPickId"], Is.EqualTo("instance-a:box.+Z"));
            Assert.That(command["captureRevision"], Is.EqualTo(4L));
        }

        [Test]
        public async Task ApplyReadinessTracksDisconnectStalenessAndOtherCadWork()
        {
            using var fixture = new Fixture();
            fixture.Mates.NextKind();fixture.Mates.NextKind();fixture.Mates.NextKind();
            await fixture.Mates.CaptureAsync(true, fixture.MovingView,
                new MeshSemanticHit("instance-a:box.+Z", 0, 1, false), 1, () => true);
            await fixture.Mates.CaptureAsync(false, fixture.FixedView,
                new MeshSemanticHit("instance-b:box.+Z", 0, 1, false), 1, () => true);
            Assert.That(fixture.Mates.CanApply(out var readyReason), Is.True, readyReason);

            var commands = fixture.Root.AddComponent<QuestCommands>();
            fixture.Mates.Commands = commands;
            typeof(QuestCommands).GetProperty("Busy", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic)
                .SetValue(commands, true);
            Assert.That(fixture.Mates.CanApply(out var busyReason), Is.False);
            Assert.That(busyReason, Does.Contain("operazione CAD"));
            typeof(QuestCommands).GetProperty("Busy", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic)
                .SetValue(commands, false);
            Assert.That(fixture.Mates.CanApply(out _), Is.True);

            var direct = fixture.Root.AddComponent<QuestDirectFaceHistory>();
            fixture.Mates.DirectFaceHistory = direct;
            typeof(QuestDirectFaceHistory).GetField("_pending", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(direct, 1);
            Assert.That(fixture.Mates.CanApply(out var directBusyReason), Is.False);
            Assert.That(directBusyReason, Does.Contain("operazione CAD"));
            var sentBeforeDirectBusy = fixture.Requests.Count;
            await fixture.Mates.ApplyAsync();
            Assert.That(fixture.Requests.Count, Is.EqualTo(sentBeforeDirectBusy),
                "the mate command must not send while direct-face capture is pending");
            typeof(QuestDirectFaceHistory).GetField("_pending", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(direct, 0);
            Assert.That(fixture.Mates.CanApply(out _), Is.True);

            typeof(QuestConnection).GetProperty("Connected", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic)
                .SetValue(fixture.Connection, false);
            Assert.That(fixture.Mates.CanApply(out var disconnectedReason), Is.False);
            Assert.That(disconnectedReason, Does.Contain("istanze correnti"));
            typeof(QuestConnection).GetProperty("Connected", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic)
                .SetValue(fixture.Connection, true);

            fixture.AdvanceModel(5);
            Assert.That(fixture.Mates.CanApply(out var staleReason), Is.False);
            Assert.That(staleReason, Does.Contain("istanze correnti"));
        }

        [Test]
        public void QuestApplyControlUsesLiveReadinessAndHasReadableNonOverlappingColliderLayout()
        {
            var root = new GameObject("Assembly mates controls test");
            var head = new GameObject("Assembly mates controls head");
            try
            {
                var rig = head.AddComponent<OVRCameraRig>();
                rig.EnsureGameObjectIntegrity();
                var connection = root.AddComponent<QuestConnection>();
                connection.DisplayRoot = new GameObject("Assembly mates controls CAD root").transform;
                connection.DisplayRoot.SetParent(root.transform);
                connection.Section = root.AddComponent<QuestSection>();
                connection.Section.Connection = connection;
                var display = root.AddComponent<QuestDisplay>();
                display.Connection = connection;
                var controls = root.AddComponent<QuestControls>();
                controls.Connection = connection;controls.Rig = rig;controls.Display = display;
                controls.Environment = root.AddComponent<QuestEnvironment>();
                controls.Voice = root.AddComponent<QuestVoice>();
                controls.Voice.Connection = connection;controls.Voice.Controls = controls;
                controls.Font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
                controls.PanelMaterial = controls.ButtonMaterial = controls.RayMaterial = controls.Font.material;
                typeof(QuestControls).GetMethod("Start", Private).Invoke(controls, null);

                var page = (Transform)typeof(QuestControls).GetField("_assemblyMatesPage", Private).GetValue(controls);
                var apply = page.GetComponentsInChildren<QuestButton>(true).Single(button => button.ActionId == "Crea accoppiamento");
                var applyCollider = apply.GetComponent<Collider>();
                var applyLabel = (TextMesh)typeof(QuestControls).GetField("_assemblyMateApplyButton", Private).GetValue(controls);
                var textLimits = (Dictionary<TextMesh, Vector2>)typeof(QuestControls).GetField("_textLimits", Private).GetValue(controls);
                Assert.That(apply.Click, Is.Not.Null, "the actual Quest control must keep its Apply callback");
                Assert.That(apply.transform.localScale.x, Is.EqualTo(.31f).Within(.0001f));
                Assert.That(apply.transform.localScale.y, Is.EqualTo(.038f).Within(.0001f));
                Assert.That(textLimits[applyLabel].x, Is.EqualTo(.294f).Within(.0001f));
                Assert.That(textLimits[applyLabel].y, Is.EqualTo(.028f).Within(.0001f));
                Assert.That(applyCollider.bounds.Intersects(page.GetComponentsInChildren<QuestButton>(true)
                    .Single(button => button.ActionId == "Annulla").GetComponent<Collider>().bounds), Is.False);
                Assert.That(applyCollider.bounds.Intersects(page.GetComponentsInChildren<QuestButton>(true)
                    .Single(button => button.ActionId == "Indietro").GetComponent<Collider>().bounds), Is.False);

                typeof(QuestControls).GetMethod("RefreshContextualActions", Private)
                    .Invoke(controls, new object[] { Array.Empty<DiscoveredSessionPc>() });
                Assert.That(controls.AssemblyMates.CanApply(out _), Is.False);
                Assert.That(applyCollider.enabled, Is.False,
                    "uncaptured or disconnected CAD state must disable the actual hand-ray collider");
                apply.Click.Invoke();
                Assert.That(controls.AssemblyMates.Status, Does.Contain("istanze correnti"),
                    "direct callback invocation must still respect live readiness");
            }
            finally
            {
                var connection = root.GetComponent<QuestConnection>();
                if (connection != null) typeof(QuestConnection).GetMethod("OnDestroy", Private).Invoke(connection, null);
                UnityEngine.Object.DestroyImmediate(root);
                UnityEngine.Object.DestroyImmediate(head);
            }
        }

        [Test]
        public async Task RejectsLateCaptureAfterSelectionOrUploadChanges()
        {
            using var fixture = new Fixture();
            for (var i = 0; i < 3; i++) fixture.Mates.NextKind();
            var hit = new MeshSemanticHit("instance-a:box.+Z", 0, 1, false);
            var release = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
            CancellationToken requestToken = default;
            fixture.Mates.SendOverride = (method, parameters, token, session, beforeSend) =>
            {
                beforeSend?.Invoke();
                requestToken = token;
                return release.Task;
            };
            var current = true;
            var pending = fixture.Mates.CaptureAsync(true, fixture.MovingView, hit, 1, () => current);
            current = false;
            Set(fixture.MovingView, "UploadVersion", 2);
            fixture.Mates.RefreshStaleCaptures();
            Assert.That(requestToken.IsCancellationRequested, Is.True);
            release.SetResult(FaceReply(fixture.Model, "instance-a:box.+Z", "part-a", "box.+Z", "plane"));
            await pending;
            Assert.That(fixture.Mates.MovingLabel, Is.EqualTo("Mobile: —"));
            Assert.That(fixture.Mates.Status, Does.Contain("Selezione cambiata"));
        }

        [Test]
        public async Task CancelsCaptureOnModelReplacementAndReconnect()
        {
            using var fixture = new Fixture();
            for (var i = 0; i < 3; i++) fixture.Mates.NextKind();
            var hit = new MeshSemanticHit("instance-a:box.+Z", 0, 1, false);
            var release = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
            CancellationToken requestToken = default;
            fixture.Mates.SendOverride = (method, parameters, token, session, beforeSend) =>
            {
                beforeSend?.Invoke();requestToken = token;return release.Task;
            };
            var pending = fixture.Mates.CaptureAsync(true, fixture.MovingView, hit, 1, () => true);
            fixture.AdvanceModel(4, "doc-replaced");
            fixture.Mates.RefreshStaleCaptures();
            Assert.That(requestToken.IsCancellationRequested, Is.True);
            release.SetResult(FaceReply(fixture.Model, "instance-a:box.+Z", "part-a", "box.+Z", "plane"));
            await pending;
            Assert.That(fixture.Mates.MovingLabel, Is.EqualTo("Mobile: —"));

            using var reconnectFixture = new Fixture();
            for (var i = 0; i < 3; i++) reconnectFixture.Mates.NextKind();
            var nextRelease = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
            requestToken = default;
            reconnectFixture.Mates.SendOverride = (method, parameters, token, session, beforeSend) =>
            {
                beforeSend?.Invoke();requestToken = token;return nextRelease.Task;
            };
            var retry = reconnectFixture.Mates.CaptureAsync(true, reconnectFixture.MovingView, hit, 1, () => true);
            reconnectFixture.Reconnect();
            reconnectFixture.Mates.RefreshStaleCaptures();
            Assert.That(requestToken.IsCancellationRequested, Is.True);
            nextRelease.SetResult(FaceReply(reconnectFixture.Model, "instance-a:box.+Z", "part-a", "box.+Z", "plane"));
            await retry;
            Assert.That(reconnectFixture.Mates.MovingLabel, Is.EqualTo("Mobile: —"));
        }

        [Test]
        public async Task DuplicateApplyWaitsForCommittedModelDelta()
        {
            using var fixture = new Fixture();
            fixture.Mates.NextKind();fixture.Mates.NextKind();fixture.Mates.NextKind();
            await fixture.Mates.CaptureAsync(true, fixture.MovingView,
                new MeshSemanticHit("instance-a:box.+Z", 0, 1, false), 1, () => true);
            await fixture.Mates.CaptureAsync(false, fixture.FixedView,
                new MeshSemanticHit("instance-b:box.+Z", 0, 1, false), 1, () => true);

            var commandReply = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
            fixture.Mates.SendOverride = (method, parameters, token, session, beforeSend) =>
            {
                beforeSend?.Invoke();fixture.Requests.Add((method, parameters, session));
                if (method == "command") return commandReply.Task;
                var instance = (string)parameters["featureId"];
                return Task.FromResult(FaceReply(fixture.Model, instance + ":box.+Z",
                    instance == "instance-a" ? "part-a" : "part-b", "box.+Z", "plane"));
            };
            var applying = fixture.Mates.ApplyAsync();
            await fixture.Mates.ApplyAsync();
            Assert.That(fixture.Requests.Count(request => request.Method == "command"), Is.EqualTo(1));

            commandReply.SetResult(Reply(new { ok = true, revision = 5 }));
            await Task.Delay(10);
            Assert.That(fixture.Mates.Busy, Is.True);
            Assert.That(fixture.Mates.Status, Does.Not.Contain("Vincolo registrato"));
            fixture.AdvanceModel(5);
            await applying;
            Assert.That(fixture.Mates.Status, Does.Contain("Vincolo registrato · revisione 5"));
        }

        [Test]
        public async Task RejectedCommandDoesNotReportSuccess()
        {
            using var fixture = new Fixture();
            fixture.Mates.NextKind();
            await fixture.Mates.CaptureAsync(true, fixture.MovingView, null, 0, () => true);
            await fixture.Mates.CaptureAsync(false, fixture.FixedView, null, 0, () => true);
            fixture.Mates.SendOverride = (method, parameters, token, session, beforeSend) =>
            {
                beforeSend?.Invoke();fixture.Requests.Add((method, parameters, session));
                return Task.FromResult(Reply(new { ok = false, revision = 5 }));
            };
            await fixture.Mates.ApplyAsync();
            Assert.That(fixture.Mates.Status, Does.Contain("rifiutato"));
            Assert.That(fixture.Mates.Status, Does.Not.Contain("Vincolo registrato"));
        }

        [Test]
        public async Task AcceptedReplyWithoutDeltaIsUncertainWhenCancelled()
        {
            using var fixture = new Fixture();
            await fixture.Mates.CaptureAsync(true, fixture.MovingView, null, 0, () => true);
            var commandReply = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
            fixture.Mates.SendOverride = (method, parameters, token, session, beforeSend) =>
            {
                beforeSend?.Invoke();fixture.Requests.Add((method, parameters, session));
                return commandReply.Task;
            };
            var applying = fixture.Mates.ApplyAsync();
            commandReply.SetResult(Reply(new { ok = true, revision = 5 }));
            await Task.Delay(10);
            Assert.That(fixture.Mates.Busy, Is.True);
            Assert.That(fixture.Mates.Status, Does.Not.Contain("Vincolo registrato"));
            fixture.Mates.CancelPending();
            await applying;
            Assert.That(fixture.Mates.Status, Does.Contain("esito remoto da verificare"));
            Assert.That(fixture.Mates.Status, Does.Not.Contain("non applicato"));
        }

        [Test]
        public async Task BuildsAllSevenRegisteredConstraintPayloads()
        {
            var expectedKinds = new[] { "ground", "coincident", "distance", "parallel", "perpendicular", "concentric", "angle" };
            for (var kind = 0; kind < expectedKinds.Length; kind++)
            {
                using var fixture = new Fixture();
                for (var i = 0; i < kind; i++) fixture.Mates.NextKind();
                if (kind == 2) { fixture.Mates.NextAxis();fixture.Mates.SetValue("-12.5"); }
                if (kind == 6) fixture.Mates.SetValue("45");
                if (kind == 5)
                {
                    fixture.Mates.SendOverride = (method, parameters, token, session, beforeSend) =>
                    {
                        beforeSend?.Invoke();fixture.Requests.Add((method, parameters, session));
                        if (method == "command")
                        { fixture.AdvanceModel(5);return Task.FromResult(Reply(new { ok = true, revision = 5 })); }
                        var instance = (string)parameters["featureId"];
                        return Task.FromResult(FaceReply(fixture.Model, instance + ":cylinder.0",
                            instance == "instance-a" ? "part-a" : "part-b", "cylinder.0", "cylinder"));
                    };
                }

                var geometric = kind >= 3;
                await fixture.Mates.CaptureAsync(true, fixture.MovingView,
                    geometric ? new MeshSemanticHit(kind == 5 ? "instance-a:cylinder.0" : "instance-a:box.+Z", 0, 1, false) : null,
                    geometric ? 1 : 0, () => true);
                if (kind != 0)
                    await fixture.Mates.CaptureAsync(false, fixture.FixedView,
                        geometric ? new MeshSemanticHit(kind == 5 ? "instance-b:cylinder.0" : "instance-b:box.+Z", 0, 1, false) : null,
                        geometric ? 1 : 0, () => true);

                await fixture.Mates.ApplyAsync();
                var request = fixture.Requests.Single(item => item.Method == "command");
                var command = (IDictionary<string, object?>)request.Parameters["parameters"];
                Assert.That(command["kind"], Is.EqualTo(expectedKinds[kind]));
                Assert.That(command["movingId"], Is.EqualTo("instance-a"));
                if (kind == 0) Assert.That(command, Does.Not.ContainKey("fixedId"));
                else Assert.That(command["fixedId"], Is.EqualTo("instance-b"));
                if (kind == 1) Assert.That(command, Does.Not.ContainKey("movingSourceBinding"));
                if (kind == 2)
                {
                    Assert.That(command["axis"], Is.EqualTo(1));
                    Assert.That(command["distanceMm"], Is.EqualTo(-12.5));
                }
                if (kind >= 3) Assert.That(command["captureRevision"], Is.EqualTo(4L));
                if (kind == 5)
                    Assert.That(((IDictionary<string, object?>)command["movingSourceBinding"])["geometryKind"], Is.EqualTo("cylinder"));
                if (kind == 6) Assert.That(command["angleDeg"], Is.EqualTo(45d));
                Assert.That(fixture.Mates.Status, Does.Contain("Vincolo registrato"));
            }
        }

        [Test]
        public async Task FocusLossCancelsPendingCaptureAndPreventsLateSlotRestore()
        {
            using var fixture = new Fixture();
            for (var i = 0; i < 3; i++) fixture.Mates.NextKind();
            var release = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
            CancellationToken requestToken = default;
            fixture.Mates.SendOverride = (method, parameters, token, session, beforeSend) =>
            {
                beforeSend?.Invoke();requestToken = token;return release.Task;
            };
            var pending = fixture.Mates.CaptureAsync(true, fixture.MovingView,
                new MeshSemanticHit("instance-a:box.+Z", 0, 1, false), 1, () => true);
            typeof(QuestAssemblyMates).GetMethod("OnApplicationFocus", Private).Invoke(fixture.Mates, new object[] { false });
            Assert.That(requestToken.IsCancellationRequested, Is.True);
            release.SetResult(FaceReply(fixture.Model, "instance-a:box.+Z", "part-a", "box.+Z", "plane"));
            await pending;
            Assert.That(fixture.Mates.MovingLabel, Is.EqualTo("Mobile: —"));
            Assert.That(fixture.Mates.Status, Does.Contain("Focus perso"));
        }

        [Test]
        public async Task RejectsAmbiguousWrongOwnerAndUnsupportedSelectedRows()
        {
            using var fixture = new Fixture();
            fixture.Mates.NextKind();fixture.Mates.NextKind();fixture.Mates.NextKind();
            var model = fixture.Model;
            var pick = "instance-a:box.+Z";
            var wrongOwner = GeometryListReply(model, new
            {
                featureId = "instance-b", ambiguous = false, persistentId = pick, captureRevision = model.Revision,
                sourceBinding = new { type = "face", featureId = "part-a", persistentFaceId = "box.+Z", geometryKind = "plane" }
            });
            var duplicate = new
            {
                featureId = "instance-a", ambiguous = false, persistentId = pick, captureRevision = model.Revision,
                sourceBinding = new { type = "face", featureId = "part-a", persistentFaceId = "box.+Z", geometryKind = "plane" }
            };
            var ambiguous = GeometryListReply(model, duplicate, duplicate);
            var unsupported = GeometryListReply(model, new
            {
                featureId = "instance-a", ambiguous = false, persistentId = pick, captureRevision = model.Revision,
                sourceBinding = new { type = "face", featureId = "part-a", persistentFaceId = "sphere.0", geometryKind = "sphere" }
            });
            var withSelectionEntry = GeometryListReply(model, new
            {
                featureId = "instance-a", ambiguous = false, persistentId = pick, captureRevision = model.Revision,
                selectionEntry = "internal", sourceBinding = new { type = "face", featureId = "part-a", persistentFaceId = "box.+Z", geometryKind = "plane" }
            });
            var withNestedExtra = GeometryListReply(model, new
            {
                featureId = "instance-a", ambiguous = false, persistentId = pick, captureRevision = model.Revision,
                sourceBinding = new { type = "face", featureId = "part-a", persistentFaceId = "box.+Z", geometryKind = "plane", role = "box.+Z" }
            });
            var validWithUnrelatedSphere = GeometryListReply(model,
                new { persistentId = "instance-a:sphere.0", captureRevision = model.Revision,
                    sourceBinding = new { type = "face", featureId = "part-a", persistentFaceId = "sphere.0", geometryKind = "sphere" } },
                duplicate);
            var replies = new Queue<JsonElement>(new[] { wrongOwner, ambiguous, unsupported, withSelectionEntry, withNestedExtra, validWithUnrelatedSphere });
            fixture.Mates.SendOverride = (method, parameters, token, session, beforeSend) =>
            {
                beforeSend?.Invoke();fixture.Requests.Add((method, parameters, session));
                return Task.FromResult(replies.Dequeue());
            };

            for (var attempt = 0; attempt < 5; attempt++)
            {
                await fixture.Mates.CaptureAsync(true, fixture.MovingView,
                    new MeshSemanticHit(pick, 0, 1, false), 1, () => true);
                Assert.That(fixture.Mates.MovingLabel, Is.EqualTo("Mobile: —"));
            }
            await fixture.Mates.CaptureAsync(true, fixture.MovingView,
                new MeshSemanticHit(pick, 0, 1, false), 1, () => true);
            Assert.That(fixture.Mates.MovingLabel, Does.Contain("piano"));
        }

        static JsonElement FaceReply(SessionModelState model, string pick, string feature, string persistent, string geometry) =>
            Reply(new
            {
                ok = true, sessionId = model.SessionId, documentId = model.DocumentId, revision = model.Revision,
                result = new { faces = new[] { new { featureId = pick.Substring(0, pick.IndexOf(':')), ambiguous = false,
                    persistentId = pick, captureRevision = model.Revision,
                    sourceBinding = new { type = "face", featureId = feature, persistentFaceId = persistent, geometryKind = geometry } } } }
            });

        static JsonElement GeometryListReply(SessionModelState model, params object[] faces) => Reply(new
        {
            ok = true, sessionId = model.SessionId, documentId = model.DocumentId, revision = model.Revision,
            result = new { faces }
        });

        static SessionModelState MakeModel(long revision, string documentId = "doc-mates")
        {
            using var json = JsonDocument.Parse("[{\"featureId\":\"part-a\",\"type\":\"Box\"},{\"featureId\":\"part-b\",\"type\":\"Box\"}," +
                "{\"featureId\":\"instance-a\",\"type\":\"Instance\",\"dependsOn\":[\"part-a\"]}," +
                "{\"featureId\":\"instance-b\",\"type\":\"Instance\",\"dependsOn\":[\"part-b\"]}]");
            return new SessionModelState("550e8400-e29b-41d4-a716-446655440000", documentId, revision,
                json.RootElement.EnumerateArray().Select(item => item.Clone()).ToArray(), Array.Empty<JsonElement>(), Array.Empty<JsonElement>());
        }

        static SessionClient NewClient(SessionModelState model)
        {
            var client = (SessionClient)typeof(SessionClient).GetConstructor(Private, null, Type.EmptyTypes, null).Invoke(null);
            typeof(SessionClient).GetField("_model", Private).SetValue(client, model);
            return client;
        }

        static void Set(QuestMeshView view, string property, object value) =>
            typeof(QuestMeshView).GetProperty(property, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic).SetValue(view, value);

        static JsonElement Reply(object value) => JsonDocument.Parse(JsonSerializer.Serialize(value)).RootElement.Clone();
    }
}
