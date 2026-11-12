using System.Collections.Generic;
using System.Reflection;
using System.Text.Json;
using System.Threading;
using Kreoda.QuestFoundation;
using Kreoda.Session;
using Kreoda.Session.Generated;
using NUnit.Framework;
using UnityEngine;

namespace Kreoda.QuestRuntime.Tests
{
    public class QuestCommandsTests
    {
        const BindingFlags Private = BindingFlags.Instance | BindingFlags.NonPublic;
        [Test]
        public void NumericSchemaFieldsRejectNonFiniteValuesAndCannotRetargetBoundSelection()
        {
            var owned = new GameObject("Owned context form test");
            try
            {
                var commands = owned.AddComponent<QuestCommands>();
                using var schema = JsonDocument.Parse("{\"properties\":{\"radiusMm\":{\"type\":\"number\"},\"targetId\":{\"type\":\"string\"}}}");
                typeof(QuestCommands).GetField("_schema", Private).SetValue(commands, schema.RootElement.Clone());
                ((List<string>)typeof(QuestCommands).GetField("_fields", Private).GetValue(commands)).Add("radiusMm");
                Assert.That(commands.SetField("radiusMm", "1,25"), Is.True);
                Assert.That(commands.SetField("radiusMm", "Infinity"), Is.False);
                Assert.That(commands.SetField("targetId", "different-owner"), Is.False);
            }
            finally { Object.DestroyImmediate(owned); }
        }
        [Test]
        public void CompletedCommandTokenCannotCrashFocusLossCleanup()
        {
            var owned = new GameObject("Owned command cleanup test");
            var commands = owned.AddComponent<QuestCommands>();
            var field = typeof(QuestCommands).GetField("_commandRun", Private);
            try
            {
                var completed = new CancellationTokenSource();completed.Dispose();field.SetValue(commands, completed);
                Assert.DoesNotThrow(() => typeof(QuestCommands).GetMethod("OnApplicationPause", Private).Invoke(commands, new object[] { true }));
            }
            finally { field.SetValue(commands, null);Object.DestroyImmediate(owned); }
        }

        [Test]
        public void PendingDirectFaceCaptureBlocksConfirmAndHistoryBeforeStartingCommands()
        {
            var owned = new GameObject("Owned direct-face command interlock test");
            var meshes = new List<Mesh>();
            try
            {
                var connection = owned.AddComponent<QuestConnection>();
                var model = new SessionModelState("550e8400-e29b-41d4-a716-446655440000", "doc-command", 4,
                    System.Array.Empty<JsonElement>(), System.Array.Empty<JsonElement>(), System.Array.Empty<JsonElement>());
                var client = (SessionClient)typeof(SessionClient).GetConstructor(Private, null, System.Type.EmptyTypes, null).Invoke(null);
                typeof(SessionClient).GetField("_model", Private).SetValue(client, model);
                typeof(QuestConnection).GetField("_client", Private).SetValue(connection, client);
                typeof(QuestConnection).GetProperty("Connected", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic)
                    .SetValue(connection, true);
                var scene = (QuestSceneState)typeof(QuestConnection).GetField("_scene", Private).GetValue(connection);
                var generation = scene.BeginConnection();
                var viewObject = new GameObject("command selection");viewObject.transform.SetParent(owned.transform, false);
                var mesh = new Mesh { vertices = new[] { Vector3.zero, Vector3.right, Vector3.up }, triangles = new[] { 0, 1, 2 } };
                meshes.Add(mesh);viewObject.AddComponent<MeshFilter>().sharedMesh = mesh;viewObject.AddComponent<MeshRenderer>();
                var view = viewObject.AddComponent<QuestMeshView>();
                Set(view, "BodyId", "body-a");Set(view, "InstanceId", null);Set(view, "FeatureId", "box-a");Set(view, "UploadVersion", 1);
                var views = (Dictionary<SceneObjectKey, QuestMeshView>)typeof(QuestConnection).GetField("_views", Private).GetValue(connection);
                views.Add(new SceneObjectKey(view.BodyId, view.InstanceId), view);
                var stamp = scene.CaptureObservation(generation, model.SessionId, model.DocumentId, model.Revision);
                var plan = scene.Reconcile(stamp, new[] { new SceneMeshTarget(view.BodyId, view.InstanceId,
                    view.FeatureId, model.SessionId, model.DocumentId, model.Revision) }, snapshot: true);
                foreach (var ticket in plan.Requests) scene.Complete(ticket);

                var direct = owned.AddComponent<QuestDirectFaceHistory>();
                var commands = owned.AddComponent<QuestCommands>();commands.Connection = connection;
                commands.DirectFaceHistory = direct;
                var info = new ContextCommandInfo { Id = "DeleteFeature", Label = "Delete", Available = true,
                    BoundParameters = new Dictionary<string, object>() };
                var context = new ContextCommandsPayload { SessionId = model.SessionId, DocumentId = model.DocumentId,
                    Revision = model.Revision, ContextValid = true, Commands = new[] { info } };
                typeof(QuestCommands).GetField("_context", Private).SetValue(commands, context);
                typeof(QuestCommands).GetField("_command", Private).SetValue(commands, info);
                using var schema = JsonDocument.Parse("{}");
                typeof(QuestCommands).GetField("_schema", Private).SetValue(commands, schema.RootElement.Clone());
                typeof(QuestCommands).GetField("_view", Private).SetValue(commands, view);
                typeof(QuestCommands).GetField("_selectionClient", Private).SetValue(commands, client);
                typeof(QuestCommands).GetField("_selectionModel", Private).SetValue(commands, model);
                typeof(QuestCommands).GetField("_selectionGeneration", Private).SetValue(commands, generation);
                Assert.That(connection.IsCurrentView(view), Is.True);
                Assert.That(commands.CanConfirm, Is.True, "fixture must be able to confirm before direct-face work starts");

                typeof(QuestDirectFaceHistory).GetField("_pending", Private).SetValue(direct, 1);
                Assert.That(commands.CanConfirm, Is.False);
                commands.Confirm();commands.Confirm();
                commands.History(false);commands.History(true);

                Assert.That(commands.Busy, Is.False);
                Assert.That(typeof(QuestCommands).GetField("_commandRun", Private).GetValue(commands), Is.Null);
            }
            finally
            {
                Object.DestroyImmediate(owned);
                foreach (var mesh in meshes) Object.DestroyImmediate(mesh);
            }
        }

        static void Set(QuestMeshView view, string property, object value) =>
            typeof(QuestMeshView).GetProperty(property, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic).SetValue(view, value);
    }
}
