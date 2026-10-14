using System;
using System.Collections;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Reflection;
using System.Text.Json;
using System.Threading;
using Google.FlatBuffers;
using Kreoda.Protocol;
using Kreoda.QuestFoundation;
using Kreoda.Session;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;
using Object = UnityEngine.Object;

namespace Kreoda.QuestRuntime.Tests
{
    public class QuestConnectionTests
    {
        const BindingFlags Private = BindingFlags.Instance | BindingFlags.NonPublic;

        [Test]
        public void DatumObservationsTrackCurrentRevisionRemovalDocumentAndConnectionWithoutMeshes()
        {
            var root = new GameObject("Owned datum connection test");
            var display = new GameObject("Owned datum display root");display.transform.SetParent(root.transform, false);
            var connection = root.AddComponent<QuestConnection>();connection.DisplayRoot = display.transform;
            var run = new CancellationTokenSource();
            try
            {
                var plane = Datum("11111111-1111-4111-8111-111111111111", "DatumPlane", "ok",
                    "\"originMm\":[10,20,30],\"xAxis\":[1,0,0],\"yAxis\":[0,1,0],\"normal\":[0,0,1]");
                var initial = Model("session", "document-a", 4, plane);
                var client = NewClient(initial);
                var scene = (QuestSceneState)typeof(QuestConnection).GetField("_scene", Private).GetValue(connection);
                var generation = scene.BeginConnection();
                typeof(QuestConnection).GetField("_run", Private).SetValue(connection, run);
                typeof(QuestConnection).GetField("_client", Private).SetValue(connection, client);
                typeof(QuestConnection).GetProperty("Connected").SetValue(connection, true);

                Capture(connection, client, run, generation, initial);
                Update(connection);
                var oldView = System.Linq.Enumerable.Single(connection.DatumViews);
                var commands = root.AddComponent<QuestCommands>();commands.Connection = connection;
                commands.SelectDatum(oldView);
                var contextSelection = typeof(QuestCommands).GetMethod("CurrentSelection", Private);
                Assert.That(contextSelection.Invoke(commands, null), Is.True);
                var reconnect = scene.BeginConnection();
                Capture(connection, client, run, reconnect, initial);Update(connection);
                Assert.That(connection.IsCurrentDatum(oldView), Is.True);
                Assert.That(contextSelection.Invoke(commands, null), Is.False, "old command context must not survive a same-revision connection generation");
                generation = reconnect;
                Assert.That(oldView.FeatureId, Is.EqualTo("11111111-1111-4111-8111-111111111111"));
                Assert.That(oldView.Revision, Is.EqualTo(4));
                Assert.That(connection.IsCurrentDatum(oldView), Is.True);
                Assert.That(connection.Views, Is.Empty);
                Assert.That(connection.PendingMeshCount, Is.Zero);

                var stale = Model("session", "document-a", 5, plane);
                var current = Model("session", "document-a", 6,
                    Datum("22222222-2222-4222-8222-222222222222", "DatumPoint", "ok", "\"positionMm\":[100,200,300]"));
                SetModel(client, stale);Capture(connection, client, run, generation, stale);
                SetModel(client, current);Capture(connection, client, run, generation, current);
                Update(connection);
                Assert.That(connection.DatumViews.Count, Is.EqualTo(1));
                Assert.That(System.Linq.Enumerable.Single(connection.DatumViews).FeatureId, Is.EqualTo("22222222-2222-4222-8222-222222222222"));
                Assert.That(connection.IsCurrentDatum(oldView), Is.False);
                Assert.That(connection.Views, Is.Empty);
                Assert.That(connection.PendingMeshCount, Is.Zero);

                var removed = Model("session", "document-a", 7);
                SetModel(client, removed);Capture(connection, client, run, generation, removed);Update(connection);
                Assert.That(connection.DatumViews, Is.Empty);

                var replacement = Model("session", "document-b", 1,
                    Datum("22222222-2222-4222-8222-222222222222", "DatumPoint", "ok", "\"positionMm\":[1,2,3]"));
                SetModel(client, replacement);Capture(connection, client, run, generation, replacement);Update(connection);
                var replacementView = System.Linq.Enumerable.Single(connection.DatumViews);
                Assert.That(connection.IsCurrentDatum(replacementView), Is.True);
                Assert.That(connection.IsCurrentDatum(oldView), Is.False, "document replacement must revoke old view identity");

                var newGeneration = scene.BeginConnection();
                Assert.That(connection.IsCurrentDatum(replacementView), Is.False, "reconnect must await its own accepted observation even at the same revision");
                Capture(connection, client, run, generation, replacement);Update(connection);
                Assert.That(connection.IsCurrentDatum(replacementView), Is.False, "old generation capture cannot restore a target");
                Capture(connection, client, run, newGeneration, replacement);Update(connection);
                Assert.That(connection.IsCurrentDatum(replacementView), Is.True);

                connection.Forget();
                Assert.That(connection.DatumViews.Count, Is.EqualTo(1), "offline guide may stay visible");
                Assert.That(connection.IsCurrentDatum(replacementView), Is.False, "offline guide cannot publish or feed voice");
            }
            finally { run.Dispose();Object.DestroyImmediate(root); }
        }

        static JsonElement Datum(string id, string kind, string status, string geometry)
        {
            using var json = JsonDocument.Parse("{\"featureId\":\"" + id + "\",\"kind\":\"" + kind + "\",\"status\":\"" + status + "\",\"resolved\":{" + geometry + "}}");
            return json.RootElement.Clone();
        }
        static SessionModelState Model(string session, string document, long revision, params JsonElement[] datums) =>
            new SessionModelState(session, document, revision, Array.Empty<JsonElement>(), Array.Empty<JsonElement>(), Array.Empty<JsonElement>()) { Datums = datums };
        static SessionClient NewClient(SessionModelState model)
        {
            var client = (SessionClient)typeof(SessionClient).GetConstructor(Private, null, Type.EmptyTypes, null).Invoke(null);
            SetModel(client, model);return client;
        }
        static void SetModel(SessionClient client, SessionModelState model) =>
            typeof(SessionClient).GetField("_model", Private).SetValue(client, model);
        static void Capture(QuestConnection connection, SessionClient client, CancellationTokenSource run,
            long generation, SessionModelState model) =>
            typeof(QuestConnection).GetMethod("Capture", Private).Invoke(connection, new object[] { run, client, generation, model, null });
        static void Update(QuestConnection connection) => typeof(QuestConnection).GetMethod("Update", Private).Invoke(connection, null);

        [UnityTest]
        public IEnumerator PairAndReconnectUploadAuthenticNativeMeshThroughActualUnityClient() => ExerciseWireClient(false);

        [UnityTest]
        public IEnumerator UsbBootstrapPairsAndReconnectsOverLoopbackWithActualMesh() => ExerciseWireClient(true);

        [UnityTest]
        public IEnumerator DatumWirePublishesNativeIdentityAndUsesPcBoundSketchSupport() => ExerciseWireClient(true, true);

        IEnumerator ExerciseWireClient(bool usbBootstrap, bool datumMode = false)
        {
            var repository = Path.GetFullPath(Path.Combine(Application.dataPath, "../../.."));
            var file = Path.Combine(repository, "packages/protocol/fixtures/native-blind-hole.meshfb");
            var raw = MeshUpdate.GetRootAsMeshUpdate(new ByteBuffer(File.ReadAllBytes(file)));
            var id = Guid.NewGuid().ToString("N");
            var metadata = Path.Combine(Path.GetTempPath(), "kreoda-unity-wire-" + id + ".json");
            var credentials = Path.Combine(Path.GetTempPath(), "kreoda-unity-device-" + id + ".dat");
            File.WriteAllText(metadata, JsonSerializer.Serialize(new { file, nativeId = raw.RequestId,
                featureId = raw.FeatureId, revision = raw.Revision, quality = raw.Lod, datumMode }));
            var start = new ProcessStartInfo("node", "\"" + Path.Combine(Application.dataPath,
                "Kreoda/Tests/Editor/QuestWireFixture.mjs") + "\" \"" + metadata + "\"")
            { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
            using var server = Process.Start(start);
            var root = new GameObject("Owned wire test");
            var display = new GameObject("Owned CAD display");
            QuestCommands datumCommands = null;
            display.transform.SetParent(root.transform);
            try
            {
                var ready = server.StandardOutput.ReadLineAsync();
                var wait = Stopwatch.StartNew();
                while (!ready.IsCompleted && wait.Elapsed.TotalSeconds < 10) yield return null;
                Assert.That(ready.IsCompleted, Is.True, "fixture server did not start");
                using var address = JsonDocument.Parse(ready.Result);
                var port = address.RootElement.GetProperty("port").GetInt32();
                var ip = Dns.GetHostAddresses(Dns.GetHostName()).FirstOrDefault(candidate =>
                    QuestConnectionInput.TryEndpoint("ws://" + candidate + ":" + port, out _));
                Assert.That(ip, Is.Not.Null, "test PC has no assigned private IPv4");
                var connection = root.AddComponent<QuestConnection>();
                connection.DisplayRoot = display.transform;
                typeof(QuestConnection).GetField("_credentialFile", BindingFlags.Instance | BindingFlags.NonPublic)
                    .SetValue(connection, credentials);
                if (usbBootstrap)
                {
                    var bootstrap = typeof(QuestConnection).GetMethod("ApplyStartupConfiguration", BindingFlags.Instance | BindingFlags.NonPublic);
                    Assert.That(bootstrap, Is.Not.Null, "ADB startup provisioning must configure the actual connection without UI input");
                    Assert.That(bootstrap.Invoke(connection, new object[] { "com.unity3d.player.UnityPlayerActivity", "ws://127.0.0.1:" + port + "/", "0123 4567" }), Is.EqualTo(false));
                    Assert.That(connection.Status, Is.EqualTo("Non connesso"));
                    Assert.That(bootstrap.Invoke(connection, new object[] { "com.kreoda.quest.AdbProvisioning", "ws://127.0.0.1:" + port + "/", "0123 4567" }), Is.EqualTo(true));
                }
                else connection.Pair("ws://" + ip + ":" + port, "0123 4567");
                var update = typeof(QuestConnection).GetMethod("Update", BindingFlags.Instance | BindingFlags.NonPublic);
                wait.Restart();
                while (connection.Views.Count == 0 && wait.Elapsed.TotalSeconds < 15)
                { update.Invoke(connection, null); yield return null; }
                Assert.That(connection.Views.Count, Is.EqualTo(1), connection.Status);
                Assert.That(connection.Connected, Is.True);
                Assert.That(File.Exists(credentials), Is.True);
                var view = connection.Views.Single();
                var firstMesh = view.GetComponent<MeshFilter>().sharedMesh;
                Assert.That(firstMesh.triangles.Length / 3, Is.EqualTo(264));
                Assert.That(view.ResolveFace(203).ReferenceAmbiguous, Is.True);
                var editIntents = connection.EditIntentsAsync(view);
                wait.Restart();
                while (!editIntents.IsCompleted && wait.Elapsed.TotalSeconds < 10) yield return null;
                Assert.That(editIntents.IsCompletedSuccessfully, Is.True, "actual adapter manipulator query failed");
                var queried = editIntents.GetAwaiter().GetResult();
                Assert.That(queried.Length, Is.EqualTo(1));Assert.That(queried[0].InitialValues["widthMm"], Is.EqualTo(100));
                Assert.That(queried[0].BodyId, Is.EqualTo(view.BodyId));Assert.That(queried[0].TargetTipId, Is.EqualTo(view.FeatureId));
                if (datumMode)
                {
                    var datum = connection.DatumViews.Single();
                    Assert.That(connection.IsCurrentDatum(datum), Is.True);
                    connection.PublishTarget(datum);
                    var commands = root.AddComponent<QuestCommands>();commands.Connection = connection;
                    datumCommands = commands;
                    typeof(QuestCommands).GetMethod("Start", Private).Invoke(commands, null);
                    commands.SelectDatum(datum);
                    var commandUpdate = typeof(QuestCommands).GetMethod("Update", Private);
                    wait.Restart();
                    while (commands.CommandLabel != "Sketch sul piano" || commands.FieldValue != "{}")
                    {
                        commandUpdate.Invoke(commands, null);
                        Assert.That(wait.Elapsed.TotalSeconds, Is.LessThan(10), commands.Status);
                        yield return null;
                    }
                    commands.Confirm();
                    wait.Restart();
                    while (commands.Busy && wait.Elapsed.TotalSeconds < 10)
                    { commandUpdate.Invoke(commands, null);update.Invoke(connection, null);yield return null; }
                    Assert.That(commands.Busy, Is.False, commands.Status);
                    var auditReply = connection.Client.CallAsync("getCapabilities", new System.Collections.Generic.Dictionary<string, object>());
                    wait.Restart();
                    while (!auditReply.IsCompleted && wait.Elapsed.TotalSeconds < 10) yield return null;
                    Assert.That(auditReply.IsCompletedSuccessfully, Is.True, "fixture audit did not return on the existing transport");
                    var sent = auditReply.GetAwaiter().GetResult().GetProperty("result").GetProperty("fixtureRequests").EnumerateArray().ToArray();
                    var selection = sent.Single(item => item.GetProperty("method").GetString() == "setSelection").GetProperty("params");
                    Assert.That(selection.GetProperty("ids")[0].GetString(), Is.EqualTo(datum.FeatureId));
                    Assert.That(selection.GetProperty("baseRevision").GetInt64(), Is.EqualTo(raw.Revision));
                    Assert.That(selection.GetProperty("documentId").GetString(), Is.EqualTo("fixture-doc"));
                    var command = sent.Single(item => item.GetProperty("method").GetString() == "command").GetProperty("params");
                    Assert.That(command.GetProperty("commandId").GetString(), Is.EqualTo("CreateSketch"));
                    Assert.That(command.GetProperty("parameters").GetProperty("supportRef").GetString(), Is.EqualTo(datum.FeatureId));
                    Assert.That(command.GetProperty("baseRevision").GetInt64(), Is.EqualTo(raw.Revision));
                    Assert.That(sent.Count(item => item.GetProperty("method").GetString() == "requestMeshLOD"), Is.EqualTo(1), "datum actions must not request meshes");
                }
                connection.Reconnect();
                if (datumCommands != null)
                {
                    Assert.That(typeof(QuestCommands).GetMethod("CurrentSelection", Private).Invoke(datumCommands, null), Is.False);
                    datumCommands.Confirm();
                    Assert.That(datumCommands.Busy, Is.False, "retired context cannot start a command while reconnecting");
                }
                wait.Restart();
                while (view.UploadVersion < 2 && wait.Elapsed.TotalSeconds < 15)
                { update.Invoke(connection, null); yield return null; }
                Assert.That(view.UploadVersion, Is.EqualTo(2), connection.Status +
                    (server.HasExited ? " · fixture exit " + server.ExitCode + " · " + server.StandardError.ReadToEnd() : " · fixture alive"));
                Assert.That(connection.Views.Single(), Is.SameAs(view));
                Assert.That(firstMesh == null, Is.True, "reconnect leaked the superseded Unity mesh");
                if (datumCommands != null)
                {
                    var commandUpdate = typeof(QuestCommands).GetMethod("Update", Private);
                    wait.Restart();
                    var values = (System.Collections.Generic.Dictionary<string, object>)typeof(QuestCommands).GetField("_values", Private).GetValue(datumCommands);
                    while (!values.TryGetValue("planeKind", out var rebound) || rebound.ToString() != "XZ")
                    { commandUpdate.Invoke(datumCommands, null);Assert.That(wait.Elapsed.TotalSeconds, Is.LessThan(10), "new connection must reload PC bindings");yield return null; }
                    datumCommands.Confirm();
                    wait.Restart();
                    while (datumCommands.Busy && wait.Elapsed.TotalSeconds < 10)
                    { commandUpdate.Invoke(datumCommands, null);update.Invoke(connection, null);yield return null; }
                    var auditReply = connection.Client.CallAsync("getCapabilities", new System.Collections.Generic.Dictionary<string, object>());
                    wait.Restart();
                    while (!auditReply.IsCompleted && wait.Elapsed.TotalSeconds < 10) yield return null;
                    Assert.That(auditReply.IsCompletedSuccessfully, Is.True);
                    var sent = auditReply.GetAwaiter().GetResult().GetProperty("result").GetProperty("fixtureRequests").EnumerateArray().ToArray();
                    var second = sent.Where(item => item.GetProperty("connection").GetInt32() == 2).ToArray();
                    Assert.That(System.Array.FindIndex(second, item => item.GetProperty("method").GetString() == "listCommands"),
                        Is.LessThan(System.Array.FindIndex(second, item => item.GetProperty("method").GetString() == "command")));
                    var command = second.Single(item => item.GetProperty("method").GetString() == "command");
                    Assert.That(command.GetProperty("params").GetProperty("parameters").GetProperty("planeKind").GetString(), Is.EqualTo("XZ"));
                }
                connection.Forget();
                Assert.That(File.Exists(credentials), Is.False);
                Assert.That(connection.Connected, Is.False);
                Assert.That(connection.Views.Single(), Is.SameAs(view), "offline display must retain geometry");
            }
            finally
            {
                Object.DestroyImmediate(root);
                if (!server.HasExited) server.Kill();
                server.WaitForExit(5000);
                if (File.Exists(metadata)) File.Delete(metadata);
                if (File.Exists(credentials)) File.Delete(credentials);
            }
        }
    }
}
