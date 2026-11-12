using System;
using System.Linq;
using System.IO;
using System.Xml.Linq;
using System.Reflection;
using System.Threading;
using Kreoda.QuestEditor;
using NUnit.Framework;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Kreoda.QuestRuntime.Tests
{
    public sealed class QuestVoiceTests
    {
        const BindingFlags Private = BindingFlags.Instance | BindingFlags.NonPublic;
        [Test]
        public void ProvisioningAliasRequiresPrivilegedPermissionWhileLauncherRemainsPublic()
        {
            XNamespace android = "http://schemas.android.com/apk/res/android";
            var app = XDocument.Load(Path.Combine(Application.dataPath, "Plugins/Android/AndroidManifest.xml")).Root.Element("application");
            var alias = app.Elements("activity-alias").Single(e => (string)e.Attribute(android + "name") == "com.kreoda.quest.AdbProvisioning");
            Assert.That((string)alias.Attribute(android + "permission"), Is.EqualTo("android.permission.DUMP"));
            Assert.That((string)alias.Attribute(android + "exported"), Is.EqualTo("true"));
            var target = app.Elements("activity").Single(e => (string)e.Attribute(android + "name") == (string)alias.Attribute(android + "targetActivity"));
            Assert.That(target.Attribute(android + "permission"), Is.Null);
            Assert.That(target.NodesAfterSelf().Contains(alias), Is.True);
        }
        [Test]
        public void SavedLegacyCandidateIsNotActivatedAndUntrustedLaunchCannotReplaceIt()
        {
            var root = new GameObject("voice provisioning test");
            try {
                var voice = root.AddComponent<QuestVoice>();
                Assert.That(voice.Configure("http://127.0.0.1:9843", "original-private-token", false), Is.True);
                Assert.That(voice.Configured, Is.False);
                Assert.That(typeof(QuestVoice).GetField("_provider", Private).GetValue(voice), Is.Null);
                Assert.That(typeof(QuestVoice).GetField("_legacyToken", Private).GetValue(voice), Is.EqualTo("original-private-token"));
                var startup = typeof(QuestVoice).GetMethod("ApplyStartupConfiguration", Private);
                Assert.That(startup, Is.Not.Null);
                Assert.That(startup.Invoke(voice, new object[] { "com.unity3d.player.UnityPlayerActivity", "http://127.0.0.1:9999", "replacement-private-token" }), Is.EqualTo(false));
                Assert.That(typeof(QuestVoice).GetField("_client", Private).GetValue(voice), Is.Null);
                Assert.That(typeof(QuestVoice).GetField("_legacyEndpoint", Private).GetValue(voice), Is.EqualTo("http://127.0.0.1:9843"));
                Assert.That(typeof(QuestVoice).GetField("_legacyToken", Private).GetValue(voice), Is.EqualTo("original-private-token"));
            } finally { UnityEngine.Object.DestroyImmediate(root); }
        }

        [Test]
        public void VoiceReadinessRetryBackoffIsBounded()
        {
            var delay = typeof(QuestVoice).GetMethod("ProbeDelaySeconds", BindingFlags.Static | BindingFlags.NonPublic);
            Assert.That(delay, Is.Not.Null);
            Assert.That(new[] { 0, 1, 2, 3, 4, 99 }.Select(value => (int)delay.Invoke(null, new object[] { value })),
                Is.EqualTo(new[] { 1, 2, 5, 10, 10, 10 }));
        }

        [Test]
        public void BeforeSendSourceStampRejectsClientOrGenerationChangeBeforeUpdate()
        {
            var guard = typeof(QuestVoice).GetMethod("SourceStampMatches", BindingFlags.Static | BindingFlags.NonPublic);
            Assert.That(guard, Is.Not.Null);
            var connectionA = new object();var clientA = new object();var clientB = new object();
            var stamp = new object[] { 5L, 5L, connectionA, connectionA, clientA, clientA,
                true, 17L, 17L, true, "session-a", "doc-a", "session-a", "doc-a" };
            var oldActions = 0;
            TestDelegate beforeSend = () =>
            {
                if (!(bool)guard.Invoke(null, stamp)) throw new OperationCanceledException();
                oldActions++;
            };

            stamp[2] = new object();
            Assert.Throws<OperationCanceledException>(beforeSend);
            Assert.That(oldActions, Is.Zero);

            stamp[2] = connectionA;
            stamp[4] = clientB;
            Assert.Throws<OperationCanceledException>(beforeSend);
            Assert.That(oldActions, Is.Zero);

            stamp[4] = clientA;
            stamp[7] = 18L;
            Assert.Throws<OperationCanceledException>(beforeSend);
            Assert.That(oldActions, Is.Zero);
        }

        [Test]
        public void FocusLossCancelsRunAndDestroysOnlyOwnedPlayback()
        {
            var root = new GameObject("voice test");
            try {
                var voice = root.AddComponent<QuestVoice>();voice.Audio = root.AddComponent<AudioSource>();
                var clip = AudioClip.Create("owned", 16, 1, 16000, false);
                typeof(QuestVoice).GetField("_ownedClip", Private).SetValue(voice, clip);voice.Audio.clip = clip;
                var run = new CancellationTokenSource();var token = run.Token;
                typeof(QuestVoice).GetField("_run", Private).SetValue(voice, run);
                typeof(QuestVoice).GetMethod("OnApplicationFocus", Private).Invoke(voice, new object[] { false });
                typeof(QuestVoice).GetMethod("Update", Private).Invoke(voice, null);
                Assert.That(token.IsCancellationRequested, Is.True);
                Assert.That(clip == null, Is.True);Assert.That(voice.Audio.clip, Is.Null);
                Assert.That(voice.Recording, Is.False);Assert.That(voice.Busy, Is.False);
            } finally { UnityEngine.Object.DestroyImmediate(root); }
        }
        [Test]
        public void CompactPalmVoiceControlsDoNotOverlapOtherButtons()
        {
            try {
                QuestBuild.Prepare();var controls = UnityEngine.Object.FindFirstObjectByType<QuestControls>();
                typeof(QuestControls).GetMethod("Start", Private).Invoke(controls, null);
                Physics.SyncTransforms();
                var buttons = controls.GetComponentsInChildren<QuestButton>(true).Where(b => b.transform.parent.parent == controls.transform).ToArray();
                for (var i = 0; i < buttons.Length; i++) for (var j = i + 1; j < buttons.Length; j++) {
                    var a = buttons[i].GetComponent<BoxCollider>().bounds;var b = buttons[j].GetComponent<BoxCollider>().bounds;
                    Assert.That(a.Intersects(b), Is.False, buttons[i].name + " " + a + " overlaps " + buttons[j].name + " " + b);
                }
            } finally { EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single); }
        }
    }
}
