using Kreoda.QuestEditor;
using NUnit.Framework;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Kreoda.QuestRuntime.Tests
{
    public class QuestSceneTests
    {
        [Test]
        public void ProductVoiceIsWiredAndStartsQuietWithoutRecording()
        {
            try {
                QuestBuild.Prepare();
                var controls = Object.FindFirstObjectByType<QuestControls>();
                var field = typeof(QuestControls).GetField("Voice");
                Assert.That(field, Is.Not.Null, "voice control must be part of the product scene");
                var voice = field.GetValue(controls) as MonoBehaviour;
                Assert.That(voice, Is.Not.Null);
                Assert.That(voice.GetType().GetField("Connection").GetValue(voice), Is.SameAs(controls.Connection));
                var audio = voice.GetType().GetField("Audio").GetValue(voice) as AudioSource;
                Assert.That(audio, Is.Not.Null);Assert.That(audio.playOnAwake, Is.False);
                Assert.That((bool)voice.GetType().GetProperty("Recording").GetValue(voice), Is.False);
            } finally { EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single); }
        }

        [Test]
        public void ProductSceneHasConnectedCadControlsAndCompactReachableMenu()
        {
            try
            {
                QuestBuild.Prepare();
                var connection = Object.FindFirstObjectByType<QuestConnection>();
                var controls = Object.FindFirstObjectByType<QuestControls>();
                Assert.That(connection, Is.Not.Null, "product scene has no actual CAD connection");
                Assert.That(controls, Is.Not.Null, "product scene has no Quest input/UI");
                Assert.That(controls.Connection, Is.SameAs(connection));
                Assert.That(controls.Rig, Is.Not.Null);
                Assert.That(controls.LeftHand, Is.Not.Null);
                Assert.That(controls.RightHand, Is.Not.Null);
                Assert.That(controls.Font, Is.Not.Null);
                Assert.That(connection.DisplayRoot, Is.Not.SameAs(controls.transform));
                Assert.That(connection.SurfaceMaterial, Is.Not.Null);
                Assert.That(connection.EdgeMaterial, Is.Not.Null);
                Assert.That(connection.SelectionMaterial, Is.Not.Null);
                Assert.That(connection.PreviewMaterial, Is.Not.Null);
                Assert.That(connection.PreviewMaterial, Is.Not.SameAs(connection.SelectionMaterial));
                Assert.That(connection.PreviewMaterial.color.a, Is.LessThan(1));
                var environment = Object.FindFirstObjectByType<QuestEnvironment>();
                var display = Object.FindFirstObjectByType<QuestDisplay>();
                Assert.That(environment, Is.Not.Null, "product scene must include MR with usable VR fallback");
                Assert.That(display, Is.Not.Null, "product scene must include independent placement controls");
                Assert.That(environment.Layer, Is.Not.Null);
                Assert.That(environment.Manager.isInsightPassthroughEnabled, Is.True);
                Assert.That(environment.VrReference, Is.Not.Null);
                Assert.That(display.Connection, Is.SameAs(connection));
                var spatial = Object.FindFirstObjectByType<QuestSpatialEdit>();
                Assert.That(spatial, Is.Not.Null);
                Assert.That(controls.Spatial, Is.SameAs(spatial));
                Assert.That(spatial.Connection, Is.SameAs(connection));
                Assert.That(spatial.Preview.transform.parent, Is.SameAs(connection.DisplayRoot));
                Assert.That(spatial.Dimensions.transform.parent, Is.SameAs(connection.DisplayRoot));
                var commands = Object.FindFirstObjectByType<QuestCommands>();
                Assert.That(commands, Is.Not.Null, "context actions must be wired into the product scene");
                Assert.That(commands.Connection, Is.SameAs(connection));
                Assert.That(controls.SketchDimensions, Is.Not.Null);
                Assert.That(controls.SketchDimensions.transform.parent, Is.SameAs(connection.DisplayRoot));
                typeof(QuestControls).GetMethod("Start", System.Reflection.BindingFlags.Instance |
                    System.Reflection.BindingFlags.NonPublic).Invoke(controls, null);
                var panel = controls.transform.Find("Compact panel (0.42 m)");
                Assert.That(panel.Find("Panel background").localScale.x, Is.EqualTo(.42f).Within(.001f));
                var menu = controls.transform.Find("Menu control");
                Assert.That(menu, Is.Not.Null);
                panel.gameObject.SetActive(false);
                Assert.That(menu.gameObject.activeInHierarchy, Is.True);
                Assert.That(menu.GetComponentInChildren<QuestButton>(), Is.Not.Null);
            }
            finally { EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single); }
        }
    }
}
