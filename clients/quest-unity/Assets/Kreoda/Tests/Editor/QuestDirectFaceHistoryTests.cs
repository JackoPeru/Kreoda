using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Kreoda.QuestFoundation;
using Kreoda.Session;
using NUnit.Framework;
using UnityEngine;

namespace Kreoda.QuestRuntime.Tests
{
    public sealed class QuestDirectFaceHistoryTests
    {
        static readonly BindingFlags Private = BindingFlags.Instance | BindingFlags.NonPublic;

        sealed class Fixture : IDisposable
        {
            const string SessionId = "550e8400-e29b-41d4-a716-446655440000";
            public readonly GameObject Root = new GameObject("Direct face history test");
            readonly List<Mesh> _meshes = new List<Mesh>();
            public readonly List<(string Method, IDictionary<string, object?> Parameters, string Session)> Requests =
                new List<(string, IDictionary<string, object?>, string)>();
            public QuestConnection Connection;
            public QuestDirectFaceHistory Direct;
            public SessionClient Client;
            public SessionModelState Model;
            public QuestMeshView SourceView, InstanceView;
            public long Generation;

            public Fixture()
            {
                Connection = Root.AddComponent<QuestConnection>();
                Direct = Root.AddComponent<QuestDirectFaceHistory>();
                Direct.Connection = Connection;
                Model = MakeModel(4);
                Client = NewClient(Model);
                typeof(QuestConnection).GetField("_client", Private).SetValue(Connection, Client);
                typeof(QuestConnection).GetProperty("Connected", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic)
                    .SetValue(Connection, true);
                var scene = (QuestSceneState)typeof(QuestConnection).GetField("_scene", Private).GetValue(Connection);
                Generation = scene.BeginConnection();
                SourceView = AddView("body-box", null, "box-a");
                InstanceView = AddView("body-instance", "instance-a", "instance-a");
                var stamp = scene.CaptureObservation(Generation, Model.SessionId, Model.DocumentId, Model.Revision);
                var plan = scene.Reconcile(stamp, new[]
                {
                    new SceneMeshTarget(SourceView.BodyId, SourceView.InstanceId, SourceView.FeatureId,
                        Model.SessionId, Model.DocumentId, Model.Revision),
                    new SceneMeshTarget(InstanceView.BodyId, InstanceView.InstanceId, InstanceView.FeatureId,
                        Model.SessionId, Model.DocumentId, Model.Revision),
                }, snapshot: true);
                Assert.That(plan.Requests, Has.Count.EqualTo(2));
                foreach (var ticket in plan.Requests)
                    Assert.That(scene.Complete(ticket), Is.EqualTo(MeshCompletionDisposition.Apply));
                Assert.That(Connection.IsCurrentView(SourceView), Is.True);
                Assert.That(Connection.IsCurrentView(InstanceView), Is.True);
                Direct.SendOverride = Send;
            }

            QuestMeshView AddView(string body, string instance, string feature)
            {
                var go = new GameObject(feature);
                go.transform.SetParent(Root.transform, false);
                var mesh = new Mesh { vertices = new[] { Vector3.zero, Vector3.right, Vector3.up }, triangles = new[] { 0, 1, 2 } };
                _meshes.Add(mesh);
                go.AddComponent<MeshFilter>().sharedMesh = mesh;
                go.AddComponent<MeshRenderer>();
                var view = go.AddComponent<QuestMeshView>();
                Set(view, "BodyId", body);Set(view, "InstanceId", instance);Set(view, "FeatureId", feature);Set(view, "UploadVersion", 1);
                var views = (Dictionary<SceneObjectKey, QuestMeshView>)typeof(QuestConnection).GetField("_views", Private).GetValue(Connection);
                views.Add(new SceneObjectKey(body, instance), view);
                return view;
            }

            Task<JsonElement> Send(string method, IDictionary<string, object?> parameters, CancellationToken token,
                string sessionId, Action beforeSend)
            {
                beforeSend?.Invoke();
                Requests.Add((method, parameters, sessionId));
                if (method == SessionMethods.FindFaces)
                    return Task.FromResult(FaceReply(Model, (string)parameters["featureId"]));
                if (method == SessionMethods.Command)
                {
                    var revision = (long)parameters["baseRevision"];
                    AdvanceModel(revision + 2);
                    return Task.FromResult(Reply(new { ok = true, sessionId = Model.SessionId,
                        documentId = Model.DocumentId, revision = revision + 1 }));
                }
                throw new AssertionException("unexpected direct-face method " + method);
            }

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

            public void Dispose()
            {
                UnityEngine.Object.DestroyImmediate(Root);
                foreach (var mesh in _meshes) UnityEngine.Object.DestroyImmediate(mesh);
            }

            static SessionModelState MakeModel(long revision, string documentId = "doc-direct")
            {
                using var features = JsonDocument.Parse("[{\"featureId\":\"box-a\",\"type\":\"Box\",\"volumeMm3\":1000,\"geometryCurrent\":true,\"status\":\"ok\"}," +
                    "{\"featureId\":\"box-later\",\"type\":\"Box\",\"volumeMm3\":900,\"geometryCurrent\":true,\"status\":\"ok\"}," +
                    "{\"featureId\":\"instance-a\",\"type\":\"Instance\",\"volumeMm3\":1000,\"geometryCurrent\":true,\"status\":\"ok\"}]");
                using var bodies = JsonDocument.Parse("[{\"bodyId\":\"body-box\",\"tip\":\"box-a\",\"visible\":true}]");
                return new SessionModelState(SessionId, documentId, revision,
                    features.RootElement.EnumerateArray().Select(item => item.Clone()).ToArray(), Array.Empty<JsonElement>(),
                    bodies.RootElement.EnumerateArray().Select(item => item.Clone()).ToArray());
            }

            static SessionClient NewClient(SessionModelState model)
            {
                var client = (SessionClient)typeof(SessionClient).GetConstructor(Private, null, Type.EmptyTypes, null).Invoke(null);
                typeof(SessionClient).GetField("_model", Private).SetValue(client, model);
                return client;
            }
        }

        [Test]
        public async Task CapturesAndAppliesExactOwnerQualifiedNativeFaceAndAcceptsNewerSnapshot()
        {
            using var fixture = new Fixture();
            await fixture.Direct.CaptureSourceAsync(fixture.SourceView,
                new MeshSemanticHit("box-a:face.5", 0, 1, false), () => true);

            Assert.That(fixture.Direct.SourceLabel, Does.Contain("box-a"),
                fixture.Direct.Status + " · requests=" + fixture.Requests.Count + " · connected=" + fixture.Connection.Connected);
            Assert.That(fixture.Direct.CanApply(out var reason), Is.True, reason);
            for (var value = 1; value <= 9; value++)
            {
                Assert.That(fixture.Direct.SetFieldValue(value.ToString()), Is.True);
                fixture.Direct.NextField();
            }

            await fixture.Direct.ApplyAsync();

            var request = fixture.Requests.Single(item => item.Method == SessionMethods.Command);
            var payload = (IDictionary<string, object?>)request.Parameters["parameters"];
            var source = (IDictionary<string, object?>)payload["sourceFace"];
            Assert.That(request.Session, Is.EqualTo(fixture.Model.SessionId));
            Assert.That(payload["sourceFeatureId"], Is.EqualTo("box-a"));
            Assert.That(source.Keys.OrderBy(key => key).ToArray(), Is.EqualTo(new[] { "featureId", "persistentFaceId", "type" }));
            Assert.That(source["persistentFaceId"], Is.EqualTo("box-a:face.5"));
            Assert.That(payload["captureRevision"], Is.EqualTo(4L));
            Assert.That((double[])payload["translationMm"], Is.EqualTo(new[] { 1d, 2d, 3d }));
            Assert.That((double[])payload["rotationDeg"], Is.EqualTo(new[] { 4d, 5d, 6d }));
            Assert.That((double[])payload["pivotMm"], Is.EqualTo(new[] { 7d, 8d, 9d }));
            Assert.That(payload.ContainsKey("sourceBinding"), Is.False);
            Assert.That(fixture.Direct.Status, Does.Contain("revisione 6"));
        }

        [Test]
        public async Task ReplaceAcceptsVisibleInstanceAsSupportButNeverAsSource()
        {
            using var fixture = new Fixture();
            var instanceHit = new MeshSemanticHit("instance-a:face.5", 0, 1, false);
            await fixture.Direct.CaptureSourceAsync(fixture.InstanceView, instanceHit, () => true);
            Assert.That(fixture.Direct.SourceLabel, Is.EqualTo("Sorgente: —"));
            Assert.That(fixture.Requests, Is.Empty);

            for (var i = 0; i < 3; i++) fixture.Direct.NextOperation();
            await fixture.Direct.CaptureSourceAsync(fixture.SourceView,
                new MeshSemanticHit("box-a:face.5", 0, 1, false), () => true);
            await fixture.Direct.CaptureSupportAsync(fixture.InstanceView, instanceHit, () => true);

            Assert.That(fixture.Direct.SourceLabel, Does.Contain("box-a"));
            Assert.That(fixture.Direct.SupportLabel, Does.Contain("instance-a"));
            Assert.That(fixture.Direct.CanApply(out var reason), Is.True, reason);
            await fixture.Direct.ApplyAsync();

            var request = fixture.Requests.Single(item => item.Method == SessionMethods.Command);
            var payload = (IDictionary<string, object?>)request.Parameters["parameters"];
            var replacement = (IDictionary<string, object?>)payload["replacementFace"];
            Assert.That(replacement["featureId"], Is.EqualTo("instance-a"));
            Assert.That(replacement["persistentFaceId"], Is.EqualTo("instance-a:face.5"));
        }

        [Test]
        public async Task OffsetUsesSignedDistanceAndDeleteSendsOnlyDirectSourceReference()
        {
            using (var offset = new Fixture())
            {
                await offset.Direct.CaptureSourceAsync(offset.SourceView,
                    new MeshSemanticHit("box-a:face.5", 0, 1, false), () => true);
                offset.Direct.NextOperation();
                Assert.That(offset.Direct.SetFieldValue("-2,5"), Is.True);
                Assert.That(offset.Direct.SetFieldValue("0"), Is.False);
                Assert.That(offset.Direct.SetFieldValue("NaN"), Is.False);
                await offset.Direct.ApplyAsync();

                var request = offset.Requests.Single(item => item.Method == SessionMethods.Command);
                Assert.That(request.Parameters["commandId"], Is.EqualTo("CreateOffsetFace"));
                var payload = (IDictionary<string, object?>)request.Parameters["parameters"];
                Assert.That(payload["distanceMm"], Is.EqualTo(-2.5d));
            }

            using (var delete = new Fixture())
            {
                await delete.Direct.CaptureSourceAsync(delete.SourceView,
                    new MeshSemanticHit("box-a:face.5", 0, 1, false), () => true);
                delete.Direct.NextOperation();delete.Direct.NextOperation();
                await delete.Direct.ApplyAsync();

                var request = delete.Requests.Single(item => item.Method == SessionMethods.Command);
                Assert.That(request.Parameters["commandId"], Is.EqualTo("CreateDeleteFace"));
                var payload = (IDictionary<string, object?>)request.Parameters["parameters"];
                Assert.That(payload.Keys.OrderBy(key => key).ToArray(),
                    Is.EqualTo(new[] { "captureRevision", "sourceFace", "sourceFeatureId" }));
            }
        }

        [Test]
        public async Task FailedSourceRecaptureClearsOnlyThatSlotAndForeignQualifiedRoleFailsClosed()
        {
            using var fixture = new Fixture();
            for (var i = 0; i < 3; i++) fixture.Direct.NextOperation();
            await fixture.Direct.CaptureSourceAsync(fixture.SourceView,
                new MeshSemanticHit("box-a:face.5", 0, 1, false), () => true);
            await fixture.Direct.CaptureSupportAsync(fixture.InstanceView,
                new MeshSemanticHit("instance-a:face.5", 0, 1, false), () => true);
            fixture.Direct.SendOverride = (method, parameters, token, session, beforeSend) =>
            {
                beforeSend?.Invoke();
                fixture.Requests.Add((method, parameters, session));
                return Task.FromResult(FaceReply(fixture.Model, "box-a", "other-owner:face.5"));
            };

            await fixture.Direct.CaptureSourceAsync(fixture.SourceView,
                new MeshSemanticHit("box-a:face.5", 0, 1, false), () => true);

            Assert.That(fixture.Direct.SourceLabel, Is.EqualTo("Sorgente: —"));
            Assert.That(fixture.Direct.SupportLabel, Does.Contain("instance-a"));
        }

        [Test]
        public async Task SuccessfulAckWithWrongRevisionIsUncertainAndNotReportedAsRemoteRejection()
        {
            using var fixture = new Fixture();
            await fixture.Direct.CaptureSourceAsync(fixture.SourceView,
                new MeshSemanticHit("box-a:face.5", 0, 1, false), () => true);
            fixture.Direct.SendOverride = (method, parameters, token, session, beforeSend) =>
            {
                beforeSend?.Invoke();
                fixture.Requests.Add((method, parameters, session));
                if (method == SessionMethods.Command)
                    return Task.FromResult(Reply(new { ok = true, sessionId = fixture.Model.SessionId,
                        documentId = fixture.Model.DocumentId, revision = fixture.Model.Revision + 2 }));
                return Task.FromResult(FaceReply(fixture.Model, (string)parameters["featureId"]));
            };

            await fixture.Direct.ApplyAsync();

            Assert.That(fixture.Requests.Count(item => item.Method == SessionMethods.Command), Is.EqualTo(1));
            Assert.That(fixture.Direct.Status, Does.Contain("Accettato dal PC"));
            Assert.That(fixture.Direct.Status, Does.Not.Contain("Rifiutato dal PC"));
        }

        [Test]
        public async Task ExplicitRemoteRejectionStillReportsFailureWithoutRetry()
        {
            using var fixture = new Fixture();
            await fixture.Direct.CaptureSourceAsync(fixture.SourceView,
                new MeshSemanticHit("box-a:face.5", 0, 1, false), () => true);
            fixture.Direct.SendOverride = (method, parameters, token, session, beforeSend) =>
            {
                beforeSend?.Invoke();
                fixture.Requests.Add((method, parameters, session));
                if (method == SessionMethods.Command)
                    return Task.FromResult(Reply(new { ok = false, sessionId = fixture.Model.SessionId,
                        documentId = fixture.Model.DocumentId, revision = fixture.Model.Revision }));
                return Task.FromResult(FaceReply(fixture.Model, (string)parameters["featureId"]));
            };

            await fixture.Direct.ApplyAsync();

            Assert.That(fixture.Direct.Status, Does.Contain("Rifiutato dal PC"));
            Assert.That(fixture.Requests.Count(item => item.Method == SessionMethods.Command), Is.EqualTo(1));
        }

        [Test]
        public async Task LateAckFromAnotherDocumentDoesNotOverwriteCurrentStatus()
        {
            using var fixture = new Fixture();
            await fixture.Direct.CaptureSourceAsync(fixture.SourceView,
                new MeshSemanticHit("box-a:face.5", 0, 1, false), () => true);
            var release = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
            fixture.Direct.SendOverride = (method, parameters, token, session, beforeSend) =>
            {
                beforeSend?.Invoke();
                fixture.Requests.Add((method, parameters, session));
                if (method == SessionMethods.Command) return release.Task;
                return Task.FromResult(FaceReply(fixture.Model, (string)parameters["featureId"]));
            };

            var applying = fixture.Direct.ApplyAsync();
            var statusAtSend = fixture.Direct.Status;
            fixture.AdvanceModel(4, "doc-next");
            release.SetResult(Reply(new { ok = true, sessionId = fixture.Model.SessionId,
                documentId = "doc-direct", revision = 5 }));
            await applying;

            Assert.That(fixture.Direct.Status, Does.Not.Contain("Rifiutato dal PC"));
            Assert.That(fixture.Direct.Status, Does.Not.Contain("salvata · revisione"));
            Assert.That(fixture.Direct.Status == statusAtSend || fixture.Direct.Status.Contains("esito remoto da verificare"), Is.True);
            Assert.That(fixture.Requests.Count(item => item.Method == SessionMethods.Command), Is.EqualTo(1));
        }

        [Test]
        public async Task CancelDuringCaptureCancelsRequestAndIgnoresLateFaceReply()
        {
            using var fixture = new Fixture();
            var release = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
            CancellationToken requestToken = default;
            fixture.Direct.SendOverride = (method, parameters, token, session, beforeSend) =>
            {
                beforeSend?.Invoke();
                fixture.Requests.Add((method, parameters, session));
                requestToken = token;
                return release.Task;
            };

            var capture = fixture.Direct.CaptureSourceAsync(fixture.SourceView,
                new MeshSemanticHit("box-a:face.5", 0, 1, false), () => true);
            fixture.Direct.Cancel();
            Assert.That(requestToken.IsCancellationRequested, Is.True);
            release.SetResult(FaceReply(fixture.Model, "box-a"));
            await capture;

            Assert.That(fixture.Direct.SourceLabel, Is.EqualTo("Sorgente: —"));
            Assert.That(fixture.Direct.Busy, Is.False);
            Assert.That(fixture.Requests, Has.Count.EqualTo(1));
        }

        static JsonElement FaceReply(SessionModelState model, string owner, string role = null) => Reply(new
        {
            ok = true, sessionId = model.SessionId, documentId = model.DocumentId, revision = model.Revision,
            result = new { faces = new[] { new { featureId = owner, ambiguous = false,
                persistentId = owner + ":face.5", captureRevision = model.Revision,
                sourceFace = new { type = "face", featureId = owner,
                    persistentFaceId = role ?? owner + ":face.5" },
                surfaceType = "plane", centroidMm = new[] { 1d, 2d, 3d } } } }
        });

        static JsonElement Reply(object value) => JsonDocument.Parse(JsonSerializer.Serialize(value)).RootElement.Clone();
        static void Set(QuestMeshView view, string property, object value) =>
            typeof(QuestMeshView).GetProperty(property, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic).SetValue(view, value);
    }
}
