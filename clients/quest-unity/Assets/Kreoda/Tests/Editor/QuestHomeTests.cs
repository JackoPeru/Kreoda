using System.Linq;
using System.Reflection;
using NUnit.Framework;
using UnityEngine;
using Object = UnityEngine.Object;

namespace Kreoda.QuestRuntime.Tests
{
    public class QuestHomeTests
    {
        static readonly BindingFlags Private = BindingFlags.Instance | BindingFlags.NonPublic;
        GameObject _root, _head;
        QuestControls _controls;

        [SetUp]
        public void BuildControls()
        {
            _root = new GameObject("Quest Home test");
            _head = new GameObject("Quest Home head");
            var rig = _head.AddComponent<OVRCameraRig>();
            rig.EnsureGameObjectIntegrity();
            _head.transform.position = new Vector3(0, 1.65f, 0);
            var connection = _root.AddComponent<QuestConnection>();
            connection.DisplayRoot = new GameObject("Quest Home CAD root").transform;
            connection.DisplayRoot.SetParent(_root.transform);
            connection.Section = _root.AddComponent<QuestSection>();
            connection.Section.Connection = connection;
            var display = _root.AddComponent<QuestDisplay>();
            display.Connection = connection;
            _controls = _root.AddComponent<QuestControls>();
            _controls.Connection = connection;
            _controls.Display = display;
            _controls.Environment = _root.AddComponent<QuestEnvironment>();
            _controls.Rig = rig;
            _controls.Font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            _controls.PanelMaterial = _controls.ButtonMaterial = _controls.RayMaterial = _controls.Font.material;
            _controls.Voice = _root.AddComponent<QuestVoice>();
            _controls.Voice.Connection = connection;
            _controls.Voice.Controls = _controls;
            _controls.Voice.Audio = _root.AddComponent<AudioSource>();
            typeof(QuestControls).GetMethod("Start", Private).Invoke(_controls, null);
        }

        [TearDown]
        public void Cleanup()
        {
            Object.DestroyImmediate(_root);
            Object.DestroyImmediate(_head);
        }

        [Test]
        public void DefaultHomeMatchesDesktopHierarchyAndUsesHonestEmptyStates()
        {
            var home = Field("_homePage") as Transform;
            Assert.That(home, Is.Not.Null, "Quest must build a real Home page in its normal startup path");
            if (home == null) return;
            Assert.That(home.gameObject.activeSelf, Is.True, "Home must be the first visible page");
            var labels = home.GetComponentsInChildren<TextMesh>(true).Select(label => label.text).ToArray();
            foreach (var expected in new[] { "KREODA", "Progetta · Visualizza · Realizza", "Dalla tua idea al mondo reale",
                "Progetti recenti", "Inizia da qui", "Nuovo Progetto", "Importa", "Template", "AI Assistant",
                "Task in corso", "Ogni spazio racconta una storia." })
                Assert.That(labels, Does.Contain(expected), "missing Desktop Home label: " + expected);
            Assert.That(labels.Any(label => label.Contains("Cucina_Villa_Costa") || label.Contains("Scale_Moderne")), Is.False,
                "Desktop demo filenames must not appear as Quest user projects");
            Assert.That(labels.Any(label => label.Contains("Ancora nessun progetto") && label.Contains("sincronizzato")), Is.True);
            Assert.That(labels, Does.Contain("Nessun task attivo"));
            Assert.That(home.GetComponentsInChildren<Component>(true).Any(component => component != null &&
                component.GetType().Name.Contains("VideoPlayer")), Is.False, "passthrough room replaces Desktop's video background");
        }

        [Test]
        public void ManualPairingInputsStayOutsideHomeAndWorkspaceActionsStayReachable()
        {
            var home = (Transform)Field("_homePage");
            Assert.That(home, Is.Not.Null, "Quest must build a Home page before contextual routes can be checked");
            if (home == null) return;
            Assert.That(home.GetComponentsInChildren<TextMesh>(true).Any(label =>
                label.text.Contains("Endpoint") || label.text.Contains("Codice")), Is.False,
                "manual endpoint and pairing code belong only in advanced diagnostics");
            Assert.That(home.Find("Misura control"), Is.Not.Null, "contextual measurement page must be reachable from Home");
            Assert.That(home.Find("Modella control"), Is.Not.Null, "CAD editing page must be reachable from Home");
            Assert.That(home.Find("Visualizza control"), Is.Not.Null, "view controls must be reachable from Home");
            Assert.That(home.Find("AI Assistant control"), Is.Not.Null, "AI action must open the existing voice page");
            var ai = home.Find("AI Assistant control").GetComponentInChildren<QuestButton>(true);
            ai.Click.Invoke();
            Assert.That(((Transform)Field("_voicePage")).gameObject.activeSelf, Is.True);
            Assert.That(_controls.Voice.Recording, Is.False, "opening AI must not start the microphone");
        }

        [Test]
        public void HomeActionsOpenExistingWorkspacePagesAndNeverFakeProjectCreation()
        {
            var home = (Transform)Field("_homePage");
            Assert.That(home, Is.Not.Null);
            if (home == null) return;
            var model = home.Find("Modella control").GetComponentInChildren<QuestButton>(true);
            Assert.That(model.ActionId, Is.EqualTo("home:model"));
            model.Click.Invoke();
            Assert.That(((Transform)Field("_editPage")).gameObject.activeSelf, Is.True);

            ReturnHome();
            home.Find("Visualizza control").GetComponentInChildren<QuestButton>(true).Click.Invoke();
            Assert.That(((Transform)Field("_viewPage")).gameObject.activeSelf, Is.True);

            ReturnHome();
            home.Find("Misura control").GetComponentInChildren<QuestButton>(true).Click.Invoke();
            Assert.That(((Transform)Field("_referencePage")).gameObject.activeSelf, Is.True);

            ReturnHome();
            var priorStatus = _controls.Connection.Status;
            home.Find("Nuovo Progetto control").GetComponentInChildren<QuestButton>(true).Click.Invoke();
            Assert.That(((Transform)Field("_homeNoticePage")).gameObject.activeSelf, Is.True);
            Assert.That(_controls.Connection.Status, Is.EqualTo(priorStatus));
            Assert.That(_controls.Connection.SavedEndpoint, Is.Empty);
            Assert.That(((TextMesh)Field("_homeNotice")).text, Does.Contain("non è disponibile").And.Contain("non verrà modificato"));
        }

        [Test]
        public void LongConnectionStatusStaysInsideItsMeasuredButtonBounds()
        {
            var home = (Transform)Field("_homePage");
            Assert.That(home, Is.Not.Null, "Quest must build a Home page before measuring its connection status");
            if (home == null) return;
            var label = home.Find("PC status control").GetComponentInChildren<TextMesh>(true);
            typeof(QuestConnection).GetField("<Status>k__BackingField", Private).SetValue(_controls.Connection,
                "Ricerca del PC locale · Kreoda Studio · connessione in riconnessione dopo un cambio rete");
            typeof(QuestControls).GetMethod("Update", Private).Invoke(_controls, null);
            typeof(QuestControls).GetMethod("LateUpdate", Private).Invoke(_controls, null);
            Physics.SyncTransforms();
            var text = label.GetComponent<MeshRenderer>().bounds;
            var button = label.transform.parent.GetComponentInChildren<Collider>().bounds;
            Assert.That(label.text, Does.EndWith("…"), "long connection state must be shortened before it becomes unreadable");
            Assert.That(label.transform.localScale.x, Is.GreaterThanOrEqualTo(.85f), "connection text must remain readable");
            Assert.That(text.size.x, Is.LessThanOrEqualTo(button.size.x * .95f));
            Assert.That(text.size.y, Is.LessThanOrEqualTo(button.size.y * .9f));
        }

        [TestCase("_homePage")]
        [TestCase("_viewPage")]
        public void VisibleControlsStayInsideSurfaceAndNeverOverlap(string pageField)
        {
            var page = (Transform)Field(pageField);
            typeof(QuestControls).GetMethod("Page", Private).Invoke(_controls, new object[] { page });
            typeof(QuestControls).GetMethod("LateUpdate", Private).Invoke(_controls, null);
            Physics.SyncTransforms();
            var surface = pageField == "_homePage" ? _controls.Home.Background : (GameObject)Field("_panelBackground");
            var panel = surface.GetComponent<MeshRenderer>().bounds;
            var buttons = _controls.GetComponentsInChildren<QuestButton>().Where(button => button.gameObject.activeInHierarchy).ToArray();
            foreach (var button in buttons)
            {
                var bounds = button.GetComponent<Collider>().bounds;
                Assert.That(bounds.min.x, Is.GreaterThanOrEqualTo(panel.min.x - .001f), button.name + " left");
                Assert.That(bounds.max.x, Is.LessThanOrEqualTo(panel.max.x + .001f), button.name + " right");
                Assert.That(bounds.min.y, Is.GreaterThanOrEqualTo(panel.min.y - .001f), button.name + " bottom");
                Assert.That(bounds.max.y, Is.LessThanOrEqualTo(panel.max.y + .001f), button.name + " top");
                foreach (var other in buttons.Where(other => other.GetInstanceID() > button.GetInstanceID()))
                {
                    var next = other.GetComponent<Collider>().bounds;
                    float width = Mathf.Min(bounds.max.x, next.max.x) - Mathf.Max(bounds.min.x, next.min.x);
                    float height = Mathf.Min(bounds.max.y, next.max.y) - Mathf.Max(bounds.min.y, next.min.y);
                    Assert.That(width <= .0001f || height <= .0001f, Is.True, button.name + " overlaps " + other.name);
                }
            }
            Assert.That(_controls.GetComponentsInChildren<QuestButton>().Any(button => button.name == "Menu"), Is.False,
                "the palm recovery menu must not float over an already visible panel");
        }

        [Test]
        public void RecoveryMenuAppearsOnlyWhenPanelIsHiddenAndReopensHome()
        {
            typeof(QuestControls).GetMethod("TogglePanel", Private).Invoke(_controls, null);
            typeof(QuestControls).GetMethod("LateUpdate", Private).Invoke(_controls, null);
            var menu = _controls.GetComponentsInChildren<QuestButton>().Single(button => button.name == "Menu");
            Assert.That(menu.GetComponent<Collider>().enabled, Is.True);
            menu.Click.Invoke();
            typeof(QuestControls).GetMethod("LateUpdate", Private).Invoke(_controls, null);
            Assert.That(((Transform)Field("_homePage")).gameObject.activeInHierarchy, Is.True);
            Assert.That(menu.gameObject.activeInHierarchy, Is.False);
        }

        object Field(string name) => typeof(QuestControls).GetField(name, Private)?.GetValue(_controls);

        void ReturnHome() => _controls.transform.Find("Compact panel (0.42 m)/Home control")
            .GetComponentInChildren<QuestButton>(true).Click.Invoke();
    }
}
