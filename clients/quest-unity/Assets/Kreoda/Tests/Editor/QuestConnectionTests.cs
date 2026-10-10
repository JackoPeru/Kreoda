using System;
using System.Collections;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Reflection;
using System.Text.Json;
using Google.FlatBuffers;
using Kreoda.Protocol;
using Kreoda.QuestFoundation;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;
using Object = UnityEngine.Object;

namespace Kreoda.QuestRuntime.Tests
{
    public class QuestConnectionTests
    {
        [UnityTest]
        public IEnumerator PairAndReconnectUploadAuthenticNativeMeshThroughActualUnityClient() => ExerciseWireClient(false);

        [UnityTest]
        public IEnumerator UsbBootstrapPairsAndReconnectsOverLoopbackWithActualMesh() => ExerciseWireClient(true);

        IEnumerator ExerciseWireClient(bool usbBootstrap)
        {
            var repository = Path.GetFullPath(Path.Combine(Application.dataPath, "../../.."));
            var file = Path.Combine(repository, "packages/protocol/fixtures/native-blind-hole.meshfb");
            var raw = MeshUpdate.GetRootAsMeshUpdate(new ByteBuffer(File.ReadAllBytes(file)));
            var id = Guid.NewGuid().ToString("N");
            var metadata = Path.Combine(Path.GetTempPath(), "kreoda-unity-wire-" + id + ".json");
            var credentials = Path.Combine(Path.GetTempPath(), "kreoda-unity-device-" + id + ".dat");
            File.WriteAllText(metadata, JsonSerializer.Serialize(new { file, nativeId = raw.RequestId,
                featureId = raw.FeatureId, revision = raw.Revision, quality = raw.Lod }));
            var start = new ProcessStartInfo("node", "\"" + Path.Combine(Application.dataPath,
                "Kreoda/Tests/Editor/QuestWireFixture.mjs") + "\" \"" + metadata + "\"")
            { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
            using var server = Process.Start(start);
            var root = new GameObject("Owned wire test");
            var display = new GameObject("Owned CAD display");
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
                    Assert.That(bootstrap.Invoke(connection, new object[] { "ws://127.0.0.1:" + port + "/", "0123 4567" }), Is.EqualTo(true));
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
                connection.Reconnect();
                wait.Restart();
                while (view.UploadVersion < 2 && wait.Elapsed.TotalSeconds < 15)
                { update.Invoke(connection, null); yield return null; }
                Assert.That(view.UploadVersion, Is.EqualTo(2), connection.Status);
                Assert.That(connection.Views.Single(), Is.SameAs(view));
                Assert.That(firstMesh == null, Is.True, "reconnect leaked the superseded Unity mesh");
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
