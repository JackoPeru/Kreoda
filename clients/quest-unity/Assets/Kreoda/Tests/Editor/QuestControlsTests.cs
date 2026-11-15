using System;
using System.Collections;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Collections.Generic;
using Kreoda.QuestFoundation;
using Kreoda.Session;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;
using Object = UnityEngine.Object;

namespace Kreoda.QuestRuntime.Tests
{
    public class QuestControlsTests
    {
        GameObject _root, _head;
        QuestControls _controls;
        const BindingFlags Private = BindingFlags.Instance | BindingFlags.NonPublic;

        [SetUp]
        public void BuildActualControls()
        {
            _root = new GameObject("Owned panel test");
            _head = new GameObject("Owned head test");
            var rig = _head.AddComponent<OVRCameraRig>();
            rig.EnsureGameObjectIntegrity();
            _head.transform.position = new Vector3(2, 1.65f, 3);
            _head.transform.rotation = Quaternion.Euler(0, 35, 0);
            var connection = _root.AddComponent<QuestConnection>();
            connection.DisplayRoot = new GameObject("Owned CAD root").transform;
            connection.DisplayRoot.SetParent(_root.transform);
            connection.Section = _root.AddComponent<QuestSection>();
            connection.Section.Connection = connection;
            var display = _root.AddComponent<QuestDisplay>();
            display.Connection = connection;
            _controls = _root.AddComponent<QuestControls>();
            _controls.Connection = connection;
            _controls.Rig = rig;
            _controls.Display = display;
            _controls.Environment = _root.AddComponent<QuestEnvironment>();
            _controls.Voice = _root.AddComponent<QuestVoice>();
            _controls.Voice.Connection = connection;
            _controls.Voice.Controls = _controls;
            _controls.Font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            _controls.PanelMaterial = _controls.ButtonMaterial = _controls.RayMaterial = _controls.Font.material;
            Call("Start");
        }

        [TearDown]
        public void DisposeControls()
        {
            typeof(QuestConnection).GetMethod("OnDestroy", Private).Invoke(_controls.Connection, null);
            Object.DestroyImmediate(_root);
            Object.DestroyImmediate(_head);
        }

        object Call(string method, params object[] args)
        {
            var target = typeof(QuestControls).GetMethod(method, Private);
            Assert.That(target, Is.Not.Null, method + " must implement the actual panel interaction");
            return target.Invoke(_controls, args);
        }

        QuestMeshView CreatePlacementFixture()
        {
            var view = new GameObject("Placement CAD fixture").AddComponent<QuestMeshView>();
            view.transform.SetParent(_controls.Connection.DisplayRoot, false);
            view.Upload(QuestMeshViewTests.NativeFixture());
            var views = (Dictionary<SceneObjectKey, QuestMeshView>)typeof(QuestConnection)
                .GetField("_views", Private).GetValue(_controls.Connection);
            views.Add(new SceneObjectKey(view.BodyId), view);
            return view;
        }

        static Vector3 PlacementContact(QuestMeshView view) => new Vector3(
            (float)(view.BboxMetres[0] + view.BboxMetres[3]) * .5f,
            (float)view.BboxMetres[1],
            (float)(view.BboxMetres[2] + view.BboxMetres[5]) * .5f);

        [Test]
        public void PlacementPointerProducerAnchorsAtNonCadPhysicsHitAndKeepsHeightCalibration()
        {
            var view = CreatePlacementFixture();
            var table = GameObject.CreatePrimitive(PrimitiveType.Cube);
            table.transform.SetParent(_root.transform);
            table.name = "Measured test table surface";
            table.transform.position = new Vector3(0, .75f, 1.1f);
            table.transform.localScale = new Vector3(.8f, .1f, .8f);
            var origin = new Vector3(0, 1.4f, 0);
            var contact = new Vector3(0, .8f, 1.1f);
            var ray = new Ray(origin, (contact - origin).normalized);

            // A CAD-owned collider nearer than the table must not become the contact.
            var cadCollider = new GameObject("CAD owned collider");
            cadCollider.transform.SetParent(_controls.Connection.DisplayRoot, false);
            cadCollider.transform.position = ray.GetPoint(.3f);
            cadCollider.AddComponent<BoxCollider>().size = Vector3.one * .12f;
            Physics.SyncTransforms();
            Assert.That(_controls.Display.BeginPlacement(), Is.True);
            Assert.That(Call("UpdatePlacementFromPointer", ray, true, 30f), Is.EqualTo(true));
            Assert.That(Vector3.Distance(_controls.Connection.DisplayRoot.TransformPoint(PlacementContact(view)),
                contact), Is.LessThan(.002f), "contact must be on the table, never at hand origin or CAD collider");
            Assert.That(_controls.Display.Status, Does.Contain("collider"));
            Assert.That(_controls.Display.Status, Does.Contain("tavolo non verificato"),
                "an unknown upward-facing collider does not establish a reconstructed real table");
            _controls.Display.AdjustHeight(.015f);
            Physics.SyncTransforms();
            Assert.That(Call("UpdatePlacementFromPointer", ray, true, 30f), Is.EqualTo(true));
            Assert.That(Vector3.Distance(_controls.Connection.DisplayRoot.TransformPoint(PlacementContact(view)),
                contact + Vector3.up * .015f), Is.LessThan(.002f));
            _controls.Display.FreezePlacement();
            Assert.That(_controls.Display.ConfirmPlacement(true), Is.True);
            Assert.That(_controls.Display.Status, Does.Contain("tavolo non verificato"),
                "final model placement must preserve the unverified collider provenance");
        }

        [Test]
        public void PlacementPointerProducerUsesClearlyLabeledFiniteManualFallbackWithoutRoomColliders()
        {
            var view = CreatePlacementFixture();
            var origin = new Vector3(-1.5f, 1.3f, -.4f);
            var ray = new Ray(origin, Vector3.right);
            Assert.That(_controls.Display.BeginPlacement(), Is.True);
            Physics.SyncTransforms();
            Assert.That(Call("UpdatePlacementFromPointer", ray, true, 0f), Is.EqualTo(true));
            Assert.That(Vector3.Distance(_controls.Connection.DisplayRoot.TransformPoint(PlacementContact(view)),
                ray.GetPoint(.85f)), Is.LessThan(.002f), "manual fallback must follow a finite ray target");
            Assert.That(_controls.Display.Status, Does.Contain("manuale"));
            _controls.Display.FreezePlacement();
            Assert.That(_controls.Display.FollowPointer, Is.False);
            Assert.That(_controls.Display.ConfirmPlacement(true), Is.True);
            Assert.That(_controls.Display.Status, Does.Contain("manuale"),
                "a projected point must never be advertised as an automatically detected table");
        }

        [Test]
        public void PlacementPointerProducerRejectsUiAndInvalidRaysWhileFrozenTargetSurvivesUiAim()
        {
            var view = CreatePlacementFixture();
            var table = GameObject.CreatePrimitive(PrimitiveType.Cube);
            table.transform.SetParent(_root.transform);
            table.transform.position = new Vector3(0, .75f, 1.1f);
            table.transform.localScale = new Vector3(.8f, .1f, .8f);
            var ray = new Ray(new Vector3(0, 1.4f, 0),
                (new Vector3(0, .8f, 1.1f) - new Vector3(0, 1.4f, 0)).normalized);
            var blocker = GameObject.CreatePrimitive(PrimitiveType.Cube);
            blocker.transform.SetParent(_root.transform);
            blocker.transform.position = ray.GetPoint(.4f);
            blocker.transform.localScale = Vector3.one * .14f;
            blocker.AddComponent<QuestButton>().ActionId = "Front UI";
            Physics.SyncTransforms();

            Assert.That(_controls.Display.BeginPlacement(), Is.True);
            var prior = _controls.Connection.DisplayRoot.position;
            Assert.That(Call("UpdatePlacementFromPointer", ray, true, 0f), Is.EqualTo(false));
            Assert.That(_controls.Connection.DisplayRoot.position, Is.EqualTo(prior));
            _controls.Display.FreezePlacement();
            Assert.That(_controls.Display.FollowPointer, Is.True,
                "UI obstruction cannot freeze or confirm an ungrounded point");
            Assert.That(Call("UpdatePlacementFromPointer",
                new Ray(new Vector3(float.NaN, 0, 0), Vector3.forward), true, 0f), Is.EqualTo(false));
            Assert.That(_controls.Connection.DisplayRoot.position, Is.EqualTo(prior));

            blocker.SetActive(false);
            Physics.SyncTransforms();
            Assert.That(Call("UpdatePlacementFromPointer", ray, true, 0f), Is.EqualTo(true));
            Assert.That(Vector3.Distance(_controls.Connection.DisplayRoot.TransformPoint(PlacementContact(view)),
                new Vector3(0, .8f, 1.1f)), Is.LessThan(.002f));
            _controls.Display.FreezePlacement();
            blocker.SetActive(true);
            Physics.SyncTransforms();
            // After a valid freeze the hand may point at the UI Confirm action.
            Assert.That(Call("UpdatePlacementFromPointer", ray, true, 0f), Is.EqualTo(false));
            Assert.That(_controls.Display.ConfirmPlacement(true), Is.True);

            Assert.That(_controls.Display.BeginPlacement(), Is.True);
            Assert.That(Call("UpdatePlacementFromPointer", ray, false, 0f), Is.EqualTo(false));
            _controls.Display.FreezePlacement();
            Assert.That(_controls.Display.ConfirmPlacement(false), Is.False,
                "tracking loss must not confirm any physical or projected contact");
        }

        static string ResolveEditorStorageDirectory(string fallback)
        {
            var resolver = typeof(QuestConnection).GetMethod("ResolveEditorStorageDirectory",
                BindingFlags.Static | BindingFlags.NonPublic);
            Assert.That(resolver, Is.Not.Null);
            return (string)resolver.Invoke(null, new object[] { fallback });
        }

        [Test]
        public void EditorStorageResolverUsesQualifiedDirectoryAndKeepsDefaultWhenUnset()
        {
            const string variable = "KREODA_EDITOR_DATA_DIR";
            var previous = Environment.GetEnvironmentVariable(variable);
            var root = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "..", ".codex", "tmp"));
            try
            {
                Assert.That(Directory.Exists(root), Is.True);
                Environment.SetEnvironmentVariable(variable, root);
                Assert.That(ResolveEditorStorageDirectory("fallback"), Is.EqualTo(root));
                Environment.SetEnvironmentVariable(variable, null);
                Assert.That(ResolveEditorStorageDirectory("fallback"), Is.EqualTo("fallback"));
            }
            finally { Environment.SetEnvironmentVariable(variable, previous); }
        }

        [Test]
        public void EditorStorageResolverRejectsRelativeAndMissingDirectories()
        {
            const string variable = "KREODA_EDITOR_DATA_DIR";
            var previous = Environment.GetEnvironmentVariable(variable);
            var absent = Path.Combine(Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "..")),
                ".codex", "g1", "missing-editor-data");
            try
            {
                Environment.SetEnvironmentVariable(variable, ".codex/tmp");
                var relative = Assert.Throws<TargetInvocationException>(() => ResolveEditorStorageDirectory("fallback"));
                Assert.That(relative.InnerException, Is.TypeOf<ArgumentException>());
                Environment.SetEnvironmentVariable(variable, absent);
                var missing = Assert.Throws<TargetInvocationException>(() => ResolveEditorStorageDirectory("fallback"));
                Assert.That(missing.InnerException, Is.TypeOf<ArgumentException>());
            }
            finally { Environment.SetEnvironmentVariable(variable, previous); }
        }

        static QuestButton ActionButton(Transform page, string id) =>
            page.GetComponentsInChildren<QuestButton>(true).Single(button => button.ActionId == id);

        [Test]
        public void ExplicitMetaRoomDiscoveryButtonsAreRealClickableDisplayActions()
        {
            var displayPage = _root.GetComponentsInChildren<Transform>(true)
                .Single(page => page.name == "Display controls");
            Call("Page", displayPage);
            // An SDK scene query or consent prompt must never be launched by
            // merely opening the view / constructing the UI.
            Assert.That(_root.GetComponentsInChildren<QuestRoomSurfaceProvider>(true), Is.Empty);
            foreach (var actionId in new[] { "Rileva tavolo", "Configura stanza" })
            {
                var button = ActionButton(displayPage, actionId);
                Assert.That(button.Click, Is.Not.Null, actionId);
                Assert.That(button.gameObject.activeInHierarchy, Is.True, actionId);
                Assert.That(button.GetComponent<BoxCollider>().enabled, Is.True, actionId);
            }
            // This invocation is intentionally from the *actual* panel button,
            // not a direct provider instance or an unreferenced test helper.
            Assert.DoesNotThrow(() => ActionButton(displayPage, "Rileva tavolo").Click());
            Assert.DoesNotThrow(() => ActionButton(displayPage, "Configura stanza").Click());
            Assert.That(_controls.Connection.DisplayRoot, Is.Not.Null);
        }

        [Test]
        public void VisibleRoomButtonsAndExistingPlacementButtonsOwnUnobstructedPhysicalRayTargets()
        {
            var page = _root.GetComponentsInChildren<Transform>(true)
                .Single(item => item.name == "Display controls");
            Call("Page", page);
            Physics.SyncTransforms();
            var labels = new[] { "MR / VR", "Mano Auto", "Rileva tavolo", "Configura stanza", "Posiziona", "Centra CAD" };
            foreach (var action in labels)
            {
                var target = ActionButton(page, action);
                var collider = target.GetComponent<BoxCollider>();
                Assert.That(target.gameObject.activeInHierarchy, Is.True, action);
                Assert.That(collider.enabled, Is.True, action);
                var normal = target.transform.forward;
                var ray = new Ray(collider.bounds.center + normal * .16f, -normal);
                Assert.That(Physics.Raycast(ray, out var hit, .40f, ~0, QueryTriggerInteraction.Ignore),
                    Is.True, action + " lacks a physical hit target");
                Assert.That(hit.collider, Is.SameAs(collider),
                    action + " is occluded by a neighboring action or decoration: " + hit.collider.name);
            }
        }

        [Test]
        public void ActualPlacementProducerUsesMetaRoomTableOnlyAfterExplicitDiscoveryAction()
        {
            var view = CreatePlacementFixture();
            var ray = new Ray(new Vector3(0, 1.4f, 0),
                (new Vector3(0, .8f, 1.1f) - new Vector3(0, 1.4f, 0)).normalized);
            var expectedContact = ray.GetPoint(.96f);
            var queries = 0;
            _controls.EditorRoomTableContact = _ =>
            {
                queries++;
                return new QuestRoomSurfaceProvider.SurfaceHit(Guid.NewGuid(), expectedContact, .96f);
            };
            Assert.That(_controls.Display.BeginPlacement(), Is.True);
            Physics.SyncTransforms();

            Assert.That(Call("UpdatePlacementFromPointer", ray, true, 0f), Is.EqualTo(true));
            Assert.That(queries, Is.Zero, "The SDK room provider must not be queried before the user clicks Rileva tavolo");
            Assert.That(_controls.Display.Status, Does.Contain("manuale"));

            var page = _root.GetComponentsInChildren<Transform>(true)
                .Single(item => item.name == "Display controls");
            ActionButton(page, "Rileva tavolo").Click();
            Assert.That(Call("UpdatePlacementFromPointer", ray, true, 22f), Is.EqualTo(true));
            Assert.That(queries, Is.EqualTo(1), "Actual tracked-pointer producer must consult the opted-in provider");
            Assert.That(Vector3.Distance(_controls.Connection.DisplayRoot.TransformPoint(PlacementContact(view)),
                expectedContact), Is.LessThan(.003f));
            Assert.That(_controls.Display.Status, Does.Contain("TABLE/DESK Meta"));
            _controls.Display.FreezePlacement();
            Assert.That(_controls.Display.ConfirmPlacement(true), Is.True);
            Assert.That(_controls.Display.ConfirmedProvenance, Is.EqualTo(QuestPlacementProvenance.MetaRoomTable));
            Assert.That(_controls.Display.Status, Does.Contain("da verificare"),
                "SDK semantic classification is not an on-head physical accuracy test");
        }

        [Test]
        public void MetaRoomTableNeverPassesNearerUiOrUnverifiedCollider()
        {
            var view = CreatePlacementFixture();
            var ray = new Ray(new Vector3(0, 1.4f, 0),
                (new Vector3(0, .8f, 1.1f) - new Vector3(0, 1.4f, 0)).normalized);
            var point = ray.GetPoint(1.15f);
            _controls.EditorRoomTableContact = _ =>
                new QuestRoomSurfaceProvider.SurfaceHit(Guid.NewGuid(), point, 1.15f);
            var page = _root.GetComponentsInChildren<Transform>(true)
                .Single(item => item.name == "Display controls");
            ActionButton(page, "Rileva tavolo").Click();
            Assert.That(_controls.Display.BeginPlacement(), Is.True);

            var blocker = GameObject.CreatePrimitive(PrimitiveType.Cube);
            blocker.transform.SetParent(_root.transform);
            blocker.transform.position = ray.GetPoint(.45f);
            blocker.transform.localScale = Vector3.one * .12f;
            blocker.AddComponent<QuestButton>().ActionId = "Front UI blocker";
            Physics.SyncTransforms();
            Assert.That(Call("UpdatePlacementFromPointer", ray, true, 0f), Is.EqualTo(false));
            Assert.That(_controls.Display.ConfirmPlacement(true), Is.False);

            blocker.SetActive(false);
            var unverifiedSurface = GameObject.CreatePrimitive(PrimitiveType.Cube);
            unverifiedSurface.transform.SetParent(_root.transform);
            unverifiedSurface.transform.position = ray.GetPoint(.66f);
            unverifiedSurface.transform.localScale = new Vector3(.45f, .1f, .45f);
            // Test the actual downward-facing ray and upward Cube top face.
            Physics.SyncTransforms();
            Assert.That(Call("UpdatePlacementFromPointer", ray, true, 0f), Is.EqualTo(true));
            Assert.That(_controls.Display.Status, Does.Contain("collider"));
            Assert.That(_controls.Display.Status, Does.Contain("tavolo non verificato"));
            _controls.Display.FreezePlacement();
            Assert.That(_controls.Display.ConfirmPlacement(true), Is.True);
            Assert.That(_controls.Display.ConfirmedProvenance,
                Is.EqualTo(QuestPlacementProvenance.ColliderUnverified));
            Assert.That(view, Is.Not.Null);
        }

        [Test]
        public void DirectFacePageShowsOneEditableGroupAndRealContextGatedButtons()
        {
            var page = (Transform)typeof(QuestControls).GetField("_directFaceHistoryPage", Private).GetValue(_controls);
            var commandPage = (Transform)typeof(QuestControls).GetField("_commandPage", Private).GetValue(_controls);
            Assert.That(_controls.DirectFaceHistory, Is.Not.Null);
            Assert.That(page.gameObject.activeSelf, Is.False);

            Call("OpenDirectFaceHistory");
            Assert.That(page.gameObject.activeSelf, Is.True);
            Assert.That(commandPage.gameObject.activeSelf, Is.False);
            Assert.That(page.GetComponentsInChildren<QuestButton>(true).Count(button => button.ActionId == "Campo →"), Is.EqualTo(1));
            Assert.That(page.GetComponentsInChildren<QuestButton>(true).Count(button => button.ActionId == "Valore"), Is.EqualTo(1));
            Assert.That(page.GetComponentsInChildren<TextMesh>(true).Any(text => text.text.Contains("tx") || text.text.Contains("py")), Is.False,
                "the direct-face panel shows one field at a time instead of a nine-value wall");

            Call("RefreshContextualActions", new object[] { System.Array.Empty<DiscoveredSessionPc>() });
            Assert.That(ActionButton(page, "Acquisisci sorgente").GetComponent<Collider>().enabled, Is.False);
            Assert.That(ActionButton(page, "Acquisisci supporto").GetComponent<Collider>().enabled, Is.False);
            Assert.That(ActionButton(page, "Applica").GetComponent<Collider>().enabled, Is.False);

            Call("Page", commandPage);
            Assert.That(page.gameObject.activeSelf, Is.False);
            Assert.That(commandPage.gameObject.activeSelf, Is.True);
        }

        [Test]
        public void AssemblyMatesPageRoutesToDirectFaceHistoryAndBack()
        {
            var page = (Transform)typeof(QuestControls).GetField("_directFaceHistoryPage", Private).GetValue(_controls);
            var matesPage = (Transform)typeof(QuestControls).GetField("_assemblyMatesPage", Private).GetValue(_controls);
            var commandPage = (Transform)typeof(QuestControls).GetField("_commandPage", Private).GetValue(_controls);

            Call("OpenAssemblyMates");
            Assert.That(matesPage.gameObject.activeSelf, Is.True);
            ActionButton(matesPage, "Facce dirette").Click();
            Assert.That(page.gameObject.activeSelf, Is.True);
            Assert.That(matesPage.gameObject.activeSelf, Is.False);

            ActionButton(page, "Indietro").Click();
            Assert.That(matesPage.gameObject.activeSelf, Is.True);
            ActionButton(matesPage, "Indietro").Click();
            Assert.That(commandPage.gameObject.activeSelf, Is.True);
        }

        [Test]
        public void OperationalScreensRenderOneCompactSummaryWithoutDecorativeDuplicateLayers()
        {
            var fields = new[] { "_pcPage", "_connectionPage", "_homeNoticePage", "_configurationPage",
                "_viewPage", "_metricsPage", "_sectionPage", "_editPage", "_commandPage",
                "_referencePage", "_sketchPage", "_voicePage", "_voiceContextPage" };
            var focus = (System.Collections.IDictionary)typeof(QuestControls)
                .GetField("_domainFocus", Private).GetValue(_controls);
            var panels = (System.Collections.IDictionary)typeof(QuestControls)
                .GetField("_measuredPanels", Private).GetValue(_controls);
            Assert.That(focus.Count, Is.EqualTo(13));
            Assert.That(panels.Count, Is.EqualTo(39));
            var referenceTitle = (TextMesh)typeof(QuestControls).GetField("_referenceTitle", Private).GetValue(_controls);
            Assert.That(referenceTitle.GetComponent<MeshRenderer>().enabled, Is.False,
                "the legacy reference title must not overlap the live page summary");

            foreach (var field in fields)
            {
                var page = (Transform)typeof(QuestControls).GetField(field, Private).GetValue(_controls);
                Call("Page", page);
                var entry = focus[page];
                var stage = (QuestUi.LiveFocusStage)entry.GetType().GetField("Stage").GetValue(entry);
                Assert.That(stage.Root.GetComponentsInChildren<MeshRenderer>(true)
                    .Count(renderer => renderer.enabled && renderer.GetComponent<MeshFilter>() != null), Is.EqualTo(2),
                    page.name + " summary should use one glass surface and one blue edge");
                Assert.That(page.GetComponentsInChildren<Transform>(true)
                    .Any(item => item.name.EndsWith(" summary")), Is.False,
                    page.name + " must not repeat summary in a footer card");

                foreach (System.Collections.DictionaryEntry item in panels)
                {
                    var panel = (QuestUi.OperationPanel)item.Value;
                    if (panel.Root.parent != page || !panel.Root.gameObject.activeInHierarchy) continue;
                    var headerText = panel.Root.GetComponentsInChildren<TextMesh>(true)
                        .Where(text => text.gameObject.activeInHierarchy &&
                            text.GetComponent<MeshRenderer>() != null && text.GetComponent<MeshRenderer>().enabled &&
                            !text.transform.IsChildOf(panel.Content))
                        .ToArray();
                    Assert.That(headerText, Has.Length.EqualTo(1),
                        page.name + " / " + panel.Root.name + " should show one heading, no fact stack");
                }

                foreach (var button in page.GetComponentsInChildren<QuestButton>(true))
                {
                    Assert.That(button.Click, Is.Not.Null, page.name + " / " + button.ActionId);
                    Assert.That(button.transform.parent.GetComponentsInChildren<MeshRenderer>(true)
                        .Count(renderer => renderer.enabled && renderer.GetComponent<MeshFilter>() != null),
                        Is.EqualTo(2), page.name + " / " + button.ActionId + " should use only glass and state edge");
                }
            }
        }

        [Test]
        public void ResultAndVoiceDetailsAreNotRepeatedOnNavigationButtons()
        {
            var notice = (TextMesh)typeof(QuestControls).GetField("_homeNotice", Private).GetValue(_controls);
            notice.text = "Minimo rilevato 10 mm\n128/128 misure · 6/6 facce\nCampionato · minimo globale non garantito";
            foreach (var field in new[] { "_homeNoticePage", "_voicePage" })
            {
                var page = (Transform)typeof(QuestControls).GetField(field, Private).GetValue(_controls);
                Call("Page", page);
                Call("Update");
                var visibleText = page.GetComponentsInChildren<TextMesh>(false)
                    .Where(text => text.GetComponent<MeshRenderer>().enabled).ToArray();
                var prefix = field == "_homeNoticePage" ? "Minimo rilevato" : "Voce non configurata";
                Assert.That(visibleText.Count(text => text.text.StartsWith(prefix)), Is.EqualTo(1), field);
            }
            var view = (Transform)typeof(QuestControls).GetField("_viewPage", Private).GetValue(_controls);
            Call("Page", view);
            Call("Update");
            var fit = ActionButton(view, "Fit");
            var detail = fit.transform.parent.Find("Operation detail");
            Assert.That(detail == null || !detail.gameObject.activeSelf, Is.True,
                "Fit must not repeat its own label as a second line");
        }

        [Test]
        public void OfflineLegacyVoiceCandidateShowsWaitingAndKeepsTalkUnavailable()
        {
            var voice = _controls.Voice;
            Assert.That(voice.Configure("http://127.0.0.1:9843", "original-private-token", false), Is.True);
            Assert.That(voice.Configured, Is.False, "an offline legacy candidate must not become an active provider");

            var page = (Transform)typeof(QuestControls).GetField("_voicePage", Private).GetValue(_controls);
            Call("Page", page);
            Call("Update");

            var action = ActionButton(page, "Parla / Invia");
            Assert.That(action.GetComponent<BoxCollider>().enabled, Is.False,
                "the real microphone action stays disabled without a bound, ready provider");
            Assert.That(action.Click, Is.Not.Null, "the original action remains wired to QuestVoice.Toggle");

            var focuses = (IDictionary)typeof(QuestControls).GetField("_domainFocus", Private).GetValue(_controls);
            var focus = focuses[page];
            var stage = (QuestUi.LiveFocusStage)focus.GetType().GetField("Stage").GetValue(focus);
            Assert.That(stage.Value.text, Is.EqualTo("HERMES IN ATTESA"));
            Assert.That(stage.Value.text, Is.Not.EqualTo("Pronto"));

            var status = (TextMesh)typeof(QuestControls).GetField("_voiceStatus", Private).GetValue(_controls);
            Assert.That(status.text, Is.EqualTo(voice.Status));
            Assert.That(status.text, Does.Contain("PC non connesso"));

            var labels = (IDictionary)typeof(QuestControls).GetField("_contextActions", Private).GetValue(_controls);
            var label = (TextMesh)((IDictionary)labels[page])["Parla / Invia"];
            var detail = label.transform.parent.Find("Operation detail");
            Assert.That(detail, Is.Not.Null);
            Assert.That(detail.GetComponent<TextMesh>().text, Is.EqualTo("IN ATTESA"));
            var cards = (IDictionary)typeof(QuestControls).GetField("_largeCardSnapshots", Private).GetValue(_controls);
            Assert.That(cards[label].ToString(), Does.StartWith("IN ATTESA|"));
        }

        [Test]
        public void VoiceContextRouteKeepsCollectionExplicitUntilSingleSelectionIsChosen()
        {
            var voicePage = (Transform)typeof(QuestControls).GetField("_voicePage", Private).GetValue(_controls);
            var contextPage = (Transform)typeof(QuestControls).GetField("_voiceContextPage", Private).GetValue(_controls);
            var context = _root.GetComponent<QuestVoiceContext>();
            Assert.That(context, Is.Not.Null);
            Assert.That(context.ExplicitMode, Is.False);

            ActionButton(voicePage, "Contesto").Click();
            Assert.That(contextPage.gameObject.activeSelf, Is.True);
            Assert.That(voicePage.gameObject.activeSelf, Is.False);
            Assert.That(context.ExplicitMode, Is.True);
            foreach (var id in new[] { "Arma punto", "Cancella", "Raccolta voce", "Voce singola" })
                Assert.That(ActionButton(contextPage, id).Click, Is.Not.Null, id);

            ActionButton(contextPage, "Cancella").Click();
            Assert.That(context.ExplicitMode, Is.True, "clear must not enable the implicit current-selection fallback");
            Assert.That(context.Count, Is.Zero);
            Assert.That(_controls.SelectionForVoice(), Is.Empty);

            ActionButton(contextPage, "Raccolta voce").Click();
            Assert.That(voicePage.gameObject.activeSelf, Is.True);
            Assert.That(context.ExplicitMode, Is.True, "returning to voice keeps the explicit collection mode");

            ActionButton(voicePage, "Contesto").Click();
            ActionButton(contextPage, "Voce singola").Click();
            Assert.That(context.ExplicitMode, Is.False);
            Assert.That(voicePage.gameObject.activeSelf, Is.True);
        }

        [Test]
        public void HiddenVoiceContextPageDoesNotConsumeWorldGeometryClicks()
        {
            var voicePage = (Transform)typeof(QuestControls).GetField("_voicePage", Private).GetValue(_controls);
            var contextPage = (Transform)typeof(QuestControls).GetField("_voiceContextPage", Private).GetValue(_controls);
            ActionButton(voicePage, "Contesto").Click();
            Assert.That(contextPage.gameObject.activeInHierarchy, Is.True);

            Call("TogglePanel");
            Assert.That(contextPage.gameObject.activeSelf, Is.True, "the hidden page keeps its last route");
            Assert.That(contextPage.gameObject.activeInHierarchy, Is.False, "the parent panel is hidden");
            Assert.That(Call("CaptureVoiceCollectionHit", null, null, -1, Vector3.zero, false, null), Is.False,
                "a hidden context page must not intercept a CAD click");
        }

        [Test]
        public void BusySpatialEditStillRefreshesExistingComposedCardAndLiveFocus()
        {
            var spatial = _root.AddComponent<QuestSpatialEdit>();
            spatial.Connection = _controls.Connection;
            _controls.Spatial = spatial;
            var page = (Transform)typeof(QuestControls).GetField("_editPage", Private).GetValue(_controls);
            Call("Page", page);
            var worker = typeof(QuestSpatialEdit).GetField("_worker", Private);
            var cardCache = (System.Collections.IDictionary)typeof(QuestControls)
                .GetField("_largeCardSnapshots", Private).GetValue(_controls);
            var focuses = (System.Collections.IDictionary)typeof(QuestControls)
                .GetField("_domainFocus", Private).GetValue(_controls);
            var focus = focuses[page];
            var snapshot = focus.GetType().GetField("LastSnapshot");
            var original = ActionButton(page, "Valore esatto");
            var click = original.Click;
            try
            {
                // Only simulate the worker's presence; no CAD IPC, task execution or fake telemetry.
                worker.SetValue(spatial, System.Runtime.Serialization.FormatterServices
                    .GetUninitializedObject(worker.FieldType));
                Assert.That(spatial.Busy, Is.True);
                cardCache.Clear();
                snapshot.SetValue(focus, null);
                Call("Update");
                Assert.That(cardCache.Count, Is.GreaterThan(0),
                    "Busy must not bypass the real composed action state refresh");
                Assert.That(snapshot.GetValue(focus), Is.Not.Null,
                    "Busy must not bypass the live domain focus refresh");
                Assert.That(original.Click, Is.SameAs(click));
            }
            finally { worker.SetValue(spatial, null); }
        }

        [Test]
        public void LiveFocusReevaluatesSameActionWhenAvailabilityChangesWithoutReplacingItsCallback()
        {
            var page = (Transform)typeof(QuestControls).GetField("_homeNoticePage", Private).GetValue(_controls);
            Call("Page", page);
            var action = ActionButton(page, "Torna a Home");
            var originalClick = action.Click;
            var originalCollider = action.GetComponent<BoxCollider>();
            var stages = (System.Collections.IDictionary)typeof(QuestControls)
                .GetField("_domainFocus", Private).GetValue(_controls);
            var focus = stages[page];
            var snapshot = focus.GetType().GetField("LastSnapshot");
            Call("SetContextAction", page, "Torna a Home", true, false, QuestUi.StatusSeverity.Active);
            Call("RefreshDomainFocusStages");
            var enabledSnapshot = (string)snapshot.GetValue(focus);
            Assert.That(enabledSnapshot, Is.Not.Null.And.Not.Empty);
            Assert.That(originalCollider.enabled, Is.True);
            Call("SetContextAction", page, "Torna a Home", false, false, QuestUi.StatusSeverity.Warning);
            Call("RefreshDomainFocusStages");
            var disabledSnapshot = (string)snapshot.GetValue(focus);
            Assert.That(disabledSnapshot, Is.Not.EqualTo(enabledSnapshot),
                "availability must invalidate hero focus even when service text is unchanged");
            Assert.That(originalCollider.enabled, Is.False);
            Assert.That(action.Click, Is.SameAs(originalClick));
            Assert.That(page.GetComponentsInChildren<QuestButton>(true).Count(b => b.ActionId == "Torna a Home"),
                Is.EqualTo(1));
        }

        [Test]
        public void ThirteenLiveFocusStagesHaveDistinctDomainsAndNeverOwnRayTargets()
        {
            var stages = (System.Collections.IDictionary)typeof(QuestControls)
                .GetField("_domainFocus", Private).GetValue(_controls);
            Assert.That(stages.Count, Is.EqualTo(13));
            var kinds = new System.Collections.Generic.HashSet<string>();
            foreach (System.Collections.DictionaryEntry entry in stages)
            {
                var page = (Transform)entry.Key;
                var focus = entry.Value;
                var type = focus.GetType();
                kinds.Add(type.GetField("Kind").GetValue(focus).ToString());
                var stage = (QuestUi.LiveFocusStage)type.GetField("Stage").GetValue(focus);
                Assert.That(stage, Is.Not.Null, page.name);
                Assert.That(stage.Root.parent, Is.SameAs(page));
                Assert.That(stage.Root.GetComponentsInChildren<QuestButton>(true), Is.Empty);
                Assert.That(stage.Root.GetComponentsInChildren<Collider>(true).Any(c => c.enabled), Is.False);
                var backing = stage.Root.GetComponentsInChildren<MeshFilter>(true)
                    .Single(filter => filter.name.EndsWith(" focus backing"));
                Assert.That(backing.transform.localScale.x, Is.EqualTo(.394f).Within(.0001f));
                Assert.That(backing.transform.localScale.y, Is.EqualTo(.105f).Within(.0001f));
                var bounds = PageRect(page, backing.transform, Vector3.zero, Vector3.one);
                foreach (var hit in page.GetComponentsInChildren<QuestButton>(true))
                {
                    var collider = hit.GetComponent<BoxCollider>();
                    if (collider == null || !collider.enabled) continue;
                    var rect = PageRect(page, collider.transform, collider.center, collider.size);
                    Assert.That(bounds.Overlaps(rect), Is.False,
                        page.name + " stage overlays action " + hit.ActionId);
                }
                stage.SetData("CURRENT DOMAIN", "Live model state", "No estimated telemetry",
                    QuestUi.StatusSeverity.Warning);
                Assert.That(stage.Value.text, Is.EqualTo("Live model state"));
                Assert.That(stage.Side.text, Is.EqualTo("No estimated telemetry"));
                Assert.That(stage.Value.transform.IsChildOf(stage.Root), Is.True);
            }
            Assert.That(kinds.Count, Is.EqualTo(13), "each page must own a different domain grammar");
        }

        [Test]
        public void DisabledInstrumentLayersPreserveOriginalWorkstationCommands()
        {
            var instruments = (System.Collections.IDictionary)typeof(QuestControls)
                .GetField("_actionInstruments", Private).GetValue(_controls);
            var pages = new[] { "_pcPage", "_connectionPage", "_homeNoticePage", "_configurationPage",
                "_viewPage", "_metricsPage", "_sectionPage", "_editPage", "_commandPage",
                "_referencePage", "_sketchPage", "_voicePage", "_voiceContextPage" };
            var kinds = new System.Collections.Generic.HashSet<string>();
            foreach (var field in pages)
            {
                var page = (Transform)typeof(QuestControls).GetField(field, Private).GetValue(_controls);
                var bound = instruments.Keys.Cast<TextMesh>()
                    .Where(label => label != null && label.transform.IsChildOf(page)).ToArray();
                Assert.That(bound.Length, Is.GreaterThan(0), field + " must build functional instruments");
                foreach (var label in bound)
                {
                    var group = label.transform.parent;
                    var button = group.GetComponentsInChildren<QuestButton>(true);
                    Assert.That(button, Has.Length.EqualTo(1), field + " instrument must reuse one command");
                    Assert.That(button[0].Click, Is.Not.Null);
                    Assert.That(group.GetComponentsInChildren<Collider>(true).Count(c => c.enabled),
                        Is.LessThanOrEqualTo(1), field + " visual instrument cannot steal raycast");
                    var instrument = instruments[label];
                    kinds.Add(instrument.GetType().GetField("Kind").GetValue(instrument).ToString());
                    foreach (var member in new[] { "Track", "Fill", "Marker", "Secondary" })
                    {
                        var visual = (Transform)instrument.GetType().GetField(member).GetValue(instrument);
                        var renderer = visual != null ? visual.GetComponent<MeshRenderer>() : null;
                        Assert.That(renderer == null || !renderer.enabled, Is.True,
                            field + " duplicate instrument renderer " + member + " must stay hidden");
                    }
                }
            }
            Assert.That(kinds.Count, Is.GreaterThanOrEqualTo(10),
                "12 workflows require task-specific composed visual instruments");
        }

        [Test]
        public void DiagnosticInstrumentNeverFabricatesMeasurementAndPreservesRealAction()
        {
            var page = (Transform)typeof(QuestControls).GetField("_metricsPage", Private).GetValue(_controls);
            Call("Page", page);
            var button = ActionButton(page, "Torna a Vista");
            var labels = (System.Collections.IDictionary)typeof(QuestControls)
                .GetField("_contextActions", Private).GetValue(_controls);
            var local = (System.Collections.IDictionary)labels[page];
            var label = (TextMesh)local["Torna a Vista"];
            var instruments = (System.Collections.IDictionary)typeof(QuestControls)
                .GetField("_actionInstruments", Private).GetValue(_controls);
            var instrument = instruments[label];
            var track = (Transform)instrument.GetType().GetField("Track").GetValue(instrument);
            var fill = (Transform)instrument.GetType().GetField("Fill").GetValue(instrument);
            var callback = button.Click;
            Call("SetDomainActionCard", page, "Torna a Vista", "RTT assente", false, true, 0, -1f);
            Assert.That(track.gameObject.activeSelf, Is.False);
            Assert.That(fill.gameObject.activeSelf, Is.False);
            Call("SetDomainActionCard", page, "Torna a Vista", "RTT misurato", false, true, 0, .5f);
            Assert.That(track.gameObject.activeSelf, Is.True);
            Assert.That(fill.gameObject.activeSelf, Is.True);
            Assert.That(fill.localScale.x, Is.GreaterThan(0f).And.LessThanOrEqualTo(track.localScale.x));
            Assert.That(button.Click, Is.SameAs(callback));
        }

        [Test]
        public void ActionDataCardChangesRailAndAvailabilityWithoutReplacingRealCommand()
        {
            var page = (Transform)typeof(QuestControls).GetField("_connectionPage", Private).GetValue(_controls);
            Call("Page", page);
            var action = ActionButton(page, "Corpo");
            var group = action.transform.parent;
            var label = group.GetComponentsInChildren<TextMesh>(true)
                .Single(t => t.name != "Operation detail");
            var originalTitle = label.text;
            var originalClick = action.Click;
            var collider = action.GetComponent<BoxCollider>();
            var rail = group.Find("Operation semantic rail");
            Assert.That(rail, Is.Not.Null);

            QuestUi.SetActionDataCard(label, "CAD body selected", true, true,
                QuestUi.StatusSeverity.Active);
            var selectedHeight = rail.localScale.y;
            Assert.That(collider.enabled, Is.True);
            Assert.That(label.text, Is.EqualTo(originalTitle));
            Assert.That(action.Click, Is.SameAs(originalClick));

            QuestUi.SetActionDataCard(label, "CAD unavailable", false, false,
                QuestUi.StatusSeverity.Warning);
            Assert.That(rail.localScale.y, Is.LessThan(selectedHeight));
            Assert.That(collider.enabled, Is.False);
            Assert.That(group.GetComponentsInChildren<QuestButton>(true), Has.Length.EqualTo(1));
            Assert.That(group.GetComponentsInChildren<Collider>(true).Count(c => c.enabled), Is.Zero);
            Assert.That(label.text, Is.EqualTo(originalTitle));
            Assert.That(action.Click, Is.SameAs(originalClick));
        }

        [Test]
        public void CompactActionDetailDoesNotProduceUnreadableSecondaryText()
        {
            var page = (Transform)typeof(QuestControls).GetField("_viewPage", Private).GetValue(_controls);
            var action = ActionButton(page, "+5");
            var label = action.transform.parent.GetComponentsInChildren<TextMesh>(true)
                .Single(t => t.name != "Operation detail");
            QuestUi.SetActionDataCard(label, "Very long dynamic operation description", false, true,
                QuestUi.StatusSeverity.Neutral);
            var detail = action.transform.parent.Find("Operation detail");
            Assert.That(detail == null || !detail.gameObject.activeSelf ||
                detail.GetComponent<TextMesh>().text.Length < "Very long dynamic operation description".Length,
                Is.True, "small action must suppress or truncate secondary detail");
            Assert.That(action.GetComponent<Collider>().enabled, Is.True);
        }

        [Test]
        public void ActiveWorkflowButtonsAreOnlyRaycastableSurfacesInsideTheirPanel()
        {
            var panels = (System.Collections.IDictionary)typeof(QuestControls)
                .GetField("_measuredPanels", Private).GetValue(_controls);
            Assert.That(panels.Count, Is.GreaterThan(0));
            foreach (System.Collections.DictionaryEntry entry in panels)
            {
                var panel = (QuestUi.OperationPanel)entry.Value;
                var buttons = panel.Content.GetComponentsInChildren<QuestButton>(true);
                Assert.That(buttons.Length, Is.GreaterThan(0), entry.Key.ToString());
                foreach (var button in buttons)
                {
                    Assert.That(button.transform.IsChildOf(panel.Content), Is.True, button.ActionId);
                    var hit = button.GetComponent<BoxCollider>();
                    Assert.That(hit, Is.Not.Null, button.ActionId);
                    Assert.That(button.Click, Is.Not.Null, button.ActionId + " must retain a real callback");
                    var inGroup = button.transform.parent.GetComponentsInChildren<Collider>(true);
                    Assert.That(inGroup.Count(c => c.enabled), Is.LessThanOrEqualTo(1),
                        button.ActionId + " must not compete with a decorative ray target");
                }
                foreach (var collider in panel.Root.GetComponentsInChildren<Collider>(true))
                {
                    if (collider.GetComponent<QuestButton>() != null) continue;
                    Assert.That(collider.enabled, Is.False,
                        entry.Key + " decorative surface blocks a ray: " + collider.name);
                }
            }
        }

        [Test]
        public void LiveDomainFactHeadersStayClearOfTheirOwnActionHitTargets()
        {
            var panels = (System.Collections.IDictionary)typeof(QuestControls)
                .GetField("_measuredPanels", Private).GetValue(_controls);
            Assert.That(panels.Count, Is.EqualTo(39));
            foreach (System.Collections.DictionaryEntry entry in panels)
            {
                var panel = (QuestUi.OperationPanel)entry.Value;
                panel.SetDomainFacts("IDENTITA", "Sessione corrente", "STATO", "In attesa",
                    QuestUi.StatusSeverity.Warning);
                var fact = (TextMesh)typeof(QuestUi.OperationPanel).GetField("_secondaryFact", Private)
                    .GetValue(panel);
                var headingTexts = new[] { panel.Heading, panel.ReadoutLabel, panel.ReadoutValue, fact };
                foreach (var button in panel.Content.GetComponentsInChildren<QuestButton>(true))
                {
                    if (!button.gameObject.activeInHierarchy) continue;
                    var hit = button.GetComponent<BoxCollider>();
                    if (hit == null || !hit.enabled) continue;
                    var bounds = PageRect(panel.Root, hit.transform, hit.center, hit.size);
                    foreach (var label in headingTexts)
                    {
                        if (label == null || string.IsNullOrWhiteSpace(label.text)) continue;
                        var renderer = label.GetComponent<MeshRenderer>();
                        if (renderer == null || !renderer.enabled) continue;
                        var textBounds = renderer.bounds;
                        if (textBounds.size.sqrMagnitude == 0f) continue;
                        var local = WorldBoundsPageRect(panel.Root, textBounds);
                        var xOverlap = Mathf.Min(bounds.xMax, local.xMax) - Mathf.Max(bounds.xMin, local.xMin);
                        var yOverlap = Mathf.Min(bounds.yMax, local.yMax) - Mathf.Max(bounds.yMin, local.yMin);
                        Assert.That(xOverlap <= .001f || yOverlap <= .001f, Is.True,
                            entry.Key + " text " + label.name + " overlaps command " + button.ActionId);
                    }
                }
            }
        }

        [Test]
        public void SectionPanelShowsOneHeadingWithoutDuplicateLiveFacts()
        {
            var page = (Transform)typeof(QuestControls).GetField("_sectionPage", Private).GetValue(_controls);
            Call("Page", page);
            var panels = (System.Collections.IDictionary)typeof(QuestControls).GetField("_measuredPanels", Private).GetValue(_controls);
            foreach (var panel in panels.Values.Cast<QuestUi.OperationPanel>().Where(item => item.Root.parent == page))
            {
                panel.Heading.text = "SUPERFICI E BANDE";
                panel.SetDomainFacts("VERSO NORMALE", "Non definito", "QUOTA CAD", "Non definita", QuestUi.StatusSeverity.Warning);
            }
            Call("LateUpdate");
            foreach (var panel in panels.Values.Cast<QuestUi.OperationPanel>().Where(item => item.Root.parent == page))
            {
                Assert.That(panel.Heading.text, Is.EqualTo("SUPERFICI E BANDE"));
                Assert.That(panel.ReadoutLabel, Is.Null, panel.Root.name + " must not repeat live facts in its header");
                Assert.That(panel.Root.GetComponentsInChildren<TextMesh>(true)
                    .Where(text => !text.transform.IsChildOf(panel.Content))
                    .Count(text => text.gameObject.activeInHierarchy && text.GetComponent<MeshRenderer>().enabled),
                    Is.EqualTo(1), panel.Root.name + " must render one header line");
            }
        }

        static Rect WorldBoundsPageRect(Transform page, Bounds world)
        {
            var min = new Vector2(float.PositiveInfinity, float.PositiveInfinity);
            var max = new Vector2(float.NegativeInfinity, float.NegativeInfinity);
            for (var x = -1; x <= 1; x += 2)
            for (var y = -1; y <= 1; y += 2)
            for (var z = -1; z <= 1; z += 2)
            {
                var point = page.InverseTransformPoint(world.center +
                    Vector3.Scale(world.extents, new Vector3(x, y, z)));
                min = Vector2.Min(min, new Vector2(point.x, point.y));
                max = Vector2.Max(max, new Vector2(point.x, point.y));
            }
            return Rect.MinMaxRect(min.x, min.y, max.x, max.y);
        }

        [Test]
        public void ReferenceModalTransitionHidesInactiveCommandsAndTheirFunctionalPanels()
        {
            Call("OpenReferences");
            var page = (Transform)typeof(QuestControls).GetField("_referencePage", Private).GetValue(_controls);
            var references = _controls.References;
            var mode = typeof(QuestReferences).GetField("_mode", Private);
            Call("RefreshReferencePage");
            Assert.That(ActionButton(page, "Nuovo piano").gameObject.activeInHierarchy, Is.True);
            Assert.That(ActionButton(page, "Conferma").gameObject.activeInHierarchy, Is.False);

            mode.SetValue(references, System.Enum.Parse(mode.FieldType, "Form"));
            typeof(QuestReferences).GetField("_schemaReady", Private).SetValue(references, false);
            Call("RefreshReferencePage");
            Assert.That(ActionButton(page, "Nuovo piano").gameObject.activeInHierarchy, Is.False);
            Assert.That(ActionButton(page, "Conferma").gameObject.activeInHierarchy, Is.False,
                "a loading schema must not expose an actionable confirmation");
            Assert.That(ActionButton(page, "Annulla").gameObject.activeInHierarchy, Is.True,
                "a pending form must retain its actual cancel escape route");

            typeof(QuestReferences).GetField("_schemaReady", Private).SetValue(references, true);
            Call("RefreshReferencePage");
            Assert.That(ActionButton(page, "Conferma").gameObject.activeInHierarchy, Is.True);
            Assert.That(ActionButton(page, "Nuovo piano").gameObject.activeInHierarchy, Is.False);
            foreach (var button in page.GetComponentsInChildren<QuestButton>(true))
                if (!button.transform.parent.gameObject.activeSelf)
                    Assert.That(button.gameObject.activeInHierarchy, Is.False,
                        "hidden modal commands must not be raycastable: " + button.ActionId);
        }

        [Test]
        public void LiveActionDetailPreservesOriginalHitTargetAndDisabledState()
        {
            var page = (Transform)typeof(QuestControls).GetField("_connectionPage", Private).GetValue(_controls);
            Call("Page", page);
            var button = page.GetComponentsInChildren<QuestButton>(true)
                .OrderByDescending(item => item.transform.localScale.x * item.transform.localScale.y).First();
            var group = button.transform.parent;
            var label = group.GetComponentsInChildren<TextMesh>(true)
                .Single(text => text.name != "Operation detail");
            var collider = button.GetComponent<BoxCollider>();
            QuestUi.SetOperationActionState(label, false, false);
            Assert.That(collider.enabled, Is.False);
            QuestUi.SetActionDetail(label, "Selezione CAD non disponibile", QuestUi.StatusSeverity.Warning);
            Assert.That(group.GetComponentsInChildren<QuestButton>(true).Length, Is.EqualTo(1));
            foreach (var decoration in group.GetComponentsInChildren<Collider>(true).Where(item => item != collider))
                Assert.That(decoration.enabled, Is.False, "decorative colliders must never receive rays");
            Assert.That(collider.enabled, Is.False, "detail must not revive a disabled action");
            var detail = group.Find("Operation detail");
            Assert.That(detail, Is.Not.Null);
            Assert.That(detail.GetComponent<TextMesh>().text, Is.Not.Empty);
            Assert.That(detail.parent, Is.SameAs(group), "detail follows the original command group");
            QuestUi.SetActionDetail(label, "", QuestUi.StatusSeverity.Neutral);
            Assert.That(detail.gameObject.activeSelf, Is.False);
            Assert.That(collider.enabled, Is.False);
        }

        [Test]
        public void AllThirteenWorkstationsHaveRealLiveActionDetailBindings()
        {
            var pages = new[] { "_pcPage", "_connectionPage", "_homeNoticePage", "_configurationPage",
                "_viewPage", "_metricsPage", "_sectionPage", "_editPage", "_commandPage",
                "_referencePage", "_sketchPage", "_voicePage", "_voiceContextPage" };
            Call("RefreshLiveActionDetails", (object)System.Array.Empty<Kreoda.Session.DiscoveredSessionPc>());
            for (var i = 0; i < pages.Length; i++)
            {
                var field = pages[i];
                var page = (Transform)typeof(QuestControls).GetField(field, Private).GetValue(_controls);
                Assert.That(page, Is.Not.Null, field);
                Call("Page", page);
                Assert.That(page.GetComponentsInChildren<QuestButton>(true).Length, Is.GreaterThan(0), field);
                var command = page.GetComponentsInChildren<QuestButton>(true)
                    .Where(item => item.gameObject.activeInHierarchy)
                    .OrderByDescending(item => item.transform.localScale.x * item.transform.localScale.y).First();
                var originalClick = command.Click;
                Call("SetDomainActionCard", page, command.ActionId, "Actual session readout", false, true, 0, -1f);
                var detail = command.transform.parent.Find("Operation detail");
                if (command.transform.localScale.y >= .045f && command.transform.localScale.x >= .075f)
                {
                    Assert.That(detail, Is.Not.Null, field + " must bind legible detail to its actual command");
                    Assert.That(detail.GetComponent<TextMesh>().text, Is.Not.Empty);
                    Assert.That(detail.parent.GetComponentsInChildren<QuestButton>(true).Length,
                        Is.EqualTo(1), field + " live detail must share exactly one real command");
                }
                else Assert.That(detail == null || !detail.gameObject.activeSelf, Is.True,
                    field + " compact commands must retain one readable line; full facts belong to the panel");
                Assert.That(command.Click, Is.SameAs(originalClick));
            }
        }

        [Test]
        public void WorkflowDataWithoutMeasurementShowsOnlyRealDetailNotSyntheticGauge()
        {
            var panels = (System.Collections.IDictionary)typeof(QuestControls)
                .GetField("_measuredPanels", Private).GetValue(_controls);
            var panel = panels.Values.Cast<QuestUi.OperationPanel>().First();
            panel.SetRole(QuestUi.OperationPanelRole.ParameterEditor);
            panel.SetWorkflowData("SESSIONE", "nessuna", "Nessun dato acquisito", QuestUi.StatusSeverity.Warning);
            var track = (Renderer)typeof(QuestUi.OperationPanel).GetField("_dataTrack", Private)
                .GetValue(panel);
            var detail = (TextMesh)typeof(QuestUi.OperationPanel).GetField("_detail", Private)
                .GetValue(panel);
            Assert.That(detail, Is.Null);
            Assert.That(track, Is.Null, "the compact screen has no duplicate measured-value meter");
        }

        [Test]
        public void EveryConstructedFunctionalPanelUsesItsAuthoredSemanticRole()
        {
            const BindingFlags statics = BindingFlags.Static | BindingFlags.NonPublic;
            var zones = typeof(QuestControls).GetMethod("AuthoredZoneNames", statics);
            var role = typeof(QuestControls).GetMethod("AuthoredPanelRole", statics);
            var panels = (System.Collections.IDictionary)typeof(QuestControls)
                .GetField("_measuredPanels", Private).GetValue(_controls);
            var roleField = typeof(QuestUi.OperationPanel).GetField("_role", Private);
            Assert.That(roleField, Is.Not.Null);
            var authored = 0;
            foreach (var page in _root.GetComponentsInChildren<Transform>(true))
            {
                var names = page.GetComponentsInChildren<QuestButton>(true).Length == 0 ? null :
                    page.name == "PC locali" || page.name == "Advanced PC diagnostics" ||
                    page.name == "Home action status" || page.name == "CAD configurations" ||
                    page.name == "Display controls" || page.name == "Optional diagnostics" ||
                    page.name == "Section view" || page.name == "Exact CAD editing" ||
                    page.name == "Canonical context actions" || page.name == "Riferimenti CAD" ||
                    page.name == "Canonical sketch dimensions" || page.name == "Hermes voice" ||
                    page.name == "Contesto Hermes"
                        ? (string[])zones.Invoke(null, new object[] { page.name }) : null;
                if (names == null) continue;
                for (var index = 0; index < names.Length; index++)
                {
                    var key = page.GetInstanceID().ToString(System.Globalization.CultureInfo.InvariantCulture) + ":" + index;
                    Assert.That(panels.Contains(key), Is.True, page.name + " / " + names[index]);
                    var panel = (QuestUi.OperationPanel)panels[key];
                    var expected = (QuestUi.OperationPanelRole)role.Invoke(null, new object[] { page.name, index });
                    Assert.That(roleField.GetValue(panel), Is.EqualTo((QuestUi.OperationPanelRole?)expected),
                        page.name + " / " + names[index] + " must use its authored role");
                    Assert.That(panel.Content, Is.Not.Null);
                    Assert.That(panel.Root.GetComponentsInChildren<QuestButton>(true).Length, Is.GreaterThan(0),
                        page.name + " / " + names[index] + " needs a real bound command");
                    authored++;
                }
            }
            Assert.That(authored, Is.EqualTo(39), "all 39 semantic workstation zones must be constructed");
        }

        [Test]
        public void WorkstationPagesDoNotCreateDuplicateFooterSummaries()
        {
            var pageFields = new[] { "_pcPage", "_connectionPage", "_homeNoticePage",
                "_configurationPage", "_viewPage", "_metricsPage", "_sectionPage",
                "_editPage", "_commandPage", "_referencePage", "_sketchPage", "_voicePage",
                "_voiceContextPage" };
            foreach (var field in pageFields)
            {
                var page = (Transform)typeof(QuestControls).GetField(field, Private).GetValue(_controls);
                if (page == null) continue;
                Assert.That(page.GetComponentsInChildren<Transform>(true)
                    .Any(transform => transform.name.EndsWith(" summary")), Is.False,
                    field + " must rely on its compact focus stage, not a footer duplicate");
            }
        }

        static Rect PageRect(Transform page, Transform item, Vector3 center, Vector3 size)
        {
            var min = new Vector2(float.PositiveInfinity, float.PositiveInfinity);
            var max = new Vector2(float.NegativeInfinity, float.NegativeInfinity);
            for (var x = -1; x <= 1; x += 2)
            for (var y = -1; y <= 1; y += 2)
            for (var z = -1; z <= 1; z += 2)
            {
                var local = page.InverseTransformPoint(item.TransformPoint(center +
                    Vector3.Scale(size * .5f, new Vector3(x, y, z))));
                min = Vector2.Min(min, new Vector2(local.x, local.y));
                max = Vector2.Max(max, new Vector2(local.x, local.y));
            }
            return Rect.MinMaxRect(min.x, min.y, max.x, max.y);
        }

        [Test]
        public void ContextActionsKeepUniquePageLocalIdentitiesAndDisableOfflineCadHitTargets()
        {
            var pages = new[] { "_pcPage", "_connectionPage", "_viewPage", "_editPage",
                "_commandPage", "_referencePage", "_sketchPage" };
            foreach (var field in pages)
            {
                var page = (Transform)typeof(QuestControls).GetField(field, Private).GetValue(_controls);
                var actions = page.GetComponentsInChildren<QuestButton>(true);
                Assert.That(actions.Select(a => a.ActionId).Distinct().Count(), Is.EqualTo(actions.Length),
                    field + " must not contain duplicate actionable identities");
            }
            Call("RefreshContextualActions", (object)System.Array.Empty<Kreoda.Session.DiscoveredSessionPc>());
            var connection = (Transform)typeof(QuestControls).GetField("_connectionPage", Private).GetValue(_controls);
            var edit = (Transform)typeof(QuestControls).GetField("_editPage", Private).GetValue(_controls);
            var commands = (Transform)typeof(QuestControls).GetField("_commandPage", Private).GetValue(_controls);
            Assert.That(ActionButton(connection, "Corpo").GetComponent<Collider>().enabled, Is.False);
            Assert.That(ActionButton(connection, "Invia target al PC").GetComponent<Collider>().enabled, Is.False);
            Assert.That(ActionButton(edit, "Valore esatto").GetComponent<Collider>().enabled, Is.False);
            Assert.That(ActionButton(commands, "Conferma").GetComponent<Collider>().enabled, Is.False);
            Assert.That(ActionButton(connection, "Connetti").Click, Is.Not.Null,
                "An offline PC must retain its real pairing callback");
        }

        [Test]
        public void ContextPcHighlightMatchesStableIdentityNotDuplicateDisplayName()
        {
            var first = new Kreoda.Session.DiscoveredSessionPc(System.Guid.NewGuid().ToString("D"),
                "Same PC name", new System.Uri("ws://192.168.1.8:44731"),
                new System.Uri("http://192.168.1.8:44732/pair"));
            var second = new Kreoda.Session.DiscoveredSessionPc(System.Guid.NewGuid().ToString("D"),
                "Same PC name", new System.Uri("ws://192.168.1.9:44731"),
                new System.Uri("http://192.168.1.9:44732/pair"));
            typeof(QuestControls).GetField("_selectedPcId", Private).SetValue(_controls, second.PcId);
            Call("RefreshContextualActions", (object)new[] { first, second });
            var page = (Transform)typeof(QuestControls).GetField("_pcPage", Private).GetValue(_controls);
            Assert.That(ActionButton(page, "PC 1").GetComponent<Collider>().enabled, Is.True);
            Assert.That(ActionButton(page, "PC 2").GetComponent<Collider>().enabled, Is.True);
            var choices = (TextMesh[])typeof(QuestControls).GetField("_pcChoices", Private)
                .GetValue(_controls);
            var firstLabel = choices[0];
            var secondLabel = choices[1];
            Assert.That(firstLabel.fontStyle, Is.Not.EqualTo(FontStyle.Bold));
            Assert.That(secondLabel.fontStyle, Is.EqualTo(FontStyle.Bold));
        }

        [Test]
        public void WorkflowHitTargetsFitTheirContentWithoutOverlapping()
        {
            const BindingFlags flags = BindingFlags.Static | BindingFlags.NonPublic;
            var type = typeof(QuestControls);
            var authored = type.GetMethod("AuthoredActionComposition", flags);
            var positioned = type.GetMethod("ComposedActionPosition", flags);
            var validate = type.GetMethod("ValidateComposedFootprints", flags);
            var zonesMethod = type.GetMethod("AuthoredZoneNames", flags);
            var idsMethod = type.GetMethod("WorkflowActionIds", flags);
            Assert.That(authored, Is.Not.Null);
            Assert.That(positioned, Is.Not.Null);
            Assert.That(validate, Is.Not.Null);
            Assert.DoesNotThrow(() => validate.Invoke(null, null));
            var names = new[] { "PC locali", "Advanced PC diagnostics", "Home action status",
                "CAD configurations", "Display controls", "Optional diagnostics", "Section view",
                "Exact CAD editing", "Canonical context actions", "Riferimenti CAD",
                "Canonical sketch dimensions", "Hermes voice", "Contesto Hermes" };
            var panels = (System.Collections.IDictionary)type.GetField("_measuredPanels", Private).GetValue(_controls);
            var total = 0;
            foreach (var name in names)
            {
                var page = _root.GetComponentsInChildren<Transform>(true).Single(t => t.name == name);
                var zones = (string[])zonesMethod.Invoke(null, new object[] { name });
                var idsOnPage = new System.Collections.Generic.HashSet<string>();
                var large = false;
                for (var zone = 0; zone < zones.Length; zone++)
                {
                    var ids = (string[])idsMethod.Invoke(null, new object[] { name, zone });
                    var key = page.GetInstanceID().ToString(System.Globalization.CultureInfo.InvariantCulture) + ":" + zone;
                    var panel = (QuestUi.OperationPanel)panels[key];
                    Assert.That(panel, Is.Not.Null, key);
                    var visible = new System.Collections.Generic.List<Rect>();
                    foreach (var id in ids)
                    {
                        Assert.That(idsOnPage.Add(id), Is.True, name + " duplicate " + id);
                        var button = ActionButton(page, id);
                        Assert.That(button.Click, Is.Not.Null, id);
                        Assert.That(button.transform.IsChildOf(panel.Content), Is.True, id);
                        var box = button.GetComponent<BoxCollider>();
                        Assert.That(box, Is.Not.Null, id);
                        var rect = PageRect(page, box.transform, box.center, box.size);
                        Assert.That(rect.width, Is.GreaterThan(.025f));
                        Assert.That(rect.height, Is.GreaterThan(.008f));
                        large |= rect.width >= .14f && rect.height >= .072f;
                        Assert.That(authored.Invoke(null, new object[] { name, id }), Is.Not.Null);
                        if (button.gameObject.activeInHierarchy && box.enabled)
                        {
                            foreach (var other in visible)
                            {
                                var overlapX = Mathf.Min(rect.xMax, other.xMax) - Mathf.Max(rect.xMin, other.xMin);
                                var overlapY = Mathf.Min(rect.yMax, other.yMax) - Mathf.Max(rect.yMin, other.yMin);
                                Assert.That(overlapX <= .0005f || overlapY <= .0005f, Is.True,
                                    name + " / " + id + " overlaps a visible action");
                            }
                            visible.Add(rect);
                        }
                        total++;
                    }
                }
                Assert.That(large, Is.True, name + " must preserve a large real click target");
                Assert.That(page.GetComponentsInChildren<QuestButton>(true).Length, Is.EqualTo(idsOnPage.Count));
            }
            Assert.That(total, Is.EqualTo(121));
            Assert.That(panels.Count, Is.EqualTo(39));
        }
        [TestCase("home:project:new")]
        [TestCase("home:project:import")]
        [TestCase("home:project:template")]
        public void HomeProjectActionsExplainDesktopOwnershipWithoutCreatingDocuments(string action)
        {
            Call("HomeAction", action);
            var noticePage = (Transform)typeof(QuestControls).GetField("_homeNoticePage", Private).GetValue(_controls);
            var notice = (TextMesh)typeof(QuestControls).GetField("_homeNotice", Private).GetValue(_controls);
            Assert.That(noticePage.gameObject.activeSelf, Is.True);
            Assert.That(notice.text, Does.Contain("Desktop").And.Contain("Quest"));
            Assert.That(_controls.Connection.Client, Is.Null, "No fake CAD document should be created");
        }

        [Test]
        public void DisconnectedProjectCatalogOpensPairingAndExplainsMissingRealPcData()
        {
            Call("HomeAction", "home:project:select");
            var pc = (Transform)typeof(QuestControls).GetField("_pcPage", Private).GetValue(_controls);
            Assert.That(pc.gameObject.activeSelf, Is.True);
            Assert.That(_controls.Home.OpenableStatus.text, Does.Contain("Connetti il PC"));
            Call("HomeAction", "home:project:refresh");
            Assert.That(_controls.Home.OpenableStatus.text, Does.Contain("Connetti il PC"));
        }

        [Test]
        public void SelectingDiscoveredPcStartsExistingSecurePairingAndKeepsConnectionScreenVisible()
        {
            var peer = new Kreoda.Session.DiscoveredSessionPc(System.Guid.NewGuid().ToString("D"),
                "Kreoda Studio",new System.Uri("ws://192.168.1.8:44731"),
                new System.Uri("http://192.168.1.8:44732/pair"));
            typeof(QuestConnection).GetProperty("AvailablePcs").SetValue(_controls.Connection,
                new[] {peer});
            Call("ConnectDiscoveredPc",peer);
            var pcPage=(Transform)typeof(QuestControls).GetField("_pcPage",Private).GetValue(_controls);
            var status=(TextMesh)typeof(QuestControls).GetField("_pcStatus",Private).GetValue(_controls);
            Assert.That(pcPage.gameObject.activeSelf,Is.True,"Pairing must never navigate to a blank screen");
            Assert.That(status.text,Does.Contain("Kreoda Studio").And.Contain("automatico").And.Not.Contain("approva"));
            Assert.That(_controls.Connection.Client,Is.Null,
                "Selecting a PC does not grant authentication before the genuine pairing response");
        }

        [Test]
        public void ControllerFreeDatumSelectionFeedsVoiceAndRejectsStaleOrOfflineIdentity()
        {
            var connection = _controls.Connection;
            using var record = System.Text.Json.JsonDocument.Parse("{\"featureId\":\"datum-plane\",\"kind\":\"DatumPlane\",\"status\":\"ok\",\"resolved\":{\"originMm\":[0,0,24],\"xAxis\":[1,0,0],\"yAxis\":[0,1,0],\"normal\":[0,0,1]}}");
            var model = new Kreoda.Session.SessionModelState("session", "document", 4,
                System.Array.Empty<System.Text.Json.JsonElement>(), System.Array.Empty<System.Text.Json.JsonElement>(),
                System.Array.Empty<System.Text.Json.JsonElement>()) { Datums = new[] { record.RootElement.Clone() } };
            var client = (Kreoda.Session.SessionClient)typeof(Kreoda.Session.SessionClient)
                .GetConstructor(Private, null, System.Type.EmptyTypes, null).Invoke(null);
            var modelField = typeof(Kreoda.Session.SessionClient).GetField("_model", Private);
            modelField.SetValue(client, model);
            var run = new System.Threading.CancellationTokenSource();
            typeof(QuestConnection).GetField("_client", Private).SetValue(connection, client);
            typeof(QuestConnection).GetField("_run", Private).SetValue(connection, run);
            typeof(QuestConnection).GetProperty("Connected").SetValue(connection, true);
            var scene = (Kreoda.QuestFoundation.QuestSceneState)typeof(QuestConnection).GetField("_scene", Private).GetValue(connection);
            var generation = scene.BeginConnection();
            typeof(QuestConnection).GetMethod("Capture", Private).Invoke(connection, new object[] { run, client, generation, model, null });
            typeof(QuestConnection).GetMethod("Update", Private).Invoke(connection, null);
            var datum = System.Linq.Enumerable.Single(connection.DatumViews);

            var pinch = typeof(QuestControls).GetMethod("IndexPinchStarted", Private | BindingFlags.Static);
            Assert.That(pinch.Invoke(null, new object[] { true, false }), Is.True);
            Assert.That(Call("SelectDatum", datum), Is.True);
            Assert.That(_controls.SelectionForVoice(), Is.EqualTo(new[] { "datum-plane" }));
            Assert.That(typeof(QuestControls).GetField("_selected", Private).GetValue(_controls), Is.Null);

            modelField.SetValue(client, model with { Revision = 5 });
            Assert.That(_controls.SelectionForVoice(), Is.Empty);
            Call("RefreshSelection");
            Assert.That(typeof(QuestControls).GetField("_selectedDatum", Private).GetValue(_controls), Is.Null);
            Assert.That(Call("SelectDatum", datum), Is.False);
            connection.Forget();
            Assert.That(_controls.SelectionForVoice(), Is.Empty);
            run.Dispose();
        }

        [UnityTest]
        public IEnumerator RenderedButtonTextFitsItsActualHitTargetIncludingDynamicEndpoint()
        {
            foreach (var label in _controls.GetComponentsInChildren<TextMesh>(true))
            {
                for (var parent = label.transform; parent != _controls.transform; parent = parent.parent)
                    parent.gameObject.SetActive(true);
                if (label.text == "Endpoint manuale") label.text = "ws://192.168.100.254:65535";
            }
            yield return null;
            typeof(QuestControls).GetMethod("LateUpdate", Private)?.Invoke(_controls, null);
            Physics.SyncTransforms();
            foreach (var label in _controls.GetComponentsInChildren<TextMesh>(true))
            {
                if (!label.transform.parent.name.EndsWith(" control")) continue;
                var target = label.transform.parent.GetComponentInChildren<QuestButton>(true);
                if (target == null) continue;
                // Measure inactive recovery controls too: LateUpdate correctly hides Menu while the panel is open.
                target.transform.parent.gameObject.SetActive(true);
                Physics.SyncTransforms();
                var glyphs = label.GetComponent<MeshRenderer>().bounds;
                var collider = target.GetComponent<Collider>();
                var wasEnabled = collider.enabled;
                Bounds button;
                try
                {
                    if (!collider.enabled) collider.enabled = true;
                    Physics.SyncTransforms();
                    button = collider.bounds;
                }
                finally
                {
                    collider.enabled = wasEnabled;
                    Physics.SyncTransforms();
                }
                Assert.That(collider.enabled, Is.EqualTo(wasEnabled), label.text + " collider state changed during measurement");
                Assert.That(glyphs.size.x, Is.LessThanOrEqualTo(button.size.x * .95f), label.text + " escapes its button width");
                Assert.That(glyphs.size.y, Is.LessThanOrEqualTo(button.size.y * .9f), label.text + " overlaps adjacent rows");
            }
        }

        [Test]
        public void PanelHasUsablePhysicalSizeAndRecentersAtCurrentEyeHeight()
        {
            var home = (Transform)typeof(QuestControls).GetField("_homePage", Private).GetValue(_controls);
            Assert.That(_controls.Home.Background, Is.Null, "real room must remain visible between HUD islands");
            var bounds = new Bounds(home.position, Vector3.zero);
            foreach (var renderer in home.GetComponentsInChildren<MeshRenderer>()) bounds.Encapsulate(renderer.bounds);
            Assert.That(bounds.size.x, Is.GreaterThanOrEqualTo(.55f));
            Assert.That(bounds.size.y, Is.GreaterThanOrEqualTo(.50f));
            typeof(QuestControls).GetField("_panelOffset", Private).SetValue(_controls, new Vector3(0, 0, 1));
            _head.transform.position = new Vector3(2, 1.8f, 3);
            _controls.RecenterPanel();
            Assert.That(_controls.transform.position.y, Is.EqualTo(1.8f).Within(.001f));
            Assert.That(Vector3.Distance(_controls.transform.position, _head.transform.position), Is.EqualTo(1).Within(.001f));
        }

        [Test]
        public void NumericEditFocusLossDiscardsPendingConfirmation()
        {
            typeof(QuestControls).GetField("_editingValue", Private).SetValue(_controls, true);
            typeof(QuestControls).GetField("_pendingExact", Private).SetValue(_controls,
                new System.Collections.Generic.Dictionary<string, double> { ["widthMm"] = 120 });
            Call("OnApplicationFocus", false);
            Assert.That(typeof(QuestControls).GetField("_editingValue", Private).GetValue(_controls), Is.False);
            Assert.That(typeof(QuestControls).GetField("_pendingExact", Private).GetValue(_controls), Is.Null);
        }

        [Test]
        public void ExactConfirmationRequiresSameAuthoritativeSessionDocumentAndRevision()
        {
            using var metadata = System.Text.Json.JsonDocument.Parse("{\"id\":\"distance\",\"type\":\"linear\",\"parameter\":\"distanceMm\",\"unit\":\"mm\",\"origin\":[0,0,0],\"axis\":[1,0,0]}");
            const string sessionA = "8f223f35-6c21-46cc-ae53-8f49ad2d9e21";
            const string sessionB = "9f223f35-6c21-46cc-ae53-8f49ad2d9e21";
            var intent = new Kreoda.QuestFoundation.SpatialEditIntent(sessionA, "document-a", 7,
                "owner", "body", "tip", metadata.RootElement,
                new System.Collections.Generic.Dictionary<string, double> { ["distanceMm"] = 100 });
            Kreoda.Session.SessionModelState Model(string session, string document, long revision) =>
                new Kreoda.Session.SessionModelState(session, document, revision,
                    System.Array.Empty<System.Text.Json.JsonElement>(), System.Array.Empty<System.Text.Json.JsonElement>(),
                    System.Array.Empty<System.Text.Json.JsonElement>());
            Assert.That(QuestControls.CanApplyExact(Model(sessionA, "document-a", 7), intent), Is.True);
            Assert.That(QuestControls.CanApplyExact(Model(sessionA, "document-a", 8), intent), Is.False);
            Assert.That(QuestControls.CanApplyExact(Model(sessionA, "document-b", 7), intent), Is.False);
            Assert.That(QuestControls.CanApplyExact(Model(sessionB, "document-a", 7), intent), Is.False);
            Assert.That(QuestControls.CanApplyExact(null, intent), Is.False);
        }

        [Test]
        public void TrackedHandHasPriorityOverConnectedController()
        {
            var choose = typeof(QuestControls).GetMethod("ChooseInputSource", BindingFlags.Static | BindingFlags.NonPublic);
            Assert.That(choose, Is.Not.Null);
            Assert.That(choose.Invoke(null, new object[] { true, true, true }), Is.EqualTo(1));
            Assert.That(choose.Invoke(null, new object[] { false, true, true }), Is.EqualTo(3));
        }

        [Test]
        public void IndexPinchUsesSameCompactSectionButtonActionWithoutController()
        {
            var page = (Transform)typeof(QuestControls).GetField("_sectionPage", Private).GetValue(_controls);
            var button = ActionButton(page, "Attiva sezione");
            Assert.That(button, Is.Not.Null);
            Assert.That(button.Click, Is.Not.Null);
            var pinch = typeof(QuestControls).GetMethod("IndexPinchStarted", Private | BindingFlags.Static);
            Assert.That(pinch, Is.Not.Null, "index-hand pinch path must produce the same rising-edge button action");
            var wasPinching = false;
            var first = new object[] { true, wasPinching };
            Assert.That(pinch.Invoke(null, first), Is.True);
            button.Click.Invoke();
            Assert.That(_controls.Connection.Section.Enabled, Is.False, "empty-scene guard must stay active on hand input");
            Assert.That(_controls.Connection.Section.Status, Does.Contain("Carica un corpo CAD"));
            var held = new object[] { true, first[1] };
            Assert.That(pinch.Invoke(null, held), Is.False, "held pinch must not repeatedly activate panel controls");
            var released = new object[] { false, held[1] };
            Assert.That(pinch.Invoke(null, released), Is.False);
            var nextPinch = new object[] { true, released[1] };
            Assert.That(pinch.Invoke(null, nextPinch), Is.True);
        }

        [Test]
        public void ReferencePageAndCreateEntryUseVisibleIndexPinchButtons()
        {
            var viewPage = (Transform)typeof(QuestControls).GetField("_viewPage", Private).GetValue(_controls);
            var page = (Transform)typeof(QuestControls).GetField("_referencePage", Private).GetValue(_controls);
            Call("Page", viewPage);
            var open = ActionButton(viewPage, "Riferimenti");
            Assert.That(open, Is.Not.Null);
            var pinch = typeof(QuestControls).GetMethod("IndexPinchStarted", Private | BindingFlags.Static);
            var start = new object[] { true, false };
            Assert.That(pinch.Invoke(null, start), Is.True);
            open.Click.Invoke();
            Assert.That(page.gameObject.activeSelf, Is.True);
            var create = ActionButton(page, "Nuovo piano");
            Assert.That(create, Is.Not.Null);
            create.Click.Invoke();
            Assert.That(_controls.References.IsFormOpen, Is.False, "offline UI cannot create a local fake datum");
            Assert.That(_controls.References.Status, Does.Contain("Collega un PC"));
        }

        [Test]
        public void ReferenceKindOperationSourceFieldAndCancelUseIndexPinchButtonRoute()
        {
            var connection = _controls.Connection;
            var run = new System.Threading.CancellationTokenSource();
            try
            {
                var model = new Kreoda.Session.SessionModelState("session", "document", 4,
                    System.Array.Empty<System.Text.Json.JsonElement>(), System.Array.Empty<System.Text.Json.JsonElement>(),
                    System.Array.Empty<System.Text.Json.JsonElement>());
                var client = (Kreoda.Session.SessionClient)typeof(Kreoda.Session.SessionClient)
                    .GetConstructor(Private, null, System.Type.EmptyTypes, null).Invoke(null);
                typeof(Kreoda.Session.SessionClient).GetField("_model", Private).SetValue(client, model);
                typeof(QuestConnection).GetField("_client", Private).SetValue(connection, client);
                typeof(QuestConnection).GetField("_run", Private).SetValue(connection, run);
                typeof(QuestConnection).GetProperty("Connected").SetValue(connection, true);
                var scene = (Kreoda.QuestFoundation.QuestSceneState)typeof(QuestConnection).GetField("_scene", Private).GetValue(connection);
                var generation = scene.BeginConnection();
                typeof(QuestConnection).GetMethod("Capture", Private).Invoke(connection, new object[] { run, client, generation, model, null });
                Call("Update");

                var viewPage = (Transform)typeof(QuestControls).GetField("_viewPage", Private).GetValue(_controls);
                var page = (Transform)typeof(QuestControls).GetField("_referencePage", Private).GetValue(_controls);
                var pinch = typeof(QuestControls).GetMethod("IndexPinchStarted", Private | BindingFlags.Static);
                void HandPress(Transform targetPage, string label)
                {
                    var button = ActionButton(targetPage, label);
                    Assert.That(button, Is.Not.Null, label);
                    Assert.That(pinch.Invoke(null, new object[] { true, false }), Is.True, "index pinch must activate " + label);
                    button.Click.Invoke();
                    Assert.That(pinch.Invoke(null, new object[] { false, true }), Is.False, "release must not repeat " + label);
                }

                Call("Page", viewPage);
                HandPress(viewPage, "Riferimenti");
                HandPress(page, "Nuovo piano");
                Assert.That(_controls.References.IsFormOpen, Is.True);
                var allowed = (System.Collections.Generic.HashSet<string>)typeof(QuestReferences).GetField("_allowedOperations", Private).GetValue(_controls.References);
                allowed.Add("principal");allowed.Add("offset");
                typeof(QuestReferences).GetField("_schemaReady", Private).SetValue(_controls.References, true);
                Call("RefreshReferencePage");
                HandPress(page, "Costruzione →");
                Assert.That(_controls.References.Operation, Is.EqualTo("offset"));
                HandPress(page, "Sorgente 1");
                Assert.That(_controls.References.CurrentFieldValue, Does.Contain("Piano XY"));
                HandPress(page, "Campo →");
                Assert.That(_controls.References.CurrentFieldLabel, Does.Contain("Scostamento"));
                HandPress(page, "Annulla");
                Assert.That(_controls.References.IsFormOpen, Is.False, "cancel button must abandon the draft without a local datum");
            }
            finally
            {
                typeof(QuestConnection).GetField("_run", Private).SetValue(connection, null);
                typeof(QuestConnection).GetField("_client", Private).SetValue(connection, null);
                typeof(QuestConnection).GetProperty("Connected").SetValue(connection, false);
                ((Kreoda.QuestFoundation.QuestSceneState)typeof(QuestConnection).GetField("_scene", Private).GetValue(connection)).InvalidateConnection();
                run.Cancel();run.Dispose();
            }
        }

        [Test]
        public void ReferenceHomeFormAndInspectKeepTextBoundsClearOfNeighboringButtons()
        {
            var page = (Transform)typeof(QuestControls).GetField("_referencePage", Private).GetValue(_controls);
            var references = _controls.References;
            Call("OpenReferences");
            typeof(QuestReferences).GetField("<Status>k__BackingField", Private).SetValue(references,
                "Scegli costruzione o datum\nPC non connesso · modello in attesa");
            Call("RefreshReferencePage");
            Call("LateUpdate");Physics.SyncTransforms();
            AssertReferenceLabelsClear(page, "home with multiline status");

            var mode = typeof(QuestReferences).GetField("_mode", Private);
            mode.SetValue(references, System.Enum.Parse(mode.FieldType, "Form"));
            typeof(QuestReferences).GetField("_kind", Private).SetValue(references, QuestReferenceKind.Plane);
            typeof(QuestReferences).GetField("_operation", Private).SetValue(references, "offset");
            typeof(QuestReferences).GetField("_schemaReady", Private).SetValue(references, true);
            typeof(QuestReferences).GetField("_sourcePage", Private).SetValue(references, 1);
            var fieldType = typeof(QuestReferences).GetNestedType("Field", BindingFlags.NonPublic);
            var field = System.Activator.CreateInstance(fieldType, true);
            fieldType.GetField("Key").SetValue(field, "base");
            fieldType.GetField("Label").SetValue(field, "Piano base");
            fieldType.GetField("Unit").SetValue(field, "sorgente");
            fieldType.GetField("Kind").SetValue(field, QuestReferenceValueKind.Plane);
            var fields = (System.Collections.IList)typeof(QuestReferences).GetField("_fields", Private).GetValue(references);
            fields.Clear();fields.Add(field);
            var values = (System.Collections.IDictionary)typeof(QuestReferences).GetField("_values", Private).GetValue(references);
            var selected = QuestReferenceValue.Datum(QuestReferenceKind.Plane, "source-long-uuid", "DatumPlane", "ok");
            selected.Label = "Piano datum corrente con un identificatore persistente molto lungo source-long-uuid";
            values["base"] = selected;
            var allowed = (System.Collections.IEnumerable)typeof(QuestReferences).GetField("_allowedOperations", Private).GetValue(references);
            var add = allowed.GetType().GetMethod("Add");add.Invoke(allowed, new object[] { "offset" });
            typeof(QuestReferences).GetField("<Status>k__BackingField", Private).SetValue(references,
                "Sorgente corrente\nSchema PC confermato · unità mm");
            Call("RefreshReferencePage");
            Call("LateUpdate");Physics.SyncTransforms();
            Assert.That(ActionButton(page, "Sorgente 2").transform.parent.GetComponentInChildren<TextMesh>(true).text, Does.Contain("source-long-uuid"));
            AssertReferenceLabelsClear(page, "form with long source and multiline status");

            mode.SetValue(references, System.Enum.Parse(mode.FieldType, "Inspect"));
            Call("RefreshReferencePage");
            var details = (TextMesh)typeof(QuestControls).GetField("_referenceDetails", Private).GetValue(_controls);
            details.text = "ID datum\nStato broken · dipendenza rimossa\nPiano · Offset\nbase: datum source-long-uuid\nscostamento: 24 mm\nRisolto mm · origine [0, 0, 24]\nx [1, 0, 0] · y [0, 1, 0] · normale [0, 0, 1]";
            Call("LateUpdate");Physics.SyncTransforms();
            AssertReferenceLabelsClear(page, "inspection with multiline native detail");
        }

        [Test]
        public void EditableReferenceInspectionHasSeparateEditAndBackHitTargets()
        {
            Call("OpenReferences");
            var edit = (TextMesh)typeof(QuestControls).GetField("_referenceEdit", Private).GetValue(_controls);
            var back = (TextMesh)typeof(QuestControls).GetField("_referenceBack", Private).GetValue(_controls);
            // Both controls are visible when inspecting an editable native datum.
            edit.transform.parent.gameObject.SetActive(true);
            back.transform.parent.gameObject.SetActive(true);
            edit.transform.parent.parent.parent.gameObject.SetActive(true);
            Physics.SyncTransforms();
            var editBounds = edit.transform.parent.GetComponentInChildren<Collider>().bounds;
            var backBounds = back.transform.parent.GetComponentInChildren<Collider>().bounds;
            Assert.That(editBounds.max.x < backBounds.min.x || backBounds.max.x < editBounds.min.x ||
                editBounds.max.y < backBounds.min.y || backBounds.max.y < editBounds.min.y, Is.True,
                "pinch rays must distinguish Edit from Back across their full hit areas");
        }

        [Test]
        public void ReferencePageShowsCommandOutcomeStatus()
        {
            var status = (TextMesh)typeof(QuestControls).GetField("_referenceStatus", Private).GetValue(_controls);
            typeof(QuestReferences).GetField("<Status>k__BackingField", Private).SetValue(_controls.References,
                "PC ha rifiutato · DATUM_FAILED: Fixture rejected datum");
            Call("RefreshReferencePage");
            Assert.That(status.text, Does.Contain("PC ha rifiutato").And.Contain("DATUM_FAILED").And.Contain("Fixture rejected datum"));
        }

        [Test]
        public void TrackingLossAndFocusLossCancelReferenceForm()
        {
            var references = _controls.References;
            var mode = typeof(QuestReferences).GetField("_mode", Private);
            mode.SetValue(references, System.Enum.Parse(mode.FieldType, "Form"));
            typeof(QuestControls).GetField("_editingReference", Private).SetValue(_controls, true);
            var ticket = references.InputTicket;
            Call("Update");
            Assert.That(references.IsFormOpen, Is.False, "tracking loss must abandon the typed reference form");
            Assert.That(typeof(QuestControls).GetField("_editingReference", Private).GetValue(_controls), Is.False,
                "tracking loss must also clear the numeric keyboard intent");
            Assert.That(references.InputTicket, Is.GreaterThan(ticket), "late keyboard input must be invalidated");

            mode.SetValue(references, System.Enum.Parse(mode.FieldType, "Form"));
            Call("OnApplicationFocus", false);
            Assert.That(references.IsFormOpen, Is.False, "focus loss must abandon the typed reference form");
        }

        static void AssertReferenceLabelsClear(Transform page, string state)
        {
            var buttons = page.GetComponentsInChildren<QuestButton>(true)
                .Where(button => button.gameObject.activeInHierarchy && button.GetComponent<Collider>() != null).ToArray();
            foreach (var label in page.GetComponentsInChildren<TextMesh>(true).Where(label => label.gameObject.activeInHierarchy))
            {
                var renderer = label.GetComponent<MeshRenderer>();
                if (renderer == null || !renderer.enabled) continue;
                var textBounds = renderer.bounds;
                foreach (var button in buttons)
                {
                    if (label.transform.parent == button.transform.parent) continue;
                    var target = button.GetComponent<Collider>().bounds;
                    var overlaps = textBounds.min.x < target.max.x && textBounds.max.x > target.min.x &&
                        textBounds.min.y < target.max.y && textBounds.max.y > target.min.y;
                    Assert.That(overlaps, Is.False, $"{state}: label '{label.text}' overlaps neighboring button '{button.transform.parent.name}'");
                }
            }
        }

        [Test]
        public void SourceHandoffCancelsHeldEditAndRequiresFreshPress()
        {
            _controls.Spatial = _root.AddComponent<QuestSpatialEdit>();
            Call("SetPointerSource", 3);
            typeof(QuestSpatialEdit).GetField("_held", Private).SetValue(_controls.Spatial, true);
            typeof(QuestControls).GetField("_requireRelease", Private).SetValue(_controls, false);
            Call("SetPointerSource", 2);
            Assert.That(_controls.Spatial.Holding, Is.False);
            Assert.That(typeof(QuestControls).GetField("_requireRelease", Private).GetValue(_controls), Is.True);
        }

        [Test]
        public void HeaderGrabMovesWithoutJumpAndReleaseStopsFollowing()
        {
            var before = _controls.transform.position;
            var ray = new Ray(_head.transform.position, (before - _head.transform.position).normalized);
            Call("BeginPanelDrag", ray, before);
            Call("UpdatePanelDrag", ray, true, true);
            Assert.That(Vector3.Distance(before, _controls.transform.position), Is.LessThan(.001f));
            var moved = new Ray(ray.origin + Vector3.right * .3f, ray.direction);
            Call("UpdatePanelDrag", moved, true, true);
            Assert.That(_controls.transform.position.x, Is.EqualTo(before.x + .3f).Within(.001f));
            Call("UpdatePanelDrag", moved, false, true);
            var released = _controls.transform.position;
            Call("UpdatePanelDrag", ray, false, true);
            Assert.That(_controls.transform.position, Is.EqualTo(released));
        }

        [Test]
        public void TrackingLossCancelsPanelGrabWithoutMovingCadOrPersistingTheDraft()
        {
            var before = _controls.transform.position;
            var cad = _controls.Connection.DisplayRoot.position;
            var ray = new Ray(_head.transform.position, (before - _head.transform.position).normalized);
            Call("BeginPanelDrag", ray, before);
            Call("UpdatePanelDrag", new Ray(ray.origin + Vector3.up * .2f, ray.direction), true, true);
            Call("UpdatePanelDrag", ray, true, false);
            Assert.That(_controls.transform.position, Is.EqualTo(before));
            Assert.That(_controls.Connection.DisplayRoot.position, Is.EqualTo(cad));
        }

        [TestCase(.5f, -.4f, 1.2f)]
        [TestCase(20f, -10f, -8f)]
        public void ShowingPanelResetsBadOffsetsToSafeEyeLevel(float x, float y, float z)
        {
            typeof(QuestControls).GetField("_panelOffset", Private).SetValue(_controls, new Vector3(x, y, z));
            _controls.RecenterPanel();
            Call("TogglePanel");
            Call("TogglePanel");
            Assert.That(Vector3.Distance(_controls.transform.position, _controls.Rig.centerEyeAnchor.position +
                _controls.Rig.centerEyeAnchor.forward * 1.25f), Is.LessThan(.001f), "B/Y show must recover independently of the saved offset");
        }

        [Test]
        public void ReleasingAnOutOfReachDraftRestoresSafePlacement()
        {
            var head = _controls.Rig.centerEyeAnchor;
            var ray = new Ray(head.position, (_controls.transform.position - head.position).normalized);
            Call("BeginPanelDrag", ray, _controls.transform.position);
            var far = new Ray(ray.origin + Vector3.down * 5, ray.direction);
            Call("UpdatePanelDrag", far, true, true);
            Call("UpdatePanelDrag", far, false, true);
            Assert.That(Vector3.Distance(_controls.transform.position, head.position + head.forward * 1.25f), Is.LessThan(.001f));
        }

        [Test]
        public void CodeDraftSurvivesKeyboardLosingFocus()
        {
            typeof(QuestControls).GetField("_editingCode", Private).SetValue(_controls, true);
            Call("ApplyKeyboardInput", "8765 4321", TouchScreenKeyboard.Status.Visible);
            Call("ApplyKeyboardInput", "", TouchScreenKeyboard.Status.LostFocus);
            Assert.That(typeof(QuestControls).GetField("_code", Private).GetValue(_controls), Is.EqualTo("8765 4321"));
        }

        [Test]
        public void LatestEndpointIsKeptWhenKeyboardClosesWithoutDone()
        {
            Call("ApplyKeyboardInput", " ws://192.168.1.7:9842 ", TouchScreenKeyboard.Status.LostFocus);
            Assert.That(typeof(QuestControls).GetField("_endpoint", Private).GetValue(_controls), Is.EqualTo("ws://192.168.1.7:9842"));
        }

        [Test]
        public void DismissingKeyboardKeepsTheEnteredDraft()
        {
            typeof(QuestControls).GetField("_editingCode", Private).SetValue(_controls, true);
            Call("ApplyKeyboardInput", "87654321", TouchScreenKeyboard.Status.Visible);
            Call("ApplyKeyboardInput", "", TouchScreenKeyboard.Status.Canceled);
            Assert.That(typeof(QuestControls).GetField("_code", Private).GetValue(_controls), Is.EqualTo("87654321"));
        }

        [Test]
        public void DoneCanDeliberatelyClearTheEnteredDraft()
        {
            typeof(QuestControls).GetField("_editingCode", Private).SetValue(_controls, true);
            Call("ApplyKeyboardInput", "87654321", TouchScreenKeyboard.Status.Visible);
            Call("ApplyKeyboardInput", "", TouchScreenKeyboard.Status.Done);
            Assert.That(typeof(QuestControls).GetField("_code", Private).GetValue(_controls), Is.EqualTo(""));
        }

        [Test]
        public void OrdinarySurfacePickResolvesCanonicalFaceFromBothSidesWithoutChangingColliderOrUpload()
        {
            var body = CreateSurfaceTriangle(out var view);
            var collider = body.GetComponent<MeshCollider>();
            var mesh = body.GetComponent<MeshFilter>().sharedMesh;
            var uploadVersion = view.UploadVersion;
            var (center, normal) = SurfaceCenterAndNormal(body);

            Physics.SyncTransforms();
            Assert.That(ResolveOrdinaryRaycast(RayAt(center, normal, false), new[] { view }, view,
                out var frontCollider, out var frontView, out var frontTriangle, out _), Is.True);
            Assert.That(frontCollider, Is.SameAs(collider));
            Assert.That(frontView, Is.SameAs(view));
            Assert.That(frontTriangle, Is.EqualTo(0));
            Assert.That(view.ResolveFace(frontTriangle).PersistentId, Is.EqualTo("surface:planar-face"));

            collider.enabled = false;
            Physics.SyncTransforms();
            Assert.That(ResolveOrdinaryRaycast(RayAt(center, normal, true), new[] { view }, view,
                out var backCollider, out var backView, out var backTriangle, out _), Is.True);
            Assert.That(backCollider, Is.Null, "disabled physics collider must not fabricate the back-face hit");
            Assert.That(backView, Is.SameAs(view));
            Assert.That(backTriangle, Is.EqualTo(0));
            Assert.That(view.ResolveFace(backTriangle).PersistentId, Is.EqualTo("surface:planar-face"));
            Assert.That(collider.enabled, Is.False);
            Assert.That(collider.sharedMesh, Is.SameAs(mesh));
            Assert.That(view.UploadVersion, Is.EqualTo(uploadVersion));
        }

        [Test]
        public void OrdinarySurfacePickBeatsFartherSolidAndStopsAtNearerUiOrSolidCollider()
        {
            var body = CreateSurfaceTriangle(out var view);
            var surfaceCollider = body.GetComponent<MeshCollider>();
            var surfaceMesh = body.GetComponent<MeshFilter>().sharedMesh;
            var uploadVersion = view.UploadVersion;
            surfaceCollider.enabled = false;
            var (center, normal) = SurfaceCenterAndNormal(body);
            var ray = RayAt(center, normal, false);

            var fartherSolid = CreateBlocker(center - normal * .01f, .003f, true);
            Physics.SyncTransforms();
            Assert.That(ResolveOrdinaryRaycast(ray, new[] { view }, view,
                out var fartherCollider, out var fartherView, out var fartherTriangle, out _), Is.True);
            Assert.That(fartherCollider, Is.Null, "the nearer semantic surface must beat the farther solid");
            Assert.That(fartherView, Is.SameAs(view));
            Assert.That(view.ResolveFace(fartherTriangle).PersistentId, Is.EqualTo("surface:planar-face"));

            var uiBlocker = CreateBlocker(center + normal * .006f, .003f, false);
            Physics.SyncTransforms();
            Assert.That(ResolveOrdinaryRaycast(ray, new[] { view }, view,
                out var uiCollider, out var uiView, out _, out _), Is.True);
            Assert.That(uiCollider, Is.SameAs(uiBlocker));
            Assert.That(uiView, Is.Null, "a nearer non-CAD UI collider must block the surface");

            uiBlocker.enabled = false;
            var nearerSolid = CreateBlocker(center + normal * .006f, .003f, true);
            Physics.SyncTransforms();
            Assert.That(ResolveOrdinaryRaycast(ray, new[] { view }, view,
                out var solidCollider, out var solidView, out _, out _), Is.True);
            Assert.That(solidCollider, Is.SameAs(nearerSolid));
            Assert.That(solidView, Is.Null, "a nearer physical solid collider must block the surface");

            Assert.That(surfaceCollider.sharedMesh, Is.SameAs(surfaceMesh));
            Assert.That(surfaceCollider.enabled, Is.False);
            Assert.That(view.UploadVersion, Is.EqualTo(uploadVersion));
        }

        [Test]
        public void OrdinarySurfaceBroadphaseSkipsHiddenOutOfRayAndNonCurrentViews()
        {
            var body = CreateSurfaceTriangle(out var view);
            var collider = body.GetComponent<MeshCollider>();
            var mesh = body.GetComponent<MeshFilter>().sharedMesh;
            var renderer = body.GetComponent<MeshRenderer>();
            var uploadVersion = view.UploadVersion;
            collider.enabled = false;
            var (center, normal) = SurfaceCenterAndNormal(body);
            var ray = RayAt(center, normal, false);

            renderer.enabled = false;
            Assert.That(ResolveOrdinaryRaycast(ray, new[] { view }, view,
                out _, out _, out _, out _), Is.False, "hidden surface renderer must not be semantically selectable");
            Assert.That(renderer.enabled, Is.False);

            renderer.enabled = true;
            var tangent = Vector3.Cross(normal, Vector3.up);
            if (tangent.sqrMagnitude < .01f) tangent = Vector3.Cross(normal, Vector3.right);
            var outsideBounds = new Ray(center + tangent.normalized * .1f + normal * .02f, -normal);
            Assert.That(ResolveOrdinaryRaycast(outsideBounds, new[] { view }, view,
                out _, out _, out _, out _), Is.False, "surface bounds should reject a ray with no intersection");

            Assert.That(ResolveOrdinaryRaycast(ray, new[] { view }, null,
                out _, out _, out _, out _), Is.False, "stale or non-current views must not be semantically selectable");
            Assert.That(collider.sharedMesh, Is.SameAs(mesh));
            Assert.That(view.UploadVersion, Is.EqualTo(uploadVersion));
        }

        GameObject CreateSurfaceTriangle(out QuestMeshView view)
        {
            var native = QuestMeshViewTests.NativeFixture();
            var body = new GameObject("semantic surface triangle");
            body.transform.SetParent(_root.transform, false);
            body.transform.position = new Vector3(20, 0, 0);
            view = body.AddComponent<QuestMeshView>();
            view.SetSurfaceGeometry(true);
            view.Upload(new SessionMeshResult(native.Header,
                new[] { 0f, 0f, 0f, 10f, 0f, 0f, 0f, 10f, 0f },
                new[] { 0f, 0f, 1f, 0f, 0f, 1f, 0f, 0f, 1f },
                new uint[] { 0, 1, 2 }, Array.Empty<float>(),
                new[] { new SessionMeshFaceRange("surface:planar-face", 0, 1) },
                Array.Empty<SessionMeshEdgeRange>(), 0, new[] { 0d, 0d, 0d, 10d, 10d, 0d },
                1, "surface-triangle-fixture"));
            return body;
        }

        static (Vector3 center, Vector3 normal) SurfaceCenterAndNormal(GameObject body)
        {
            var mesh = body.GetComponent<MeshFilter>().sharedMesh;
            var indices = mesh.triangles;
            var vertices = mesh.vertices;
            var a = vertices[indices[0]];
            var b = vertices[indices[1]];
            var c = vertices[indices[2]];
            var center = body.transform.TransformPoint((a + b + c) / 3f);
            var normal = body.transform.TransformDirection(mesh.normals[indices[0]].normalized);
            return (center, normal.normalized);
        }

        static Ray RayAt(Vector3 center, Vector3 normal, bool fromBack) => fromBack
            ? new Ray(center - normal * .02f, normal)
            : new Ray(center + normal * .02f, -normal);

        Collider CreateBlocker(Vector3 center, float size, bool meshCollider)
        {
            var blocker = GameObject.CreatePrimitive(PrimitiveType.Cube);
            blocker.name = meshCollider ? "solid physical blocker" : "UI physical blocker";
            blocker.transform.SetParent(_root.transform, false);
            blocker.transform.position = center;
            blocker.transform.localScale = Vector3.one * size;
            var box = blocker.GetComponent<BoxCollider>();
            if (!meshCollider) return box;
            var mesh = blocker.GetComponent<MeshFilter>().sharedMesh;
            Object.DestroyImmediate(box);
            var collider = blocker.AddComponent<MeshCollider>();
            collider.sharedMesh = mesh;
            return collider;
        }

        bool ResolveOrdinaryRaycast(Ray ray, QuestMeshView[] views, QuestMeshView currentView,
            out Collider hitCollider, out QuestMeshView hitView, out int hitTriangle, out Vector3 hitPoint)
        {
            var resolver = typeof(QuestControls).GetMethod("ResolveOrdinaryRaycast", Private | BindingFlags.Static);
            Assert.That(resolver, Is.Not.Null, "ordinary picking must resolve semantic surfaces before physics blockers");
            var arguments = new object[] { ray, views, new Func<QuestMeshView, bool>(candidate => candidate == currentView),
                _root.transform, null, null, -1, default(Vector3) };
            var found = (bool)resolver.Invoke(null, arguments);
            hitCollider = (Collider)arguments[4];
            hitView = (QuestMeshView)arguments[5];
            hitTriangle = (int)arguments[6];
            hitPoint = (Vector3)arguments[7];
            return found;
        }
    }
}
