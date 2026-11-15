using System.Linq;
using System.Reflection;
using NUnit.Framework;
using UnityEngine;
using Kreoda.Session;
using System;
using System.Text.Json;
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
            typeof(QuestConnection).GetMethod("OnDestroy", Private).Invoke(_controls.Connection, null);
            Object.DestroyImmediate(_root);
            Object.DestroyImmediate(_head);
        }

        [Test]
        public void EditorCaptureFitsActualVisiblePanoramicBoundsButIgnoresHiddenSurfaces()
        {
            var page = new GameObject("Framing fixture");
            var cameraObject = new GameObject("Framing camera");
            try
            {
                var camera = cameraObject.AddComponent<Camera>();
                camera.orthographic = true;
                camera.aspect = 1600f / 900f;
                GameObject Surface(string name, float x, bool visible)
                {
                    var surface = GameObject.CreatePrimitive(PrimitiveType.Cube);
                    surface.name = name;
                    surface.transform.SetParent(page.transform, false);
                    surface.transform.localPosition = new Vector3(x, 0, 0);
                    surface.transform.localScale = new Vector3(.3f, .4f, .002f);
                    surface.SetActive(visible);
                    return surface;
                }
                var left = Surface("Left real glass", -.38f, true);
                var right = Surface("Right real glass", .38f, true);
                Surface("Hidden distant decoration", 100f, false);
                var method = typeof(Kreoda.QuestEditor.QuestHomeRender).GetMethod("FitRealPage",
                    BindingFlags.Static | BindingFlags.NonPublic);
                Assert.That(method, Is.Not.Null);
                var args = new object[] { camera, page.transform, 0f, Vector2.zero };
                method.Invoke(null, args);
                var halfHeight = (float)args[2];
                var center = (Vector2)args[3];
                Assert.That(center.x, Is.EqualTo(0f).Within(.001f));
                Assert.That(camera.orthographicSize, Is.EqualTo(halfHeight).Within(.00001f));
                Assert.That(halfHeight, Is.GreaterThan(.28f).And.LessThan(1f),
                    "include both lateral glass islands, exclude hidden distant geometry");
                foreach (var surface in new[] { left, right })
                {
                    var bounds = surface.GetComponent<Renderer>().bounds;
                    Assert.That(Mathf.Abs(bounds.min.x - center.x),
                        Is.LessThanOrEqualTo(halfHeight * camera.aspect + .0001f));
                    Assert.That(Mathf.Abs(bounds.max.x - center.x),
                        Is.LessThanOrEqualTo(halfHeight * camera.aspect + .0001f));
                    Assert.That(Mathf.Abs(bounds.max.y - center.y), Is.LessThanOrEqualTo(halfHeight + .0001f));
                }
            }
            finally
            {
                Object.DestroyImmediate(cameraObject);
                Object.DestroyImmediate(page);
            }
        }

        
        [Test]
        public void SpatialHomeUsesThreeWorldLockedCardsAndOneBelt()
        {
            var page = (Transform)Field("_homePage");
            foreach (var card in new[] { "ENTRA NELLO SPAZIO card", "CONNETTI PC card", "HERMES card" })
                Assert.That(page.Find(card), Is.Not.Null, card);
            foreach (var id in new[] { "home:design", "home:pc", "home:ai", "home:project:select",
                "home:project:open", "home:model", "home:view", "home:measure", "home:render" })
                Assert.That(ActionButton(page, id), Is.Not.Null, id);
            var belt = page.Find("Spatial context belt");
            Assert.That(belt, Is.Not.Null);
            Assert.That(belt.GetComponentsInChildren<QuestButton>(true).Length, Is.EqualTo(5));
            var left = page.Find("ENTRA NELLO SPAZIO card");
            var rail = (Transform)Field("_toolRail");
            Assert.That(left, Is.Not.Null);
            Assert.That(rail.gameObject.activeSelf, Is.False,
                "the Home mockup has no tool rail; it appears on the workspace pages");
            Assert.That(page.Find("Spatial context belt"), Is.Not.Null);
        }

        [Test]
        public void HomeProjectSummaryUsesActualSessionDocumentRevisionAndBodyCount()
        {
            var model = new SessionModelState("session", "document-1234567890", 42,
                Array.Empty<JsonElement>(), Array.Empty<JsonElement>(), Array.Empty<JsonElement>());
            Assert.That(QuestHomeProjectData.Summary(model), Does.Contain("document-123…").And.Contain("Rev 42").And.Contain("0 corpi"));
            Assert.That(QuestHomeProjectData.Summary(null), Does.Contain("Connetti il PC"));
        }

        [Test]
        public void ObservedDocumentsAreBoundedDeduplicatedAndIgnoreStaleRevisions()
        {
            var history = new QuestHomeProjectData();
            SessionModelState Model(string id, long revision) => new SessionModelState("session", id, revision,
                Array.Empty<JsonElement>(), Array.Empty<JsonElement>(), Array.Empty<JsonElement>());
            history.Observe(Model("first", 8));
            history.Observe(Model("second", 2));
            history.Observe(Model("first", 7));
            Assert.That(history.Recent[0].DocumentId, Is.EqualTo("second"), "stale revision cannot reorder history");
            history.Observe(Model("first", 9));
            Assert.That(history.Recent[0].Revision, Is.EqualTo(9));
            foreach (var id in new[] { "third", "fourth", "fifth" }) history.Observe(Model(id, 1));
            Assert.That(history.Recent.Count, Is.EqualTo(4));
            Assert.That(history.RecentSummary(), Does.Contain("fifth").And.Not.Contain("first"));
        }

        [Test]
        public void RecentProjectReplyRejectsStalePairingGenerationAndDocumentRevision()
        {
            SessionModelState Model(string session, string document, long revision) =>
                new SessionModelState(session, document, revision, Array.Empty<JsonElement>(),
                    Array.Empty<JsonElement>(), Array.Empty<JsonElement>());
            var requested = Model("paired-pc", "doc-a", 4);
            Assert.That(QuestControls.HomeRecentResponseCurrent(requested, Model("paired-pc", "doc-a", 4), 9, 9, 3, 3), Is.True);
            Assert.That(QuestControls.HomeRecentResponseCurrent(requested, Model("paired-pc", "doc-a", 5), 9, 9, 3, 3), Is.False);
            Assert.That(QuestControls.HomeRecentResponseCurrent(requested, Model("paired-pc", "doc-b", 4), 9, 9, 3, 3), Is.False);
            Assert.That(QuestControls.HomeRecentResponseCurrent(requested, Model("other-pc", "doc-a", 4), 9, 9, 3, 3), Is.False);
            Assert.That(QuestControls.HomeRecentResponseCurrent(requested, requested, 9, 10, 3, 3), Is.False);
            Assert.That(QuestControls.HomeRecentResponseCurrent(requested, requested, 9, 9, 3, 4), Is.False);
        }

        [Test]
        public void RecentProjectNamesCannotAuthorizeOpeningWithoutCanonicalMethods()
        {
            Assert.That(QuestHomeProjectData.HasCanonicalOpenCapability(new[] { SessionMethods.ListRecentProjects }), Is.False);
            Assert.That(QuestHomeProjectData.HasCanonicalOpenCapability(new[] { "listOpenableProjects" }), Is.False);
            Assert.That(QuestHomeProjectData.HasCanonicalOpenCapability(new[] { "listOpenableProjects", "requestOpenProject" }), Is.False,
                "Names alone cannot enable open: explicit trusted Desktop consent is still unavailable");
        }

        [Test]
        public void ServerRecentProjectsShowOnlyNamesAndOpenedAtAndFallBackOnInvalidReply()
        {
            var home = new QuestHomeProjectData();
            using var valid = JsonDocument.Parse("{\"result\":{\"projects\":[{\"name\":\"Cucina privata\",\"openedAt\":1792231200000,\"path\":\"C:/secret/private.kreoda\"}]}}");
            Assert.That(home.ApplyServerProjects(valid.RootElement), Is.True);
            Assert.That(home.RecentSummary(), Does.Contain("Cucina privata").And.Contain("2026-").And.Not.Contain("secret").And.Not.Contain(".kreoda"));
            using var invalid = JsonDocument.Parse("{\"result\":{\"projects\":[{\"name\":\"No timestamp\"}]}}");
            Assert.That(home.ApplyServerProjects(invalid.RootElement), Is.False);
            home.ClearServerProjects();
            Assert.That(home.RecentSummary(), Does.Contain("Connetti il PC"));
        }

        [Test]
        public void RecentDataDistinguishesOfflineFallbackObservedDocumentsAndEmptyServerSnapshot()
        {
            var data = new QuestHomeProjectData();
            Assert.That(data.HasServerSnapshot, Is.False);
            Assert.That(data.HasRecentProjects, Is.False);
            Assert.That(data.RecentProjectCount, Is.Zero);
            using var empty = JsonDocument.Parse("{\"result\":{\"projects\":[]}}");
            Assert.That(data.ApplyServerProjects(empty.RootElement), Is.True);
            Assert.That(data.HasServerSnapshot, Is.True);
            Assert.That(data.HasRecentProjects, Is.False);
            Assert.That(data.RecentProjectCount, Is.Zero);
            data.ClearServerProjects();
            data.Observe(new SessionModelState("session", "document", 1,
                Array.Empty<JsonElement>(), Array.Empty<JsonElement>(), Array.Empty<JsonElement>()));
            Assert.That(data.HasServerSnapshot, Is.False);
            Assert.That(data.HasRecentProjects, Is.True);
            Assert.That(data.RecentProjectCount, Is.EqualTo(1));
        }

        
        [Test]
        public void SpatialHomeBindsLiveConnectionStateToTheWorldLockedChip()
        {
            var chip = (TextMesh)Field("_chipStatus");
            Assert.That(chip, Is.Not.Null, "the world-locked status chip must exist");
            _controls.Home.SetConnectionStatus("PC connesso", true);
            Assert.That(chip.text, Is.EqualTo("PC CONNESSO"));
            Assert.That(_controls.Home.ConnectionStatus.text, Is.EqualTo("PC connesso"));
            _controls.Home.SetConnectionStatus("PC non connesso", false);
            Assert.That(chip.text, Is.EqualTo("PC NON CONNESSO"));
        }

        
        [Test]
        public void EmptyRecentProjectsRenderOneBadgeAndNoFakeRows()
        {
            var home = (Transform)Field("_homePage");
            _controls.Home.SetProjectStatus(null, false, false);
            Assert.That(_controls.Home.OpenableStatus.text, Is.EqualTo("NESSUN PROGETTO CARICATO"));
            var labels = home.GetComponentsInChildren<TextMesh>(true).Select(label => label.text).ToArray();
            Assert.That(labels.Any(label => label.Contains("Cucina_Villa_Costa") || label.Contains("Scale_Moderne")), Is.False);
            Assert.That(home.GetComponentsInChildren<Transform>(true)
                .Any(item => item.name.StartsWith("Recent project card ")), Is.False,
                "the redesign uses one honest badge instead of fake recent rows");
        }

        [Test]
        public void HomeShowsOneConnectionStatusWithoutDuplicateTaskShelves()
        {
            var labels = ((Transform)Field("_homePage")).GetComponentsInChildren<TextMesh>(true)
                .Select(label => label.text).ToArray();
            Assert.That(labels.Count(label => label == "PC non connesso"), Is.EqualTo(1));
            Assert.That(labels.Any(label => label == "STATO PC" || label == "STATO PC / SESSIONE"), Is.False);
            Assert.That(labels.Any(label => label == "TASK IN CORSO" || label == "In attesa di connessione PC"), Is.False);
        }

        [Test]
        public void HomeQuickStartUsesRealActionsAndHidesUnsupportedProjectShortcuts()
        {
            var home = (Transform)Field("_homePage");
            var ids = home.GetComponentsInChildren<QuestButton>(true).Select(button => button.ActionId).ToArray();
            foreach (var id in new[] { "home:pc", "home:project:select", "home:project:open", "home:ai" })
                Assert.That(ids, Does.Contain(id), id);
            foreach (var id in new[] { "home:project:new", "home:project:import", "home:project:template" })
                Assert.That(ids, Does.Not.Contain(id), id + " is Desktop-owned on Quest");
            var labels = home.GetComponentsInChildren<TextMesh>(true).Select(label => label.text).ToArray();
            Assert.That(labels, Does.Not.Contain("DIAGNOSI"));
            Assert.That(labels, Does.Contain("APRI"));
        }

        [TestCase("home:project:new")]
        [TestCase("home:project:import")]
        [TestCase("home:project:template")]
        public void DesktopOwnedProjectActionsExplainWhereTheyBelong(string action)
        {
            typeof(QuestControls).GetField("_thicknessNotice", Private).SetValue(_controls, true);
            typeof(QuestControls).GetField("_thicknessPending", Private).SetValue(_controls, true);
            typeof(QuestControls).GetField("_massRequest", Private).SetValue(_controls, 7);
            typeof(QuestControls).GetMethod("HomeAction", Private).Invoke(_controls, new object[] { action });
            Assert.That(((Transform)Field("_homeNoticePage")).gameObject.activeSelf, Is.True);
            Assert.That(((Transform)Field("_connectionPage")).gameObject.activeSelf, Is.False,
                "Desktop-owned template action must not route to diagnostics");
            var notice = ((TextMesh)Field("_homeNotice")).text;
            Assert.That(notice, Does.Contain("Desktop").And.Contain("Quest"));
            Assert.That(_controls.Connection.Client, Is.Null, "Desktop-owned actions cannot create or import a Quest document");
            Assert.That((bool)typeof(QuestControls).GetField("_thicknessNotice", Private).GetValue(_controls), Is.False);
            Assert.That((bool)typeof(QuestControls).GetField("_thicknessPending", Private).GetValue(_controls), Is.False);
            Assert.That((int)typeof(QuestControls).GetField("_massRequest", Private).GetValue(_controls), Is.EqualTo(8),
                "Desktop ownership notice invalidates the pending thickness reply");
        }

        [Test]
        public void DefaultHomeMatchesDesktopHierarchyAndUsesHonestEmptyStates()
        {
            var home = Field("_homePage") as Transform;
            Assert.That(home, Is.Not.Null, "Quest must build a real Home page in its normal startup path");
            if (home == null) return;
            Assert.That(home.gameObject.activeSelf, Is.True, "Home must be the first visible page");
            var labels = home.GetComponentsInChildren<TextMesh>(true).Select(label => label.text).ToArray();
            foreach (var expected in new[] { "ENTRA NELLO SPAZIO", "CONNETTI PC", "HERMES",
                "NESSUN PROGETTO CARICATO", "DISEGNA", "MODELLA", "VISTA", "MISURA", "DISPLAY", "PC non connesso" })
                Assert.That(labels, Does.Contain(expected), "missing spatial Home label: " + expected);
            Assert.That(labels.Any(label => label.Contains("Cucina_Villa_Costa") || label.Contains("Scale_Moderne")), Is.False,
                "Desktop demo filenames must not appear as Quest user projects");
            Assert.That(labels.Count(label => label == "PC non connesso"), Is.EqualTo(1));
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
            Assert.That(ActionButton(home, "home:measure"), Is.Not.Null);
            Assert.That(ActionButton(home, "home:model"), Is.Not.Null);
            Assert.That(ActionButton(home, "home:view"), Is.Not.Null);
            var ai = ActionButton(home, "home:ai");
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
            var model = ActionButton(home, "home:model");
            Assert.That(model.ActionId, Is.EqualTo("home:model"));
            model.Click.Invoke();
            Assert.That(((Transform)Field("_editPage")).gameObject.activeSelf, Is.True);

            ReturnHome();
            ActionButton(home, "home:view").Click.Invoke();
            Assert.That(((Transform)Field("_viewPage")).gameObject.activeSelf, Is.True);

            ReturnHome();
            ActionButton(home, "home:measure").Click.Invoke();
            Assert.That(((Transform)Field("_referencePage")).gameObject.activeSelf, Is.True);

            ReturnHome();
            ActionButton(home, "home:pc").Click.Invoke();
            Assert.That(((Transform)Field("_pcPage")).gameObject.activeSelf, Is.True);
            Assert.That(_controls.Connection.SavedEndpoint, Is.Empty);
            Assert.That(_controls.Connection.Client, Is.Null, "connection action cannot manufacture a CAD document");
        }

        
        [Test]
        public void LongConnectionStatusStaysInsideTheChip()
        {
            var chip = (TextMesh)Field("_chipStatus");
            Assert.That(chip, Is.Not.Null, "the world-locked status chip must exist");
            typeof(QuestConnection).GetField("<Status>k__BackingField", Private).SetValue(_controls.Connection,
                "Ricerca del PC locale - Kreoda Studio - connessione in riconnessione dopo un cambio rete");
            typeof(QuestControls).GetMethod("Update", Private).Invoke(_controls, null);
            typeof(QuestControls).GetMethod("LateUpdate", Private).Invoke(_controls, null);
            Physics.SyncTransforms();
            Assert.That(chip.text, Does.EndWith("..."), "long connection state must be shortened");
            var backing = chip.transform.parent.Find("Status chip backing").GetComponent<MeshRenderer>().bounds;
            var text = chip.GetComponent<MeshRenderer>().bounds;
            Assert.That(text.size.x, Is.LessThanOrEqualTo(backing.size.x * .95f));
            Assert.That(text.size.y, Is.LessThanOrEqualTo(backing.size.y * .9f));
        }

        [TestCase("_homePage")]
        [TestCase("_viewPage")]
        [TestCase("_pcPage")]
        public void VisibleControlsStayInsideSurfaceAndNeverOverlap(string pageField)
        {
            var page = (Transform)Field(pageField);
            typeof(QuestControls).GetMethod("Page", Private).Invoke(_controls, new object[] { page });
            typeof(QuestControls).GetMethod("LateUpdate", Private).Invoke(_controls, null);
            Physics.SyncTransforms();
            var panel = (Transform)Field("_panel");
            var allowed = pageField == "_homePage" ? Rect.MinMaxRect(-.48f, -.40f, .48f, .32f)
                : Rect.MinMaxRect(-.30f, -.37f, .25f, .28f);
            var boundsMethod = typeof(QuestControls).GetMethod("ColliderPageBounds", BindingFlags.Static | BindingFlags.NonPublic);
            var buttons = _controls.GetComponentsInChildren<QuestButton>().Where(button => button.gameObject.activeInHierarchy).ToArray();
            foreach (var button in buttons)
            {
                var basis = pageField == "_homePage" ? page : panel;
                var bounds = (Rect)boundsMethod.Invoke(null, new object[] { basis, button.GetComponent<BoxCollider>() });
                Assert.That(bounds.xMin, Is.GreaterThanOrEqualTo(allowed.xMin - .001f), button.name + " left");
                Assert.That(bounds.xMax, Is.LessThanOrEqualTo(allowed.xMax + .001f), button.name + " right");
                Assert.That(bounds.yMin, Is.GreaterThanOrEqualTo(allowed.yMin - .001f), button.name + " bottom");
                Assert.That(bounds.yMax, Is.LessThanOrEqualTo(allowed.yMax + .001f), button.name + " top");
                foreach (var other in buttons.Where(other => other.GetInstanceID() > button.GetInstanceID()))
                {
                    var next = (Rect)boundsMethod.Invoke(null, new object[] { basis, other.GetComponent<BoxCollider>() });
                    float width = Mathf.Min(bounds.xMax, next.xMax) - Mathf.Max(bounds.xMin, next.xMin);
                    float height = Mathf.Min(bounds.yMax, next.yMax) - Mathf.Max(bounds.yMin, next.yMin);
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

        [Test]
        public void PcHomeActionShowsNamesWithoutManualInputsAndKeepsDiagnosticsSeparate()
        {
            ActionButton((Transform)Field("_homePage"), "home:pc").Click.Invoke();
            var page = (Transform)Field("_pcPage");
            Assert.That(page.gameObject.activeInHierarchy, Is.True);
            var labels = page.GetComponentsInChildren<TextMesh>(true).Select(label => label.text).ToArray();
            Assert.That(labels.Any(label => label.Contains("Endpoint") || label.Contains("Codice")), Is.False);
            var peers = new[] { new Kreoda.Session.DiscoveredSessionPc(System.Guid.NewGuid().ToString("D"), "Studio",
                new System.Uri("ws://192.168.1.8:1"), new System.Uri("http://192.168.1.8:2/pair")) };
            typeof(QuestConnection).GetProperty("AvailablePcs").SetValue(_controls.Connection, peers);
            typeof(QuestControls).GetMethod("Update", Private).Invoke(_controls, null);
            Assert.That(page.GetComponentsInChildren<TextMesh>().Any(label => label.text == "Studio"), Is.True);
            ActionButton(page, "Diagnostica avanzata").Click.Invoke();
            Assert.That(((Transform)Field("_connectionPage")).gameObject.activeInHierarchy, Is.True);
        }

        object Field(string name) => typeof(QuestControls).GetField(name, Private)?.GetValue(_controls);

        static QuestButton ActionButton(Transform page, string id) =>
            page.GetComponentsInChildren<QuestButton>(true).First(button => button.ActionId == id);

        void ReturnHome() => _controls.transform.Find("Compact panel (0.42 m)/Spatial tool rail/Home rail button")
            .GetComponent<QuestButton>().Click.Invoke();
    }
}
