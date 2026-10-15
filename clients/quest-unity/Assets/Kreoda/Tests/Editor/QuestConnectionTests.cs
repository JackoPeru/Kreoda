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

        [TestCase("INVALID_JSON")]
        [TestCase("UNKNOWN_NATIVE_CODE")]
        [TestCase("CANCELLED")]
        public void UnconfirmedReferenceErrorsRemainUncertain(string code)
        {
            var failure = typeof(QuestCommands).GetMethod("ReferenceFailure", BindingFlags.Static | BindingFlags.NonPublic);
            var result = (string)failure.Invoke(null, new object[] { true, false, new SessionException(code, "wire detail") });
            Assert.That(result, Does.Contain("Esito incerto").And.Contain(code));
            Assert.That(result, Does.Not.Contain("PC ha rifiutato"));
        }

        [Test]
        public void ReferenceFailureDistinguishesNativeRejectionFromAcceptedCommandRefreshFailure()
        {
            var failure = typeof(QuestCommands).GetMethod("ReferenceFailure", BindingFlags.Static | BindingFlags.NonPublic);
            var rejected = (string)failure.Invoke(null, new object[] { true, false, new SessionException("DATUM_FAILED", "bad frame") });
            var refresh = (string)failure.Invoke(null, new object[] { true, true, new SessionException("INVALID_JSON", "snapshot reply") });
            Assert.That(rejected, Does.Contain("PC ha rifiutato").And.Contain("DATUM_FAILED").And.Contain("bad frame"));
            Assert.That(refresh, Does.Contain("PC ha accettato").And.Contain("vista non aggiornata"));
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
        static IEnumerator WaitFor(Func<bool> condition, Action pump, Stopwatch wait, string failure)
        {
            wait.Restart();
            while (!condition() && wait.Elapsed.TotalSeconds < 10) { pump();yield return null; }
            Assert.That(condition(), Is.True, failure);
        }

        [UnityTest]
        public IEnumerator PairAndReconnectUploadAuthenticNativeMeshThroughActualUnityClient() => ExerciseWireClient(false);

        [UnityTest]
        public IEnumerator UsbBootstrapPairsAndReconnectsOverLoopbackWithActualMesh() => ExerciseWireClient(true);

        [UnityTest]
        public IEnumerator DatumWirePublishesNativeIdentityAndUsesPcBoundSketchSupport() => ExerciseWireClient(true, true);

        [UnityTest]
        public IEnumerator LateReferenceReplyCannotRetargetSameUuidAfterDocumentReconnect() => ExerciseWireClient(false, true, true);

        IEnumerator ExerciseWireClient(bool usbBootstrap, bool datumMode = false, bool lateLineageMode = false)
        {
            var repository = Path.GetFullPath(Path.Combine(Application.dataPath, "../../.."));
            var file = Path.Combine(repository, "packages/protocol/fixtures/native-blind-hole.meshfb");
            var raw = MeshUpdate.GetRootAsMeshUpdate(new ByteBuffer(File.ReadAllBytes(file)));
            var id = Guid.NewGuid().ToString("N");
            var metadata = Path.Combine(Path.GetTempPath(), "kreoda-unity-wire-" + id + ".json");
            var credentials = Path.Combine(Path.GetTempPath(), "kreoda-unity-device-" + id + ".dat");
            File.WriteAllText(metadata, JsonSerializer.Serialize(new { file, nativeId = raw.RequestId,
                featureId = raw.FeatureId, revision = raw.Revision, quality = raw.Lod, datumMode,
                rejectCommandId = datumMode && !lateLineageMode ? "CreateDatumPoint" : null,
                delayCommandId = lateLineageMode ? "CreateDatumPlane" : null,
                delayCommandMs = lateLineageMode ? 2500 : 0 }));
            var start = new ProcessStartInfo("node", "\"" + Path.Combine(Application.dataPath,
                "Kreoda/Tests/Editor/QuestWireFixture.mjs") + "\" \"" + metadata + "\"")
            { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
            using var server = Process.Start(start);
            var root = new GameObject("Owned wire test");
            var display = new GameObject("Owned CAD display");
            QuestCommands datumCommands = null;
            QuestReferences referenceForm = null;
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
                if (lateLineageMode)
                {
                    var clientA = connection.Client;var modelA = clientA.Model;var datumA = connection.DatumViews.Single();
                    var commands = root.AddComponent<QuestCommands>();commands.Connection = connection;datumCommands = commands;
                    typeof(QuestCommands).GetMethod("Start", Private).Invoke(commands, null);
                    var commandUpdate = typeof(QuestCommands).GetMethod("Update", Private);
                    typeof(QuestCommands).GetField("_datum", Private).SetValue(commands, datumA);
                    typeof(QuestCommands).GetField("_datumRevision", Private).SetValue(commands, modelA.Revision);
                    var references = root.AddComponent<QuestReferences>();references.Connection = connection;references.Commands = commands;referenceForm = references;
                    Assert.That(references.BeginCreate(QuestReferenceKind.Plane), Is.True, references.Status);
                    yield return WaitFor(() => references.SchemaReady, () => { commandUpdate.Invoke(commands, null);update.Invoke(connection, null); }, wait,
                        "PC reference schema did not load for late-reply coverage");
                    Assert.That(commands.SubmitReference(references), Is.True, references.Status);

                    JsonElement audit = default;
                    var requestCaptured = false;wait.Restart();
                    while (!requestCaptured && wait.Elapsed.TotalSeconds < 10)
                    {
                        var pendingAudit = clientA.CallAsync("getCapabilities", new System.Collections.Generic.Dictionary<string, object>());
                        while (!pendingAudit.IsCompleted && wait.Elapsed.TotalSeconds < 10) yield return null;
                        Assert.That(pendingAudit.IsCompletedSuccessfully, Is.True, "fixture did not expose the in-flight command");
                        audit = pendingAudit.GetAwaiter().GetResult().GetProperty("result").GetProperty("fixtureRequests").Clone();
                        requestCaptured = audit.EnumerateArray().Any(item => item.GetProperty("method").GetString() == "command" &&
                            item.GetProperty("params").GetProperty("commandId").GetString() == "CreateDatumPlane");
                        if (!requestCaptured) yield return null;
                    }
                    Assert.That(requestCaptured, Is.True, "reference command must reach the PC before lineage changes");

                    var datumRecord = Datum(datumA.FeatureId, "DatumPlane", "ok",
                        "\"originMm\":[0,0,24],\"xAxis\":[1,0,0],\"yAxis\":[0,1,0],\"normal\":[0,0,1]");
                    var modelB = Model(modelA.SessionId, "replacement-document", 1, datumRecord);var clientB = NewClient(modelB);
                    var scene = (QuestSceneState)typeof(QuestConnection).GetField("_scene", Private).GetValue(connection);
                    var generationB = scene.BeginConnection();
                    typeof(QuestConnection).GetField("_client", Private).SetValue(connection, clientB);
                    typeof(QuestConnection).GetProperty("Connected").SetValue(connection, true);
                    var datumObject = new GameObject("Replacement document datum " + datumA.FeatureId);datumObject.transform.SetParent(display.transform, false);
                    var datumB = datumObject.AddComponent<QuestDatumView>();
                    Assert.That(datumB.Apply(datumRecord, modelB.SessionId, modelB.DocumentId, modelB.Revision), Is.True);
                    ((System.Collections.Generic.Dictionary<string, QuestDatumView>)typeof(QuestConnection).GetField("_datumViews", Private)
                        .GetValue(connection))[datumB.FeatureId] = datumB;
                    typeof(QuestConnection).GetField("_datumGeneration", Private).SetValue(connection, generationB);
                    typeof(QuestConnection).GetField("_datumModel", Private).SetValue(connection, modelB);
                    typeof(QuestConnection).GetField("_datumSessionId", Private).SetValue(connection, modelB.SessionId);
                    typeof(QuestConnection).GetField("_datumDocumentId", Private).SetValue(connection, modelB.DocumentId);
                    Assert.That(connection.IsCurrentDatum(datumB), Is.True);
                    Assert.That(datumB.FeatureId, Is.EqualTo(datumA.FeatureId));Assert.That(datumB, Is.Not.SameAs(datumA));

                    yield return WaitFor(() => !commands.Busy, () => commandUpdate.Invoke(commands, null), wait,
                        "in-flight reference command did not finish after document replacement");
                    Assert.That(references.Status, Does.Contain("Esito incerto"), "old-document reply must not claim success on the replacement document");
                    Assert.That(typeof(QuestCommands).GetField("_datum", Private).GetValue(commands), Is.SameAs(datumA),
                        "late completion must not retarget the same UUID into a replacement document");
                    Assert.That(typeof(QuestCommands).GetField("_context", Private).GetValue(commands), Is.Null,
                        "late completion must not load actions for the replacement document");
                    Assert.That(audit.EnumerateArray().Count(item => item.GetProperty("method").GetString() == "command" &&
                        item.GetProperty("params").GetProperty("commandId").GetString() == "CreateDatumPlane"), Is.EqualTo(1),
                        "lineage change must not retry the in-flight native command");
                    yield break;
                }
                if (datumMode)
                {
                    var datum = connection.DatumViews.Single();
                    Assert.That(connection.IsCurrentDatum(datum), Is.True);
                    var commands = root.AddComponent<QuestCommands>();commands.Connection = connection;
                    datumCommands = commands;
                    typeof(QuestCommands).GetMethod("Start", Private).Invoke(commands, null);
                    var commandUpdate = typeof(QuestCommands).GetMethod("Update", Private);

                    var references = root.AddComponent<QuestReferences>();references.Connection = connection;references.Commands = commands;
                    referenceForm = references;
                    Assert.That(references.BeginCreate(QuestReferenceKind.Plane), Is.True, references.Status);
                    yield return WaitFor(() => references.SchemaReady, () => { commandUpdate.Invoke(commands, null);update.Invoke(connection, null); }, wait,
                        "PC reference schema did not load for plane creation");
                    Assert.That(references.Operation, Is.EqualTo("principal"));
                    references.CycleOperation();
                    Assert.That(references.Operation, Is.EqualTo("offset"));
                    Assert.That(references.ChooseSource(0), Is.True, "offset plane must bind the canonical principal XY source");
                    var keyboardForm = references.FormTicket;var staleKeyboard = references.InputTicket;
                    references.NextField();
                    Assert.That(references.SetNumericInput("99", keyboardForm, staleKeyboard), Is.False,
                        "field traversal must invalidate a keyboard opened for the previous field");
                    Assert.That(references.SetNumericInput("24", references.FormTicket, references.InputTicket), Is.True,
                        "comma and period decimal parsing must accept the offset field value");
                    Assert.That(commands.SubmitReference(references), Is.True, references.Status);
                    yield return WaitFor(() => !commands.Busy, () => { commandUpdate.Invoke(commands, null);update.Invoke(connection, null); }, wait,
                        "CreateDatumPlane did not finish through the canonical command path");
                    Assert.That(references.Status, Does.Contain("Riferimento creato sul PC"), "accepted command must reach the reference page");

                    connection.PublishTarget(datum);
                    commands.SelectDatum(datum);
                    wait.Restart();
                    while (commands.CommandLabel != "Sketch sul piano" || commands.FieldValue != "{}")
                    {
                        commandUpdate.Invoke(commands, null);
                        Assert.That(wait.Elapsed.TotalSeconds, Is.LessThan(10), commands.Status);
                        yield return null;
                    }
                    commands.Confirm();
                    yield return WaitFor(() => !commands.Busy, () => { commandUpdate.Invoke(commands, null);update.Invoke(connection, null); }, wait,
                        "CreateSketch did not finish through the PC-bound support path");

                    references.SelectCurrentDatum(datum.FeatureId);
                    Assert.That(references.BeginEditSelected(), Is.True, references.Status);
                    yield return WaitFor(() => references.SchemaReady, () => { commandUpdate.Invoke(commands, null);update.Invoke(connection, null); }, wait,
                        "UpdateDatum schema did not load for editing");
                    Assert.That(references.IsEditing, Is.True);
                    Assert.That(references.Operation, Is.EqualTo("offset"), "edit must start from the native definition");
                    references.NextField();
                    Assert.That(references.SetNumericInput("30", references.FormTicket, references.InputTicket), Is.True);
                    Assert.That(commands.SubmitReference(references), Is.True, references.Status);
                    yield return WaitFor(() => !commands.Busy, () => { commandUpdate.Invoke(commands, null);update.Invoke(connection, null); }, wait,
                        "UpdateDatum did not finish through the canonical command path");
                    Assert.That(references.Status, Does.Contain("Riferimento modificato sul PC"), "accepted update must reach the reference page");
                    commands.History(false);
                    yield return WaitFor(() => !commands.Busy, () => { commandUpdate.Invoke(commands, null);update.Invoke(connection, null); }, wait,
                        "ordinary Undo did not finish after editing the datum");

                    var modelField = typeof(SessionClient).GetField("_model", Private);
                    var client = connection.Client;var currentModel = client.Model;
                    Assert.That(references.BeginCreate(QuestReferenceKind.Point), Is.True, references.Status);
                    yield return WaitFor(() => references.SchemaReady, () => { commandUpdate.Invoke(commands, null);update.Invoke(connection, null); }, wait,
                        "PC reference schema did not reload for stale-revision coverage");
                    modelField.SetValue(client, currentModel with { Revision = currentModel.Revision + 1 });
                    Assert.That(commands.SubmitReference(references), Is.False, "stale revision must not submit a reference command");
                    modelField.SetValue(client, currentModel);
                    references.Cancel();

                    Assert.That(references.BeginCreate(QuestReferenceKind.Point), Is.True, references.Status);
                    yield return WaitFor(() => references.SchemaReady, () => { commandUpdate.Invoke(commands, null);update.Invoke(connection, null); }, wait,
                        "PC reference schema did not reload for stale-document coverage");
                    modelField.SetValue(client, currentModel with { DocumentId = "stale-document" });
                    Assert.That(commands.SubmitReference(references), Is.False, "stale document must not submit a reference command");
                    modelField.SetValue(client, currentModel);
                    references.Cancel();

                    Assert.That(references.BeginCreate(QuestReferenceKind.Point), Is.True, references.Status);
                    yield return WaitFor(() => references.SchemaReady, () => { commandUpdate.Invoke(commands, null);update.Invoke(connection, null); }, wait,
                        "PC reference schema did not reload for stale-client coverage");
                    typeof(QuestConnection).GetField("_client", Private).SetValue(connection, NewClient(currentModel));
                    Assert.That(commands.SubmitReference(references), Is.False, "replaced client must not submit a reference command");
                    typeof(QuestConnection).GetField("_client", Private).SetValue(connection, client);
                    references.Cancel();

                    Assert.That(references.BeginCreate(QuestReferenceKind.Plane), Is.True, references.Status);
                    yield return WaitFor(() => references.SchemaReady, () => { commandUpdate.Invoke(commands, null);update.Invoke(connection, null); }, wait,
                        "PC reference schema did not reload for broken-source coverage");
                    references.CycleOperation();
                    references.NextSourcePage(1);
                    Assert.That(references.ChooseSource(1), Is.True, "a current healthy datum plane should be available as a source");
                    references.NextField();
                    Assert.That(references.SetNumericInput("1", references.FormTicket, references.InputTicket), Is.True);
                    using (var brokenRecord = JsonDocument.Parse("{\"featureId\":\"datum-plane-wire\",\"kind\":\"DatumPlane\",\"status\":\"broken\",\"dependsOn\":[],\"definition\":{\"type\":\"offset\",\"base\":{\"type\":\"principal\",\"planeKind\":\"XY\"},\"offsetMm\":24},\"resolved\":{\"originMm\":[0,0,24],\"xAxis\":[1,0,0],\"yAxis\":[0,1,0],\"normal\":[0,0,1]}}"))
                    {
                        var brokenModel = currentModel with { Datums = new[] { brokenRecord.RootElement.Clone() } };
                        modelField.SetValue(client, brokenModel);
                        typeof(QuestConnection).GetMethod("Capture", Private).Invoke(connection,
                            new object[] { typeof(QuestConnection).GetField("_run", Private).GetValue(connection), client, connection.ConnectionGeneration, brokenModel, null });
                        update.Invoke(connection, null);
                        Assert.That(connection.DatumViews.Single().NativeStatus, Is.EqualTo("broken"));
                        Assert.That(commands.SubmitReference(references), Is.False, "a datum that became broken cannot remain a valid source");
                        modelField.SetValue(client, currentModel);
                        typeof(QuestConnection).GetMethod("Capture", Private).Invoke(connection,
                            new object[] { typeof(QuestConnection).GetField("_run", Private).GetValue(connection), client, connection.ConnectionGeneration, currentModel, null });
                        update.Invoke(connection, null);
                    }
                    commands.SelectDatum(connection.DatumViews.Single());
                    references.Cancel();

                    Assert.That(references.BeginCreate(QuestReferenceKind.Point), Is.True, references.Status);
                    yield return WaitFor(() => references.SchemaReady, () => { commandUpdate.Invoke(commands, null);update.Invoke(connection, null); }, wait,
                        "PC reference schema did not reload for stale-generation coverage");
                    Assert.That(commands.SubmitReference(references), Is.True, references.Status);
                    yield return WaitFor(() => !commands.Busy, () => { commandUpdate.Invoke(commands, null);update.Invoke(connection, null); }, wait,
                        "fixture rejection did not complete through the canonical command path");
                    Assert.That(references.Status, Does.Contain("PC ha rifiutato").And.Contain("DATUM_FAILED").And.Contain("Fixture rejected datum"),
                        "native rejection must reach the reference page with a readable reason");

                    var auditReply = connection.Client.CallAsync("getCapabilities", new System.Collections.Generic.Dictionary<string, object>());
                    wait.Restart();
                    while (!auditReply.IsCompleted && wait.Elapsed.TotalSeconds < 10) yield return null;
                    Assert.That(auditReply.IsCompletedSuccessfully, Is.True, "fixture audit did not return on the existing transport");
                    var sent = auditReply.GetAwaiter().GetResult().GetProperty("result").GetProperty("fixtureRequests").EnumerateArray().ToArray();
                    var selection = sent.Single(item => item.GetProperty("method").GetString() == "setSelection").GetProperty("params");
                    Assert.That(selection.GetProperty("ids")[0].GetString(), Is.EqualTo(datum.FeatureId));
                    Assert.That(selection.GetProperty("baseRevision").GetInt64(), Is.EqualTo(raw.Revision));
                    Assert.That(selection.GetProperty("documentId").GetString(), Is.EqualTo("fixture-doc"));
                    var commandsSent = sent.Where(item => item.GetProperty("method").GetString() == "command").Select(item => item.GetProperty("params")).ToArray();
                    var created = commandsSent.Single(item => item.GetProperty("commandId").GetString() == "CreateDatumPlane");
                    Assert.That(created.GetProperty("parameters").GetProperty("definition").GetProperty("offsetMm").GetDouble(), Is.EqualTo(24));
                    Assert.That(created.GetProperty("parameters").GetProperty("definition").GetProperty("base").GetProperty("type").GetString(), Is.EqualTo("principal"));
                    var updated = commandsSent.Single(item => item.GetProperty("commandId").GetString() == "UpdateDatum");
                    Assert.That(updated.GetProperty("parameters").GetProperty("featureId").GetString(), Is.EqualTo(datum.FeatureId), "edit must preserve the original feature UUID");
                    Assert.That(updated.GetProperty("parameters").GetProperty("definition").GetProperty("offsetMm").GetDouble(), Is.EqualTo(30));
                    Assert.That(commandsSent.Count(item => item.GetProperty("commandId").GetString() == "Undo"), Is.EqualTo(1));
                    var sketch = commandsSent.Single(item => item.GetProperty("commandId").GetString() == "CreateSketch");
                    Assert.That(sketch.GetProperty("parameters").GetProperty("supportRef").GetString(), Is.EqualTo(datum.FeatureId));
                    Assert.That(sketch.GetProperty("baseRevision").GetInt64(), Is.EqualTo(raw.Revision));
                    Assert.That(sent.Count(item => item.GetProperty("method").GetString() == "command"), Is.EqualTo(5),
                        "stale client, document, revision, keyboard, and broken-source attempts emit none; rejection sends once");
                    Assert.That(commandsSent.Count(item => item.GetProperty("commandId").GetString() == "CreateDatumPoint"), Is.EqualTo(1),
                        "a rejected reference command must not be retried");
                    Assert.That(commandsSent.Length, Is.EqualTo(5), "one rejection follows the four successful commands");
                    var meshRequests = sent.Where(item => item.GetProperty("method").GetString() == "requestMeshLOD").ToArray();
                    Assert.That(meshRequests.All(item =>
                    {
                        var parameters = item.GetProperty("params");
                        return parameters.GetProperty("bodyId").GetString() == view.BodyId &&
                            (!parameters.TryGetProperty("instanceId", out var instanceId) || instanceId.ValueKind == JsonValueKind.Null);
                    }), Is.True,
                        "datum controls must never request datum geometry as a mesh");
                }
                connection.Reconnect();
                var uploadVersionBeforeReconnect = view.UploadVersion;
                if (referenceForm != null)
                {
                    Assert.That(datumCommands.SubmitReference(referenceForm), Is.False, "connection-generation change must reject an open reference form");
                    typeof(QuestReferences).GetMethod("Update", Private).Invoke(referenceForm, null);
                }
                if (referenceForm != null)
                    Assert.That(referenceForm.IsFormOpen, Is.False, "connection generation change must abandon an open reference form");
                if (datumCommands != null)
                {
                    Assert.That(typeof(QuestCommands).GetMethod("CurrentSelection", Private).Invoke(datumCommands, null), Is.False);
                    datumCommands.Confirm();
                    Assert.That(datumCommands.Busy, Is.False, "retired context cannot start a command while reconnecting");
                }
                wait.Restart();
                while (view.UploadVersion < uploadVersionBeforeReconnect + 1 && wait.Elapsed.TotalSeconds < 15)
                { update.Invoke(connection, null); yield return null; }
                Assert.That(view.UploadVersion, Is.EqualTo(uploadVersionBeforeReconnect + 1), connection.Status +
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
