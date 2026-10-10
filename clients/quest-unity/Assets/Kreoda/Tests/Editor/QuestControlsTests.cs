using System.Collections;
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
