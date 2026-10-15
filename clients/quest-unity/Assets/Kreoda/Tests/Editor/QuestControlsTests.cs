using System.Collections;
using System.Linq;
using System.Reflection;
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
            _controls.Font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            _controls.PanelMaterial = _controls.ButtonMaterial = _controls.RayMaterial = _controls.Font.material;
            Call("Start");
        }

        [TearDown]
        public void DisposeControls()
        {
            Object.DestroyImmediate(_root);
            Object.DestroyImmediate(_head);
        }

        object Call(string method, params object[] args)
        {
            var target = typeof(QuestControls).GetMethod(method, Private);
            Assert.That(target, Is.Not.Null, method + " must implement the actual panel interaction");
            return target.Invoke(_controls, args);
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
                if (label.text == "IP del PC") label.text = "ws://192.168.100.254:65535";
            }
            yield return null;
            typeof(QuestControls).GetMethod("LateUpdate", Private)?.Invoke(_controls, null);
            Physics.SyncTransforms();
            foreach (var label in _controls.GetComponentsInChildren<TextMesh>(true))
            {
                if (!label.transform.parent.name.EndsWith(" control")) continue;
                var target = label.transform.parent.GetComponentInChildren<QuestButton>(true);
                if (target == null) continue;
                var glyphs = label.GetComponent<MeshRenderer>().bounds;
                var button = target.GetComponent<Collider>().bounds;
                Assert.That(glyphs.size.x, Is.LessThanOrEqualTo(button.size.x * .95f), label.text + " escapes its button width");
                Assert.That(glyphs.size.y, Is.LessThanOrEqualTo(button.size.y * .9f), label.text + " overlaps adjacent rows");
            }
        }

        [Test]
        public void PanelHasUsablePhysicalSizeAndRecentersAtCurrentEyeHeight()
        {
            var background = _controls.transform.Find("Compact panel (0.42 m)/Panel background");
            Assert.That(background, Is.Not.Null);
            Assert.That(background.lossyScale.x, Is.GreaterThanOrEqualTo(.65f));
            Assert.That(background.lossyScale.y, Is.GreaterThanOrEqualTo(.60f));
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
            var button = page.Find("Attiva sezione control").GetComponentInChildren<QuestButton>(true);
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
            var open = viewPage.Find("Riferimenti control").GetComponentInChildren<QuestButton>(true);
            Assert.That(open, Is.Not.Null);
            var pinch = typeof(QuestControls).GetMethod("IndexPinchStarted", Private | BindingFlags.Static);
            var start = new object[] { true, false };
            Assert.That(pinch.Invoke(null, start), Is.True);
            open.Click.Invoke();
            Assert.That(page.gameObject.activeSelf, Is.True);
            var create = page.Find("Nuovo piano control").GetComponentInChildren<QuestButton>(true);
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
                    var button = targetPage.Find(label + " control").GetComponentInChildren<QuestButton>(true);
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
            Assert.That(page.Find("Sorgente 2 control").GetComponentInChildren<TextMesh>(true).text, Does.Contain("source-long-uuid"));
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
            Physics.SyncTransforms();
            var editBounds = edit.transform.parent.GetComponentInChildren<Collider>().bounds;
            var backBounds = back.transform.parent.GetComponentInChildren<Collider>().bounds;
            Assert.That(editBounds.max.x, Is.LessThan(backBounds.min.x),
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
                if (renderer == null) continue;
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
                _controls.Rig.centerEyeAnchor.forward), Is.LessThan(.001f), "B/Y show must recover independently of the saved offset");
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
            Assert.That(Vector3.Distance(_controls.transform.position, head.position + head.forward), Is.LessThan(.001f));
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
    }
}
