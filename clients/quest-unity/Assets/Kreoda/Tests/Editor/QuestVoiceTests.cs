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
        public void PublicLaunchCannotReplaceSavedVoiceConfiguration()
        {
            var root = new GameObject("voice provisioning test");
            try {
                var voice = root.AddComponent<QuestVoice>();
                Assert.That(voice.Configure("http://127.0.0.1:9843", "original-private-token", false), Is.True);
                var original = typeof(QuestVoice).GetField("_client", Private).GetValue(voice);
                var startup = typeof(QuestVoice).GetMethod("ApplyStartupConfiguration", Private);
                Assert.That(startup, Is.Not.Null);
                Assert.That(startup.Invoke(voice, new object[] { "com.unity3d.player.UnityPlayerActivity", "http://127.0.0.1:9999", "replacement-private-token" }), Is.EqualTo(false));
                Assert.That(typeof(QuestVoice).GetField("_client", Private).GetValue(voice), Is.SameAs(original));
            } finally { UnityEngine.Object.DestroyImmediate(root); }
        }
        [Test]
        public void FocusLossDiscardsQueuedReplyAndDestroysOnlyOwnedPlayback()
        {
            var root = new GameObject("voice test");
            try {
                var voice = root.AddComponent<QuestVoice>();voice.Audio = root.AddComponent<AudioSource>();
                var clip = AudioClip.Create("owned", 16, 1, 16000, false);
                typeof(QuestVoice).GetField("_ownedClip", Private).SetValue(voice, clip);voice.Audio.clip = clip;
                var run = new CancellationTokenSource();var token = run.Token;
                typeof(QuestVoice).GetField("_run", Private).SetValue(voice, run);
                var ticket = (long)typeof(QuestVoice).GetField("_ticket", Private).GetValue(voice);var callbacks = 0;
                typeof(QuestVoice).GetMethod("Post", Private).Invoke(voice, new object[] { ticket, (Action)(() => callbacks++) });
                typeof(QuestVoice).GetMethod("OnApplicationFocus", Private).Invoke(voice, new object[] { false });
                typeof(QuestVoice).GetMethod("Update", Private).Invoke(voice, null);
                Assert.That(token.IsCancellationRequested, Is.True);Assert.That(callbacks, Is.Zero);
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
