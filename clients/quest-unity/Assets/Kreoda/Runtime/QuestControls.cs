using System;
using System.Collections.Generic;
using System.Linq;
using Kreoda.QuestFoundation;
using UnityEngine;

namespace Kreoda.QuestRuntime
{
    public sealed class QuestButton : MonoBehaviour
    {
        public Action Click;
        public bool DragPanel;
    }

    public sealed class QuestControls : MonoBehaviour
    {
        public QuestConnection Connection;
        public QuestDisplay Display;
        public QuestEnvironment Environment;
        public OVRCameraRig Rig;
        public OVRHand LeftHand, RightHand;
        public Font Font;
        public Material PanelMaterial, ButtonMaterial, RayMaterial;
        public bool PreferLeftHand;
        Transform _panel, _content, _connectionPage, _viewPage, _metricsPage;
        TextMesh _status, _target, _endpointLabel, _codeLabel, _viewStatus, _handLabel, _diagnostics;
        QuestMeshView _selected;
        MeshSemanticHit _hit;
        LineRenderer _ray;
        TouchScreenKeyboard _keyboard;
        string _endpoint = "", _code = "";
        bool _editingCode, _pinching, _requireRelease = true, _tracked, _draggingPanel, _uiLeft, _wasConnected;
        int _handMode;
        Vector3 _panelOffset;
        float _yaw;
        int _selectionMode = 1;
        int _selectedUploadVersion;
        readonly Dictionary<TextMesh, Vector2> _textLimits = new Dictionary<TextMesh, Vector2>();
        Vector3 _grabOffset, _grabStartPosition;
        Quaternion _grabStartRotation;
        float _grabDistance, _initialTrackingTime = -1;
        bool _initialPanelPlaced;

        void Start()
        {
            _endpoint = Connection.SavedEndpoint;
            _handMode = Mathf.Clamp(PlayerPrefs.GetInt("kreoda-hand-mode", 0), 0, 2);
            _uiLeft = PlayerPrefs.GetInt("kreoda-ui-left", 0) != 0;
            bool currentLayout = PlayerPrefs.GetInt("kreoda-panel-layout", 0) == 2;
            _panelOffset = currentLayout ? new Vector3(PlayerPrefs.GetFloat("kreoda-panel-x", 0),
                PlayerPrefs.GetFloat("kreoda-panel-y", 0), PlayerPrefs.GetFloat("kreoda-panel-z", 1)) : new Vector3(0, 0, 1);
            if (!ValidPanelOffset(_panelOffset))
                _panelOffset = new Vector3(0, 0, 1);
            _panel = new GameObject("Compact panel (0.42 m)").transform;
            _panel.SetParent(transform, false);
            _panel.localScale = Vector3.one * 1.65f;
            _content = _panel;
            var back = GameObject.CreatePrimitive(PrimitiveType.Cube);
            back.name = "Panel background";
            back.transform.SetParent(_panel, false);
            back.transform.localPosition = new Vector3(0, -.035f, .008f);
            back.transform.localScale = new Vector3(.42f, .42f, .008f);
            back.GetComponent<MeshRenderer>().sharedMaterial = PanelMaterial;
            back.GetComponent<Collider>().enabled = false;
            var header = Button("KREODA · trascina", new Vector3(-.08f, .145f, 0), .21f, null, .03f, .014f);
            header.transform.parent.GetComponentInChildren<QuestButton>().DragPanel = true;
            Button("PC", new Vector3(.065f, .145f, 0), .07f, () => Page(_connectionPage), .027f);
            Button("Vista", new Vector3(.15f, .145f, 0), .08f, () => Page(_viewPage), .027f);
            _status = Label(_panel, "Non connesso", new Vector3(-.19f, .115f, -.003f), .012f);
            _connectionPage = PageRoot("PC and selection");
            _content = _connectionPage;
            _endpointLabel = Button("IP del PC", new Vector3(0, .06f, 0), .38f, () => Edit(false), .032f);
            _codeLabel = Button("Codice 8 cifre", new Vector3(-.07f, .022f, 0), .24f, () => Edit(true));
            Button("Connetti", new Vector3(.13f, .022f, 0), .1f, () =>
            {
                if (_code.Length == 0 && Connection.SavedEndpoint == _endpoint) Connection.Reconnect();
                else Connection.Pair(_endpoint, _code);
                _code = "";
            });
            Button("Corpo", new Vector3(-.13f, -.03f, 0), .11f, () => _selectionMode = 0);
            Button("Faccia", new Vector3(0, -.03f, 0), .11f, () => _selectionMode = 1);
            Button("Bordo", new Vector3(.13f, -.03f, 0), .11f, () => _selectionMode = 2);
            Button("Invia target al PC", new Vector3(-.067f, -.08f, 0), .245f,
                () => Connection.PublishTarget(_selected, _hit));
            Button("Centra", new Vector3(.13f, -.08f, 0), .1f, Display.Recenter);
            _target = Label(_content, "Seleziona con il raggio", new Vector3(-.19f, -.11f, -.003f), .011f);
            _textLimits[_target] = new Vector2(.38f, .065f);
            Button("Dimentica PC", new Vector3(-.1f, -.205f, 0), .18f, Connection.Forget, .032f);
            Button("Vista MR / scale", new Vector3(.105f, -.205f, 0), .17f, () => Page(_viewPage), .032f);
            _viewPage = PageRoot("Display controls");
            _content = _viewPage;
            _viewStatus = Label(_content, "MR in avvio", new Vector3(-.19f, .088f, -.003f), .010f);
            _textLimits[_viewStatus] = new Vector2(.38f, .04f);
            Button("MR / VR", new Vector3(-.1f, .037f, 0), .18f, Environment.Toggle, .032f);
            _handLabel = Button("Mano Auto", new Vector3(.105f, .037f, 0), .17f, () =>
            { _handMode = (_handMode + 1) % 3; ResetIntent(); PlayerPrefs.SetInt("kreoda-hand-mode", _handMode); PlayerPrefs.Save(); }, .032f);
            Button("Posiziona", new Vector3(-.1f, -.01f, 0), .18f, () => Display.BeginPlacement(), .032f);
            Button("Centra CAD", new Vector3(.105f, -.01f, 0), .17f, Display.Recenter, .032f);
            Button("Conferma", new Vector3(-.13f, -.055f, 0), .11f, () => Display.ConfirmPlacement(_tracked), .032f);
            Button("Annulla", new Vector3(0, -.055f, 0), .11f, Display.CancelPlacement, .032f);
            Button("−5", new Vector3(.10f, -.055f, 0), .045f, () => Display.AdjustHeight(-.005f), .032f);
            Button("+5", new Vector3(.165f, -.055f, 0), .045f, () => Display.AdjustHeight(.005f), .032f);
            var scales = new[] { "1:10", "1:5", "1:1", "2:1", "10:1", "Fit" };
            for (int i = 0; i < scales.Length; i++)
            { var preset = scales[i]; Button(preset, new Vector3(-.16f + i * .064f, -.10f, 0), .055f, () => Display.SetScale(preset), .03f, .010f); }
            Button("Ispezione", new Vector3(-.1f, -.145f, 0), .18f, () => Quality(MeshLod.Inspection), .031f);
            Button("Normale", new Vector3(.105f, -.145f, 0), .17f, () => Quality(MeshLod.Interactive), .031f);
            Button("UI L/R", new Vector3(-.13f, -.205f, 0), .11f, () =>
            {
                _uiLeft = !_uiLeft;
                _panelOffset.x = (_uiLeft ? -1 : 1) * Mathf.Max(.25f, Mathf.Abs(_panelOffset.x));
                PlayerPrefs.SetInt("kreoda-ui-left", _uiLeft ? 1 : 0); SavePanelOffset(); RecenterPanel();
            }, .023f);
            Button("Centra UI", new Vector3(0, -.205f, 0), .11f, ResetPanel, .03f);
            Button("Metriche", new Vector3(.13f, -.205f, 0), .11f, () => Page(_metricsPage), .03f);
            _metricsPage = PageRoot("Optional diagnostics");
            _content = _metricsPage;
            _diagnostics = Label(_content, "Metriche: attendi un campione", new Vector3(-.19f, .085f, -.003f), .012f);
            _textLimits[_diagnostics] = new Vector2(.38f, .25f);
            Button("Torna a Vista", new Vector3(0, -.205f, 0), .2f, () => Page(_viewPage), .03f);
            Page(_connectionPage);
            _content = _panel;
            // A small independent menu tab stays reachable when the panel hides.
            var menu = Button("Menu", new Vector3(.30f, .335f, 0), .095f,
                TogglePanel, .03f);
            menu.transform.parent.SetParent(transform, false);
            _ray = new GameObject("Pointer ray").AddComponent<LineRenderer>();
            _ray.transform.SetParent(transform, false);
            _ray.sharedMaterial = RayMaterial;
            _ray.positionCount = 2;
            _ray.startWidth = _ray.endWidth = .0012f;
            _ray.useWorldSpace = true;
            RecenterPanel();
            Connection.SceneChanged += RefreshSelection;
        }

        public void RecenterPanel()
        {
            var head = Rig != null ? Rig.centerEyeAnchor : Camera.main?.transform;
            if (head == null) return;
            var forward = Vector3.ProjectOnPlane(head.forward, Vector3.up).normalized;
            if (forward.sqrMagnitude < .01f) forward = Vector3.forward;
            var rotation = Quaternion.LookRotation(forward, Vector3.up);
            transform.SetPositionAndRotation(head.position + rotation * _panelOffset, rotation);
        }

        public void ResetPanel()
        {
            UpdatePanelDrag(default, false, false);
            _panelOffset = new Vector3(0, 0, 1);
            _initialPanelPlaced = true;
            SavePanelOffset();
            RecenterPanel();
        }

        Transform PageRoot(string name)
        { var page = new GameObject(name).transform; page.SetParent(_panel, false); return page; }
        void Page(Transform selected)
        {
            if (_connectionPage != null) _connectionPage.gameObject.SetActive(selected == _connectionPage);
            if (_viewPage != null) _viewPage.gameObject.SetActive(selected == _viewPage);
            if (_metricsPage != null) _metricsPage.gameObject.SetActive(selected == _metricsPage);
        }
        void TogglePanel()
        {
            UpdatePanelDrag(default, false, false);
            _panel.gameObject.SetActive(!_panel.gameObject.activeSelf);
            if (_panel.gameObject.activeSelf) ResetPanel();
        }
        void Quality(MeshLod quality)
        { if (_selected == null) { _status.text = "Seleziona prima un corpo"; return; } Connection.RequestQuality(_selected, quality); }
        void SavePanelOffset()
        {
            PlayerPrefs.SetInt("kreoda-panel-layout", 2);
            PlayerPrefs.SetFloat("kreoda-panel-x", _panelOffset.x); PlayerPrefs.SetFloat("kreoda-panel-y", _panelOffset.y);
            PlayerPrefs.SetFloat("kreoda-panel-z", _panelOffset.z); PlayerPrefs.Save();
        }
        static bool Finite(Vector3 v) => !float.IsNaN(v.x) && !float.IsInfinity(v.x) &&
            !float.IsNaN(v.y) && !float.IsInfinity(v.y) && !float.IsNaN(v.z) && !float.IsInfinity(v.z);
        static bool ValidPanelOffset(Vector3 offset) => Finite(offset) && offset.magnitude <= 2 &&
            offset.z >= .45f && offset.z <= 1.5f && Mathf.Abs(offset.x) <= 1 && Mathf.Abs(offset.y) <= .65f;
        void ResetIntent()
        {
            _pinching = false; _requireRelease = true;
            UpdatePanelDrag(default, false, false);
            if (Display != null) Display.CancelPlacement();
        }

        void Edit(bool code)
        {
            _editingCode = code;
            _keyboard = TouchScreenKeyboard.Open(code ? _code : _endpoint, TouchScreenKeyboardType.Default,
                false, false, false, false, code ? "Codice dal PC" : "ws://IP del PC:porta", code ? 32 : 128);
        }

        void Update()
        {
            if (_keyboard != null)
            {
                if (_keyboard.status == TouchScreenKeyboard.Status.Done)
                {
                    if (_editingCode) _code = _keyboard.text; else _endpoint = _keyboard.text.Trim();
                    _keyboard = null;
                }
                else if (_keyboard.status == TouchScreenKeyboard.Status.Canceled ||
                    _keyboard.status == TouchScreenKeyboard.Status.LostFocus) _keyboard = null;
            }
            if (_status == null) return;
            var status = Connection.Status.Length > 46 ? Connection.Status.Substring(0, 43) + "…" : Connection.Status;
            if (_status.text != status) _status.text = status;
            var viewStatus = Display.PlacementActive ? Display.Status : Environment.Status + "\nScala " + Display.ScaleName + " · quote CAD mm";
            if (_viewStatus.text != viewStatus) _viewStatus.text = viewStatus;
            var handText = _handMode == 0 ? "Mano Auto" : _handMode == 1 ? "Mano sinistra" : "Mano destra";
            if (_handLabel.text != handText) _handLabel.text = handText;
            if (_diagnostics.text != Environment.Diagnostics) _diagnostics.text = Environment.Diagnostics;
            if (_wasConnected && !Connection.Connected) ResetIntent();
            _wasConnected = Connection.Connected;
            var endpoint = _endpoint.Length == 0 ? "IP del PC" : _endpoint;
            if (_endpointLabel.text != endpoint) _endpointLabel.text = endpoint;
            var code = _code.Length == 0 ? "Codice 8 cifre" : "Codice inserito";
            if (_codeLabel.text != code) _codeLabel.text = code;
            _tracked = Pointer(out var ray, out var clicked, out var pressed);
            if (!_tracked)
            { UpdatePanelDrag(ray, pressed, false); _ray.enabled = false; _requireRelease = true; Display.UpdatePlacement(default, _yaw, false); return; }
            if (_requireRelease) { clicked = false; if (!pressed) _requireRelease = false; }
            var direction = Vector3.ProjectOnPlane(ray.direction, Vector3.up);
            if (direction.sqrMagnitude > .01f) _yaw = Mathf.Atan2(direction.x, direction.z) * Mathf.Rad2Deg;
            Display.UpdatePlacement(ray.origin, _yaw, true);
            if (_draggingPanel)
            {
                UpdatePanelDrag(ray, pressed, true);
                _ray.enabled = true;
                _ray.SetPosition(0, ray.origin);
                _ray.SetPosition(1, ray.GetPoint(_grabDistance));
                return;
            }
            _ray.enabled = true;
            var hasHit = Physics.Raycast(ray, out var hit, 5f, ~0, QueryTriggerInteraction.Ignore);
            _ray.SetPosition(0, ray.origin);
            _ray.SetPosition(1, hasHit ? hit.point : ray.GetPoint(2));
            if (!clicked || _keyboard != null) return;
            var button = hasHit ? hit.collider.GetComponent<QuestButton>() : null;
            if (button != null)
            { if (button.DragPanel) BeginPanelDrag(ray, hit.point); else button.Click?.Invoke(); return; }
            if (Display.PlacementActive) { Display.FreezePlacement(); return; }
            if (!hasHit) return;
            var view = hit.collider.GetComponent<QuestMeshView>();
            if (view == null) return;
            if (_selected != null) _selected.ClearSelection();
            _selected = view;
            _selectedUploadVersion = view.UploadVersion;
            _hit = _selectionMode == 2 ? view.ResolveNearestEdge(hit.point, .008f) :
                _selectionMode == 1 ? view.ResolveFace(hit.triangleIndex) : null;
            if (_selectionMode == 1) view.SelectFace(_hit);
            else if (_selectionMode == 2) view.SelectEdge(_hit);
            else view.SelectBody();
            if (_selectionMode != 0 && _hit == null)
            {
                _selected = null;
                _target.text = _selectionMode == 2 ? "Avvicina il raggio a un bordo" : "Faccia senza riferimento CAD";
                return;
            }
            var box = view.BboxMetres;
            string dimensions = box == null ? "" : string.Format("{0:0.##} × {1:0.##} × {2:0.##} mm",
                (box[3] - box[0]) * 1000, (box[5] - box[2]) * 1000, (box[4] - box[1]) * 1000);
            _target.text = (_selectionMode == 0 ? "Corpo" : _selectionMode == 1 ? "Faccia" : "Bordo") +
                (view.InstanceId != null ? " · istanza" : "") + " selezionato\nIngombro CAD " + dimensions +
                (_hit?.ReferenceAmbiguous == true ? "\nFaccia/bordo non univoco: invio disattivo" : "");
        }

        void RefreshSelection()
        {
            if (_selected == null || !Connection.Views.Contains(_selected) || _selected.UploadVersion != _selectedUploadVersion)
            {
                if (_selected != null) _selected.ClearSelection();
                _selected = null;
                _hit = null;
                if (_target != null) _target.text = "Seleziona con il raggio";
            }
        }

        bool Pointer(out Ray ray, out bool clicked, out bool pressed)
        {
            ray = default;
            clicked = false;
            pressed = false;
            bool left = _handMode == 1 || (_handMode == 0 && OVRInput.GetDominantHand() == OVRInput.Handedness.LeftHanded);
            if (left != PreferLeftHand) { PreferLeftHand = left; _requireRelease = true; _pinching = false; }
            var controller = PreferLeftHand ? OVRInput.Controller.LTouch : OVRInput.Controller.RTouch;
            if (Rig != null && OVRInput.IsControllerConnected(controller) &&
                OVRInput.GetControllerPositionTracked(controller) && OVRInput.GetControllerOrientationTracked(controller))
            {
                var tracking = Rig.trackingSpace;
                ray = new Ray(tracking.TransformPoint(OVRInput.GetLocalControllerPosition(controller)),
                    tracking.rotation * OVRInput.GetLocalControllerRotation(controller) * Vector3.forward);
                clicked = OVRInput.GetDown(OVRInput.Button.PrimaryIndexTrigger, controller);
                pressed = OVRInput.Get(OVRInput.Button.PrimaryIndexTrigger, controller);
                if (OVRInput.GetDown(OVRInput.Button.Two, controller))
                    TogglePanel();
                _pinching = false;
                return true;
            }
            var hand = PreferLeftHand ? LeftHand : RightHand;
            if (hand == null || !hand.IsTracked || !hand.IsPointerPoseValid ||
                hand.HandConfidence != OVRHand.TrackingConfidence.High)
            { _pinching = false; return false; }
            bool pinching = hand.GetFingerIsPinching(OVRHand.HandFinger.Index);
            pressed = pinching;
            clicked = pinching && !_pinching;
            _pinching = pinching;
            ray = new Ray(hand.PointerPose.position, hand.PointerPose.forward);
            return true;
        }

        TextMesh Button(string text, Vector3 position, float width, Action action, float height = .039f, float textSize = .013f)
        {
            var button = GameObject.CreatePrimitive(PrimitiveType.Cube);
            button.name = text;
            button.transform.SetParent(_content, false);
            button.transform.localPosition = position;
            button.transform.localScale = new Vector3(width, height, .008f);
            button.GetComponent<MeshRenderer>().sharedMaterial = ButtonMaterial;
            button.AddComponent<QuestButton>().Click = action;
            // Keep text outside the scaled button so its glyphs stay proportional.
            var label = Label(_content, text, position + new Vector3(-width / 2 + .008f, height / 2 - .006f, -.006f), textSize);
            _textLimits[label] = new Vector2(width - .016f, height - .010f);
            var group = new GameObject(text + " control").transform;
            group.SetParent(_content, false);
            button.transform.SetParent(group, true);
            label.transform.SetParent(group, true);
            return label;
        }

        TextMesh Label(Transform parent, string text, Vector3 position, float size)
        {
            var label = new GameObject(text).AddComponent<TextMesh>();
            label.transform.SetParent(parent, false);
            label.transform.localPosition = position;
            label.font = Font;
            label.fontSize = 64;
            // TextMesh fontSize multiplies characterSize; size is a metre line height.
            label.characterSize = size * 10f / label.fontSize;
            label.anchor = TextAnchor.UpperLeft;
            label.text = text;
            label.color = Color.white;
            label.GetComponent<MeshRenderer>().sharedMaterial = Font.material;
            _textLimits[label] = new Vector2(.38f, .025f);
            return label;
        }

        void LateUpdate()
        {
            // Wait for the actual XR pose, rather than anchoring at the rig's startup origin.
            if (!_initialPanelPlaced && OVRManager.hasVrFocus && OVRPlugin.GetNodePositionTracked(OVRPlugin.Node.EyeCenter))
            {
                if (_initialTrackingTime < 0) _initialTrackingTime = Time.unscaledTime;
                if (!_draggingPanel) RecenterPanel();
                if (Time.unscaledTime - _initialTrackingTime >= .5f) _initialPanelPlaced = true;
            }
            foreach (var entry in _textLimits)
            {
                var bounds = entry.Key.GetComponent<MeshRenderer>().localBounds.size;
                float scale = Mathf.Min(1, entry.Value.x / Mathf.Max(.0001f, bounds.x),
                    entry.Value.y / Mathf.Max(.0001f, bounds.y));
                entry.Key.transform.localScale = Vector3.one * scale;
            }
        }

        void BeginPanelDrag(Ray ray, Vector3 hitPoint)
        {
            Display.CancelPlacement();
            _initialPanelPlaced = true;
            _grabStartPosition = transform.position;
            _grabStartRotation = transform.rotation;
            _grabDistance = Mathf.Clamp(Vector3.Distance(ray.origin, hitPoint), .3f, 2);
            _grabOffset = transform.position - ray.GetPoint(_grabDistance);
            _draggingPanel = true;
        }

        void UpdatePanelDrag(Ray ray, bool pressed, bool tracked)
        {
            if (!_draggingPanel) return;
            if (!tracked)
            { transform.SetPositionAndRotation(_grabStartPosition, _grabStartRotation); _draggingPanel = false; return; }
            if (pressed) { transform.position = ray.GetPoint(_grabDistance) + _grabOffset; return; }
            _draggingPanel = false;
            var head = Rig != null ? Rig.centerEyeAnchor : Camera.main?.transform;
            if (head == null) return;
            _panelOffset = Quaternion.Inverse(Quaternion.Euler(0, head.eulerAngles.y, 0)) * (transform.position - head.position);
            if (!ValidPanelOffset(_panelOffset)) { ResetPanel(); return; }
            SavePanelOffset();
        }

        void OnDestroy()
        {
            if (_keyboard != null) _keyboard.active = false;
            if (Connection != null) Connection.SceneChanged -= RefreshSelection;
        }
        void OnApplicationFocus(bool focused) { if (!focused) ResetIntent(); }
        void OnApplicationPause(bool paused) { if (paused) ResetIntent(); }
    }
}
