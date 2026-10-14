using System;
using System.Collections.Generic;
using System.Linq;
using System.Globalization;
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
        public QuestSpatialEdit Spatial;
        public QuestCommands Commands;
        public QuestSketchDimensions SketchDimensions;
        public QuestVoice Voice;
        Transform _voicePage;
        TextMesh _voiceStatus, _voiceTranscript, _voiceReply, _voiceButton;
        public string[] SelectionForVoice() => _selectedDatum != null
            ? Connection.IsCurrentDatum(_selectedDatum) ? new[] { _selectedDatum.FeatureId } : Array.Empty<string>()
            : _selected != null && Connection.IsCurrentView(_selected) && _selected.UploadVersion == _selectedUploadVersion
                ? _hit != null && !_hit.ReferenceAmbiguous ? new[] { _hit.PersistentId } : _hit == null ? new[] { _selected.InstanceId ?? _selected.BodyId } : Array.Empty<string>()
                : Array.Empty<string>();
        Transform _sketchPage;
        TextMesh _sketchStatus;
        bool _editingSketch;
        long _sketchSelection;
        Transform _commandPage;
        TextMesh _commandStatus;
        bool _editingCommand;
        string _commandField;
        long _commandForm;
        public QuestEnvironment Environment;
        public OVRCameraRig Rig;
        public OVRHand LeftHand, RightHand;
        public Font Font;
        public Material PanelMaterial, ButtonMaterial, RayMaterial;
        public bool PreferLeftHand;
        Transform _panel, _content, _connectionPage, _viewPage, _metricsPage, _sectionPage, _editPage;
        TextMesh _editStatus, _modeLabel, _sectionStatus, _sectionToggle, _sectionQuota;
        int _exactParameter;
        bool _editingValue;
        string _valueInput = "";
        SpatialEditIntent _exactIntent;
        string _exactName;
        Dictionary<string, double> _pendingExact;
        TextMesh _valueLabel;
        readonly List<Transform> _compactMenu = new List<Transform>();
        TextMesh _status, _target, _endpointLabel, _codeLabel, _viewStatus, _handLabel, _diagnostics;
        QuestMeshView _selected;
        QuestDatumView _selectedDatum;
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
        readonly RaycastHit[] _sectionHits = new RaycastHit[128];
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
                () => { if (_selectedDatum != null) Connection.PublishTarget(_selectedDatum); else Connection.PublishTarget(_selected, _hit); });
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
            Button("Sezione", new Vector3(.13f, -.205f, 0), .11f, () => Page(_sectionPage), .03f);
            _metricsPage = PageRoot("Optional diagnostics");
            _content = _metricsPage;
            _diagnostics = Label(_content, "Metriche: attendi un campione", new Vector3(-.19f, .085f, -.003f), .012f);
            _textLimits[_diagnostics] = new Vector2(.38f, .25f);
            Button("Torna a Vista", new Vector3(0, -.205f, 0), .2f, () => Page(_viewPage), .03f);
            _sectionPage = PageRoot("Section view");
            _content = _sectionPage;
            _sectionStatus = Label(_content, "Sezione spenta", new Vector3(-.19f, .105f, -.003f), .012f);
            _textLimits[_sectionStatus] = new Vector2(.38f, .04f);
            _sectionToggle = Button("Attiva sezione", new Vector3(0, .055f, 0), .31f, ToggleSection, .036f, .012f);
            Button("X", new Vector3(-.13f, .008f, 0), .075f, () => SetSectionAxis(SectionAxis.X), .034f);
            Button("Y", new Vector3(0, .008f, 0), .075f, () => SetSectionAxis(SectionAxis.Y), .034f);
            Button("Z", new Vector3(.13f, .008f, 0), .075f, () => SetSectionAxis(SectionAxis.Z), .034f);
            Button("−5 mm", new Vector3(-.11f, -.042f, 0), .12f, () => AdjustSectionQuota(-5), .034f, .011f);
            _sectionQuota = Label(_content, "Quota —", new Vector3(-.045f, -.036f, -.003f), .011f);
            _textLimits[_sectionQuota] = new Vector2(.09f, .034f);
            Button("+5 mm", new Vector3(.11f, -.042f, 0), .12f, () => AdjustSectionQuota(5), .034f, .011f);
            Button("Inverti", new Vector3(-.09f, -.092f, 0), .15f, InvertSection, .034f, .011f);
            Button("Azzera", new Vector3(.09f, -.092f, 0), .15f, ResetSection, .034f, .011f);
            Button("Indietro", new Vector3(-.095f, -.175f, 0), .15f, () => Page(_viewPage), .034f, .011f);
            Button("Metriche", new Vector3(.095f, -.175f, 0), .15f, () => Page(_metricsPage), .034f, .011f);
            _editPage = PageRoot("Exact CAD editing");_content = _editPage;
            _editStatus = Label(_content, "Seleziona una quota", new Vector3(-.19f, .085f, -.003f), .012f);
            _textLimits[_editStatus] = new Vector2(.38f, .10f);
            Button("Valore esatto", new Vector3(-.1f, -.04f, 0), .18f, EditValue, .032f);
            Button("Parametro →", new Vector3(.105f, -.04f, 0), .17f, () => _exactParameter++, .032f);
            Button("Feature →", new Vector3(-.1f, -.10f, 0), .18f, () => Spatial?.NextOwner(), .032f);
            Button("Snap 0.1mm / 5deg", new Vector3(.105f, -.10f, 0), .17f, () => { if (Spatial != null) Spatial.SnapEnabled = !Spatial.SnapEnabled; }, .032f, .011f);
            Button("Annulla modifica", new Vector3(0, -.17f, 0), .30f, () => Spatial?.Cancel(), .032f);
            Button("Azioni CAD", new Vector3(0, -.215f, 0), .30f, () => Page(_commandPage), .032f);
            _commandPage = PageRoot("Canonical context actions");_content = _commandPage;
            _commandStatus = Label(_content, "Seleziona geometria", new Vector3(-.19f, .085f, -.003f), .012f);
            _textLimits[_commandStatus] = new Vector2(.38f, .13f);
            Button("Azione →", new Vector3(-.1f, -.06f, 0), .18f, () => Commands?.NextCommand(), .032f);
            Button("Campo →", new Vector3(.105f, -.06f, 0), .17f, () => Commands?.NextField(), .032f);
            Button("Valore", new Vector3(-.1f, -.12f, 0), .18f, EditCommandField, .032f);
            Button("Conferma", new Vector3(.105f, -.12f, 0), .17f, () => Commands?.Confirm(), .032f);
            Button("Undo", new Vector3(-.1f, -.19f, 0), .18f, () => Commands?.History(false), .032f);
            Button("Redo", new Vector3(.105f, -.19f, 0), .17f, () => Commands?.History(true), .032f);
            Button("Quote sketch", new Vector3(0, -.235f, 0), .30f, () => { SketchDimensions?.Select();Page(_sketchPage); }, .028f);
            _sketchPage = PageRoot("Canonical sketch dimensions");_content = _sketchPage;
            _sketchStatus = Label(_content, "Seleziona uno sketch", new Vector3(-.19f, .085f, -.003f), .012f);
            _textLimits[_sketchStatus] = new Vector2(.38f, .11f);
            Button("Sketch →", new Vector3(-.1f, -.05f, 0), .18f, () => SketchDimensions?.NextSketch(), .032f);
            Button("Quota →", new Vector3(.105f, -.05f, 0), .17f, () => SketchDimensions?.NextDimension(), .032f);
            Button("Valore esatto", new Vector3(-.1f, -.11f, 0), .18f, EditSketchValue, .032f);
            Button("Conferma", new Vector3(.105f, -.11f, 0), .17f, () => SketchDimensions?.Confirm(), .032f);
            Button("Annulla", new Vector3(-.1f, -.17f, 0), .18f, () => SketchDimensions?.Cancel(), .032f);
            Button("Undo", new Vector3(.105f, -.17f, 0), .17f, () => Commands?.History(false), .032f);
            if (Voice != null)
            {
                _voicePage = PageRoot("Hermes voice");_content = _voicePage;
                _voiceStatus = Label(_content, "Hermes", new Vector3(-.19f, .09f, -.003f), .012f);
                _textLimits[_voiceStatus] = new Vector2(.38f, .05f);
                _voiceTranscript = Label(_content, "Premi Parla e poi Invia", new Vector3(-.19f, .025f, -.003f), .012f);
                _textLimits[_voiceTranscript] = new Vector2(.38f, .085f);
                _voiceReply = Label(_content, "", new Vector3(-.19f, -.075f, -.003f), .012f);
                _textLimits[_voiceReply] = new Vector2(.38f, .09f);
                _voiceStatus.richText = _voiceTranscript.richText = _voiceReply.richText = false;
                Button("Parla / Invia", new Vector3(-.1f, -.205f, 0), .18f, Voice.Toggle, .032f);
                Button("Stop", new Vector3(.105f, -.205f, 0), .17f, Voice.Cancel, .032f);
            }
            Page(_connectionPage);
            _content = _panel;
            // A small independent menu tab stays reachable when the panel hides.
            var menu = Button("Menu", new Vector3(.30f, .335f, 0), .095f,
                TogglePanel, .03f);
            menu.transform.parent.SetParent(transform, false);
            _compactMenu.Add(menu.transform.parent);
            if (Voice != null)
            {
                _voiceButton = Button("Parla", new Vector3(.005f, .29f, 0), .11f, () => { Voice.Toggle(); }, .03f);
                _voiceButton.transform.parent.SetParent(transform, false);_compactMenu.Add(_voiceButton.transform.parent);
                var voicePage = Button("Hermes", new Vector3(.13f, .245f, 0), .15f, () => {
                    _panel.gameObject.SetActive(true);Page(_voicePage);ResetPanel();
                }, .03f);
                voicePage.transform.parent.SetParent(transform, false);_compactMenu.Add(voicePage.transform.parent);
            }
            if (Spatial != null)
            {
                _modeLabel = Button("Modello", new Vector3(.04f, .335f, 0), .14f,
                    () => { Display.EndTwoHand(false);Spatial.SetMode(!Spatial.EditMode); }, .03f);
                _modeLabel.transform.parent.SetParent(transform, false);
                _compactMenu.Add(_modeLabel.transform.parent);
                var exact = Button("Valore", new Vector3(.18f, .335f, 0), .1f, EditValue, .03f);
                exact.transform.parent.SetParent(transform, false);
                _valueLabel = exact;_compactMenu.Add(exact.transform.parent);
                if (Commands != null)
                {
                    var undo = Button("Undo", new Vector3(.13f, .29f, 0), .11f, () => Commands.History(false), .03f);
                    undo.transform.parent.SetParent(transform, false);_compactMenu.Add(undo.transform.parent);
                    var redo = Button("Redo", new Vector3(.255f, .29f, 0), .11f, () => Commands.History(true), .03f);
                    redo.transform.parent.SetParent(transform, false);_compactMenu.Add(redo.transform.parent);
                }
                _panel.gameObject.SetActive(false);
            }
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
            if (_sectionPage != null) _sectionPage.gameObject.SetActive(selected == _sectionPage);
            if (_editPage != null) _editPage.gameObject.SetActive(selected == _editPage);
            if (_commandPage != null) _commandPage.gameObject.SetActive(selected == _commandPage);
            if (_sketchPage != null) _sketchPage.gameObject.SetActive(selected == _sketchPage);
            if (_voicePage != null) _voicePage.gameObject.SetActive(selected == _voicePage);
        }
        void TogglePanel()
        {
            UpdatePanelDrag(default, false, false);
            _panel.gameObject.SetActive(!_panel.gameObject.activeSelf);
            if (_panel.gameObject.activeSelf) { if (Spatial != null) Page(Spatial.EditMode ? _editPage : _viewPage);ResetPanel(); }
        }
        void Quality(MeshLod quality)
        { if (_selected == null) { _status.text = "Seleziona prima un corpo"; return; } Connection.RequestQuality(_selected, quality); }
        void ToggleSection() { if (Connection != null && Connection.Section != null) Connection.Section.Toggle(); }
        void SetSectionAxis(SectionAxis axis) { if (Connection != null && Connection.Section != null) Connection.Section.TrySetAxis(axis); }
        void AdjustSectionQuota(double step)
        {
            var section = Connection != null ? Connection.Section : null;
            if (section != null && section.Plane.HasValue) section.TrySetOffsetMm(section.Plane.Value.OffsetMm + step);
        }
        void InvertSection()
        {
            var section = Connection != null ? Connection.Section : null;
            if (section != null && section.Plane.HasValue) section.SetInverted(!section.Plane.Value.Inverted);
        }
        void ResetSection() { if (Connection != null && Connection.Section != null) Connection.Section.ResetView(); }
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
            if (_editingValue || _editingCommand || _editingSketch)
            {
                _editingValue = false;
                _editingCommand = false;
                _editingSketch = false;
                if (_keyboard != null) _keyboard.active = false;
                _keyboard = null;
            }
            _pendingExact = null;_exactIntent = null;
            _pinching = false; _requireRelease = true;
            UpdatePanelDrag(default, false, false);
            if (Display != null) Display.CancelPlacement();
            if (Display != null) Display.EndTwoHand(false);
            if (Spatial != null) Spatial.Cancel();
        }

        void Edit(bool code)
        {
            _editingValue = false;
            _editingCommand = false;
            _editingCode = code;
            _keyboard = TouchScreenKeyboard.Open(code ? _code : _endpoint, TouchScreenKeyboardType.Default,
                false, false, false, false, code ? "Codice dal PC" : "ws://IP del PC:porta", code ? 32 : 128);
        }
        void EditValue()
        {
            _editingCommand = false;
            var intent = Spatial?.SelectedIntent;
            if (intent == null || Spatial.Busy) return;
            if (_pendingExact != null && ReferenceEquals(intent, _exactIntent))
            { Spatial.Exact(_pendingExact);_pendingExact = null;return; }
            _pendingExact = null;_exactIntent = intent;
            _exactParameter %= intent.Parameters.Count;_editingValue = true;
            _exactName = intent.Parameters[_exactParameter];
            _valueInput = (Spatial.DraftValues ?? intent.InitialValues)[intent.Parameters[_exactParameter]].ToString("R", CultureInfo.InvariantCulture);
            _keyboard = TouchScreenKeyboard.Open(_valueInput, TouchScreenKeyboardType.NumbersAndPunctuation,
                false, false, false, false, intent.Parameters[_exactParameter] + " · " + intent.Unit, 64);
        }
        void EditCommandField()
        {
            _editingSketch = false;
            if (Commands == null || Commands.Busy || Commands.SelectedField == null) return;
            _editingValue = false;_editingCommand = true;_commandField = Commands.SelectedField;_commandForm = Commands.FormTicket;
            _valueInput = Commands.FieldValue.Trim('"');
            _keyboard = TouchScreenKeyboard.Open(_valueInput, TouchScreenKeyboardType.Default, false, false, false, false, _commandField, 4096);
        }
        void EditSketchValue()
        {
            if (SketchDimensions?.Selected == null || SketchDimensions.Busy) return;
            _editingValue = _editingCommand = false;_editingSketch = true;_sketchSelection = SketchDimensions.SelectionTicket;
            _valueInput = SketchDimensions.Value.ToString("R", CultureInfo.InvariantCulture);
            _keyboard = TouchScreenKeyboard.Open(_valueInput, TouchScreenKeyboardType.NumbersAndPunctuation,
                false, false, false, false, SketchDimensions.Selected.Kind + " · " + SketchDimensions.Selected.Unit, 64);
        }

        void Update()
        {
            if (_keyboard != null)
                ApplyKeyboardInput(_keyboard.text, _keyboard.status);
            if (_status == null) return;
            if (Voice != null)
            {
                _voiceStatus.text = ShortVoiceText(Voice.Status, 120);
                _voiceTranscript.text = ShortVoiceText(Voice.Transcript, 160);
                _voiceReply.text = ShortVoiceText(Voice.Reply, 260);
                _voiceButton.text = Voice.Recording ? "Invia" : Voice.Busy ? "Stop" : "Parla";
            }
            var status = Connection.Status.Length > 46 ? Connection.Status.Substring(0, 43) + "…" : Connection.Status;
            if (_status.text != status) _status.text = status;
            var viewStatus = Display.PlacementActive ? Display.Status : Environment.Status + "\nScala " + Display.ScaleName + " · quote CAD mm";
            if (_viewStatus.text != viewStatus) _viewStatus.text = viewStatus;
            if (_sectionStatus != null && Connection.Section != null)
            {
                _sectionStatus.text = Connection.Section.Status;
                _sectionToggle.text = Connection.Section.Enabled ? "Disattiva sezione" : "Attiva sezione";
                _sectionQuota.text = Connection.Section.Plane.HasValue
                    ? Connection.Section.Plane.Value.OffsetMm.ToString("0.###", CultureInfo.InvariantCulture) + " mm"
                    : "Quota —";
            }
            var handText = _handMode == 0 ? "Mano Auto" : _handMode == 1 ? "Mano sinistra" : "Mano destra";
            if (_handLabel.text != handText) _handLabel.text = handText;
            if (_diagnostics.text != Environment.Diagnostics) _diagnostics.text = Environment.Diagnostics;
            if (Commands != null) _commandStatus.text = Commands.CommandLabel + "\n" + Commands.FieldLabel + " · " + Commands.FieldValue + "\n" + Commands.Status;
            if (SketchDimensions != null) _sketchStatus.text = SketchDimensions.Status + (SketchDimensions.Selected == null ? "" :
                "\n" + SketchDimensions.Value.ToString("0.###", CultureInfo.InvariantCulture) + " " + SketchDimensions.Selected.Unit);
            if (Spatial != null)
            {
                if (_modeLabel != null) _modeLabel.text = Spatial.EditMode ? "Modifica" : "Modello";
                if (_valueLabel != null) _valueLabel.text = _pendingExact != null && ReferenceEquals(Spatial.SelectedIntent, _exactIntent) ? "Applica" : "Valore";
                var intent = Spatial.SelectedIntent;
                _editStatus.text = Spatial.Status + (intent == null ? "" : "\n" + intent.FeatureId + " · " +
                    intent.Parameters[_exactParameter % intent.Parameters.Count] + " · " + intent.Unit) +
                    "\nSnap " + (Spatial.SnapEnabled ? "attivo" : "spento");
                if (!Spatial.EditMode && TwoHandInput()) { _ray.enabled = false;_requireRelease = true;return; }
                if (Spatial.Busy && !Spatial.Holding) { _ray.enabled = false;return; }
            }
            if (_wasConnected && !Connection.Connected) ResetIntent();
            _wasConnected = Connection.Connected;
            var endpoint = _endpoint.Length == 0 ? "IP del PC" : _endpoint;
            if (_endpointLabel.text != endpoint) _endpointLabel.text = endpoint;
            var code = _code.Length == 0 ? "Codice 8 cifre" : "Codice inserito";
            if (_codeLabel.text != code) _codeLabel.text = code;
            _tracked = Pointer(out var ray, out var clicked, out var pressed, out var orientation);
            if (Spatial != null && Spatial.Holding)
            { Spatial.Drag(ray, orientation, pressed, _tracked);_ray.enabled = false;return; }
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
            var hasHit = false;
            var hitPoint = default(Vector3);
            var hitTriangle = -1;
            Collider hitCollider = null;
            QuestMeshView hitView = null;
            if (Connection.Section != null && Connection.Section.Enabled && Connection.Section.Plane.HasValue)
            {
                var count = Physics.RaycastNonAlloc(ray, _sectionHits, 5f, ~0, QueryTriggerInteraction.Ignore);
                var nonCadDistance = 5f;
                RaycastHit nonCadHit = default;
                for (var i = 0; i < count; i++)
                {
                    var candidate = _sectionHits[i];
                    if (candidate.collider == null || candidate.collider.GetComponent<QuestMeshView>() != null ||
                        candidate.distance >= nonCadDistance) continue;
                    nonCadDistance = candidate.distance;
                    nonCadHit = candidate;
                }
                var hasNative = Connection.Section.TryRaycastVisible(ray, nonCadDistance,
                    out var nativeView, out var nativeTriangle, out var nativePoint, out var nativeDistance);
                if (hasNative && (!nonCadHit.collider || nativeDistance < nonCadDistance))
                {
                    hasHit = true;hitView = nativeView;hitTriangle = nativeTriangle;hitPoint = nativePoint;
                }
                else if (nonCadHit.collider)
                {
                    hasHit = true;hitCollider = nonCadHit.collider;hitPoint = nonCadHit.point;
                    hitTriangle = nonCadHit.triangleIndex;
                }
            }
            else if (Physics.Raycast(ray, out var hit, 5f, ~0, QueryTriggerInteraction.Ignore))
            {
                hasHit = true;hitCollider = hit.collider;hitPoint = hit.point;hitTriangle = hit.triangleIndex;
                hitView = hit.collider.GetComponent<QuestMeshView>();
            }
            _ray.SetPosition(0, ray.origin);
            _ray.SetPosition(1, hasHit ? hitPoint : ray.GetPoint(2));
            if (!clicked || _keyboard != null) return;
            var button = hitCollider != null ? hitCollider.GetComponent<QuestButton>() : null;
            if (button != null)
            { if (button.DragPanel) BeginPanelDrag(ray, hitPoint); else button.Click?.Invoke(); return; }
            if (Display.PlacementActive) { Display.FreezePlacement(); return; }
            if (!hasHit) return;
            if (hitCollider != null && Connection.Section != null && Connection.Section.IsSectionCapCollider(hitCollider))
            { _target.text = "Piano di sezione solo visivo · nessun target CAD";return; }
            var edit = hitCollider != null ? hitCollider.GetComponent<QuestEditHandle>() : null;
            if (Spatial != null && edit != null && Spatial.Begin(edit, ray, hitPoint, orientation)) return;
            var datum = hitCollider != null ? hitCollider.GetComponentInParent<QuestDatumView>() : null;
            if (datum != null) { SelectDatum(datum);return; }
            var view = hitView ?? (hitCollider != null ? hitCollider.GetComponent<QuestMeshView>() : null);
            if (view == null) return;
            if (_selectedDatum != null) _selectedDatum.SetSelected(false);
            _selectedDatum = null;
            if (_selected != null) _selected.ClearSelection();
            _selected = view;
            if (Spatial != null) Spatial.Select(view);
            _selectedUploadVersion = view.UploadVersion;
            var activeSection = Connection.Section != null && Connection.Section.Enabled ? Connection.Section.Plane : null;
            _hit = _selectionMode == 2 ? view.ResolveNearestEdge(hitPoint, .008f, activeSection, Connection.DisplayRoot) :
                _selectionMode == 1 ? view.ResolveFace(hitTriangle) : null;
            if (_selectionMode == 1) view.SelectFace(_hit);
            else if (_selectionMode == 2) view.SelectEdge(_hit);
            else view.SelectBody();
            if (Commands != null) Commands.Select(view, _hit);
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

        void ApplyKeyboardInput(string text, TouchScreenKeyboard.Status status)
        {
            if (_editingSketch)
            {
                if (!string.IsNullOrEmpty(text)) _valueInput = text;
                if (status == TouchScreenKeyboard.Status.Visible) return;
                _keyboard = null;_editingSketch = false;
                if (status != TouchScreenKeyboard.Status.Canceled && SketchDimensions != null && SketchDimensions.SelectionTicket == _sketchSelection &&
                    double.TryParse(_valueInput.Replace(',', '.'), NumberStyles.Float, CultureInfo.InvariantCulture, out var number) &&
                    !double.IsNaN(number) && !double.IsInfinity(number)) SketchDimensions.Preview(number);
                return;
            }
            if (_editingCommand)
            {
                if (!string.IsNullOrEmpty(text)) _valueInput = text;
                if (status == TouchScreenKeyboard.Status.Visible) return;
                _keyboard = null;_editingCommand = false;
                if (status != TouchScreenKeyboard.Status.Canceled && Commands != null && Commands.FormTicket == _commandForm)
                    Commands.SetField(_commandField, _valueInput);
                return;
            }
            if (_editingValue)
            {
                if (!string.IsNullOrEmpty(text)) _valueInput = text;
                if (status == TouchScreenKeyboard.Status.Visible) return;
                _keyboard = null;_editingValue = false;
                if (status == TouchScreenKeyboard.Status.Canceled || Spatial?.SelectedIntent == null ||
                    !ReferenceEquals(Spatial.SelectedIntent, _exactIntent)) return;
                if (double.TryParse(_valueInput.Replace(',', '.'), NumberStyles.Float, CultureInfo.InvariantCulture, out var value) &&
                    !double.IsNaN(value) && !double.IsInfinity(value))
                {
                    var intent = Spatial.SelectedIntent;
                    var values = (Spatial.DraftValues ?? intent.InitialValues).ToDictionary(p => p.Key, p => p.Value);
                    values[_exactName] = value;
                    if (status == TouchScreenKeyboard.Status.Done) Spatial.Exact(values);
                    else _pendingExact = values;
                }
                return;
            }
            // Quest's keyboard may close with LostFocus instead of Done.
            // Capture live text and retain it if the closing keyboard clears its buffer.
            if (status == TouchScreenKeyboard.Status.Visible || status == TouchScreenKeyboard.Status.Done ||
                !string.IsNullOrEmpty(text))
            {
                if (_editingCode) _code = text ?? ""; else _endpoint = (text ?? "").Trim();
            }
            if (status != TouchScreenKeyboard.Status.Visible) _keyboard = null;
        }

        bool SelectDatum(QuestDatumView view)
        {
            if (!Connection.IsCurrentDatum(view)) return false;
            if (_selected != null) _selected.ClearSelection();
            if (_selectedDatum != null) _selectedDatum.SetSelected(false);
            _selected = null;_hit = null;_selectedDatum = view;
            view.SetSelected(true);
            Spatial?.Select(null);
            Commands?.SelectDatum(view);
            _target.text = (view.NativeKind == "DatumPlane" ? "Piano" : view.NativeKind == "DatumAxis" ? "Asse" : "Punto") +
                " selezionato\n" + view.FeatureId;
            return true;
        }

        static string ShortVoiceText(string text, int limit) => text.Length <= limit ? text : text.Substring(0, limit - 1) + "…";
        void RefreshSelection()
        {
            if (_selectedDatum != null)
            {
                if (Connection.IsCurrentDatum(_selectedDatum)) return;
                _selectedDatum.SetSelected(false);_selectedDatum = null;
            }
            if (_selected == null || !Connection.Views.Contains(_selected) || _selected.UploadVersion != _selectedUploadVersion)
            {
                if (_selected != null) _selected.ClearSelection();
                _selected = null;
                _hit = null;
                if (_target != null) _target.text = "Seleziona con il raggio";
            }
        }

        int _pointerSource, _modelLeftSource, _modelRightSource;
        bool _modelRequireRelease;
        static int ChooseInputSource(bool hand, bool controller, bool left) => hand ? (left ? 1 : 2) : controller ? (left ? 3 : 4) : 0;
        void SetPointerSource(int source)
        {
            if (_pointerSource == source) return;
            ResetIntent();_pointerSource = source;
        }
        bool Pose(bool left, out Ray ray, out Quaternion rotation, out int source)
        {
            ray = default;rotation = Quaternion.identity;
            var hand = left ? LeftHand : RightHand;
            bool trackedHand = hand != null && hand.IsTracked && hand.IsPointerPoseValid && hand.HandConfidence == OVRHand.TrackingConfidence.High;
            var controller = left ? OVRInput.Controller.LTouch : OVRInput.Controller.RTouch;
            bool trackedController = !trackedHand && Rig != null && OVRInput.IsControllerConnected(controller) &&
                OVRInput.GetControllerPositionTracked(controller) && OVRInput.GetControllerOrientationTracked(controller);
            source = ChooseInputSource(trackedHand, trackedController, left);
            if (source == 0) return false;
            if (source <= 2) { ray = new Ray(hand.PointerPose.position, hand.PointerPose.forward);rotation = hand.PointerPose.rotation; }
            else {
                rotation = Rig.trackingSpace.rotation * OVRInput.GetLocalControllerRotation(controller);
                ray = new Ray(Rig.trackingSpace.TransformPoint(OVRInput.GetLocalControllerPosition(controller)), rotation * Vector3.forward);
            }
            return true;
        }
        bool Pointer(out Ray ray, out bool clicked, out bool pressed, out Quaternion orientation)
        {
            clicked = pressed = false;
            bool left = _handMode == 1 || (_handMode == 0 && OVRInput.GetDominantHand() == OVRInput.Handedness.LeftHanded);
            PreferLeftHand = left;
            bool tracked = Pose(left, out ray, out orientation, out var source);
            SetPointerSource(source);
            if (!tracked) return false;
            if (source <= 2) {
                var hand = left ? LeftHand : RightHand;
                pressed = hand.GetFingerIsPinching(OVRHand.HandFinger.Index);clicked = IndexPinchStarted(pressed, ref _pinching);
            } else {
                var controller = left ? OVRInput.Controller.LTouch : OVRInput.Controller.RTouch;
                clicked = OVRInput.GetDown(OVRInput.Button.PrimaryIndexTrigger, controller);pressed = OVRInput.Get(OVRInput.Button.PrimaryIndexTrigger, controller);
                if (OVRInput.GetDown(OVRInput.Button.Two, controller)) TogglePanel();
                _pinching = false;
            }
            return true;
        }
        static bool IndexPinchStarted(bool pressed, ref bool pinching)
        { var clicked = pressed && !pinching;pinching = pressed;return clicked; }
        bool TwoHandInput()
        {
            bool Sample(bool left, out Vector3 point, out bool held, out int source)
            {
                bool tracked = Pose(left, out var ray, out _, out source);point = ray.origin;held = false;
                if (!tracked) return false;
                held = source <= 2 ? (left ? LeftHand : RightHand).GetFingerIsPinching(OVRHand.HandFinger.Index) :
                    OVRInput.Get(OVRInput.Button.PrimaryHandTrigger, left ? OVRInput.Controller.LTouch : OVRInput.Controller.RTouch);
                return true;
            }
            bool leftTracked = Sample(true, out var left, out var leftHeld, out var leftSource);
            bool rightTracked = Sample(false, out var right, out var rightHeld, out var rightSource);
            if (Display.TwoHandActive) {
                if (!leftTracked || !rightTracked || leftSource != _modelLeftSource || rightSource != _modelRightSource)
                { Display.EndTwoHand(false);_modelRequireRelease = true; }
                else if (!leftHeld || !rightHeld) { Display.EndTwoHand(true);_modelRequireRelease = true; }
                else Display.UpdateTwoHand(left, right, true);
                return true;
            }
            if (_modelRequireRelease) { if (!leftHeld && !rightHeld) _modelRequireRelease = false;return false; }
            if (!leftTracked || !rightTracked || !leftHeld || !rightHeld || _draggingPanel || _keyboard != null || !Display.BeginTwoHand(left, right)) return false;
            _modelLeftSource = leftSource;_modelRightSource = rightSource;return true;
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
            if (Spatial != null)
            {
                var head = Rig != null ? Rig.centerEyeAnchor : Camera.main?.transform;
                bool palm = LeftHand != null && LeftHand.IsTracked && LeftHand.IsPointerPoseValid &&
                    LeftHand.HandConfidence == OVRHand.TrackingConfidence.High && head != null;
                if (palm)
                {
                    var point = LeftHand.PointerPose.position + head.right * .04f + head.up * .08f;
                    var rotation = Quaternion.LookRotation(point - head.position, head.up);
                    foreach (var group in _compactMenu) group.SetPositionAndRotation(point - rotation * new Vector3(.18f, .335f, 0), rotation);
                }
                else foreach (var group in _compactMenu) { group.localPosition = Vector3.zero;group.localRotation = Quaternion.identity; }
            }
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
