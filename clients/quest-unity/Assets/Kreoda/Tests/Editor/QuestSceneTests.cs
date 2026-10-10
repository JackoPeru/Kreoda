using Kreoda.QuestEditor;
using NUnit.Framework;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Kreoda.QuestRuntime.Tests
{
    public class QuestSceneTests
    {
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
