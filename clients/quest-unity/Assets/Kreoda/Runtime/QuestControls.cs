using System;
using System.Collections.Generic;
using System.Linq;
using System.Globalization;
using System.Collections.Concurrent;
using System.Threading;
using System.Threading.Tasks;
using Kreoda.QuestFoundation;
using UnityEngine;

namespace Kreoda.QuestRuntime
{
    public sealed class QuestButton : MonoBehaviour
    {
        public Action Click;
        public bool DragPanel;
        public string ActionId;
    }

    public sealed class QuestControls : MonoBehaviour
    {
        public QuestConnection Connection;
        public QuestDisplay Display;
        public QuestSpatialEdit Spatial;
        public QuestCommands Commands;
        public QuestReferences References;
        public QuestSketchDimensions SketchDimensions;
        public QuestVoice Voice;
        public QuestHome Home;
        public QuestAssemblyMates AssemblyMates;
        public QuestDirectFaceHistory DirectFaceHistory;
        // Room discovery requires a deliberate MR button click. Starting the
        // application cannot request permission or scan a user's room.
        QuestRoomSurfaceProvider _roomSurfaceProvider;
        bool _roomDiscoveryRequested;
        string _roomActionStatus;
#if UNITY_EDITOR
        // Synthetic room hits exist ONLY in the Editor tests. Android APK
        // always consults the genuine Meta scene anchor provider.
        internal Func<Ray, QuestRoomSurfaceProvider.SurfaceHit?> EditorRoomTableContact;
#endif
        Transform _voicePage, _voiceContextPage;
        TextMesh _voiceStatus, _voiceTranscript, _voiceReply, _voiceButton;
        TextMesh _voiceModeReadout, _voiceContextStatus, _voiceContextSummary;
        QuestVoiceContext _voiceContext;
        GameObject _voicePointMarker;
        public string[] SelectionForVoice()
        {
            if (_voiceContext != null && _voiceContext.ExplicitMode)
            {
                _voiceContext.Refresh(QuestVoiceContext.CaptureFence(Connection), Connection?.DisplayRoot);
                return _voiceContext.SelectionIds();
            }
            return _selectedDatum != null
            ? Connection.IsCurrentDatum(_selectedDatum) ? new[] { _selectedDatum.FeatureId } : Array.Empty<string>()
            : _selected != null && Connection.IsCurrentView(_selected) && _selected.UploadVersion == _selectedUploadVersion
                ? _hit != null && !_hit.ReferenceAmbiguous ? new[] { _hit.PersistentId } : _hit == null ? new[] { _selected.InstanceId ?? _selected.BodyId } : Array.Empty<string>()
                : Array.Empty<string>();
        }

        public Dictionary<string, object> SemanticContextForVoice()
        {
            if (_voiceContext != null && _voiceContext.ExplicitMode)
            {
                _voiceContext.Refresh(QuestVoiceContext.CaptureFence(Connection), Connection?.DisplayRoot);
                return _voiceContext.SemanticContext();
            }
            if (Connection == null) return null;
            if (_selectedDatum != null)
                return Connection.IsCurrentDatum(_selectedDatum)
                    ? QuestSemanticContext.Build(_selectedDatum.SelectionKind, _selectedDatum.FeatureId, null, _selectedDatum.FeatureId)
                    : null;
            if (_selected == null || !Connection.IsCurrentView(_selected) ||
                _selected.UploadVersion != _selectedUploadVersion || (_hit != null && _hit.ReferenceAmbiguous)) return null;
            var kind = _hit == null ? (_selected.InstanceId == null ? "body" : "instance") :
                _selectionMode == 1 ? "face" : _selectionMode == 2 ? "edge" : null;
            return QuestSemanticContext.Build(kind, _hit?.PersistentId ?? _selected.InstanceId ?? _selected.BodyId,
                _selected.BodyId, _selected.FeatureId, _selected.InstanceId);
        }

        internal bool TryCaptureVoiceSnapshot(out QuestVoiceContext.VoiceSnapshot snapshot, out string error)
        {
            if (_voiceContext != null && _voiceContext.ExplicitMode)
                return _voiceContext.TryCaptureSnapshot(QuestVoiceContext.CaptureFence(Connection),
                    Connection != null ? Connection.DisplayRoot : null, out snapshot, out error);
            var context = SemanticContextForVoice();
            var json = context != null ? System.Text.Json.JsonSerializer.Serialize(context) : null;
            var source = _selectedDatum != null ? (object)_selectedDatum : _selected;
            snapshot = new QuestVoiceContext.VoiceSnapshot(QuestVoiceContext.CaptureFence(Connection),
                SelectionForVoice(), json, false, _voiceContext != null ? _voiceContext.Version : 0,
                source != null ? new[] { source } : Array.Empty<object>(),
                _selectedDatum == null && _selected != null ? new[] { _selectedUploadVersion } : Array.Empty<int>());
            error = null;return true;
        }

        internal bool IsVoiceSnapshotCurrent(QuestVoiceContext.VoiceSnapshot snapshot)
        {
            return snapshot != null && TryCaptureVoiceSnapshot(out var current, out _) && snapshot.Matches(current);
        }

        void OpenVoiceContextPage()
        {
            _voiceContext.EnterExplicit(QuestVoiceContext.CaptureFence(Connection));
            Page(_voiceContextPage);RefreshVoiceContextUi();
        }

        void UseSingleVoiceContext()
        {
            _voiceContext.DisableExplicit();
            Page(_voicePage);RefreshVoiceContextUi();
        }

        void ClearVoiceContext()
        {
            _voiceContext.ClearCollection();RefreshVoiceContextUi();
        }

        void ArmVoicePoint()
        {
            if (Spatial != null && (Spatial.EditMode || Spatial.Busy || Spatial.Holding) ||
                Display != null && (Display.TwoHandActive || Display.PlacementActive) ||
                AssemblyMates != null && AssemblyMates.Busy || DirectFaceHistory != null && DirectFaceHistory.Busy)
            { _voiceContext.Report("Punto non armato · termina prima l'operazione attiva");return; }
            _voiceContext.ArmPoint(QuestVoiceContext.CaptureFence(Connection), _pointerSource);
            RefreshVoiceContextUi();
        }

        void RefreshVoiceContextUi()
        {
            if (_voiceContext == null) return;
            if (_voiceModeReadout != null)
                SetReadout(_voiceModeReadout, _voiceContext.ExplicitMode
                    ? "Voce invia raccolta esplicita · " + _voiceContext.Count.ToString(CultureInfo.InvariantCulture) + " riferimenti"
                    : "Voce singola · selezione CAD corrente");
            if (_voiceContextSummary != null) SetReadout(_voiceContextSummary, _voiceContext.Summary);
            if (_voiceContextStatus != null) SetReadout(_voiceContextStatus, _voiceContext.Status);
            if (!_voiceContext.HasPoint)
            {
                if (_voicePointMarker != null) _voicePointMarker.SetActive(false);
                return;
            }
            if (_voicePointMarker == null)
            {
                _voicePointMarker = GameObject.CreatePrimitive(PrimitiveType.Sphere);
                _voicePointMarker.name = "Runtime voice reference point";
                var collider = _voicePointMarker.GetComponent<Collider>();
                if (collider != null)
                { collider.enabled = false;if (Application.isPlaying) Destroy(collider);else DestroyImmediate(collider); }
                var renderer = _voicePointMarker.GetComponent<MeshRenderer>();
                if (renderer != null) renderer.sharedMaterial = RayMaterial != null ? RayMaterial : ButtonMaterial;
            }
            _voicePointMarker.transform.position = _voiceContext.PointWorldPosition;
            _voicePointMarker.transform.localScale = Vector3.one * .018f;
            _voicePointMarker.SetActive(true);
        }

        bool CaptureVoiceCollectionHit(Collider hitCollider, QuestMeshView hitView, int triangle,
            Vector3 hitPoint, bool sectionCap, QuestEditHandle edit)
        {
            if (_voiceContext == null || !_voiceContext.ExplicitMode ||
                _voiceContextPage == null || !_voiceContextPage.gameObject.activeInHierarchy) return false;
            if (AssemblyMates != null && AssemblyMates.Busy || DirectFaceHistory != null && DirectFaceHistory.Busy ||
                Display != null && Display.PlacementActive || Spatial != null && Spatial.Busy)
            { _voiceContext.CancelPointArm();return true; }
            if (sectionCap) { _voiceContext.Report("Piano di sezione solo visivo · riferimento ignorato");return true; }
            if (edit != null) { _voiceContext.Report("Raccolta in sola lettura · handle CAD ignorato");return true; }
            var fence = QuestVoiceContext.CaptureFence(Connection);
            var datum = hitCollider != null ? hitCollider.GetComponentInParent<QuestDatumView>() : null;
            if (datum != null)
            {
                if (!Connection.IsCurrentDatum(datum))
                { _voiceContext.Report("Datum non corrente · selezione rifiutata");return true; }
                var semantic = QuestSemanticContext.Build(datum.SelectionKind, datum.FeatureId, null, datum.FeatureId);
                _voiceContext.ToggleSelection(fence, datum.FeatureId, semantic, datum, -1,
                    () => fence.IsCurrent(Connection) && Connection.IsCurrentDatum(datum));
                RefreshVoiceContextUi();return true;
            }
            var view = hitView ?? (hitCollider != null ? hitCollider.GetComponent<QuestMeshView>() : null);
            if (view == null) return true;
            if (!Connection.IsCurrentView(view))
            { _voiceContext.Report("Vista CAD non corrente · selezione rifiutata");return true; }
            var mode = _selectionMode;
            var activeSection = Connection.Section != null && Connection.Section.Enabled ? Connection.Section.Plane : null;
            var hit = mode == 2 ? view.ResolveNearestEdge(hitPoint, .008f, activeSection, Connection.DisplayRoot) :
                mode == 1 ? view.ResolveFace(triangle) : null;
            if (mode != 0 && hit == null)
            { _voiceContext.Report(mode == 2 ? "Bordo senza riferimento CAD" : "Faccia senza riferimento CAD");return true; }
            if (hit != null && hit.ReferenceAmbiguous)
            { _voiceContext.Report("Riferimento ambiguo · selezione rifiutata");return true; }
            var kind = mode == 2 ? "edge" : mode == 1 ? "face" : view.InstanceId != null ? "instance" : "body";
            var id = mode == 0 ? view.InstanceId ?? view.BodyId : hit.PersistentId;
            var upload = view.UploadVersion;
            var context = QuestSemanticContext.Build(kind, id, view.BodyId, view.FeatureId, view.InstanceId);
            _voiceContext.ToggleSelection(fence, id, context, view, upload,
                () => fence.IsCurrent(Connection) && Connection.IsCurrentView(view) && view.UploadVersion == upload);
            RefreshVoiceContextUi();return true;
        }
        Transform _sketchPage, _projectionPage;
        TextMesh _sketchStatus;
        TextMesh _projectionRoute;
        QuestProjections _projections;
        QuestUi.LiveFocusStage _projectionStage;
        readonly Dictionary<string, TextMesh> _projectionActions = new Dictionary<string, TextMesh>(StringComparer.Ordinal);
        bool _refreshingProjectionPage;
        bool _editingSketch;
        long _sketchSelection;
        Transform _commandPage;
        TextMesh _commandStatus;
        bool _editingCommand;
        string _commandField;
        long _commandForm;
        bool _editingReference;
        long _referenceForm, _referenceInput;
        public QuestEnvironment Environment;
        public OVRCameraRig Rig;
        public OVRHand LeftHand, RightHand;
        public Font Font;
        public Material PanelMaterial, ButtonMaterial, RayMaterial;
        public bool PreferLeftHand;
        Transform _panel, _content, _homePage, _homeNoticePage, _connectionPage, _viewPage, _metricsPage, _sectionPage, _editPage, _referencePage, _configurationPage, _assemblyMatesPage, _directFaceHistoryPage;
        TextMesh _editStatus, _modeLabel, _sectionStatus, _sectionToggle, _sectionQuota;
        TextMesh _zebraToggle, _zebraDensity, _zebraRotation, _curvatureToggle;
        TextMesh _referenceTitle, _referenceDetails, _referenceStatus;
        TextMesh _homeNotice;
        TextMesh[] _referenceDatumLabels = new TextMesh[2], _referenceSourceLabels = new TextMesh[2];
        TextMesh _referenceNewPlane, _referenceNewAxis, _referenceNewPoint, _referenceInspect, _referenceEdit, _referenceSketch,
            _referenceType, _referenceOperation, _referenceFieldPrevious, _referenceFieldNext, _referenceSourcesPrevious,
            _referenceSourcesNext, _referenceDatumPrevious, _referenceDatumNext, _referenceNumeric, _referenceEnum,
            _referenceConfirm, _referenceCancel, _referenceBack;
        int _exactParameter;
        bool _editingValue;
        string _valueInput = "";
        SpatialEditIntent _exactIntent;
        string _exactName;
        Dictionary<string, double> _pendingExact;
        TextMesh _valueLabel;
        readonly List<Transform> _compactMenu = new List<Transform>();
        Transform _pcPage;
        TextMesh _pcStatus;
        TextMesh _pcOverview, _configurationOverview, _viewOverview, _sectionOverview;
        TextMesh _metricsOverview, _editOverview, _commandOverview, _sketchOverview;
        TextMesh _connectionOverview, _noticeOverview, _referenceOverview, _voiceOverview;
        readonly Dictionary<Transform, QuestUi.OperationSummary> _pageSummaries = new Dictionary<Transform, QuestUi.OperationSummary>();
        // Stable semantic action bindings. An operational card is a live
        // command surface, not merely a layout container: state updates keep
        // its original QuestButton, click delegate and TextMesh identity.
        readonly Dictionary<Transform, Dictionary<string, TextMesh>> _contextActions =
            new Dictionary<Transform, Dictionary<string, TextMesh>>();
        readonly Dictionary<TextMesh, int> _contextVisualStates = new Dictionary<TextMesh, int>();
        // The original QuestButton remains the ONLY interactive target. These
        // domain instruments are non-colliding children of its existing root:
        // they change shape/state in response to real live workflow data.
        enum ActionInstrumentKind
        {
            Peer, Pairing, Outcome, Variant, Placement, Metric,
            Plane, ValueWell, Command, Datum, Dimension, Voice
        }
        sealed class ActionInstrument
        {
            public ActionInstrumentKind Kind;
            public Transform Marker, Track, Fill, Secondary;
            public MeshRenderer MarkerRenderer, FillRenderer, SecondaryRenderer;
            public float TrackWidth;
            public Vector3 FillOrigin;
            public string LastState;
        }
        readonly Dictionary<TextMesh, ActionInstrument> _actionInstruments =
            new Dictionary<TextMesh, ActionInstrument>();
        readonly Dictionary<TextMesh, string> _actionCardSnapshots =
            new Dictionary<TextMesh, string>();
        readonly Dictionary<TextMesh, string> _largeCardSnapshots =
            new Dictionary<TextMesh, string>();
        Material _instrumentGlass;
        // Thirteen page-wide focus stages show one live value and helper line.
        // Existing buttons remain the only interactive controls.
        enum FocusKind { Peers, Pairing, Outcome, Variants, Placement, Telemetry,
            Section, Parameter, Commands, Datums, Dimension, Hermes, VoiceContext }
        sealed class DomainFocus
        {
            public FocusKind Kind;
            public QuestUi.LiveFocusStage Stage;
            public TextMesh FocusedAction;
            public string LastSnapshot;
        }
        readonly Dictionary<Transform, DomainFocus> _domainFocus =
            new Dictionary<Transform, DomainFocus>();
        readonly TextMesh[] _pcChoices = new TextMesh[4];
        int _pcChoicePage;
        string _selectedPcNotice;
        string _selectedPcId;
        TextMesh _status, _target, _endpointLabel, _codeLabel, _viewStatus, _handLabel, _diagnostics;
        TextMesh _chipStatus, _sectionTitle, _sectionSubtitle;
        Material _chipDot;
        Transform _toolRail, _shellHint;
        TextMesh _massStatus;
        TextMesh _assemblyKindButton, _assemblyMovingButton, _assemblyFixedButton, _assemblyAxisButton,
            _assemblyValueButton, _assemblyMateApplyButton, _assemblyMateStatus, _assemblyMovingStatus, _assemblyFixedStatus;
        TextMesh _directOperationButton, _directSourceButton, _directSupportButton, _directFieldButton,
            _directValueButton, _directApplyButton, _directSourceStatus, _directSupportStatus, _directStatus;
        bool _editingAssemblyMateValue;
        bool _editingDirectFaceValue;
        readonly Dictionary<string, Transform> _authoredRegions = new Dictionary<string, Transform>();
        readonly Dictionary<Transform, QuestUi.FlowLayout> _pageFlows = new Dictionary<Transform, QuestUi.FlowLayout>();
        readonly Dictionary<Transform, float> _flowSourceRows = new Dictionary<Transform, float>();
        readonly Dictionary<Transform, Vector3[]> _flowRowColumns = new Dictionary<Transform, Vector3[]>();
        readonly Dictionary<Transform, int> _flowColumnCursor = new Dictionary<Transform, int>();
        readonly ConcurrentQueue<Action> _massUi = new ConcurrentQueue<Action>();
        int _massRequest;
        string _thicknessSummary = "Analisi campionata sul PC";
        Kreoda.Session.SessionModelState _thicknessModel;
        QuestMeshView _thicknessSelected;
        bool _thicknessNotice, _thicknessPending;
        GameObject _panelBackground;
        readonly List<GameObject> _pageShellEdges = new List<GameObject>();
        readonly System.Collections.Generic.List<GameObject> _legacyHeaderControls = new System.Collections.Generic.List<GameObject>();
        QuestMeshView _selected;
        QuestDatumView _selectedDatum;
        MeshSemanticHit _hit;
        LineRenderer _ray;
        Transform _pointerDot, _pointerHalo;
        MeshRenderer _pointerDotRenderer, _pointerHaloRenderer;
        Material _pointerIdleMaterial, _pointerHoverMaterial, _pointerPressMaterial, _pointerHaloMaterial;
        TouchScreenKeyboard _keyboard;
        string _endpoint = "", _code = "";
        bool _editingCode, _pinching, _requireRelease = true, _tracked, _draggingPanel, _uiLeft, _wasConnected;
        int _handMode;
        Vector3 _panelOffset;
        float _yaw;
        int _selectionMode = 1, _selectedMode = -1;
        int _selectedUploadVersion;
        readonly Dictionary<TextMesh, Vector2> _textLimits = new Dictionary<TextMesh, Vector2>();
        readonly RaycastHit[] _sectionHits = new RaycastHit[128];
        readonly RaycastHit[] _placementHits = new RaycastHit[128];
        Vector3 _grabOffset, _grabStartPosition;
        Quaternion _grabStartRotation;
        float _grabDistance, _initialTrackingTime = -1;
        bool _initialPanelPlaced;
        int _pinchReleaseFrames;

        void Start()
        {
            _voiceContext = GetComponent<QuestVoiceContext>() ?? gameObject.AddComponent<QuestVoiceContext>();
            if (Voice != null) { Voice.Connection = Connection;Voice.Controls = this; }
            var uiFont = Resources.Load<Font>("Inter-Regular");
            if (uiFont != null) Font = uiFont;
            // Runtime override is required: the saved Unity scene holds older light materials.
            // Keep the CAD viewport untouched; only local Quest UI materials are themed.
            if (PanelMaterial != null)
            {
                PanelMaterial = QuestUi.GlassMaterial(PanelMaterial);
                PanelMaterial.color = new Color(.055f, .06f, .075f, .82f);
            }
            if (ButtonMaterial != null)
            {
                ButtonMaterial = QuestUi.GlassMaterial(ButtonMaterial);
                ButtonMaterial.color = new Color(.13f, .14f, .17f, .80f);
            }
            if (References == null) References = GetComponent<QuestReferences>() ?? gameObject.AddComponent<QuestReferences>();
            References.Connection = Connection;References.Commands = Commands;References.Changed += RefreshReferencePage;
            _endpoint = Connection.SavedEndpoint;
            _handMode = Mathf.Clamp(PlayerPrefs.GetInt("kreoda-hand-mode", 0), 0, 2);
            _uiLeft = PlayerPrefs.GetInt("kreoda-ui-left", 0) != 0;
            bool currentLayout = PlayerPrefs.GetInt("kreoda-panel-layout", 0) == 2;
            _panelOffset = currentLayout ? new Vector3(PlayerPrefs.GetFloat("kreoda-panel-x", 0),
                PlayerPrefs.GetFloat("kreoda-panel-y", 0), PlayerPrefs.GetFloat("kreoda-panel-z", 1.25f)) : new Vector3(0, 0, 1.25f);
            // Older versions saved the default panel at 1 m. Migrate only that
            // untouched default; preserve any position explicitly dragged by the user.
            if (currentLayout && Mathf.Abs(_panelOffset.x) < .001f &&
                Mathf.Abs(_panelOffset.y) < .001f && Mathf.Abs(_panelOffset.z - 1f) < .001f)
            {
                _panelOffset.z = 1.25f;
                SavePanelOffset();
            }
            if (!ValidPanelOffset(_panelOffset))
                _panelOffset = new Vector3(0, 0, 1.25f);
            _panel = new GameObject("Compact panel (0.42 m)").transform;
            _panel.SetParent(transform, false);
            _panel.localScale = Vector3.one * 1.40f;
            _content = _panel;
            // No opaque full-page backdrop: the world-locked chip, rail and
            // contextual panels stay separate islands over real passthrough.
            BuildSpatialShell();
            if (Home == null) Home = GetComponent<QuestHome>() ?? gameObject.AddComponent<QuestHome>();
            _homePage = Home.Build(_panel, Font, PanelMaterial, ButtonMaterial, RegisterTextBounds, HomeAction);
            Home.ChipStatus = _chipStatus;
            Home.ChipDot = _chipDot;
            _status = Home.ConnectionStatus;
            if (AssemblyMates == null) AssemblyMates = GetComponent<QuestAssemblyMates>() ?? gameObject.AddComponent<QuestAssemblyMates>();
            AssemblyMates.Connection = Connection;
            AssemblyMates.Spatial = Spatial;
            AssemblyMates.Commands = Commands;
            if (DirectFaceHistory == null) DirectFaceHistory = GetComponent<QuestDirectFaceHistory>() ?? gameObject.AddComponent<QuestDirectFaceHistory>();
            DirectFaceHistory.Connection = Connection;DirectFaceHistory.Spatial = Spatial;
            DirectFaceHistory.Commands = Commands;DirectFaceHistory.AssemblyMates = AssemblyMates;
            if (Commands != null) Commands.DirectFaceHistory = DirectFaceHistory;
            if (Spatial != null) Spatial.DirectFaceHistory = DirectFaceHistory;
            AssemblyMates.DirectFaceHistory = DirectFaceHistory;
            _assemblyMatesPage = new GameObject("Assembly mates").transform;
            _assemblyMatesPage.SetParent(_panel, false);
            _assemblyMatesPage.gameObject.SetActive(false);
            _content = _assemblyMatesPage;
            Label(_content, "Accoppiamenti", new Vector3(-.19f, .145f, -.003f), .014f);
            _assemblyMateStatus = Label(_content, "Collega un PC e seleziona un’istanza.", new Vector3(-.19f, .093f, -.003f), .010f);
            _textLimits[_assemblyMateStatus] = new Vector2(.38f, .052f);
            _assemblyKindButton = Button("Tipo · Fissa istanza", new Vector3(0, .035f, 0), .34f,
                () => AssemblyMates.NextKind(), .035f, .010f);
            _assemblyMovingButton = Button("Acquisisci mobile", new Vector3(-.09f, -.015f, 0), .17f,
                () => CaptureAssemblySlot(true), .035f, .009f);
            _assemblyFixedButton = Button("Acquisisci fissa", new Vector3(.09f, -.015f, 0), .17f,
                () => CaptureAssemblySlot(false), .035f, .009f);
            _assemblyMovingStatus = Label(_content, "Mobile: —", new Vector3(-.105f, -.045f, -.003f), .008f);
            _textLimits[_assemblyMovingStatus] = new Vector2(.18f, .026f);
            _assemblyFixedStatus = Label(_content, "Fissa: —", new Vector3(.105f, -.045f, -.003f), .008f);
            _textLimits[_assemblyFixedStatus] = new Vector2(.18f, .026f);
            _assemblyAxisButton = Button("Asse X", new Vector3(-.09f, -.081f, 0), .17f,
                () => AssemblyMates.NextAxis(), .035f, .009f);
            _assemblyValueButton = Button("Valore 0 mm", new Vector3(.09f, -.081f, 0), .17f,
                EditAssemblyMateValue, .035f, .009f);
            _assemblyMateApplyButton = Button("Crea accoppiamento", new Vector3(0, -.136f, 0), .31f,
                () => { if (AssemblyMates != null) _ = AssemblyMates.ApplyAsync(); }, .038f, .010f);
            _contextActions[_assemblyMatesPage] = new Dictionary<string, TextMesh>(StringComparer.Ordinal)
            { ["Crea accoppiamento"] = _assemblyMateApplyButton };
            Button("Annulla", new Vector3(-.09f, -.194f, 0), .16f,
                () => AssemblyMates?.Cancel(), .034f, .010f);
            Button("Indietro", new Vector3(.09f, -.194f, 0), .16f,
                () => Page(_commandPage), .034f, .010f);
            Button("Facce dirette", new Vector3(0, -.248f, 0), .30f,
                OpenDirectFaceHistory, .028f, .009f);
            _directFaceHistoryPage = new GameObject("Direct face history").transform;
            _directFaceHistoryPage.SetParent(_panel, false);
            _directFaceHistoryPage.gameObject.SetActive(false);
            _content = _directFaceHistoryPage;
            Label(_content, "Facce dirette", new Vector3(-.19f, .155f, -.003f), .014f);
            _directStatus = Label(_content, "Scegli un’operazione e acquisisci una faccia.", new Vector3(-.19f, .105f, -.003f), .010f);
            _textLimits[_directStatus] = new Vector2(.38f, .047f);
            _directOperationButton = Button("Operazione · Sposta faccia", new Vector3(0, .05f, 0), .34f,
                () => DirectFaceHistory?.NextOperation(), .035f, .010f);
            _directSourceButton = Button("Acquisisci sorgente", new Vector3(-.09f, .005f, 0), .17f,
                CaptureDirectFaceSource, .034f, .009f);
            _directSupportButton = Button("Acquisisci supporto", new Vector3(.09f, .005f, 0), .17f,
                CaptureDirectFaceSupport, .034f, .009f);
            _directSourceStatus = Label(_content, "Sorgente: —", new Vector3(-.19f, -.031f, -.003f), .008f);
            _textLimits[_directSourceStatus] = new Vector2(.19f, .035f);
            _directSupportStatus = Label(_content, "Supporto: —", new Vector3(.005f, -.031f, -.003f), .008f);
            _textLimits[_directSupportStatus] = new Vector2(.18f, .035f);
            _directFieldButton = Button("Campo →", new Vector3(-.09f, -.073f, 0), .17f,
                () => DirectFaceHistory?.NextField(), .034f, .009f);
            _directValueButton = Button("Valore", new Vector3(.09f, -.073f, 0), .17f,
                EditDirectFaceValue, .034f, .009f);
            _directApplyButton = Button("Applica", new Vector3(0, -.126f, 0), .30f,
                () => { if (DirectFaceHistory != null) _ = DirectFaceHistory.ApplyAsync(); }, .036f, .010f);
            _contextActions[_directFaceHistoryPage] = new Dictionary<string, TextMesh>(StringComparer.Ordinal)
            {
                ["Operazione →"] = _directOperationButton, ["Acquisisci sorgente"] = _directSourceButton,
                ["Acquisisci supporto"] = _directSupportButton, ["Campo →"] = _directFieldButton,
                ["Valore"] = _directValueButton, ["Applica"] = _directApplyButton,
            };
            Button("Annulla", new Vector3(-.09f, -.185f, 0), .16f,
                () => DirectFaceHistory?.Cancel(), .034f, .010f);
            Button("Indietro", new Vector3(.09f, -.185f, 0), .16f,
                () => Page(_assemblyMatesPage), .034f, .010f);
            _content = _panel;
            _pcPage = PageRoot("PC locali");_content = _pcPage;
            _pcStatus = Label(_content, "Ricerca del PC locale…", new Vector3(-.19f, .13f, -.003f), .012f);
            _textLimits[_pcStatus] = new Vector2(.38f, .055f);
            for (int i = 0; i < _pcChoices.Length; i++)
            {
                int slot = i;
                _pcChoices[i] = OperationControl("PC " + (i + 1), new Vector3(0, .065f - i * .047f, 0), .37f, () =>
                {
                    var peers = Connection.AvailablePcs;int index = _pcChoicePage * _pcChoices.Length + slot;
                    if (index < peers.Length) ConnectDiscoveredPc(peers[index]);
                }, .038f, .011f);
            }
            OperationControl("Altri PC", new Vector3(-.1f, -.144f, 0), .18f, () =>
            {
                var count = Connection.AvailablePcs.Length;
                var pages = Mathf.Max(1, (count + _pcChoices.Length - 1) / _pcChoices.Length);
                _pcChoicePage = (_pcChoicePage + 1) % pages;
            }, .032f, .011f);
            OperationControl("Riprova", new Vector3(.105f, -.144f, 0), .17f, Connection.Reconnect, .032f, .011f);
            OperationControl("Diagnostica avanzata", new Vector3(0, -.209f, 0), .32f, () => Page(_connectionPage), .032f, .011f);
            _connectionPage = PageRoot("Advanced PC diagnostics");
            _content = _connectionPage;
            // The connection workstation's functional card owns its live heading.
            _endpointLabel = OperationControl("Endpoint manuale", new Vector3(0, .06f, 0), .38f, () => Edit(false), .032f);
            _codeLabel = OperationControl("Codice manuale", new Vector3(-.07f, .022f, 0), .24f, () => Edit(true));
            OperationControl("Connetti", new Vector3(.13f, .022f, 0), .1f, () =>
            {
                if (_code.Length == 0 && Connection.SavedEndpoint == _endpoint) Connection.Reconnect();
                else Connection.Pair(_endpoint, _code);
                _code = "";
            });
            OperationControl("Corpo", new Vector3(-.13f, -.043f, 0), .11f, () => _selectionMode = 0);
            OperationControl("Faccia", new Vector3(0, -.043f, 0), .11f, () => _selectionMode = 1);
            OperationControl("Bordo", new Vector3(.13f, -.043f, 0), .11f, () => _selectionMode = 2);
            OperationControl("Invia target al PC", new Vector3(-.067f, -.095f, 0), .245f,
                () => { if (_selectedDatum != null) Connection.PublishTarget(_selectedDatum); else Connection.PublishTarget(_selected, _hit); });
            OperationControl("Centra", new Vector3(.13f, -.095f, 0), .1f, Display.Recenter);
            _target = Label(_content, "Seleziona con il raggio", new Vector3(-.19f, -.11f, -.003f), .011f);
            _textLimits[_target] = new Vector2(.38f, .065f);
            OperationControl("Proprietà fisiche", new Vector3(0, -.155f, 0), .28f, InspectMassProperties, .032f);
            OperationControl("Spessore minimo", new Vector3(0, -.195f, 0), .28f, InspectMinimumThickness, .032f);
            _massStatus = Label(_content, "Volume, area e baricentro · lettura CAD", new Vector3(-.19f, -.18f, -.003f), .008f);
            _textLimits[_massStatus] = new Vector2(.38f, .06f);
            OperationControl("Dimentica PC", new Vector3(-.1f, -.229f, 0), .18f, Connection.Forget, .032f);
            OperationControl("Vista MR / scale", new Vector3(.105f, -.229f, 0), .17f, () => Page(_viewPage), .032f);
            _homeNoticePage = PageRoot("Home action status");
            _content = _homeNoticePage;
            _homeNotice = Label(_content, "Questa azione non è disponibile su Quest.\nIl documento CAD non verrà modificato.",
                new Vector3(-.19f, .07f, -.003f), .011f);
            _textLimits[_homeNotice] = new Vector2(.38f, .10f);
            OperationControl("Torna a Home", new Vector3(-.10f, -.111f, 0), .18f, () => Page(_homePage), .034f, .011f);
            OperationControl("Diagnostica PC", new Vector3(.105f, -.111f, 0), .17f, () => Page(_connectionPage), .034f, .011f);
            _configurationPage = PageRoot("CAD configurations");
            _content = _configurationPage;
            _configurationStatus = Label(_content, "Configurazioni: collega il PC", new Vector3(-.19f, .08f, -.003f), .011f);
            _textLimits[_configurationStatus] = new Vector2(.38f, .13f);
            OperationControl("Aggiorna", new Vector3(-.10f, -.067f, 0), .17f, ReadConfigurations, .032f);
            OperationControl("Successiva", new Vector3(.10f, -.067f, 0), .17f, NextConfiguration, .032f);
            OperationControl("Attiva selezionata", new Vector3(0, -.125f, 0), .30f, ConfirmConfiguration, .032f);
            OperationControl("Indietro", new Vector3(0, -.193f, 0), .20f, () => Page(_homePage), .032f);
            _viewPage = PageRoot("Display controls");
            _content = _viewPage;
            _viewStatus = Label(_content, "MR in avvio", new Vector3(-.19f, .077f, -.003f), .010f);
            _textLimits[_viewStatus] = new Vector2(.38f, .04f);
            OperationControl("MR / VR", new Vector3(-.1f, .037f, 0), .18f, Environment.Toggle, .032f);
            _handLabel = OperationControl("Mano Auto", new Vector3(.105f, .037f, 0), .17f, () =>
            { _handMode = (_handMode + 1) % 3; ResetIntent(); PlayerPrefs.SetInt("kreoda-hand-mode", _handMode); PlayerPrefs.Save(); }, .032f);
            OperationControl("Rileva tavolo", new Vector3(-.1f, .002f, 0), .18f,
                RequestMetaTableDiscovery, .025f, .009f);
            OperationControl("Configura stanza", new Vector3(.105f, .002f, 0), .17f,
                RequestMetaRoomSetup, .025f, .009f);
            OperationControl("Posiziona", new Vector3(-.1f, -.01f, 0), .18f, () => Display.BeginPlacement(), .032f);
            OperationControl("Centra CAD", new Vector3(.105f, -.01f, 0), .17f, Display.Recenter, .032f);
            OperationControl("Condividi selezione", new Vector3(0, -.241f, 0), .34f, PublishSelectionToDesktop, .030f);
            OperationControl("Conferma", new Vector3(-.13f, -.055f, 0), .11f, () => Display.ConfirmPlacement(_tracked), .032f);
            OperationControl("Annulla", new Vector3(0, -.055f, 0), .11f, Display.CancelPlacement, .032f);
            OperationControl("−5", new Vector3(.10f, -.055f, 0), .045f, () => Display.AdjustHeight(-.005f), .032f);
            OperationControl("+5", new Vector3(.165f, -.055f, 0), .045f, () => Display.AdjustHeight(.005f), .032f);
            var scales = new[] { "1:10", "1:5", "1:1", "2:1", "10:1", "Fit" };
            for (int i = 0; i < scales.Length; i++)
            { var preset = scales[i]; OperationControl(preset, new Vector3(-.16f + i * .064f, -.10f, 0), .055f, () => Display.SetScale(preset), .03f, .012f); }
            OperationControl("Ispezione", new Vector3(-.1f, -.145f, 0), .18f, () => Quality(MeshLod.Inspection), .031f);
            OperationControl("Normale", new Vector3(.105f, -.145f, 0), .17f, () => Quality(MeshLod.Interactive), .031f);
            OperationControl("UI L/R", new Vector3(-.13f, -.205f, 0), .11f, () =>
            {
                _uiLeft = !_uiLeft;
                _panelOffset.x = (_uiLeft ? -1 : 1) * Mathf.Max(.25f, Mathf.Abs(_panelOffset.x));
                PlayerPrefs.SetInt("kreoda-ui-left", _uiLeft ? 1 : 0); SavePanelOffset(); RecenterPanel();
            }, .023f);
            OperationControl("Centra UI", new Vector3(0, -.205f, 0), .11f, ResetPanel, .03f);
            OperationControl("Sezione", new Vector3(.13f, -.205f, 0), .11f, () => Page(_sectionPage), .03f);
            OperationControl("Riferimenti", new Vector3(-.100f, -.289f, 0), .17f, OpenReferences, .031f);
            OperationControl("Configurazioni", new Vector3(.100f, -.289f, 0), .17f, () => { Page(_configurationPage);ReadConfigurations(); }, .029f);
            _metricsPage = PageRoot("Optional diagnostics");
            _content = _metricsPage;
            _diagnostics = Label(_content, "Metriche: attendi un campione", new Vector3(-.19f, .085f, -.003f), .012f);
            _textLimits[_diagnostics] = new Vector2(.38f, .25f);
            OperationControl("Torna a Vista", new Vector3(0, -.218f, 0), .2f, () => Page(_viewPage), .03f);
            _sectionPage = PageRoot("Section view");
            _content = _sectionPage;
            _sectionStatus = Label(_content, "Sezione spenta", new Vector3(-.19f, .105f, -.003f), .012f);
            _textLimits[_sectionStatus] = new Vector2(.38f, .04f);
            _sectionToggle = OperationControl("Attiva sezione", new Vector3(0, .055f, 0), .31f, ToggleSection, .036f, .012f);
            OperationControl("X", new Vector3(-.13f, .008f, 0), .075f, () => SetSectionAxis(SectionAxis.X), .034f);
            OperationControl("Y", new Vector3(0, .008f, 0), .075f, () => SetSectionAxis(SectionAxis.Y), .034f);
            OperationControl("Z", new Vector3(.13f, .008f, 0), .075f, () => SetSectionAxis(SectionAxis.Z), .034f);
            OperationControl("−5 mm", new Vector3(-.11f, -.042f, 0), .12f, () => AdjustSectionQuota(-5), .034f, .011f);
            _sectionQuota = Label(_content, "Quota —", new Vector3(-.045f, -.036f, -.003f), .011f);
            _textLimits[_sectionQuota] = new Vector2(.09f, .034f);
            OperationControl("+5 mm", new Vector3(.11f, -.042f, 0), .12f, () => AdjustSectionQuota(5), .034f, .011f);
            OperationControl("Quota esatta", new Vector3(0, -.143f, 0), .30f, EditSectionQuota, .032f, .011f);
            OperationControl("Inverti", new Vector3(-.09f, -.092f, 0), .15f, InvertSection, .034f, .011f);
            OperationControl("Azzera", new Vector3(.09f, -.092f, 0), .15f, ResetSection, .034f, .011f);
            _zebraToggle = OperationControl("Zebra", new Vector3(-.08f, -.24f, 0), .14f, () => Connection.Section?.ToggleZebra(), .034f);
            _curvatureToggle = OperationControl("Curvatura", new Vector3(.08f, -.24f, 0), .14f, () => Connection.Section?.ToggleCurvature(), .034f);
            _zebraDensity = OperationControl("Bande →", new Vector3(-.09f, -.28f, 0), .15f, () => {
                var s = Connection.Section; if (s == null) return;
                if (s.CurvatureEnabled) s.NextCurvatureScale(); else s.NextZebraDensity();
            }, .034f);
            _zebraRotation = OperationControl("Ruota bande", new Vector3(.09f, -.28f, 0), .15f, () => {
                var s = Connection.Section; if (s == null) return;
                if (s.CurvatureEnabled) s.AutoCurvatureScale(); else s.RotateZebra();
            }, .034f);
            OperationControl("Indietro", new Vector3(-.095f, -.200f, 0), .15f, () => Page(_viewPage), .034f, .011f);
            OperationControl("Metriche", new Vector3(.095f, -.200f, 0), .15f, () => Page(_metricsPage), .034f, .011f);
            _editPage = PageRoot("Exact CAD editing");_content = _editPage;
            _editStatus = Label(_content, "Seleziona una quota", new Vector3(-.19f, .085f, -.003f), .012f);
            _textLimits[_editStatus] = new Vector2(.38f, .10f);
            OperationControl("Feature →", new Vector3(-.1f, -.052f, 0), .18f, () => Spatial?.NextOwner(), .032f);
            OperationControl("Parametro →", new Vector3(.105f, -.052f, 0), .17f, () =>
            {
                var parameters = Spatial?.SelectedIntent?.Parameters;
                _exactParameter = parameters != null && parameters.Count > 0
                    ? (_exactParameter + 1) % parameters.Count : 0;
            }, .032f);
            OperationControl("Valore esatto", new Vector3(-.1f, -.108f, 0), .18f, EditValue, .032f);
            OperationControl("Snap 0.1mm / 5deg", new Vector3(.105f, -.108f, 0), .17f, () => { if (Spatial != null) Spatial.SnapEnabled = !Spatial.SnapEnabled; }, .032f, .011f);
            OperationControl("Annulla modifica", new Vector3(-.1f, -.182f, 0), .18f, () => Spatial?.Cancel(), .032f);
            OperationControl("Azioni CAD", new Vector3(.105f, -.182f, 0), .17f, () => Page(_commandPage), .032f);
            OperationControl("Vista MR", new Vector3(0, -.226f, 0), .24f, () => Page(_viewPage), .028f, .010f);
            _commandPage = PageRoot("Canonical context actions");_content = _commandPage;
            _commandStatus = Label(_content, "Seleziona geometria", new Vector3(-.19f, .085f, -.003f), .012f);
            _textLimits[_commandStatus] = new Vector2(.38f, .13f);
            OperationControl("Azione →", new Vector3(-.1f, -.06f, 0), .18f, () => Commands?.NextCommand(), .032f);
            OperationControl("Campo →", new Vector3(.105f, -.06f, 0), .17f, () => Commands?.NextField(), .032f);
            OperationControl("Valore", new Vector3(-.1f, -.12f, 0), .18f, EditCommandField, .032f);
            OperationControl("Conferma", new Vector3(.105f, -.12f, 0), .17f, () => Commands?.Confirm(), .032f);
            OperationControl("Undo", new Vector3(-.1f, -.19f, 0), .18f, () => Commands?.History(false), .032f);
            OperationControl("Redo", new Vector3(.105f, -.19f, 0), .17f, () => Commands?.History(true), .032f);
            OperationControl("Accoppiamenti", new Vector3(-.1f, -.225f, 0), .18f, OpenAssemblyMates, .028f, .009f);
            OperationControl("Quote sketch", new Vector3(.105f, -.225f, 0), .17f, () =>
            {
                SketchDimensions?.Select();
                Page(_sketchPage);
            }, .028f, .009f);
            _referencePage = PageRoot("Riferimenti CAD");_content = _referencePage;
            _referenceTitle = Label(_content, "Riferimenti", new Vector3(-.19f, .132f, -.003f), .013f);
            _textLimits[_referenceTitle] = new Vector2(.38f, .025f);
            _referenceDetails = Label(_content, "Scegli una costruzione o un datum", new Vector3(-.19f, .095f, -.003f), .010f);
            _textLimits[_referenceDetails] = new Vector2(.38f, .045f);
            _referenceStatus = Label(_content, "", new Vector3(-.19f, .063f, -.003f), .009f);
            _textLimits[_referenceStatus] = new Vector2(.38f, .025f);
            _referenceNewPlane = OperationControl("Nuovo piano", new Vector3(-.1f, .005f, 0), .18f, () => BeginReference(QuestReferenceKind.Plane), .03f, .010f);
            _referenceNewAxis = OperationControl("Nuovo asse", new Vector3(.105f, .005f, 0), .17f, () => BeginReference(QuestReferenceKind.Axis), .03f, .010f);
            _referenceNewPoint = OperationControl("Nuovo punto", new Vector3(0, -.035f, 0), .30f, () => BeginReference(QuestReferenceKind.Point), .03f, .010f);
            _referenceDatumLabels[0] = OperationControl("Datum pagina 1", new Vector3(0, -.08f, 0), .37f, () => SelectReferenceDatum(0), .032f, .009f);
            _referenceDatumLabels[1] = OperationControl("Datum pagina 2", new Vector3(0, -.12f, 0), .37f, () => SelectReferenceDatum(1), .032f, .009f);
            _referenceDatumPrevious = OperationControl("Datums ←", new Vector3(-.1f, -.16f, 0), .18f, () => { References?.NextDatumPage(-1);RefreshReferencePage(); }, .03f, .010f);
            _referenceDatumNext = OperationControl("Datums →", new Vector3(.105f, -.16f, 0), .17f, () => { References?.NextDatumPage(1);RefreshReferencePage(); }, .03f, .010f);
            _referenceInspect = OperationControl("Ispeziona", new Vector3(-.135f, -.215f, 0), .12f, InspectReferenceDatum, .03f, .009f);
            _referenceEdit = OperationControl("Modifica", new Vector3(0, -.215f, 0), .12f, EditReferenceDatum, .03f, .009f);
            _referenceSketch = OperationControl("Sketch piano", new Vector3(.135f, -.215f, 0), .12f, SketchOnReferencePlane, .03f, .008f);
            _referenceType = OperationControl("Tipo →", new Vector3(-.1f, .005f, 0), .18f, () => { References?.CycleKind();RefreshReferencePage(); }, .03f, .010f);
            _referenceOperation = OperationControl("Costruzione →", new Vector3(.105f, .005f, 0), .17f, () => { References?.CycleOperation();RefreshReferencePage(); }, .03f, .009f);
            _referenceFieldPrevious = OperationControl("Campo ←", new Vector3(-.1f, -.035f, 0), .18f, () => { References?.PreviousField();RefreshReferencePage(); }, .03f, .010f);
            _referenceFieldNext = OperationControl("Campo →", new Vector3(.105f, -.035f, 0), .17f, () => { References?.NextField();RefreshReferencePage(); }, .03f, .010f);
            _referenceSourceLabels[0] = OperationControl("Sorgente 1", new Vector3(0, -.08f, 0), .37f, () => ChooseReferenceSource(0), .032f, .009f);
            _referenceSourceLabels[1] = OperationControl("Sorgente 2", new Vector3(0, -.12f, 0), .37f, () => ChooseReferenceSource(1), .032f, .009f);
            _referenceSourcesPrevious = OperationControl("Fonti ←", new Vector3(-.1f, -.16f, 0), .18f, () => { References?.NextSourcePage(-1);RefreshReferencePage(); }, .03f, .010f);
            _referenceSourcesNext = OperationControl("Fonti →", new Vector3(.105f, -.16f, 0), .17f, () => { References?.NextSourcePage(1);RefreshReferencePage(); }, .03f, .010f);
            _referenceNumeric = OperationControl("Valore mm/deg", new Vector3(-.1f, -.20f, 0), .18f, EditReferenceNumeric, .03f, .009f);
            _referenceEnum = OperationControl("Valore →", new Vector3(.105f, -.20f, 0), .17f, () => { References?.CycleEnumValue();RefreshReferencePage(); }, .03f, .010f);
            _referenceConfirm = OperationControl("Conferma", new Vector3(-.1f, -.23f, 0), .18f, SubmitReference, .03f, .010f);
            _referenceCancel = OperationControl("Annulla", new Vector3(.105f, -.23f, 0), .17f, CancelReference, .03f, .010f);
            _referenceBack = OperationControl("Indietro", new Vector3(.135f, -.215f, 0), .12f, () => { References?.OpenHome();RefreshReferencePage(); }, .03f, .010f);
            References.OpenHome();RefreshReferencePage();
            OperationControl("Vista MR", new Vector3(0, -.267f, 0), .20f,
                () => { if (References != null && References.IsFormOpen) CancelReference(); Page(_viewPage); }, .024f, .009f);
            _sketchPage = PageRoot("Canonical sketch dimensions");_content = _sketchPage;
            _sketchStatus = Label(_content, "Seleziona uno sketch", new Vector3(-.19f, .085f, -.003f), .012f);
            _textLimits[_sketchStatus] = new Vector2(.38f, .11f);
            OperationControl("Sketch →", new Vector3(-.1f, -.042f, 0), .18f, () => SketchDimensions?.NextSketch(), .032f);
            OperationControl("Quota →", new Vector3(.105f, -.042f, 0), .17f, () => SketchDimensions?.NextDimension(), .032f);
            OperationControl("Valore esatto", new Vector3(-.1f, -.101f, 0), .18f, EditSketchValue, .032f);
            OperationControl("Conferma", new Vector3(.105f, -.101f, 0), .17f, () => SketchDimensions?.Confirm(), .032f);
            OperationControl("Annulla", new Vector3(-.1f, -.160f, 0), .18f, () => SketchDimensions?.Cancel(), .032f);
            OperationControl("Undo", new Vector3(.105f, -.160f, 0), .17f, () => Commands?.History(false), .032f);
            OperationControl("Simmetrie / quote", new Vector3(-.1f, -.218f, 0), .18f,
                () => SketchDimensions?.ToggleConstraintInspection(), .03f);
            OperationControl("Azioni CAD", new Vector3(.105f, -.218f, 0), .17f,
                () => Page(_commandPage), .03f, .010f);
            OperationControl("Modifica CAD", new Vector3(0, -.258f, 0), .22f,
                () => Page(_editPage), .025f, .009f);
            if (Voice != null)
            {
                _voicePage = PageRoot("Hermes voice");_content = _voicePage;
                _voiceStatus = Label(_content, "Hermes", new Vector3(-.19f, .09f, -.003f), .012f);
                _textLimits[_voiceStatus] = new Vector2(.38f, .05f);
                _voiceTranscript = Label(_content, "Premi Parla e poi Invia", new Vector3(-.19f, .025f, -.003f), .012f);
                _textLimits[_voiceTranscript] = new Vector2(.38f, .085f);
                _voiceReply = Label(_content, "", new Vector3(-.19f, -.045f, -.003f), .011f);
                _textLimits[_voiceReply] = new Vector2(.38f, .075f);
                _voiceModeReadout = Label(_content, "Voce singola · selezione CAD corrente",
                    new Vector3(-.19f, -.105f, -.003f), .010f);
                _textLimits[_voiceModeReadout] = new Vector2(.38f, .028f);
                _voiceStatus.richText = _voiceTranscript.richText = _voiceReply.richText = false;
                OperationControl("Parla / Invia", new Vector3(-.1f, -.200f, 0), .18f, Voice.Toggle, .032f);
                OperationControl("Stop", new Vector3(.105f, -.200f, 0), .17f, Voice.Cancel, .032f);
                OperationControl("Home", new Vector3(0, -.245f, 0), .20f, () => Page(_homePage), .026f, .010f);
                OperationControl("Contesto", new Vector3(.12f, -.245f, 0), .16f, OpenVoiceContextPage, .026f, .009f);

                _voiceContextPage = PageRoot("Contesto Hermes");_content = _voiceContextPage;
                _voiceContextSummary = Label(_content, "Raccolta · 0/64", new Vector3(-.19f, .035f, -.003f), .011f);
                _textLimits[_voiceContextSummary] = new Vector2(.38f, .135f);
                _voiceContextStatus = Label(_content, "Raccolta esplicita · sola lettura",
                    new Vector3(-.19f, -.090f, -.003f), .009f);
                _textLimits[_voiceContextStatus] = new Vector2(.38f, .032f);
                _voiceContextSummary.richText = _voiceContextStatus.richText = false;
                OperationControl("Arma punto", new Vector3(-.1f, -.160f, 0), .18f, ArmVoicePoint, .032f, .010f);
                OperationControl("Cancella", new Vector3(.105f, -.160f, 0), .17f, ClearVoiceContext, .032f, .010f);
                OperationControl("Raccolta voce", new Vector3(-.1f, -.215f, 0), .18f,
                    () => Page(_voicePage), .028f, .009f);
                OperationControl("Voce singola", new Vector3(.105f, -.215f, 0), .17f,
                    UseSingleVoiceContext, .028f, .009f);
            }
            BuildSecondaryPageLayouts();
            BuildProjectionPage();
            foreach (var secondary in new[] { _pcPage, _connectionPage, _homeNoticePage,
                _configurationPage, _viewPage, _metricsPage, _sectionPage, _editPage,
                _commandPage, _sketchPage, _voicePage, _voiceContextPage, _projectionPage })
                ReconcilePanelBackdrops(secondary);
            ValidateAuthoredActionGeometry();
            // Preserve each tool's authored hit geometry: no automatic grid.
            Page(_homePage);
            _content = _panel;
            // A small independent menu tab stays reachable when the panel hides.
            var menu = Button("Menu", Vector3.zero, .11f,
                TogglePanel, .03f);
            menu.transform.parent.SetParent(transform, false);
            _compactMenu.Add(menu.transform.parent);
            _ray = new GameObject("Pointer ray").AddComponent<LineRenderer>();
            _ray.transform.SetParent(transform, false);
            _ray.sharedMaterial = RayMaterial;
            _ray.positionCount = 2;
            _ray.startWidth = .0007f;
            _ray.endWidth = .0015f;
            _ray.useWorldSpace = true;
            _ray.startColor = new Color(.36f, .74f, 1f, .15f);
            _ray.endColor = new Color(.36f, .74f, 1f, .80f);
            _pointerIdleMaterial = PointerMaterial(new Color(.38f, .75f, 1f, .96f));
            _pointerHoverMaterial = PointerMaterial(new Color(.74f, .96f, 1f, 1f));
            _pointerPressMaterial = PointerMaterial(new Color(.13f, 1f, .73f, 1f));
            _pointerHaloMaterial = PointerMaterial(new Color(.16f, .61f, 1f, .33f));
            _pointerHalo = PointerSphere("Pointer focus ring", .021f, _pointerHaloMaterial, out _pointerHaloRenderer);
            _pointerDot = PointerSphere("Pointer tip", .010f, _pointerIdleMaterial, out _pointerDotRenderer);
            HidePointerVisual();
            RecenterPanel();
            Connection.SceneChanged += RefreshSelection;
        }

        static Material PointerMaterial(Color tint)
        {
            var shader = Shader.Find("Unlit/Color") ?? Shader.Find("Sprites/Default") ?? Shader.Find("Standard");
            var result = new Material(shader) { color = tint };
            return result;
        }

        Transform PointerSphere(string name, float diameter, Material material, out MeshRenderer renderer)
        {
            var sphere = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            sphere.name = name;
            sphere.transform.SetParent(transform, false);
            sphere.transform.localScale = Vector3.one * diameter;
            var collider = sphere.GetComponent<Collider>();
            if (collider != null) collider.enabled = false;
            renderer = sphere.GetComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            return sphere.transform;
        }

        void HidePointerVisual()
        {
            if (_ray != null) _ray.enabled = false;
            if (_pointerDot != null) _pointerDot.gameObject.SetActive(false);
            if (_pointerHalo != null) _pointerHalo.gameObject.SetActive(false);
        }

        void ShowPointerVisual(Ray ray, Vector3 target, bool hit, bool interactive, bool pressed, bool clicked)
        {
            // No visual infinity ray: free-space indication stops at a comfortable
            // arm's-length distance; real surface hits end precisely on the surface.
            var distance = Mathf.Max(.09f, Vector3.Distance(ray.origin, target));
            var start = ray.GetPoint(Mathf.Min(.09f, distance * .18f));
            _ray.enabled = true;
            _ray.SetPosition(0, start);
            _ray.SetPosition(1, target);
            var color = clicked || pressed && interactive ? _pointerPressMaterial.color :
                interactive ? _pointerHoverMaterial.color : _pointerIdleMaterial.color;
            _ray.startColor = new Color(color.r, color.g, color.b, .12f);
            _ray.endColor = new Color(color.r, color.g, color.b, hit ? .88f : .38f);
            _ray.endWidth = clicked ? .0028f : interactive ? .0021f : .0012f;
            _pointerDot.gameObject.SetActive(true);
            _pointerDot.position = target;
            _pointerDot.localScale = Vector3.one * (clicked ? .011f : pressed ? .012f : interactive ? .017f : .009f);
            _pointerDotRenderer.sharedMaterial = clicked || pressed && interactive ? _pointerPressMaterial :
                interactive ? _pointerHoverMaterial : _pointerIdleMaterial;
            _pointerHalo.gameObject.SetActive(hit && interactive);
            if (hit)
            {
                _pointerHalo.position = target;
                var pulse = 1f + .09f * Mathf.Sin(Time.unscaledTime * 7f);
                _pointerHalo.localScale = Vector3.one * (clicked ? .025f : pressed ? .027f : .032f * pulse);
            }
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
            _panelOffset = new Vector3(0, 0, 1.25f);
            _initialPanelPlaced = true;
            SavePanelOffset();
            RecenterPanel();
        }

        void BuildSpatialShell()
        {
            var source = PanelMaterial != null ? PanelMaterial : ButtonMaterial;
            if (source == null)
            {
                var shader = Shader.Find("Kreoda/QuestUi") ?? Shader.Find("Unlit/Color");
                source = new Material(shader);
            }
            var chip = QuestUi.StatusChip(_panel, Font, source, new Vector3(0, .215f, 0),
                .30f, .036f, RegisterTextBounds, out _chipStatus);
            var dot = chip.Find("Status chip dot");
            if (dot != null) _chipDot = dot.GetComponent<MeshRenderer>()?.sharedMaterial;
            _sectionTitle = QuestUi.SectionLabel(_panel, Font, "SPAZIO / HOME",
                "Le azioni sono oggetti nello spazio.", new Vector3(-.190f, .175f, -.006f),
                .19f, RegisterTextBounds, out _sectionSubtitle);
            _toolRail = QuestUi.ToolRail(_panel, Font, source, new Vector3(-.245f, .02f, 0),
                .085f, .30f,
                new[] { "rail:home", "rail:view", "rail:section", "rail:references" },
                new[] { "Home", "Vista", "Sezione", "Riferimenti" },
                new[] { 4, 0, 8, 9 }, 0, RailAction, RegisterTextBounds);
            _shellHint = QuestUi.Hint(_panel, Font, source, new Vector3(-.17f, -.345f, 0), .175f);
        }

        void RailAction(string id)
        {
            switch (id)
            {
                case "rail:home": Page(_homePage); break;
                case "rail:view": Page(_viewPage); break;
                case "rail:section": Page(_sectionPage); break;
                case "rail:references": OpenReferences(); break;
            }
        }

        void UpdateSpatialSection(Transform selected)
        {
            if (_sectionTitle == null) return;
            string title, subtitle;
            if (selected == _homePage) { title = "SPAZIO / HOME"; subtitle = "Le azioni sono oggetti nello spazio."; }
            else if (selected == _viewPage) { title = "SPAZIO / WORKSPACE"; subtitle = "Modello su piano reale. Strumenti vicini all'oggetto."; }
            else if (selected == _connectionPage) { title = "SPAZIO / CONNESSIONE"; subtitle = "Pairing protetto. Target CAD solo dopo connessione."; }
            else if (selected == _pcPage) { title = "SPAZIO / RICERCA PC"; subtitle = "Dispositivi della rete locale e ricerca di workstation."; }
            else if (selected == _commandPage) { title = "SPAZIO / AZIONI CAD"; subtitle = "Comandi contestuali sulla selezione geometrica."; }
            else if (selected == _editPage) { title = "SPAZIO / MODIFICA"; subtitle = "Handle spaziale e valore numerico preciso."; }
            else if (selected == _sketchPage) { title = "SPAZIO / SKETCH"; subtitle = "Piano di disegno ancorato alla geometria."; }
            else if (selected == _sectionPage) { title = "SPAZIO / SEZIONE"; subtitle = "Un piano attraversa l'oggetto nello spazio reale."; }
            else if (selected == _referencePage) { title = "SPAZIO / RIFERIMENTI"; subtitle = "Piani, assi e punti creati intorno al pezzo."; }
            else if (selected == _configurationPage) { title = "SPAZIO / CONFIGURAZIONI"; subtitle = "Varianti del progetto, selezione spaziale."; }
            else if (selected == _metricsPage) { title = "SPAZIO / METRICHE"; subtitle = "Strumentazione non invasiva, nessun grafico inventato."; }
            else if (selected == _voicePage) { title = "SPAZIO / HERMES"; subtitle = "Assistente contestuale, non sostituisce i comandi CAD."; }
            else if (selected == _homeNoticePage) { title = "SPAZIO / ESITO"; subtitle = "Messaggio world-locked; mai coprire l'area di lavoro."; }
            else { title = "SPAZIO / KREODA"; subtitle = "Strumenti contestuali intorno al modello."; }
            if (_sectionTitle.text != title) _sectionTitle.text = title;
            if (_sectionSubtitle.text != subtitle) _sectionSubtitle.text = subtitle;
            if (_shellHint != null) _shellHint.gameObject.SetActive(selected != _homePage);
            UpdateRailActive(selected);
        }

        void UpdateRailActive(Transform selected)
        {
            if (_toolRail == null) return;
            var active = selected == _homePage ? 0 : selected == _viewPage ? 1 :
                selected == _sectionPage ? 2 : selected == _referencePage ? 3 : -1;
            var names = new[] { "Home", "Vista", "Sezione", "Riferimenti" };
            for (var i = 0; i < names.Length; i++)
            {
                var button = _toolRail.Find(names[i] + " rail button");
                if (button == null) continue;
                var renderer = button.GetComponent<MeshRenderer>();
                if (renderer == null || renderer.sharedMaterial == null) continue;
                var fill = renderer.sharedMaterial;
                fill.color = i == active ? new Color(.078f, .325f, .353f, .99f) : new Color(.125f, .188f, .216f, .99f);
                if (fill.HasProperty("_BorderColor"))
                    fill.SetColor("_BorderColor", i == active
                        ? new Color(.392f, .933f, .882f, .95f)
                        : new Color(.341f, .455f, .490f, .9f));
            }
        }

        Transform PageRoot(string name)
        {
            var page = new GameObject(name).transform;
            page.SetParent(_panel, false);
            // Reserve a 0.394 x 0.105 m, domain-specific focus theater above
            // the independent non-overlapping action workstations. The old
            // title-only shelf occupied the same upper band and is replaced.
            // No full-width footer rule: Display scale and datum modals use
            // this lower region and a decorative line crossed real controls.
            CreateDomainFocus(page, name);
            return page;
        }

        static string PageTitle(string name)
        {
            switch (name)
            {
                case "PC locali": return "PC vicini";
                case "Advanced PC diagnostics": return "Connessione PC";
                case "Home action status": return "Stato operazione";
                case "CAD configurations": return "Configurazioni";
                case "Display controls": return "Vista MR";
                case "Optional diagnostics": return "Metriche";
                case "Section view": return "Sezione";
                case "Exact CAD editing": return "Modifica";
                case "Canonical context actions": return "Azioni CAD";
                case "Canonical sketch dimensions": return "Sketch e quote";
                case "Hermes voice": return "Hermes";
                case "Contesto Hermes": return "Contesto voce";
                default: return name;
            }
        }

        readonly struct FocusSnapshot
        {
            public readonly string Primary, Secondary;
            public readonly bool Ready;
            public readonly int Mode;
            public readonly int RealItemCount;
            public readonly float Fraction;
            public FocusSnapshot(string primary, string secondary, bool ready, int mode = 0,
                float fraction = -1f, int realItemCount = 0)
            {
                Primary = primary ?? string.Empty;
                Secondary = secondary ?? string.Empty;
                Ready = ready; Mode = mode; Fraction = fraction; RealItemCount = realItemCount;
            }
        }

        FocusSnapshot CurrentFocus(FocusKind kind)
        {
            var online = Connection != null && Connection.Connected;
            var model = online && Connection.Client?.Model != null;
            switch (kind)
            {
                case FocusKind.Peers:
                {
                    var peers = Connection?.AvailablePcs;
                    Kreoda.Session.DiscoveredSessionPc selected = null;
                    if (peers != null)
                        foreach (var peer in peers)
                            if (!string.IsNullOrEmpty(_selectedPcId) && peer.PcId == _selectedPcId)
                            { selected = peer; break; }
                    var authenticated = AuthenticatedSelectedPc(selected);
                    var requesting = selected != null && !online && !string.IsNullOrEmpty(_selectedPcNotice);
                    return new FocusSnapshot(selected == null ?
                        (peers?.Length ?? 0).ToString(CultureInfo.InvariantCulture) + " PC rilevati" : selected.Name,
                        selected == null ? Connection?.Status :
                            (selected.Endpoint != null ? selected.Endpoint.Authority + " · " : "") + selected.PcId,
                        selected != null || peers != null && peers.Length > 0,
                        authenticated ? 2 : requesting ? 1 : 0,
                        -1f, peers?.Length ?? 0);
                }
                case FocusKind.Pairing:
                    return new FocusSnapshot(online ? "PC AUTENTICATO" :
                        string.IsNullOrWhiteSpace(_endpoint) ? Connection?.SavedEndpoint : _endpoint,
                        Connection?.Status, online || !string.IsNullOrWhiteSpace(_endpoint) ||
                        !string.IsNullOrWhiteSpace(Connection?.SavedEndpoint), online ? 2 : _code.Length > 0 ? 1 : 0);
                case FocusKind.Outcome:
                    return new FocusSnapshot("Esito disponibile", "", true, online ? 2 : 1);
                case FocusKind.Variants:
                {
                    var choices = _configurations?.Names;
                    var available = model && choices != null && choices.Length > 0 &&
                        QuestConfigurations.IsCurrent(Connection.Client.Model, _configurationModel);
                    var chosen = available ? choices[_configurationIndex % choices.Length] : "Nessuna variante corrente";
                    return new FocusSnapshot(chosen, available ? "Attiva: " + _configurations.Active :
                        Connection?.Status, available, available ? chosen == _configurations.Active ? 2 : 1 : 0,
                        -1f, available ? choices.Length : 0);
                }
                case FocusKind.Placement:
                    return new FocusSnapshot(Display != null ? Display.ScaleName : "Scala non disponibile",
                        Display == null ? "" : Display.Status + " · " +
                        (Display.HeightCalibration * 1000f).ToString("0.#", CultureInfo.InvariantCulture) + " mm",
                        model, Display != null && Display.PlacementActive ? 1 : 0);
                case FocusKind.Telemetry:
                {
                    var measured = model && Connection.TriangleBudget > 0 && Connection.TriangleCount >= 0;
                    var fraction = measured ? Mathf.Clamp01((float)Connection.TriangleCount / Connection.TriangleBudget) : -1f;
                    var latency = online && Connection.RttMilliseconds.HasValue ?
                        "RTT " + Connection.RttMilliseconds.Value.ToString("0.#", CultureInfo.InvariantCulture) + " ms" : "RTT non disponibile";
                    var geometry = measured ? "TRI " + Connection.TriangleCount.ToString(CultureInfo.InvariantCulture) + " / " +
                        Connection.TriangleBudget.ToString(CultureInfo.InvariantCulture) : "Mesh non disponibile";
                    return new FocusSnapshot(latency, geometry, measured, measured ? 1 : 0, fraction);
                }
                case FocusKind.Section:
                {
                    if (Connection.Section != null && Connection.Section.CurvatureEnabled)
                        return new FocusSnapshot("CURVATURA max " + Connection.Section.CurvatureMaximumPerMm.ToString("G3", CultureInfo.InvariantCulture) + " 1/mm",
                            "0 blu / max rosso / grigio ?", Connection.Section.CurvatureAvailable, 0);
                    var plane = model && Connection.Section != null ? Connection.Section.Plane : null;
                    var axis = plane.HasValue && plane.Value.Axis.HasValue ? plane.Value.Axis.Value.ToString() : "—";
                    var quota = plane.HasValue ? plane.Value.OffsetMm.ToString("0.###", CultureInfo.InvariantCulture) + " mm" : "Nessuna quota";
                    var mode = axis == "X" ? 1 : axis == "Y" ? 2 : axis == "Z" ? 3 : 0;
                    if (mode != 0 && plane.Value.Inverted) mode += 3;
                    return new FocusSnapshot("PIANO " + axis + " / " + quota,
                        plane.HasValue ? (plane.Value.Inverted ? "Normale invertita" : "Normale originale") : Connection?.Status,
                        plane.HasValue, mode);
                }
                case FocusKind.Parameter:
                {
                    var intent = model && Spatial != null ? Spatial.SelectedIntent : null;
                    var ready = intent != null && intent.Parameters.Count > 0;
                    var field = ready ? intent.Parameters[_exactParameter % intent.Parameters.Count] : "Nessun parametro";
                    var values = Spatial != null ? Spatial.DraftValues : null;
                    if (values == null) values = intent?.InitialValues;
                    var number = ready && values != null && values.TryGetValue(field, out var candidate) ?
                        candidate.ToString("0.###", CultureInfo.InvariantCulture) + " " + intent.Unit : "Valore non disponibile";
                    return new FocusSnapshot(number, field + " · " + (Spatial != null && Spatial.SnapEnabled ? "Snap ON" : "Snap OFF"),
                        ready, _pendingExact != null && ReferenceEquals(Spatial?.SelectedIntent, _exactIntent) ? 2 : ready ? 1 : 0);
                }
                case FocusKind.Commands:
                    return new FocusSnapshot(model && Commands != null ? Commands.FieldLabel + ": " + Commands.FieldValue : "Nessun campo CAD",
                        Commands != null && model ? Commands.CommandLabel + " · " + Commands.Status : Connection?.Status,
                        model && Commands != null, Commands != null && Commands.Busy ? 3 :
                        Commands != null && Commands.CanConfirm && model ? 2 : model && Commands != null ? 1 : 0);
                case FocusKind.Datums:
                    return new FocusSnapshot(model && References != null ?
                        References.IsFormOpen && References.SchemaReady ? References.CurrentFieldValue :
                        References.HasSelectedDatum ? References.SelectedDatumId : "Nessun datum corrente" : "Nessun datum corrente",
                        model && References != null ? _referenceTitle.text + " · " + References.Status : Connection?.Status,
                        model && References != null, References == null ? 0 : References.IsFormOpen ? 1 :
                        References.IsInspecting ? 2 : References.IsHome ? 3 : 0);
                case FocusKind.Dimension:
                {
                    var chosen = model && SketchDimensions != null ? SketchDimensions.Selected : null;
                    return new FocusSnapshot(chosen != null ? SketchDimensions.Value.ToString("0.###", CultureInfo.InvariantCulture) +
                        " " + chosen.Unit : "Nessuna quota corrente",
                        chosen != null ? chosen.Kind + " · " + chosen.ConstraintId : Connection?.Status,
                        chosen != null, chosen != null ? SketchDimensions.Busy ? 2 : 1 : 0);
                }
                case FocusKind.Hermes:
                    return new FocusSnapshot(Voice == null ? "Non disponibile" : !Voice.Configured ? "HERMES IN ATTESA" :
                        Voice.Recording ? "Ascolto…" : Voice.Busy ? "Elaborazione…" : "Pronto", "",
                        Voice != null && Voice.Configured, Voice == null ? 0 : Voice.Recording ? 1 : Voice.Busy ? 2 : 0);
                case FocusKind.VoiceContext:
                {
                    var collection = _voiceContext;
                    var active = collection != null && collection.ExplicitMode;
                    var count = collection != null ? collection.Count : 0;
                    var hasPoint = collection != null && collection.HasPoint;
                    var armed = collection != null && collection.PointArmed;
                    var primary = !active ? "Raccolta non attiva" : armed ? "Punto MR armato" :
                        count > 0 ? count.ToString(CultureInfo.InvariantCulture) + " riferimenti" :
                        hasPoint ? "Punto MR CAD" : "Raccolta vuota";
                    return new FocusSnapshot(primary,
                        collection != null ? collection.Status : "Contesto voce non disponibile", active,
                        armed ? 1 : hasPoint ? 3 : count > 0 ? 2 : 0, -1f, count);
                }
                default: return new FocusSnapshot("", "", false);
            }
        }

        static FocusKind FocusFor(string page)
        {
            switch (page)
            {
                case "PC locali": return FocusKind.Peers;
                case "Advanced PC diagnostics": return FocusKind.Pairing;
                case "Home action status": return FocusKind.Outcome;
                case "CAD configurations": return FocusKind.Variants;
                case "Display controls": return FocusKind.Placement;
                case "Optional diagnostics": return FocusKind.Telemetry;
                case "Section view": return FocusKind.Section;
                case "Exact CAD editing": return FocusKind.Parameter;
                case "Canonical context actions": return FocusKind.Commands;
                case "Riferimenti CAD": return FocusKind.Datums;
                case "Canonical sketch dimensions": return FocusKind.Dimension;
                case "Hermes voice": return FocusKind.Hermes;
                case "Contesto Hermes": return FocusKind.VoiceContext;
                default: throw new InvalidOperationException("No focus scene for " + page);
            }
        }

        void CreateDomainFocus(Transform page, string pageName)
        {
            if (page == null || Font == null || PanelMaterial == null) return;
            var stage = QuestUi.CreateLiveFocusStage(page, Font, PanelMaterial,
                PageTitle(pageName), new Vector3(0, .163f, .011f), .394f, .105f, RegisterTextBounds);
            // The spatial redesign replaces the desktop summary slab with the
            // world-locked status chip and the right-hand inspector.
            stage.Root.gameObject.SetActive(false);
            _textLimits[stage.Value] = new Vector2(.35f, .027f);
            _textLimits[stage.Side] = new Vector2(.35f, .020f);
            _domainFocus.Add(page, new DomainFocus
            {
                Kind = FocusFor(pageName),
                Stage = stage
            });
        }
        void RefreshDomainFocusStages()
        {
            foreach (var entry in _domainFocus)
            {
                var focus = entry.Value;
                if (!entry.Key.gameObject.activeInHierarchy)
                {
                    focus.LastSnapshot = null;
                    continue;
                }
                var observed = CurrentFocus(focus.Kind);
                var severity = observed.Ready ? QuestUi.StatusSeverity.Active : QuestUi.StatusSeverity.Warning;
                var value = ShortVoiceText(observed.Primary, 47);
                var note = ShortVoiceText(observed.Secondary, 47);
                var featuredId = FocusedOperationId(focus.Kind);
                TextMesh featured = null;
                if (_contextActions.TryGetValue(entry.Key, out var actions) &&
                    !string.IsNullOrEmpty(featuredId)) actions.TryGetValue(featuredId, out featured);
                var actionState = featured != null && _contextVisualStates.TryGetValue(featured, out var visualState) ?
                    visualState : 0;
                var key = value + "|" + note + "|" + observed.Ready + "|" + featuredId + "|" +
                    actionState.ToString(CultureInfo.InvariantCulture);
                if (focus.LastSnapshot == key) continue;
                focus.LastSnapshot = key;
                focus.Stage.SetData(PageTitle(entry.Key.name), value, note, severity);
                if (!ReferenceEquals(focus.FocusedAction, featured))
                {
                    if (focus.FocusedAction != null)
                        QuestUi.SetActionFocus(focus.FocusedAction, false, QuestUi.StatusSeverity.Neutral);
                    focus.FocusedAction = featured;
                }
                if (featured != null)
                {
                    var actionable = (actionState & 1) != 0 &&
                        featured.transform.parent.gameObject.activeInHierarchy;
                    QuestUi.SetActionFocus(featured, observed.Ready && actionable, severity);
                }
            }
        }
        string FocusedOperationId(FocusKind kind)
        {
            switch (kind)
            {
                case FocusKind.Peers:
                {
                    var peers = Connection?.AvailablePcs;
                    if (peers == null || peers.Length == 0) return "Riprova";
                    for (var slot = 0; slot < _pcChoices.Length; slot++)
                    {
                        var index = _pcChoicePage * _pcChoices.Length + slot;
                        if (index < peers.Length && peers[index].PcId == _selectedPcId) return "PC " + (slot + 1);
                    }
                    return "PC 1";
                }
                case FocusKind.Pairing: return Connection != null && Connection.Connected ? "Invia target al PC" : "Connetti";
                case FocusKind.Outcome: return "Torna a Home";
                case FocusKind.Variants: return _configurations != null &&
                    _configurations.Names != null && _configurations.Names.Length > 0 &&
                    _configurations.Names[_configurationIndex % _configurations.Names.Length] == _configurations.Active ?
                    "Successiva" : "Attiva selezionata";
                case FocusKind.Placement: return Display != null && Display.PlacementActive ? "Conferma" : "Posiziona";
                case FocusKind.Telemetry: return "Torna a Vista";
                case FocusKind.Section: return Connection?.Section != null && Connection.Section.Plane.HasValue ?
                    "Quota esatta" : "Attiva sezione";
                case FocusKind.Parameter: return Spatial?.SelectedIntent != null ? "Valore esatto" : "Feature →";
                case FocusKind.Commands: return Commands != null && Commands.CanConfirm ? "Conferma" : "Valore";
                case FocusKind.Datums: return References != null && References.IsFormOpen ? "Conferma" :
                    References != null && References.HasSelectedDatum ? "Ispeziona" : "Nuovo piano";
                case FocusKind.Dimension: return SketchDimensions?.Selected != null ? "Conferma" : "Sketch →";
                case FocusKind.Hermes: return Voice != null && Voice.Busy ? "Stop" : "Parla / Invia";
                case FocusKind.VoiceContext: return _voiceContext != null &&
                    (_voiceContext.Count > 0 || _voiceContext.HasPoint) ? "Cancella" : "Arma punto";
                default: return null;
            }
        }
        void AddPageSummary(Transform page, TextMesh live, string title, float y, float height = .047f)
        {
            // The focus stage is the single page summary. No footer duplicate.
        }

        void UpdatePageSummary(Transform page, string title, TextMesh readout,
            string detail, bool ready, QuestUi.StatusSeverity active = QuestUi.StatusSeverity.Active)
        {
            // Page state is shown in the live focus and bound action labels.
        }

        void BuildSecondaryPageLayouts()
        {
            // Keep the hidden readout sources for existing service refreshes.
            // The visible page state belongs to the compact focus stage.
            _pcOverview = OperationalReadout(_pcPage, "PC DISPONIBILI", -.270f);
            _configurationOverview = OperationalReadout(_configurationPage, "DOCUMENTO E VARIANTE", -.275f);
            _viewOverview = OperationalReadout(_viewPage, "SCENA MR", .132f);
            _sectionOverview = OperationalReadout(_sectionPage, "TAGLIO CORRENTE", -.275f);
            _metricsOverview = OperationalReadout(_metricsPage, "TELEMETRIA ATTUALE", -.274f);
            _editOverview = OperationalReadout(_editPage, "OPERAZIONE EDIT", -.275f);
            _commandOverview = OperationalReadout(_commandPage, "COMANDO IN CORSO", -.280f);
            _sketchOverview = OperationalReadout(_sketchPage, "QUOTA SELEZIONATA", -.295f, .028f);
            _connectionOverview = OperationalReadout(_connectionPage, "COLLEGAMENTO PC", -.289f);
            _noticeOverview = OperationalReadout(_homeNoticePage, "RISULTATO OPERAZIONE", -.235f);
            _referenceOverview = OperationalReadout(_referencePage, "STATO RIFERIMENTI", .140f, .028f);
            _voiceOverview = OperationalReadout(_voicePage, "STATO HERMES", -.289f);
            // Legacy footer summary creation is intentionally disabled.
            AddPageSummary(_pcPage, _pcOverview, "DISPOSITIVI", -.270f);
            AddPageSummary(_connectionPage, _connectionOverview, "SESSIONE PC", -.289f);
            AddPageSummary(_homeNoticePage, _noticeOverview, "ESITO", -.235f);
            AddPageSummary(_configurationPage, _configurationOverview, "VARIANTE", -.275f);
            AddPageSummary(_viewPage, _viewOverview, "SCENA MR", .132f);
            AddPageSummary(_metricsPage, _metricsOverview, "TELEMETRIA", -.274f);
            AddPageSummary(_sectionPage, _sectionOverview, "SEZIONE", -.275f);
            AddPageSummary(_editPage, _editOverview, "MODIFICA", -.275f);
            AddPageSummary(_commandPage, _commandOverview, "COMANDO", -.280f);
            // Reference modals occupy the lower work surface in every mode;
            // the live datum summary belongs to the free upper status strip.
            AddPageSummary(_referencePage, _referenceOverview, "DATUM", .140f, .028f);
            AddPageSummary(_sketchPage, _sketchOverview, "QUOTA", -.295f, .028f);
            AddPageSummary(_voicePage, _voiceOverview, "HERMES", -.289f);
            // These compatibility calls are no-ops because there are no footer cards.
            HideSecondarySummaryUnderFocus(_viewPage);
            HideSecondarySummaryUnderFocus(_referencePage);
            // Hide duplicate legacy status text; its data remains available to
            // the page focus and the original action details.
            HideLegacyDuplicateReadouts(_pcStatus, _target, _massStatus,
                _configurationStatus, _viewStatus, _sectionStatus, _sectionQuota,
                _editStatus, _commandStatus, _sketchStatus,
                _viewOverview, _referenceOverview, _referenceTitle);
        }

        void HideSecondarySummaryUnderFocus(Transform page)
        {
            if (page != null && _pageSummaries.TryGetValue(page, out var summary) &&
                summary.Title != null && summary.Title.transform.parent != null)
                summary.Title.transform.parent.gameObject.SetActive(false);
        }

        static void HideLegacyDuplicateReadouts(params TextMesh[] readouts)
        {
            foreach (var readout in readouts)
            {
                if (readout == null) continue;
                var textRenderer = readout.GetComponent<MeshRenderer>();
                if (textRenderer != null) textRenderer.enabled = false;
            }
        }

        static void SetReadout(TextMesh target, string value)
        {
            if (target != null && target.text != value) target.text = value;
        }

        static void SetButtonActive(TextMesh target, bool active)
        {
            var root = target != null ? target.transform.parent : null;
            if (root != null && root.gameObject.activeSelf != active) root.gameObject.SetActive(active);
        }

        TextMesh OperationalReadout(Transform page, string heading, float y, float height = .047f)
        {
            if (page == null || PanelMaterial == null || Font == null) return null;
            // Hidden source retained for the established service refresh flow.
            var live = QuestUi.Label(page, Font, "—", new Vector3(-.172f, y - height * .20f, -.012f),
                .009f, new Vector2(.345f, height * .48f), RegisterTextBounds);
            live.GetComponent<MeshRenderer>().enabled = false;
            return live;
        }

        void FunctionalSection(Transform page, string title, float y, float width)
        {
            if (page == null || Font == null) return;
            var caption = QuestUi.Label(page, Font, title, new Vector3(-.186f, y, -.013f),
                .009f, new Vector2(.37f, .017f), RegisterTextBounds, QuestUi.Accent);
            caption.anchor = TextAnchor.UpperLeft;
        }

        void SecondaryCard(Transform page, string name, float centerY, float width, float height)
        {
            if (page == null || PanelMaterial == null) return;
            var card = QuestUi.GlassMaterial(PanelMaterial);
            card.color = new Color(.045f, .095f, .155f, .43f);
            QuestUi.Surface(page, card, name + " glass body",
                new Vector3(0, centerY, .022f), new Vector3(width, height, .001f));
            var left = QuestUi.GlassMaterial(PanelMaterial);
            left.color = new Color(.24f, .59f, .90f, .33f);
            QuestUi.Surface(page, left, name + " section edge",
                new Vector3(-width * .49f, centerY, .018f), new Vector3(.001f, height * .90f, .001f));
        }

        void BuildProjectionPage()
        {
            if (_panel == null || Font == null || PanelMaterial == null || ButtonMaterial == null) return;
            if (!QuestProjectionLayout.Validate(out var layoutError))
                throw new InvalidOperationException(layoutError);

            _projectionPage = new GameObject("Sketch projection groups").transform;
            _projectionPage.SetParent(_panel, false);
            _projectionPage.gameObject.SetActive(false);
            _projectionStage = QuestUi.CreateLiveFocusStage(_projectionPage, Font, PanelMaterial,
                "Proiezioni sketch", new Vector3(0, .160f, .011f), .394f, .105f, RegisterTextBounds);

            _projections = GetComponent<QuestProjections>() ?? gameObject.AddComponent<QuestProjections>();
            _projections.Initialize(Connection, RayMaterial != null ? RayMaterial : ButtonMaterial);
            _projections.Changed += RefreshProjectionPage;

            foreach (var control in QuestProjectionLayout.Actions)
            {
                var label = QuestUi.OperationAction(_projectionPage, Font, ButtonMaterial,
                    control.Id, control.Caption, new Vector3(control.X, control.Y, .008f),
                    control.Width, control.Height, ProjectionAction(control.Id), RegisterTextBounds);
                _projectionActions.Add(control.Id, label);
            }
            _projectionRoute = QuestUi.OperationAction(_panel, Font, ButtonMaterial,
                QuestProjectionLayout.Route.Id, QuestProjectionLayout.Route.Caption,
                new Vector3(QuestProjectionLayout.Route.X, QuestProjectionLayout.Route.Y, .008f),
                QuestProjectionLayout.Route.Width, QuestProjectionLayout.Route.Height,
                OpenProjections, RegisterTextBounds);
            RefreshProjectionPage();
        }

        Action ProjectionAction(string id) => () =>
        {
            if (_projections != null && _projections.AuthoredSourceSelectionMode)
            { AuthoredSourceAction(id); return; }
            MainProjectionAction(id);
        };

        void MainProjectionAction(string id)
        {
            switch (id)
            {
                case "projection:sketch": _projections?.NextSketch(); break;
                case "projection:group": _projections?.NextGroup(); break;
                case "projection:operation": _projections?.NextOperation(); break;
                case "projection:refresh": _projections?.Refresh(); break;
                case "projection:capture":
                    if (_projections?.OperationName == "projectEdges") _projections.EnterAuthoredSourceSelection();
                    else CaptureProjectionSource();
                    break;
                case "projection:clear": _projections?.ClearSources(); break;
                case "projection:create": _projections?.CreateGroup(); break;
                case "projection:repair": _projections?.RepairGroup(); break;
                case "projection:replace": _projections?.ReplaceSource(); break;
                case "projection:remove": _projections?.RemoveGroup(); break;
                case "projection:back": Page(_sketchPage); break;
                default: throw new InvalidOperationException("Unknown projection action " + id);
            }
        }

        void AuthoredSourceAction(string id)
        {
            switch (id)
            {
                case "projection:sketch": _projections?.CycleAuthoredSource(1); break;
                case "projection:group": _projections?.CycleAuthoredSource(-1); break;
                case "projection:operation": _projections?.CycleAuthoredEntity(1); break;
                case "projection:refresh": _projections?.CycleAuthoredEntity(-1); break;
                case "projection:capture": _projections?.ToggleAuthoredEntity(); break;
                case "projection:clear": _projections?.ClearPendingAuthoredEntities(); break;
                case "projection:create": _projections?.AddAuthoredSource(); break;
                case "projection:repair": _projections?.SelectAllAuthoredEntities(); break;
                case "projection:replace": CaptureProjectionSource(); break;
                case "projection:remove":
                    _projections?.ExitAuthoredSourceSelection();
                    Page(_projectionPage);
                    break;
                case "projection:back":
                    _projections?.ExitAuthoredSourceSelection();
                    Page(_sketchPage);
                    break;
                default: throw new InvalidOperationException("Unknown authored source action " + id);
            }
        }

        void OpenProjections()
        {
            if (_projectionPage == null || _projections == null) return;
            _projections.ExitAuthoredSourceSelection();
            Page(_projectionPage);
            _projections.Open();
        }

        void CaptureProjectionSource()
        {
            if (_projections == null) return;
            var view = _selected;
            var uploadVersion = _selectedUploadVersion;
            var selectionMode = _selectedMode;
            var currentSelectionMode = _selectionMode;
            var hit = _hit;
            var datumSelected = _selectedDatum != null;
            _projections.CaptureSource(view, uploadVersion, selectionMode, currentSelectionMode,
                hit != null, selectionMode == 2 && hit != null,
                selectionMode == 2 ? hit?.PersistentId : null,
                hit?.ReferenceAmbiguous == true, datumSelected);
        }

        void RefreshProjectionPage()
        {
            if (_refreshingProjectionPage || _projections == null) return;
            _refreshingProjectionPage = true;
            try
            {
                var connected = Connection != null && Connection.Connected;
                var sourceMode = _projections.AuthoredSourceSelectionMode;
                var severity = connected && _projections.HasTarget
                    ? QuestUi.StatusSeverity.Active : QuestUi.StatusSeverity.Warning;
                if (sourceMode)
                {
                    _projectionStage?.SetData(
                        string.IsNullOrEmpty(_projections.SelectedAuthoredSketchFeatureId) ? "Nessuno sketch sorgente" :
                            "Sketch sorgente · " + _projections.SelectedAuthoredSketchFeatureId,
                        _projections.SelectedAuthoredEntityLabel,
                        _projections.AuthoredSelectionReadout,
                        severity);
                    SetProjectionAction("projection:sketch", _projections.CanCycleAuthoredSource, false, severity);
                    SetProjectionAction("projection:group", _projections.CanCycleAuthoredSource, false, severity);
                    SetProjectionAction("projection:operation", _projections.CanCycleAuthoredEntity, false, severity);
                    SetProjectionAction("projection:refresh", _projections.CanCycleAuthoredEntity, false, severity);
                    SetProjectionAction("projection:capture", _projections.CanToggleAuthoredEntity,
                        _projections.SelectedAuthoredEntityPending, severity);
                    SetProjectionAction("projection:clear", _projections.CanClearPendingAuthoredEntities, false, severity);
                    SetProjectionAction("projection:create", _projections.CanAddAuthoredSource, false, severity);
                    SetProjectionAction("projection:repair", _projections.CanSelectAllAuthoredEntities, false, severity);
                    SetProjectionAction("projection:replace", _projections.CanCapture, false, severity);
                    SetProjectionAction("projection:remove", _projections.CanExitAuthoredSourceSelection, false, severity);
                    SetProjectionAction("projection:back", _projections.CanExitAuthoredSourceSelection, false, severity);
                }
                else
                {
                    _projectionStage?.SetData(
                        string.IsNullOrEmpty(_projections.SelectedFeatureId) ? "Sketch non disponibile" : "Sketch · " + _projections.SelectedFeatureId,
                        _projections.Secondary,
                        _projections.OperationName + " · " + _projections.Status,
                        severity);
                    SetProjectionAction("projection:sketch", _projections.CanNextSketch, false, severity);
                    SetProjectionAction("projection:group", _projections.CanNextGroup, false, severity);
                    SetProjectionAction("projection:operation", !_projections.Busy && _projections.HasTarget, false, severity);
                    SetProjectionAction("projection:refresh", _projections.CanRefresh, false, severity);
                    SetProjectionAction("projection:capture", _projections.CanCapture, false, severity);
                    SetProjectionAction("projection:clear", _projections.CanClearSources, false, severity);
                    SetProjectionAction("projection:create", _projections.CanCreate, false, severity);
                    SetProjectionAction("projection:repair", _projections.CanRepair, false, severity);
                    SetProjectionAction("projection:replace", _projections.CanReplace, false, severity);
                    SetProjectionAction("projection:remove", _projections.CanRemove, false, severity);
                    SetProjectionAction("projection:back", true, false, severity);
                }
                foreach (var control in QuestProjectionLayout.Actions)
                {
                    if (!_projectionActions.TryGetValue(control.Id, out var label) || label == null) continue;
                    var caption = sourceMode ? AuthoredSourceActionCaption(control.Id) :
                        control.Id == "projection:capture" && _projections.OperationName == "projectEdges" ? "Sorgenti" : control.Caption;
                    if (label.text != caption) label.text = caption;
                }
                QuestUi.SetOperationActionState(_projectionRoute, false, true, QuestUi.StatusSeverity.Active);
            }
            finally { _refreshingProjectionPage = false; }
        }

        string AuthoredSourceActionCaption(string id)
        {
            switch (id)
            {
                case "projection:sketch": return "Sketch →";
                case "projection:group": return "Sketch ←";
                case "projection:operation": return "Curva →";
                case "projection:refresh": return "Curva ←";
                case "projection:capture": return _projections.SelectedAuthoredEntityPending ? "Escludi" : "Includi";
                case "projection:clear": return "Pulisci";
                case "projection:create": return "Aggiungi";
                case "projection:repair": return "Tutte";
                case "projection:replace": return "Acq. mesh";
                case "projection:remove": return "Proiezioni";
                case "projection:back": return "Sketch / quote";
                default: throw new InvalidOperationException("Unknown authored source action " + id);
            }
        }

        void SetProjectionAction(string id, bool enabled, bool selected, QuestUi.StatusSeverity severity)
        {
            if (_projectionActions.TryGetValue(id, out var label))
                QuestUi.SetOperationActionState(label, selected, enabled, severity);
        }

        void Page(Transform selected)
        {
            if (_voiceContextPage != null && selected != _voiceContextPage)
                _voiceContext?.CancelPointArm();
            if (_assemblyMatesPage != null && selected != _assemblyMatesPage && _assemblyMatesPage.gameObject.activeSelf)
                AssemblyMates?.CancelPending("Pagina chiusa; operazioni annullate.");
            if (_directFaceHistoryPage != null && selected != _directFaceHistoryPage && _directFaceHistoryPage.gameObject.activeSelf)
                CancelDirectFaceUi("Pagina chiusa; acquisizioni annullate.");
            if (selected != _homeNoticePage && _thicknessNotice)
            {
                _thicknessNotice = false;
                if (_thicknessPending) { _thicknessPending = false;_massRequest++;_thicknessSummary = "Misura non completata"; }
            }
            if (_pcPage != null) _pcPage.gameObject.SetActive(selected == _pcPage);
            if (_homePage != null) _homePage.gameObject.SetActive(selected == _homePage);
            if (_assemblyMatesPage != null) _assemblyMatesPage.gameObject.SetActive(selected == _assemblyMatesPage);
            if (_directFaceHistoryPage != null) _directFaceHistoryPage.gameObject.SetActive(selected == _directFaceHistoryPage);
            if (_homeNoticePage != null) _homeNoticePage.gameObject.SetActive(selected == _homeNoticePage);
            if (_connectionPage != null) _connectionPage.gameObject.SetActive(selected == _connectionPage);
            if (_viewPage != null) _viewPage.gameObject.SetActive(selected == _viewPage);
            if (_metricsPage != null) _metricsPage.gameObject.SetActive(selected == _metricsPage);
            if (_sectionPage != null) _sectionPage.gameObject.SetActive(selected == _sectionPage);
            if (_editPage != null) _editPage.gameObject.SetActive(selected == _editPage);
            if (_commandPage != null) _commandPage.gameObject.SetActive(selected == _commandPage);
            if (_referencePage != null) _referencePage.gameObject.SetActive(selected == _referencePage);
            if (_configurationPage != null) _configurationPage.gameObject.SetActive(selected == _configurationPage);
            if (_sketchPage != null) _sketchPage.gameObject.SetActive(selected == _sketchPage);
            if (_projectionPage != null) _projectionPage.gameObject.SetActive(selected == _projectionPage);
            if (_projectionRoute != null && _projectionRoute.transform.parent != null)
                _projectionRoute.transform.parent.gameObject.SetActive(selected == _sketchPage);
            if (_voicePage != null) _voicePage.gameObject.SetActive(selected == _voicePage);
            if (_voiceContextPage != null) _voiceContextPage.gameObject.SetActive(selected == _voiceContextPage);
            if (_panelBackground != null) _panelBackground.SetActive(false);
            foreach (var edge in _pageShellEdges)
                if (edge != null) edge.SetActive(selected != _homePage);
            foreach (var legacyControl in _legacyHeaderControls)
                if (legacyControl != null)
                    legacyControl.SetActive(selected != _homePage);
            UpdateSpatialSection(selected);
        }
        void HomeAction(string id)
        {
            switch (id)
            {
                case "home:pc":
                    Page(_pcPage);
                    if (Connection != null && !Connection.Connected) Connection.Reconnect();
                    break;
                case "home:project:select": SelectOpenableProject(); break;
                case "home:project:open": ConfirmOpenableProject(); break;
                case "home:project:refresh": RefreshOpenableProjects();break;
                case "home:ai": if (_voicePage != null) Page(_voicePage); else Page(_connectionPage); break;
                case "home:design": SketchDimensions?.Select();Page(_sketchPage); break;
                case "home:model":
                    if (Spatial != null) { Display.EndTwoHand(false);Spatial.SetMode(true); }
                    Page(_editPage);break;
                case "home:view": Page(_viewPage);break;
                case "home:measure": OpenReferences();break;
                // These legacy IDs remain wired for old scenes and input bindings,
                // but project creation, local file import, and templates belong to Desktop.
                case "home:project:new":
                    DelegateProjectToDesktop("Crea nuovi progetti in Kreoda Desktop. Quest non crea documenti."); break;
                case "home:project:import":
                    DelegateProjectToDesktop("Importa file in Kreoda Desktop. Quest non importa file locali."); break;
                case "home:project:template":
                    DelegateProjectToDesktop("Crea progetti da template in Kreoda Desktop. Quest non applica template."); break;
                case "home:render": Page(_viewPage);break;
            }
        }

        void OpenAssemblyMates()
        {
            if (AssemblyMates == null) return;
            AssemblyMates.Connection = Connection;
            AssemblyMates.Spatial = Spatial;
            AssemblyMates.Commands = Commands;
            Page(_assemblyMatesPage);
        }

        void CaptureAssemblySlot(bool moving)
        {
            if (AssemblyMates == null) return;
            var view = _selected;
            var hit = _hit;
            var mode = _selectionMode;
            var uploadVersion = _selectedUploadVersion;
            bool SelectionIsCurrent() => view != null && _selected == view && _selectedDatum == null &&
                _selectedUploadVersion == uploadVersion && view.UploadVersion == uploadVersion &&
                _selectionMode == mode && ReferenceEquals(_hit, hit);
            _ = AssemblyMates.CaptureAsync(moving, view, hit, mode, SelectionIsCurrent);
        }

        void EditAssemblyMateValue()
        {
            if (_keyboard != null || AssemblyMates == null) return;
            _editingAssemblyMateValue = true;
            _valueInput = AssemblyMates.ValueText;
            _keyboard = TouchScreenKeyboard.Open(_valueInput, TouchScreenKeyboardType.NumbersAndPunctuation,
                false, false, false, false, AssemblyMates.UsesAngle ? "Angolo (0–180°)" : "Distanza (mm)", 32);
        }

        void OpenDirectFaceHistory()
        {
            if (DirectFaceHistory == null) return;
            DirectFaceHistory.Connection = Connection;DirectFaceHistory.Spatial = Spatial;
            DirectFaceHistory.Commands = Commands;DirectFaceHistory.AssemblyMates = AssemblyMates;
            Page(_directFaceHistoryPage);
        }

        void CaptureDirectFaceSource() => CaptureDirectFace(true);
        void CaptureDirectFaceSupport() => CaptureDirectFace(false);

        void CaptureDirectFace(bool source)
        {
            if (DirectFaceHistory == null) return;
            var view = _selected;var hit = _hit;var mode = _selectionMode;var upload = _selectedUploadVersion;
            bool SelectionIsCurrent() => view != null && _selected == view && _selectedDatum == null &&
                _selectedUploadVersion == upload && view.UploadVersion == upload && _selectionMode == mode &&
                mode == 1 && ReferenceEquals(_hit, hit);
            if (source) _ = DirectFaceHistory.CaptureSourceAsync(view, hit, SelectionIsCurrent);
            else _ = DirectFaceHistory.CaptureSupportAsync(view, hit, SelectionIsCurrent);
        }

        void EditDirectFaceValue()
        {
            if (_keyboard != null || DirectFaceHistory == null) return;
            _editingDirectFaceValue = true;_valueInput = DirectFaceHistory.FieldValue;
            _keyboard = TouchScreenKeyboard.Open(_valueInput, TouchScreenKeyboardType.NumbersAndPunctuation,
                false, false, false, false, DirectFaceHistory.FieldLabel, 32);
        }

        void DelegateProjectToDesktop(string instructions)
        {
            // No phantom CreateProject/Import IPC: explain ownership in the existing notice.
            Page(_homePage);
            if (_homeNotice != null) _homeNotice.text = instructions;
            Page(_homeNoticePage);
        }

        void ConnectDiscoveredPc(Kreoda.Session.DiscoveredSessionPc pc)
        {
            if (pc == null || Connection == null) return;
            // SelectPc performs authenticated discovery bootstrap or cached-credential
            // identity verification before presenting the authoritative model.
            _selectedPcNotice = "Collegamento automatico a " + pc.Name;
            _selectedPcId = pc.PcId;
            if (_pcStatus != null) _pcStatus.text = ShortVoiceText(_selectedPcNotice, 80);
            Page(_pcPage);
            Connection.SelectPc(pc.PcId);
        }

        bool AuthenticatedSelectedPc(Kreoda.Session.DiscoveredSessionPc peer)
        {
            // Selection alone never proves an authenticated session. The
            // actual saved endpoint must agree with this discovered stable ID.
            return peer != null && Connection != null && Connection.Connected &&
                peer.Endpoint != null && !string.IsNullOrEmpty(_selectedPcId) &&
                string.Equals(_selectedPcId, peer.PcId, StringComparison.Ordinal) &&
                string.Equals(Connection.SavedEndpoint, peer.Endpoint.AbsoluteUri,
                    StringComparison.OrdinalIgnoreCase);
        }

        void RefreshOpenableProjects()
        {
            ++_openableTicket;
            _openableProjects = null;
            _openablePending = false;
            _openConfirmId = null;
            SelectOpenableProject();
        }

        void ShowHomeNotice()
        {
            _thicknessNotice = false;
            _homeNotice.text = "Questa azione non è disponibile su Quest.\nIl documento CAD non verrà modificato.";
            Page(_homeNoticePage);
        }

        void OpenReferences()
        { References?.OpenHome();RefreshReferencePage();Page(_referencePage); }

        void RefreshReferencePage()
        {
            if (References == null || _referenceTitle == null) return;
            bool home = References.IsHome, inspect = References.IsInspecting, form = References.IsFormOpen;
            _referenceTitle.text = References.ModeLabel + (form ? " · " + References.OperationLabel : "");
            _referenceDetails.text = form
                ? References.CurrentFieldLabel + "\n" + References.CurrentFieldValue
                : inspect ? References.InspectionText : References.HomeSummary;
            _referenceStatus.text = inspect ? "" : References.Status;
            _referenceDetails.transform.localPosition = new Vector3(-.19f, inspect ? .085f : .095f, -.003f);
            _textLimits[_referenceDetails] = new Vector2(.38f, inspect ? .16f : .045f);
            _referenceStatus.transform.localPosition = new Vector3(-.19f, .063f, -.003f);
            _referenceStatus.gameObject.SetActive(!inspect);

            Show(_referenceNewPlane, home);Show(_referenceNewAxis, home);Show(_referenceNewPoint, home);
            for (var i = 0; i < _referenceDatumLabels.Length; i++)
            {
                var item = References.DatumAt(i);var label = item?.Label ?? "—";
                if (item != null && item.FeatureId == References.SelectedDatumId) label = "✓ " + label;
                SetButton(_referenceDatumLabels[i], home && item != null, label);
            }
            Show(_referenceDatumPrevious, home && References.DatumPageCount > 1);
            Show(_referenceDatumNext, home && References.DatumPageCount > 1);
            Show(_referenceInspect, home && References.HasSelectedDatum);
            Show(_referenceEdit, home && References.CanEditSelected || inspect && References.CanEditSelected);
            Show(_referenceSketch, home && References.CanSketchSelected);
            Show(_referenceBack, inspect);

            var formReady = form && References.SchemaReady;
            Show(_referenceType, formReady && !References.IsEditing);Show(_referenceOperation, formReady);
            Show(_referenceFieldPrevious, formReady);Show(_referenceFieldNext, formReady);
            var isSource = formReady && References.CurrentFieldIsSource;
            for (var i = 0; i < _referenceSourceLabels.Length; i++)
                SetButton(_referenceSourceLabels[i], isSource, isSource ? References.SourceChoiceLabel(i) : "—");
            Show(_referenceSourcesPrevious, isSource && References.SourcePageCount > 1);
            Show(_referenceSourcesNext, isSource && References.SourcePageCount > 1);
            if (form)
            {
                _referenceSourcesPrevious.text = "Fonti " + (References.SourcePage + 1) + " ←";
                _referenceSourcesNext.text = "→ " + (References.SourcePage + 1) + "/" + References.SourcePageCount;
            }
            Show(_referenceNumeric, formReady && References.CurrentFieldIsNumeric);
            Show(_referenceEnum, formReady && References.CurrentFieldIsEnum);
            Show(_referenceConfirm, formReady);Show(_referenceCancel, form);
            RefreshReferencePanelSurfaces();
        }

        void RefreshReferencePanelSurfaces()
        {
            if (_referencePage == null) return;
            var prefix = _referencePage.GetInstanceID().ToString(CultureInfo.InvariantCulture) + ":";
            for (var zone = 0; zone < 5; zone++)
            {
                if (!_measuredPanels.TryGetValue(prefix + zone, out var panel)) continue;
                // Panel content contains real QuestButton objects. Examine each
                // direct action root, not GetComponentsInChildren(active=true):
                // the parent may already be inactive from a previous mode.
                var hasVisibleAction = false;
                foreach (Transform child in panel.Content)
                    if (child.gameObject.activeSelf) { hasVisibleAction = true; break; }
                panel.Root.gameObject.SetActive(hasVisibleAction);
            }
        }

        static void Show(TextMesh label, bool visible)
        { if (label != null && label.transform.parent != null) label.transform.parent.gameObject.SetActive(visible); }
        static void SetButton(TextMesh label, bool visible, string text)
        { if (label == null) return;label.text = text;Show(label, visible); }

        void BeginReference(QuestReferenceKind kind)
        { References?.BeginCreate(kind);RefreshReferencePage(); }
        void SelectReferenceDatum(int slot)
        { References?.SelectDatumPageItem(slot);RefreshReferencePage(); }
        void InspectReferenceDatum()
        { References?.InspectSelected();RefreshReferencePage(); }
        void EditReferenceDatum()
        { References?.BeginEditSelected();RefreshReferencePage(); }
        void SketchOnReferencePlane()
        { if (References != null && References.StartSketchOnSelected()) Page(_commandPage);RefreshReferencePage(); }
        void ChooseReferenceSource(int slot)
        { References?.ChooseSource(slot);RefreshReferencePage(); }
        void SubmitReference()
        {
            if (Commands != null && References != null) Commands.SubmitReference(References);
            RefreshReferencePage();
        }
        void CancelReference()
        {
            if (_editingReference && _keyboard != null) _keyboard.active = false;
            _keyboard = null;_editingReference = false;References?.Cancel();RefreshReferencePage();
        }
        void EditReferenceNumeric()
        {
            if (References == null || !References.IsFormOpen || !References.CurrentFieldIsNumeric) return;
            _editingValue = _editingCommand = _editingSketch = false;_editingReference = true;
            _referenceForm = References.FormTicket;_referenceInput = References.InputTicket;
            _valueInput = References.NumericValue;
            _keyboard = TouchScreenKeyboard.Open(_valueInput, TouchScreenKeyboardType.NumbersAndPunctuation,
                false, false, false, false, References.NumericInputLabel, 64);
        }
        void TogglePanel()
        {
            UpdatePanelDrag(default, false, false);
            var visible = !_panel.gameObject.activeSelf;
            if (!visible)
            {
                _voiceContext?.CancelPointArm();
                CancelDirectFaceUi("Pannello chiuso; operazioni annullate.");
            }
            _panel.gameObject.SetActive(visible);
            if (_panel.gameObject.activeSelf) { Page(_homePage);ResetPanel(); }
        }

        void CancelDirectFaceUi(string reason)
        {
            if (_editingDirectFaceValue && _keyboard != null) _keyboard.active = false;
            if (_editingDirectFaceValue) _keyboard = null;
            _editingDirectFaceValue = false;
            DirectFaceHistory?.CancelPending(reason);
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
        bool _editingSection;
        string _sectionSession, _sectionDocument;
        void EditSectionQuota()
        {
            var section = Connection?.Section;
            var model = Connection?.Client?.Model;
            if (_keyboard != null || section?.Plane == null || model == null) return;
            _sectionSession = model.SessionId;_sectionDocument = model.DocumentId;
            _editingSection = true;
            _valueInput = section.Plane.Value.OffsetMm.ToString("0.###", CultureInfo.InvariantCulture);
            _keyboard = TouchScreenKeyboard.Open(_valueInput, TouchScreenKeyboardType.NumbersAndPunctuation,
                false, false, false, false, "Quota sezione (mm)", 32);
        }
        internal static bool CanApplySectionQuota(string session, string document, string currentSession,
            string currentDocument, string input, out double offset)
        {
            offset = 0;
            return !string.IsNullOrEmpty(session) && !string.IsNullOrEmpty(document) &&
                session == currentSession && document == currentDocument &&
                double.TryParse((input ?? "").Replace(',', '.'), NumberStyles.Float,
                    CultureInfo.InvariantCulture, out offset) && !double.IsNaN(offset) && !double.IsInfinity(offset);
        }
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
            if (References != null && (References.IsFormOpen || _editingReference)) References.Cancel();
            if (_editingValue || _editingCommand || _editingSketch || _editingReference)
            {
                _editingValue = false;
                _editingCommand = false;
                _editingSketch = false;
                _editingReference = false;
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
            {
                var pending = _pendingExact;
                _pendingExact = null;
                if (CanApplyExact(Connection.Connected ? Connection.Client?.Model : null, intent))
                    Spatial.Exact(pending);
                return;
            }
            _pendingExact = null;_exactIntent = intent;
            _exactParameter %= intent.Parameters.Count;_editingValue = true;
            _exactName = intent.Parameters[_exactParameter];
            _valueInput = (Spatial.DraftValues ?? intent.InitialValues)[intent.Parameters[_exactParameter]].ToString("R", CultureInfo.InvariantCulture);
            _keyboard = TouchScreenKeyboard.Open(_valueInput, TouchScreenKeyboardType.NumbersAndPunctuation,
                false, false, false, false, intent.Parameters[_exactParameter] + " · " + intent.Unit, 64);
        }
        internal static bool CanApplyExact(Kreoda.Session.SessionModelState model, SpatialEditIntent intent) =>
            model != null && intent != null && model.SessionId == intent.SessionId &&
            model.DocumentId == intent.DocumentId && model.Revision == intent.BaseRevision;

        void InspectMassProperties()
        {
            var client = Connection?.Client;
            var model = client?.Model;
            if (client == null || model == null || !Connection.Connected)
            { _massStatus.text = "Collega il PC per misurare";return; }
            var selected = _selected;
            if (selected == null || !Connection.IsCurrentView(selected))
            { _massStatus.text = "Seleziona un corpo CAD corrente";return; }
            var ticket = ++_massRequest;
            var feature = selected.FeatureId;
            _massStatus.text = "Calcolo B-Rep sul PC…";
            _ = Task.Run(async () =>
            {
                string message;
                try
                {
                    using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(12));
                    var result = await client.CallAsync(Kreoda.Session.SessionMethods.MeasureMassProperties,
                        new Dictionary<string, object> { ["featureId"] = feature }, timeout.Token,
                        expectedSessionId: model.SessionId).ConfigureAwait(false);
                    message = QuestMassInspection.Format(result);
                }
                catch (Exception error) { message = "Misura non disponibile · " + (error is Kreoda.Session.SessionException session ? session.Code : "QUERY_FAILED"); }
                _massUi.Enqueue(() =>
                {
                    if (ticket == _massRequest && _selected == selected && Connection.Client == client &&
                        Connection.IsCurrentView(selected) && CanApplyMassResult(client.Model, model) && _massStatus != null)
                        _massStatus.text = message;
                });
            });
        }

        void InspectMinimumThickness()
        {
            var client = Connection?.Client;var model = client?.Model;var selected = _selected;
            if (client == null || model == null || !Connection.Connected || selected == null || !Connection.IsCurrentView(selected)) return;
            var ticket = ++_massRequest;var feature = selected.FeatureId;
            _thicknessModel = model;_thicknessSelected = selected;_thicknessNotice = true;_thicknessPending = true;
            _thicknessSummary = "Analisi campionata sul PC…";_homeNotice.text = _thicknessSummary;Page(_homeNoticePage);
            _ = Task.Run(async () =>
            {
                string message;
                try {
                    using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(12));
                    var result = await client.CallAsync(Kreoda.Session.SessionMethods.MeasureMinimumThickness,
                        new Dictionary<string, object> { ["featureId"] = feature, ["maxSamples"] = 512 }, timeout.Token,
                        expectedSessionId: model.SessionId).ConfigureAwait(false);
                    message = QuestThicknessInspection.Format(result, feature);
                } catch (Exception error) { message = "Spessore non disponibile · " + (error is Kreoda.Session.SessionException session ? session.Code : "QUERY_FAILED"); }
                _massUi.Enqueue(() => {
                    if (ticket != _massRequest || _selected != selected || Connection.Client != client || !Connection.IsCurrentView(selected) ||
                        !CanApplyMassResult(client.Model, model) || !_thicknessNotice) return;
                    _thicknessPending = false;_thicknessSummary = message;_homeNotice.text = message;
                });
            });
        }

        internal static bool CanApplyMassResult(Kreoda.Session.SessionModelState current, Kreoda.Session.SessionModelState requested) =>
            current != null && requested != null && current.SessionId == requested.SessionId &&
            current.DocumentId == requested.DocumentId && current.Revision == requested.Revision;

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

        readonly QuestHomeProjectData _homeProjects = new QuestHomeProjectData();
        QuestOpenableProjects _openableProjects;
        int _openableIndex, _openableTicket;
        bool _openablePending;
        bool _openRequestPending;
        string _openConfirmId;
        Kreoda.Session.SessionClient _openableClient;
        long _openableGeneration;

        void SelectOpenableProject()
        {
            var client = Connection.Connected ? Connection.Client : null;
            var model = client?.Model;
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            if (client != _openableClient || Connection.ConnectionGeneration != _openableGeneration)
            {
                ++_openableTicket;
                _openablePending = false;
                _openableProjects = null;
                _openConfirmId = null;
            }
            if (_openableProjects != null && client == _openableClient &&
                Connection.ConnectionGeneration == _openableGeneration &&
                _openableProjects.IsCurrent(model, now, _openableIndex) && _openableProjects.Projects.Length > 0)
            {
                _openableIndex = (_openableIndex + 1) % _openableProjects.Projects.Length;
                _openConfirmId = null;
                Home.OpenableStatus.text = "Visualizza: " + _openableProjects.Projects[_openableIndex].Name;
                return;
            }
            if (client == null || model == null)
            {
                if (Home?.OpenableStatus != null)
                    Home.OpenableStatus.text = "Connetti il PC per caricare i progetti reali";
                Page(_pcPage);
                return;
            }
            if (_openablePending) return;
            _openablePending = true;
            _openableClient = client;
            _openableGeneration = Connection.ConnectionGeneration;
            var generation = _openableGeneration;
            var ticket = ++_openableTicket;
            Home.OpenableStatus.text = "Caricamento progetti PC...";
            _ = Task.Run(async () =>
            {
                QuestOpenableProjects parsed = null;
                try
                {
                    using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(6));
                    var response = await client.CallAsync(Kreoda.Session.SessionMethods.ListOpenableProjects,
                        new Dictionary<string, object>(), timeout.Token, expectedSessionId: model.SessionId).ConfigureAwait(false);
                    parsed = QuestOpenableProjects.Parse(response, model, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
                }
                catch { }
                _massUi.Enqueue(() =>
                {
                    if (ticket != _openableTicket || Connection.Client != client ||
                        Connection.ConnectionGeneration != generation) return;
                    _openablePending = false;
                    _openableProjects = parsed;
                    _openableIndex = 0;
                    _openConfirmId = null;
                    Home.OpenableStatus.text = parsed == null || !parsed.IsCurrent(client.Model,
                        DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), 0) ? "Progetti PC: aggiorna elenco" :
                        parsed.Projects.Length == 0 ? "Nessun progetto PC" : "Visualizza: " + parsed.Projects[0].Name;
                });
            });
        }

        void ConfirmOpenableProject()
        {
            var client = Connection.Connected ? Connection.Client : null;
            var model = client?.Model;
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            if (_openRequestPending || _openablePending || client == null || client != _openableClient ||
                Connection.ConnectionGeneration != _openableGeneration || _openableProjects == null ||
                !_openableProjects.IsCurrent(model, now, _openableIndex))
            {
                _openConfirmId = null;
                if (Home?.OpenableStatus != null) Home.OpenableStatus.text = "Elenco scaduto: aggiorna";
                return;
            }
            var project = _openableProjects.Projects[_openableIndex];
            if (_openConfirmId != project.Id)
            {
                _openConfirmId = project.Id;
                Home.OpenableStatus.text = "Conferma apertura PC: " + project.Name;
                return;
            }
            _openConfirmId = null;
            _openRequestPending = true;
            var ticket = ++_openableTicket;
            var generation = _openableGeneration;
            var selectedCatalog = _openableProjects;
            var selectedIndex = _openableIndex;
            Home.OpenableStatus.text = "Attesa consenso sul PC...";
            _ = Task.Run(async () =>
            {
                var accepted = false;
                try
                {
                    using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(45));
                    if (!selectedCatalog.IsCurrent(client.Model, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), selectedIndex))
                        throw new InvalidOperationException("Stale project selection");
                    var reply = await client.CallAsync(Kreoda.Session.SessionMethods.RequestOpenProject,
                        new Dictionary<string, object> { ["projectId"] = project.Id, ["sessionId"] = model.SessionId,
                            ["documentId"] = model.DocumentId, ["expectedRevision"] = model.Revision },
                        timeout.Token, expectedSessionId: model.SessionId).ConfigureAwait(false);
                    accepted = QuestOpenableProjects.OpenReplyAccepted(reply, model.SessionId);
                }
                catch { }
                _massUi.Enqueue(() =>
                {
                    if (ticket != _openableTicket || Connection.Client != client ||
                        Connection.ConnectionGeneration != generation) return;
                    _openRequestPending = false;
                    _openableProjects = null;
                    Home.OpenableStatus.text = accepted ? "Consenso ottenuto: sincronizzazione CAD..." :
                        "Apertura negata o scaduta: aggiorna elenco";
                    if (accepted) Connection.Reconnect();
                });
            });
        }
        TextMesh _configurationStatus;
        QuestConfigurations.Snapshot _configurations;
        Kreoda.Session.SessionModelState _configurationModel;
        int _configurationIndex, _configurationTicket;
        string _configurationConfirm;

        void ShowConfiguration()
        {
            if (_configurationStatus == null) return;
            var names = _configurations?.Names;
            _configurationStatus.text = names == null ? "Configurazioni non caricate" :
                "Attiva: " + (_configurations.Active.Length == 0 ? "nessuna" : _configurations.Active) +
                "\n" + (names.Length == 0 ? "Nessuna configurazione" :
                    "Selezionata: " + names[_configurationIndex % names.Length]) +
                (_configurationConfirm == null ? "" : "\nPremi ancora Attiva per confermare");
        }

        void NextConfiguration()
        {
            if (_configurations?.Names?.Length > 0) _configurationIndex = (_configurationIndex + 1) % _configurations.Names.Length;
            _configurationConfirm = null;
            ShowConfiguration();
        }

        void ReadConfigurations()
        {
            var client = Connection.Connected ? Connection.Client : null;
            var model = client?.Model;
            _configurations = null;_configurationConfirm = null;
            var ticket = ++_configurationTicket;
            if (model == null) { ShowConfiguration();return; }
            _configurationStatus.text = "Lettura configurazioni dal PC…";
            _ = Task.Run(async () =>
            {
                QuestConfigurations.Snapshot snapshot = null;
                try
                {
                    using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(8));
                    var response = await client.CommandAsync(nameof(Kreoda.Protocol.CommandType.QueryConfigurations), new Dictionary<string, object>(),
                        documentId: model.DocumentId, baseRevision: model.Revision, ct: timeout.Token).ConfigureAwait(false);
                    snapshot = QuestConfigurations.Parse(response);
                }
                catch { /* No supported command or invalid server reply: do not guess configurations. */ }
                _massUi.Enqueue(() =>
                {
                    if (ticket != _configurationTicket || Connection.Client != client ||
                        !QuestConfigurations.IsCurrent(client.Model, model)) return;
                    _configurations = snapshot;_configurationModel = model;_configurationIndex = 0;
                    ShowConfiguration();
                });
            });
        }

        void ConfirmConfiguration()
        {
            var client = Connection.Connected ? Connection.Client : null;
            var model = client?.Model;
            if (_configurations == null || _configurations.Names.Length == 0 ||
                !QuestConfigurations.IsCurrent(model, _configurationModel))
            { _configurationConfirm = null;ReadConfigurations();return; }
            var name = _configurations.Names[_configurationIndex % _configurations.Names.Length];
            if (name == _configurations.Active) { _configurationConfirm = null;ShowConfiguration();return; }
            if (_configurationConfirm != name) { _configurationConfirm = name;ShowConfiguration();return; }
            _configurationConfirm = null;
            var ticket = ++_configurationTicket;
            _configurationStatus.text = "Attivazione richiesta al PC…";
            _ = Task.Run(async () =>
            {
                var succeeded = false;
                try
                {
                    using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(12));
                    if (!QuestConfigurations.IsCurrent(client.Model, model)) throw new InvalidOperationException("Stale model");
                    await client.CommandAsync(nameof(Kreoda.Protocol.CommandType.ActivateConfiguration), new Dictionary<string, object> { ["name"] = name },
                        documentId: model.DocumentId, baseRevision: model.Revision, ct: timeout.Token).ConfigureAwait(false);
                    succeeded = true;
                }
                catch { }
                _massUi.Enqueue(() =>
                {
                    if (ticket != _configurationTicket || Connection.Client != client) return;
                    _configurations = null;
                    _configurationStatus.text = succeeded ? "Attivazione inviata · aggiorna lo stato CAD" :
                        "Attivazione non confermata · rileggi lo stato CAD";
                });
            });
        }
        Kreoda.Session.SessionClient _homeRecentClient;
        long _homeRecentGeneration = -1;
        int _homeRecentTicket;
        bool _homeRecentPending;
        float _homeRecentNext;

        internal static bool HomeRecentResponseCurrent(Kreoda.Session.SessionModelState requested,
            Kreoda.Session.SessionModelState current, long requestedGeneration, long currentGeneration,
            int requestedTicket, int currentTicket) =>
            requested != null && current != null && requestedGeneration == currentGeneration &&
            requestedTicket == currentTicket && requested.SessionId == current.SessionId &&
            requested.DocumentId == current.DocumentId && requested.Revision == current.Revision;

        void PollHomeRecentProjects()
        {
            var client = Connection.Connected ? Connection.Client : null;
            var generation = Connection.ConnectionGeneration;
            if (client != _homeRecentClient || generation != _homeRecentGeneration)
            {
                _homeRecentClient = client;
                _homeRecentGeneration = generation;
                ++_homeRecentTicket;
                _homeProjects.ClearServerProjects();
                _homeRecentNext = 0;
                _homeRecentPending = false;
            }
            if (client == null || _homeRecentPending || Time.unscaledTime < _homeRecentNext) return;
            var model = client.Model;
            if (model == null) return;
            _homeRecentPending = true;
            var ticket = ++_homeRecentTicket;
            _homeRecentNext = Time.unscaledTime + 60f;
            _ = Task.Run(async () =>
            {
                System.Text.Json.JsonElement reply = default;
                var valid = false;
                try
                {
                    using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
                    reply = await client.CallAsync(Kreoda.Session.SessionMethods.ListRecentProjects, new Dictionary<string, object>(),
                        timeout.Token, expectedSessionId: model.SessionId).ConfigureAwait(false);
                    valid = true;
                }
                catch { /* Older PC relay: retain observed-document fallback. */ }
                _massUi.Enqueue(() =>
                {
                    if (_homeRecentClient != client || _homeRecentGeneration != generation ||
                        ticket != _homeRecentTicket) return;
                    _homeRecentPending = false;
                    if (valid && HomeRecentResponseCurrent(model, client.Model, generation,
                        Connection.ConnectionGeneration, ticket, _homeRecentTicket))
                        _homeProjects.ApplyServerProjects(reply);
                    else _homeRecentNext = 0;
                });
            });
        }

        // Preserve the original action and TextMesh objects while making each
        // workstation respond to genuine Desktop/CAD/voice state. Cache state
        // transitions to avoid rewriting XR renderer property blocks per frame.
        void SetContextAction(Transform page, string id, bool enabled, bool selected = false,
            QuestUi.StatusSeverity severity = QuestUi.StatusSeverity.Neutral)
        {
            if (page == null || !_contextActions.TryGetValue(page, out var actions) ||
                !actions.TryGetValue(id, out var label) || label == null) return;
            if (!enabled) selected = false;
            var state = (enabled ? 1 : 0) | (selected ? 2 : 0) | ((int)severity << 2);
            if (_contextVisualStates.TryGetValue(label, out var before) && before == state) return;
            _contextVisualStates[label] = state;
            QuestUi.SetOperationActionState(label, selected, enabled, severity);
        }

        void RefreshContextualActions(Kreoda.Session.DiscoveredSessionPc[] peers)
        {
            var connected = Connection != null && Connection.Connected;
            var document = connected && Connection.Client?.Model != null;
            if (AssemblyMates != null)
            {
                AssemblyMates.Connection = Connection;
                AssemblyMates.Spatial = Spatial;
                AssemblyMates.Commands = Commands;
                AssemblyMates.DirectFaceHistory = DirectFaceHistory;
            }
            var assemblyBusy = AssemblyMates != null && AssemblyMates.Busy;
            if (DirectFaceHistory != null)
            {
                DirectFaceHistory.Connection = Connection;DirectFaceHistory.Spatial = Spatial;
                DirectFaceHistory.Commands = Commands;DirectFaceHistory.AssemblyMates = AssemblyMates;
            }
            var directFaceBusy = DirectFaceHistory != null && DirectFaceHistory.Busy;
            var cadOperationBusy = assemblyBusy || directFaceBusy;
            var currentMesh = _selected != null && Connection.IsCurrentView(_selected);
            if (_thicknessModel != null && (!connected || _selected != _thicknessSelected || !currentMesh ||
                !CanApplyMassResult(Connection.Client?.Model, _thicknessModel)))
            {
                _thicknessModel = null;_thicknessPending = false;_massRequest++;
                _thicknessSummary = "Modello o selezione cambiati · ripeti la misura";
                if (_thicknessNotice) _homeNotice.text = _thicknessSummary;
                _thicknessNotice = false;
            }
            var currentDatum = _selectedDatum != null && Connection.IsCurrentDatum(_selectedDatum);
            var targetReady = currentDatum || currentMesh &&
                (_selectionMode == 0 || _hit != null && !_hit.ReferenceAmbiguous);
            var pcCount = peers == null ? 0 : peers.Length;
            for (var i = 0; i < _pcChoices.Length; i++)
            {
                var index = _pcChoicePage * _pcChoices.Length + i;
                var available = index < pcCount;
                SetContextAction(_pcPage, "PC " + (i + 1), available,
                    available && !string.IsNullOrEmpty(_selectedPcId) &&
                    peers[index].PcId == _selectedPcId);
            }
            SetContextAction(_pcPage, "Altri PC", pcCount > _pcChoices.Length);
            SetContextAction(_pcPage, "Diagnostica avanzata", true, !connected);
            SetContextAction(_connectionPage, "Connetti",
                !string.IsNullOrWhiteSpace(_endpoint) ||
                !string.IsNullOrWhiteSpace(Connection.SavedEndpoint), connected,
                connected ? QuestUi.StatusSeverity.Active : QuestUi.StatusSeverity.Warning);
            SetContextAction(_connectionPage, "Corpo", document, _selectionMode == 0);
            SetContextAction(_connectionPage, "Faccia", document, _selectionMode == 1);
            SetContextAction(_connectionPage, "Bordo", document, _selectionMode == 2);
            SetContextAction(_connectionPage, "Invia target al PC", document && targetReady);
            SetContextAction(_connectionPage, "Proprietà fisiche", document && currentMesh);
            SetContextAction(_connectionPage, "Spessore minimo", document && currentMesh);
            SetContextAction(_homeNoticePage, "Diagnostica PC", true, !connected);
            SetContextAction(_assemblyMatesPage, "Crea accoppiamento",
                AssemblyMates != null && AssemblyMates.CanApply(out _));
            var directSelection = document && currentMesh && _selectedDatum == null && _selectionMode == 1 &&
                _hit != null && !_hit.ReferenceAmbiguous;
            SetContextAction(_directFaceHistoryPage, "Operazione →", !directFaceBusy);
            SetContextAction(_directFaceHistoryPage, "Acquisisci sorgente", directSelection && !directFaceBusy);
            SetContextAction(_directFaceHistoryPage, "Acquisisci supporto",
                directSelection && !directFaceBusy && DirectFaceHistory?.NeedsSupport == true);
            SetContextAction(_directFaceHistoryPage, "Campo →",
                !directFaceBusy && DirectFaceHistory?.UsesMoveFields == true);
            SetContextAction(_directFaceHistoryPage, "Valore",
                !directFaceBusy && DirectFaceHistory?.UsesValue == true);
            SetContextAction(_directFaceHistoryPage, "Applica",
                DirectFaceHistory != null && DirectFaceHistory.CanApply(out _));

            var configurations = _configurations?.Names;
            var hasVariants = document && configurations != null && configurations.Length > 0 &&
                QuestConfigurations.IsCurrent(Connection.Client.Model, _configurationModel);
            var variant = hasVariants ? configurations[_configurationIndex % configurations.Length] : null;
            SetContextAction(_configurationPage, "Aggiorna", document);
            SetContextAction(_configurationPage, "Successiva", hasVariants && configurations.Length > 1);
            SetContextAction(_configurationPage, "Attiva selezionata",
                hasVariants && !cadOperationBusy && variant != _configurations.Active,
                variant != null && _configurationConfirm == variant,
                variant != null && _configurationConfirm == variant ?
                    QuestUi.StatusSeverity.Warning : QuestUi.StatusSeverity.Active);

            var placing = Display != null && Display.PlacementActive;
            SetContextAction(_viewPage, "Posiziona", document && !placing);
            SetContextAction(_viewPage, "Centra CAD", document);
            SetContextAction(_viewPage, "Conferma", placing);
            SetContextAction(_viewPage, "Annulla", placing);
            SetContextAction(_viewPage, "−5", placing);
            SetContextAction(_viewPage, "+5", placing);
            SetContextAction(_viewPage, "Condividi selezione", document && targetReady);
            SetContextAction(_viewPage, "Ispezione", document);
            SetContextAction(_viewPage, "Normale", document);
            foreach (var scale in ScaleChoices)
                SetContextAction(_viewPage, scale, true, Display != null && Display.ScaleName == scale);

            var section = Connection.Section;
            var sectionAvailable = document && section != null;
            var hasPlane = sectionAvailable && section.Plane.HasValue;
            SetContextAction(_sectionPage, "Attiva sezione", sectionAvailable,
                sectionAvailable && section.Enabled);
            SetContextAction(_sectionPage, "Zebra", sectionAvailable, section != null && section.ZebraEnabled);
            SetContextAction(_sectionPage, "Curvatura", sectionAvailable && (section.CurvatureAvailable || section.CurvatureEnabled), section != null && section.CurvatureEnabled);
            SetContextAction(_sectionPage, "Bande →", sectionAvailable && (section.ZebraEnabled || section.CurvatureEnabled));
            SetContextAction(_sectionPage, "Ruota bande", sectionAvailable && (section.ZebraEnabled || section.CurvatureEnabled));
            foreach (var axis in SectionAxes)
            {
                var selectedAxis = hasPlane && section.Plane.Value.Axis.HasValue &&
                    (axis == "X" && section.Plane.Value.Axis.Value == SectionAxis.X ||
                     axis == "Y" && section.Plane.Value.Axis.Value == SectionAxis.Y ||
                     axis == "Z" && section.Plane.Value.Axis.Value == SectionAxis.Z);
                SetContextAction(_sectionPage, axis, sectionAvailable, selectedAxis);
            }
            foreach (var adjustment in SectionAdjustments)
                SetContextAction(_sectionPage, adjustment, hasPlane);

            var editReady = document && !cadOperationBusy && Spatial != null && Spatial.EditMode && !Spatial.Busy;
            SetContextAction(_editPage, "Feature →", editReady);
            SetContextAction(_editPage, "Parametro →", editReady && Spatial.SelectedIntent != null);
            SetContextAction(_editPage, "Valore esatto", editReady && Spatial.SelectedIntent != null);
            SetContextAction(_editPage, "Snap 0.1mm / 5deg", editReady,
                editReady && Spatial.SnapEnabled);
            SetContextAction(_editPage, "Annulla modifica", Spatial != null && Spatial.EditMode);

            var commandsReady = document && !cadOperationBusy && Commands != null && !Commands.Busy;
            SetContextAction(_commandPage, "Azione →", commandsReady);
            SetContextAction(_commandPage, "Campo →", commandsReady && Commands.SelectedField != null);
            SetContextAction(_commandPage, "Valore", commandsReady && Commands.SelectedField != null);
            SetContextAction(_commandPage, "Conferma", commandsReady && Commands.CanConfirm);
            SetContextAction(_commandPage, "Undo", commandsReady);
            SetContextAction(_commandPage, "Redo", commandsReady);

            foreach (var name in DatumCreationActions)
                SetContextAction(_referencePage, name, document && !cadOperationBusy);
            var canInspect = document && References != null && References.HasSelectedDatum;
            SetContextAction(_referencePage, "Ispeziona", canInspect);
            SetContextAction(_referencePage, "Modifica",
                document && !cadOperationBusy && References != null && References.CanEditSelected);
            SetContextAction(_referencePage, "Sketch piano",
                document && !cadOperationBusy && References != null && References.CanSketchSelected);
            SetContextAction(_referencePage, "Conferma",
                document && !cadOperationBusy && References != null && References.IsFormOpen && References.SchemaReady);

            var sketchReady = document && !cadOperationBusy && SketchDimensions != null && !SketchDimensions.Busy;
            var hasDimension = sketchReady && SketchDimensions.Selected != null;
            SetContextAction(_sketchPage, "Sketch →", sketchReady);
            SetContextAction(_sketchPage, "Quota →", sketchReady);
            SetContextAction(_sketchPage, "Valore esatto", hasDimension);
            SetContextAction(_sketchPage, "Conferma", hasDimension);
            SetContextAction(_sketchPage, "Annulla", sketchReady);
            SetContextAction(_sketchPage, "Undo", sketchReady);
            SetContextAction(_voicePage, "Parla / Invia", Voice != null && Voice.Configured &&
                (!Voice.Busy || Voice.Recording),
                Voice != null && Voice.Recording);
            SetContextAction(_voicePage, "Stop", Voice != null && Voice.Busy);

            // Distinct workflow headings use only existing observed data. These
            // are the headings of the actual interactive card surfaces, not
            // additional summary wrappers drawn over the CAD scene.
            SetPanelContext(_pcPage, 0, pcCount == 0 ? "RICERCA DISPOSITIVI" :
                "PC RILEVATI · " + pcCount.ToString(CultureInfo.InvariantCulture), pcCount > 0);
            SetPanelContext(_pcPage, 1, "RICERCA E SELEZIONE", true);
            SetPanelContext(_connectionPage, 0, connected ? "SESSIONE AUTENTICATA" : "ASSOCIAZIONE PC", connected);
            SetPanelContext(_connectionPage, 1, "TIPO DI SELEZIONE", document);
            SetPanelContext(_connectionPage, 2, targetReady ? "TARGET CAD PRONTO" : "SELEZIONA UN TARGET", targetReady);
            SetPanelContext(_homeNoticePage, 0, "ESITO · PROSSIMI PASSI", true);
            SetPanelContext(_configurationPage, 0, hasVariants ?
                "VARIANTI · " + configurations.Length.ToString(CultureInfo.InvariantCulture) :
                "CARICA VARIANTI", hasVariants);
            SetPanelContext(_configurationPage, 1, hasVariants ?
                ShortVoiceText(variant, 26) : "NESSUNA VARIANTE", hasVariants);
            SetPanelContext(_viewPage, 0, "AMBIENTE E MANI", true);
            SetPanelContext(_viewPage, 1, placing ? "POSIZIONAMENTO ATTIVO" : "POSIZIONA IL MODELLO", document);
            SetPanelContext(_viewPage, 2, "SCALA · " + (Display != null ? Display.ScaleName : "—"), true);
            SetPanelContext(_viewPage, 3, targetReady ? "STRUMENTI · TARGET ATTIVO" : "STRUMENTI SPAZIALI", document);
            SetPanelContext(_metricsPage, 0, connected ? "DIAGNOSTICA SESSIONE" : "DIAGNOSTICA LOCALE", true);
            SetPanelContext(_sectionPage, 0, hasPlane && section.Enabled ?
                "PIANO DI TAGLIO ATTIVO" : "ABILITA PIANO", sectionAvailable);
            SetPanelContext(_sectionPage, 1, hasPlane ? "ASSI E QUOTA CAD" : "DEFINISCI IL PIANO", sectionAvailable);
            SetPanelContext(_editPage, 0, editReady ? "FEATURE CORRENTE" : "SELEZIONA FEATURE", editReady);
            SetPanelContext(_editPage, 1, Spatial != null && Spatial.SnapEnabled ?
                "PARAMETRO · SNAP ON" : "PARAMETRO · SNAP OFF", editReady);
            SetPanelContext(_commandPage, 0, Commands != null && Commands.Busy ?
                "OPERAZIONE SUL PC" : "SELEZIONA COMANDO", commandsReady);
            SetPanelContext(_commandPage, 1, Commands != null && Commands.SelectedField != null ?
                "CAMPO · " + ShortVoiceText(Commands.SelectedField, 18) : "PARAMETRI COMANDO", commandsReady);
            SetPanelContext(_referencePage, 0, "NUOVO RIFERIMENTO", document);
            SetPanelContext(_referencePage, 1, References != null && References.IsInspecting ?
                "ISPEZIONE DATUM" : "RIFERIMENTI DEL MODELLO", document);
            SetPanelContext(_referencePage, 2, "GEOMETRIA DI SUPPORTO", document);
            SetPanelContext(_referencePage, 3, References != null && References.IsFormOpen ?
                "PARAMETRI DATUM" : "VALORI E CONFERMA", document);
            SetPanelContext(_sketchPage, 0, "SKETCH E QUOTE", sketchReady);
            SetPanelContext(_sketchPage, 1, hasDimension ? "QUOTA SELEZIONATA" : "SELEZIONA QUOTA", hasDimension);
            SetPanelContext(_sketchPage, 2, "VINCOLI E STORIA", sketchReady);
            var voiceReady = Voice != null && Voice.Configured;
            SetPanelContext(_voicePage, 0, Voice == null ? "HERMES NON CONFIGURATO" :
                Voice.Recording ? "REGISTRAZIONE IN CORSO" :
                Voice.Busy ? "HERMES IN ELABORAZIONE" : voiceReady ? "HERMES PRONTO" : "HERMES IN ATTESA", voiceReady);
            SetPanelContext(_voicePage, 1, _voiceContext != null && _voiceContext.ExplicitMode ?
                "RACCOLTA ESPLICITA ATTIVA" : "SELEZIONE SINGOLA", true);
            SetPanelContext(_voiceContextPage, 0, _voiceContext != null && _voiceContext.PointArmed ?
                "PUNTO MR ARMATO" : "RACCOLTA SOLA LETTURA", _voiceContext != null && _voiceContext.ExplicitMode);
            SetPanelContext(_voiceContextPage, 1, "INVIO VOCE", Voice != null && Voice.Configured);
        }

        void SetPanelContext(Transform page, int zone, string title, bool available)
        {
            if (page == null) return;
            var key = page.GetInstanceID().ToString(CultureInfo.InvariantCulture) + ":" + zone;
            if (!_measuredPanels.TryGetValue(key, out var panel)) return;
            panel.SetContext(title, available ? QuestUi.StatusSeverity.Active :
                QuestUi.StatusSeverity.Warning, available);
        }

        static readonly string[] ScaleChoices = { "1:10", "1:5", "1:1", "2:1", "10:1", "Fit" };
        static readonly string[] SectionAxes = { "X", "Y", "Z" };
        static readonly string[] SectionAdjustments = { "−5 mm", "+5 mm", "Quota esatta", "Inverti", "Azzera" };
        static readonly string[] DatumCreationActions = { "Nuovo piano", "Nuovo asse", "Nuovo punto" };

        static bool ResolveOrdinaryRaycast(Ray ray, IEnumerable<QuestMeshView> views,
            Func<QuestMeshView, bool> isCurrentView, Transform displayRoot,
            out Collider hitCollider, out QuestMeshView hitView, out int hitTriangle, out Vector3 hitPoint)
        {
            hitCollider = null;
            hitView = null;
            hitTriangle = -1;
            hitPoint = default;
            var hasHit = Physics.Raycast(ray, out var physicalHit, 5f, ~0, QueryTriggerInteraction.Ignore);
            var nearestDistance = 5f;
            if (hasHit)
            {
                nearestDistance = physicalHit.distance;
                hitCollider = physicalHit.collider;
                hitPoint = physicalHit.point;
                hitTriangle = physicalHit.triangleIndex;
                hitView = hitCollider.GetComponent<QuestMeshView>();
            }
            if (views == null || isCurrentView == null) return hasHit;
            foreach (var view in views)
            {
                if (view == null || !view.isActiveAndEnabled || !view.IsSurfaceGeometry ||
                    view.TriangleCount <= 0 || view.UploadVersion <= 0 || string.IsNullOrEmpty(view.FeatureId) ||
                    !isCurrentView(view)) continue;
                var renderer = view.GetComponent<MeshRenderer>();
                if (renderer == null || !renderer.enabled || !renderer.gameObject.activeInHierarchy ||
                    !renderer.bounds.IntersectRay(ray)) continue;
                if (!view.TryRaycast(ray, null, displayRoot, nearestDistance,
                    out var triangle, out var point, out var distance)) continue;
                hasHit = true;
                nearestDistance = distance;
                hitCollider = null;
                hitView = view;
                hitTriangle = triangle;
                hitPoint = point;
            }
            return hasHit;
        }

        enum PlacementPointSource { Invalid, MetaRoomTable, ColliderSurface, ManualProjection }

        void RequestMetaTableDiscovery()
        {
            _roomDiscoveryRequested = true;
            _roomSurfaceProvider = QuestRoomSurfaceProvider.OptInFromUserAction();
            _roomActionStatus = _roomSurfaceProvider != null
                ? _roomSurfaceProvider.Status
                : "Rilevamento tavolo disponibile solo su Quest o ambiente Meta non pronto";
        }

        void RequestMetaRoomSetup()
        {
            if (!_roomDiscoveryRequested || _roomSurfaceProvider == null)
            {
                _roomActionStatus = "Prima scegli Rileva tavolo; nessuna scansione avviata";
                return;
            }
            if (!_roomSurfaceProvider.RequestRoomSetup())
            {
                _roomActionStatus = "Scansione non avviata · verifica permessi e Room Setup sul visore";
                return;
            }
            _roomActionStatus = _roomSurfaceProvider.Status;
        }

        bool TryGetOptedInMetaTable(Ray ray, out QuestRoomSurfaceProvider.SurfaceHit hit)
        {
            hit = default;
            if (!_roomDiscoveryRequested) return false;
#if UNITY_EDITOR
            if (EditorRoomTableContact != null)
            {
                var synthetic = EditorRoomTableContact(ray);
                if (!synthetic.HasValue) return false;
                hit = synthetic.Value;
                return true;
            }
#endif
            return _roomSurfaceProvider != null &&
                   _roomSurfaceProvider.TryGetTableContact(ray, out hit);
        }

        // Passthrough is a camera image, not a collision mesh. A Unity collider
        // supplies a geometric contact, but cannot prove it is a real table.
        // The bounded manual projection is explicitly identified when no
        // usable collider is available.
        PlacementPointSource ResolvePlacementPoint(Ray ray, out Vector3 point)
        {
            point = default;
            var count = Physics.RaycastNonAlloc(ray, _placementHits, 5f, ~0, QueryTriggerInteraction.Ignore);
            // A saturated unsorted NonAlloc buffer cannot establish the nearest
            // blocking surface, so do not guess a contact or project through it.
            if (count == _placementHits.Length) return PlacementPointSource.Invalid;

            var nearestSurface = float.PositiveInfinity;
            var nearestBlocker = float.PositiveInfinity;
            var surfacePoint = default(Vector3);
            for (var i = 0; i < count; i++)
            {
                var hit = _placementHits[i];
                var collider = hit.collider;
                if (collider == null || !Finite(hit.point) || !Finite(hit.normal) ||
                    float.IsNaN(hit.distance) || float.IsInfinity(hit.distance) ||
                    hit.distance < 0f || hit.distance > 5f) continue;
                var target = collider.transform;
                // CAD geometry, its guides and the VR reference floor are not
                // evidence of a physical table in the player's room.
                if (collider.GetComponentInParent<QuestMeshView>() != null ||
                    Connection != null && Connection.DisplayRoot != null && target.IsChildOf(Connection.DisplayRoot) ||
                    Environment != null && Environment.VrReference != null && target.IsChildOf(Environment.VrReference.transform) ||
                    Rig != null && target.IsChildOf(Rig.transform)) continue;

                // UI, edit handles, datum controls and non-horizontal solids
                // occlude a table behind them. Their position is never an anchor.
                var blocked = target.IsChildOf(transform) && _panel != null && target.IsChildOf(_panel) ||
                    collider.GetComponentInParent<QuestButton>() != null ||
                    collider.GetComponentInParent<QuestEditHandle>() != null ||
                    collider.GetComponentInParent<QuestDatumView>() != null ||
                    Connection != null && Connection.Section != null && Connection.Section.IsSectionCapCollider(collider) ||
                    collider.gameObject.layer == LayerMask.NameToLayer("UI");
                if (blocked || hit.normal.y < .65f)
                {
                    nearestBlocker = Mathf.Min(nearestBlocker, hit.distance);
                    continue;
                }
                if (hit.distance < nearestSurface)
                {
                    nearestSurface = hit.distance;
                    surfacePoint = hit.point;
                }
            }
            // Only a tracked Meta TABLE/DESK plane from the user-enabled
            // provider can receive MetaRoomTable provenance. Even such a plane
            // cannot be accepted through a nearer UI or edit blocker.
            if (TryGetOptedInMetaTable(ray, out var meta) && meta.AnchorId != Guid.Empty &&
                Finite(meta.Point) && !float.IsNaN(meta.DistanceMetres) && !float.IsInfinity(meta.DistanceMetres) &&
                meta.DistanceMetres >= .01f && meta.DistanceMetres <= 5f &&
                Vector3.Distance(ray.GetPoint(meta.DistanceMetres), meta.Point) <= .01f &&
                meta.DistanceMetres < nearestBlocker - .001f &&
                meta.DistanceMetres <= nearestSurface + .002f)
            {
                point = meta.Point;
                return PlacementPointSource.MetaRoomTable;
            }
            if (nearestSurface < nearestBlocker)
            {
                point = surfacePoint;
                return PlacementPointSource.ColliderSurface;
            }
            if (!float.IsPositiveInfinity(nearestBlocker)) return PlacementPointSource.Invalid;
            point = ray.GetPoint(.85f);
            return Finite(point) ? PlacementPointSource.ManualProjection : PlacementPointSource.Invalid;
        }

        // Called by the actual tracked-pointer Update path. A frozen placement
        // remains confirmable while the same tracked hand aims at the UI button.
        bool UpdatePlacementFromPointer(Ray ray, bool tracked, float yaw)
        {
            if (Display == null || !Display.PlacementActive) return false;
            var validRay = tracked && Finite(ray.origin) && Finite(ray.direction) &&
                ray.direction.sqrMagnitude > .000001f && !float.IsNaN(yaw) && !float.IsInfinity(yaw);
            if (!validRay)
            {
                Display.UpdatePointerPlacement(default, yaw, false, false, false);
                return false;
            }
            var source = ResolvePlacementPoint(new Ray(ray.origin, ray.direction.normalized), out var point);
            Display.UpdatePointerPlacement(point, yaw, true, source != PlacementPointSource.Invalid,
                source == PlacementPointSource.MetaRoomTable ? QuestPlacementProvenance.MetaRoomTable :
                source == PlacementPointSource.ColliderSurface ? QuestPlacementProvenance.ColliderUnverified :
                source == PlacementPointSource.ManualProjection ? QuestPlacementProvenance.ManualProjection :
                QuestPlacementProvenance.Unknown);
            return source != PlacementPointSource.Invalid;
        }

        void Update()
        {
            while (_massUi.TryDequeue(out var apply)) apply();
            if (_keyboard != null)
                ApplyKeyboardInput(_keyboard.text, _keyboard.status);
            if (_status == null) return;
            if (Voice != null)
            {
                SetReadout(_voiceStatus, ShortVoiceText(Voice.Status, 120));
                SetReadout(_voiceTranscript, ShortVoiceText(Voice.Transcript, 160));
                SetReadout(_voiceReply, ShortVoiceText(Voice.Reply, 260));
            }
            if (_voiceContext != null)
            {
                _voiceContext.Refresh(QuestVoiceContext.CaptureFence(Connection), Connection != null ? Connection.DisplayRoot : null);
                RefreshVoiceContextUi();
            }
            Home?.SetConnectionStatus(Connection.Status, Connection.Connected);
            _homeProjects.Observe(Connection.Connected ? Connection.Client?.Model : null);
            PollHomeRecentProjects();
            Home?.SetProjectStatus(_homeProjects.RecentSummary(),
                _homeProjects.HasRecentProjects, _homeProjects.HasServerSnapshot);
            if (AssemblyMates != null)
            {
                SetReadout(_assemblyKindButton, "Tipo · " + AssemblyMates.KindLabel);
                SetReadout(_assemblyAxisButton, AssemblyMates.AxisLabel);
                SetReadout(_assemblyValueButton, AssemblyMates.ValueLabel);
                SetButtonActive(_assemblyAxisButton, AssemblyMates.UsesDistance);
                SetButtonActive(_assemblyValueButton, AssemblyMates.UsesDistance || AssemblyMates.UsesAngle);
                SetReadout(_assemblyMovingStatus, AssemblyMates.MovingLabel);
                SetReadout(_assemblyFixedStatus, AssemblyMates.FixedLabel);
                SetReadout(_assemblyMateStatus, ShortVoiceText(AssemblyMates.Status, 110));
            }
            if (DirectFaceHistory != null)
            {
                DirectFaceHistory.RefreshStaleCaptures();
                SetReadout(_directOperationButton, "Operazione · " + DirectFaceHistory.OperationLabel);
                SetReadout(_directSourceStatus, ShortVoiceText(DirectFaceHistory.SourceLabel, 34));
                SetReadout(_directSupportStatus, ShortVoiceText(DirectFaceHistory.SupportLabel, 34));
                SetReadout(_directFieldButton, DirectFaceHistory.FieldLabel);
                SetReadout(_directValueButton, DirectFaceHistory.UsesValue
                    ? "Valore · " + DirectFaceHistory.FieldValue + (DirectFaceHistory.FieldLabel.Contains("°") ? "°" : " mm")
                    : "Valore non richiesto");
                SetReadout(_directStatus, ShortVoiceText(DirectFaceHistory.Status, 110));
                SetButtonActive(_directSupportButton, DirectFaceHistory.NeedsSupport);
                SetButtonActive(_directFieldButton, DirectFaceHistory.UsesMoveFields);
                SetButtonActive(_directValueButton, DirectFaceHistory.UsesValue);
            }
            if (Connection.Connected) _selectedPcNotice = null;
            var authenticating = !Connection.Connected && !string.IsNullOrEmpty(_selectedPcNotice) &&
                (Connection.Status == null || Connection.Status.Contains("Ricerca") || Connection.Status.Contains("Associazione") ||
                 Connection.Status.Contains("Riconnessione") || Connection.Status.Contains("Offline"));
            SetReadout(_pcStatus, ShortVoiceText(authenticating ? _selectedPcNotice + "\n" + Connection.Status : Connection.Status, 115));
            var localPcs = Connection.AvailablePcs;
            SetReadout(_pcOverview, Connection.Connected ? "Sessione PC attiva" :
                localPcs.Length.ToString(CultureInfo.InvariantCulture) + " PC rilevati · scegli dispositivo");
            SetReadout(_configurationOverview, Connection.Connected ? ShortVoiceText(_configurationStatus.text, 48) : "Collega un PC per leggere varianti");
            SetReadout(_viewOverview, ShortVoiceText(Environment.Status + " · " + Display.ScaleName, 56));
            SetReadout(_sectionOverview, Connection.Section == null ? "Sessione CAD assente" :
                (Connection.Section.Enabled ? "Taglio attivo" : "Taglio disattivato") + " · " +
                (Connection.Section.Plane.HasValue ?
                    Connection.Section.Plane.Value.OffsetMm.ToString("0.###", CultureInfo.InvariantCulture) + " mm" : "quota —"));
            SetReadout(_metricsOverview, ShortVoiceText(Environment.Diagnostics, 65));
            SetReadout(_editOverview, Spatial == null ? "Modifica CAD non inizializzata" :
                ShortVoiceText(Spatial.Status + " · Snap " + (Spatial.SnapEnabled ? "ON" : "OFF"), 65));
            SetReadout(_commandOverview, Commands == null ? "Comandi CAD non inizializzati" :
                ShortVoiceText(Commands.CommandLabel + " · " + Commands.Status, 65));
            SetReadout(_sketchOverview, SketchDimensions == null ? "Quote non inizializzate" :
                ShortVoiceText(SketchDimensions.Status + (SketchDimensions.Selected == null ? "" :
                    " · " + SketchDimensions.Value.ToString("0.###", CultureInfo.InvariantCulture) +
                    " " + SketchDimensions.Selected.Unit), 65));
            SetReadout(_connectionOverview, ShortVoiceText(
                Connection.Connected ? Connection.Status : Connection.Status +
                (string.IsNullOrEmpty(_endpoint) ? "" : " · " + _endpoint), 65));
            SetReadout(_noticeOverview, ShortVoiceText(_homeNotice != null ? _homeNotice.text : "", 65));
            SetReadout(_referenceOverview, References == null ?
                "Riferimenti non inizializzati" : ShortVoiceText(References.Status, 65));
            SetReadout(_voiceOverview, Voice == null ?
                "Hermes non configurato" : ShortVoiceText(Voice.Status, 65));
            UpdatePageSummary(_pcPage, "PC DISPONIBILI", _pcOverview, Connection.Status, Connection.Connected || localPcs.Length > 0);
            UpdatePageSummary(_connectionPage, "ASSOCIAZIONE", _connectionOverview, _endpointLabel != null ? _endpointLabel.text : "", Connection.Connected);
            UpdatePageSummary(_homeNoticePage, "ESITO OPERAZIONE", _noticeOverview, _homeNotice != null ? _homeNotice.text : "", Connection.Connected);
            UpdatePageSummary(_configurationPage, "CONFIGURAZIONI", _configurationOverview, _configurationStatus != null ? _configurationStatus.text : "", Connection.Connected);
            UpdatePageSummary(_viewPage, "SPAZIO MR", _viewOverview, Display.Status, Connection.Connected);
            UpdatePageSummary(_metricsPage, "DIAGNOSTICA", _metricsOverview, Environment.Status, Connection.Connected);
            UpdatePageSummary(_sectionPage, "PIANO CAD", _sectionOverview, _sectionStatus != null ? _sectionStatus.text : "", Connection.Section != null && Connection.Section.Enabled);
            UpdatePageSummary(_editPage, "PARAMETRO CAD", _editOverview, Spatial != null ? Spatial.Status : "", Spatial != null && Spatial.EditMode);
            UpdatePageSummary(_commandPage, "AZIONE CAD", _commandOverview, Commands != null ? Commands.Status : "", Connection.Connected);
            UpdatePageSummary(_referencePage, "GEOMETRIA DATUM", _referenceOverview, References != null ? References.ModeLabel : "", References != null && Connection.Connected);
            UpdatePageSummary(_sketchPage, "QUOTE SKETCH", _sketchOverview, SketchDimensions != null ? SketchDimensions.Status : "", Connection.Connected);
            UpdatePageSummary(_voicePage, "ASSISTENTE HERMES", _voiceOverview, Voice != null ? Voice.Transcript : "",
                Voice != null && Voice.Configured);
            RefreshPanelReadouts(_pcPage, "DISPOSITIVI", _pcOverview.text, Connection.Connected || localPcs.Length > 0);
            RefreshPanelReadouts(_connectionPage, "SESSIONE", Connection.Status, Connection.Connected);
            RefreshPanelReadouts(_homeNoticePage, "ESITO", _homeNotice != null ? _homeNotice.text : "", Connection.Connected);
            RefreshPanelReadouts(_configurationPage, "VARIANTE", _configurationStatus != null ? _configurationStatus.text : "", Connection.Connected);
            RefreshPanelReadouts(_viewPage, "SCENA MR", Display.Status + " · " + Display.ScaleName, Connection.Connected);
            RefreshPanelReadouts(_metricsPage, "DIAGNOSTICA", Environment.Diagnostics, Connection.Connected);
            RefreshPanelReadouts(_sectionPage, "PIANO", Connection.Section != null ? Connection.Section.Status : "Sessione CAD assente", Connection.Section != null && Connection.Section.Enabled);
            RefreshPanelReadouts(_editPage, "PARAMETRO", Spatial != null ? Spatial.Status : "Nessuna modifica", Spatial != null && Spatial.EditMode);
            RefreshPanelReadouts(_commandPage, "COMANDO", Commands != null ? Commands.CommandLabel + " · " + Commands.Status : "Nessuna sessione", Connection.Connected);
            RefreshPanelReadouts(_referencePage, "DATUM", References != null ? References.ModeLabel + " · " + References.Status : "Nessun riferimento", References != null && Connection.Connected);
            RefreshPanelReadouts(_sketchPage, "QUOTA", SketchDimensions != null ? SketchDimensions.Status : "Nessuna quota", Connection.Connected);
            RefreshPanelReadouts(_voicePage, "HERMES", Voice != null ? Voice.Status : "Assistente non configurato",
                Voice != null && Voice.Configured);
            _pcChoicePage %= Mathf.Max(1, (localPcs.Length + _pcChoices.Length - 1) / _pcChoices.Length);
            for (int i = 0; i < _pcChoices.Length; i++)
            {
                int index = _pcChoicePage * _pcChoices.Length + i;
                SetButton(_pcChoices[i], index < localPcs.Length,
                    index < localPcs.Length ? ShortVoiceText(localPcs[index].Name, 34) : "");
            }
            var viewStatus = Display.PlacementActive ? Display.Status : _roomDiscoveryRequested
                ? (_roomSurfaceProvider != null ? _roomSurfaceProvider.Status : _roomActionStatus)
                : Environment.Status + "\nScala " + Display.ScaleName + " · quote CAD mm";
            if (_viewStatus.text != viewStatus) _viewStatus.text = viewStatus;
            if (_sectionStatus != null && Connection.Section != null)
            {
                SetReadout(_sectionStatus, Connection.Section.Status);
                SetReadout(_sectionToggle, Connection.Section.Enabled ? "Disattiva sezione" : "Attiva sezione");
                SetReadout(_zebraToggle, "Zebra");
                SetReadout(_curvatureToggle, "Curvatura");
                SetReadout(_zebraDensity, Connection.Section.CurvatureEnabled
                    ? "Max " + Connection.Section.CurvatureMaximumPerMm.ToString("G3", CultureInfo.InvariantCulture)
                    : "Bande " + Connection.Section.ZebraBands);
                SetReadout(_zebraRotation, Connection.Section.CurvatureEnabled ? "Scala auto"
                    : "Ruota " + Connection.Section.ZebraAngleDeg.ToString("0", CultureInfo.InvariantCulture) + "°");
                SetReadout(_sectionQuota, Connection.Section.Plane.HasValue
                    ? Connection.Section.Plane.Value.OffsetMm.ToString("0.###", CultureInfo.InvariantCulture) + " mm"
                    : "Quota —");
            }
            else if (_sectionStatus != null)
            {
                // A previous document's section is not current after disconnect.
                SetReadout(_sectionStatus, "Collega un PC per gestire il piano");
                SetReadout(_sectionToggle, "Attiva sezione");
                SetReadout(_sectionQuota, "Quota —");
            }
            var handText = _handMode == 0 ? "Mano Auto" : _handMode == 1 ? "Mano sinistra" : "Mano destra";
            if (_handLabel.text != handText) _handLabel.text = handText;
            if (_diagnostics.text != Environment.Diagnostics) _diagnostics.text = Environment.Diagnostics;
            if (Commands != null) SetReadout(_commandStatus, Commands.CommandLabel + "\n" + Commands.FieldLabel + " · " + Commands.FieldValue + "\n" + Commands.Status);
            if (SketchDimensions != null) SetReadout(_sketchStatus, SketchDimensions.Status + (SketchDimensions.Selected == null ? "" :
                "\n" + SketchDimensions.Value.ToString("0.###", CultureInfo.InvariantCulture) + " " + SketchDimensions.Selected.Unit));
            var suppressForTwoHand = false;
            var suppressForBusyEdit = false;
            if (Spatial != null)
            {
                if (_modeLabel != null) _modeLabel.text = Spatial.EditMode ? "Modifica" : "Modello";
                if (_valueLabel != null) _valueLabel.text = _pendingExact != null && ReferenceEquals(Spatial.SelectedIntent, _exactIntent) ? "Applica" : "Valore";
                var intent = Spatial.SelectedIntent;
                SetReadout(_editStatus, Spatial.Status + (intent == null ? "" : "\n" + intent.FeatureId + " · " +
                    (intent.Parameters.Count > 0 ? intent.Parameters[_exactParameter % intent.Parameters.Count] : "Nessun parametro") + " · " + intent.Unit) +
                    "\nSnap " + (Spatial.SnapEnabled ? "attivo" : "spento"));
                // Two-hand manipulation and busy CAD editing suppress pointer
                // input, NOT service-driven workstation state updates.
                suppressForTwoHand = !Spatial.EditMode && TwoHandInput();
                suppressForBusyEdit = Spatial.Busy && !Spatial.Holding;
            }
            if (_wasConnected && !Connection.Connected) ResetIntent();
            _wasConnected = Connection.Connected;
            var endpoint = _endpoint.Length == 0 ? "Endpoint manuale" : _endpoint;
            if (_endpointLabel.text != endpoint) _endpointLabel.text = endpoint;
            var code = _code.Length == 0 ? "Codice manuale" : "Codice inserito";
            if (_codeLabel.text != code) _codeLabel.text = code;
            RefreshContextualActions(localPcs);
            RefreshLiveActionDetails(localPcs);
            RefreshDomainActionCards(localPcs);
            RefreshLargeComposedCards(localPcs);
            RefreshDomainFocusStages();
            // Keep real action availability, focus and live facts current even
            // while interactions are suppressed. After the TwoHandInput state
            // check, do not sample Pointer, cast rays or dispatch UI gestures.
            if (suppressForTwoHand || suppressForBusyEdit)
            {
                _voiceContext?.CancelPointArm();
                HidePointerVisual();
                if (suppressForTwoHand) _requireRelease = true;
                return;
            }
            _tracked = Pointer(out var ray, out var clicked, out var pressed, out var orientation);
            if (Spatial != null && Spatial.Holding)
            { _voiceContext?.CancelPointArm();Spatial.Drag(ray, orientation, pressed, _tracked);HidePointerVisual();return; }
            if (!_tracked)
            {
                _voiceContext?.CancelPointArm();
                if (References != null && (References.IsFormOpen || _editingReference)) CancelReference();
                UpdatePanelDrag(ray, pressed, false); HidePointerVisual(); _requireRelease = true; UpdatePlacementFromPointer(ray, false, _yaw); return;
            }
            if (_requireRelease) { clicked = false; if (!pressed) _requireRelease = false; }
            var direction = Vector3.ProjectOnPlane(ray.direction, Vector3.up);
            if (direction.sqrMagnitude > .01f) _yaw = Mathf.Atan2(direction.x, direction.z) * (180f / (float)Math.PI);
            UpdatePlacementFromPointer(ray, true, _yaw);
            if (_draggingPanel)
            {
                _voiceContext?.CancelPointArm();
                UpdatePanelDrag(ray, pressed, true);
                ShowPointerVisual(ray, ray.GetPoint(_grabDistance), true, true, pressed, clicked);
                return;
            }
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
            else
            {
                hasHit = ResolveOrdinaryRaycast(ray, Connection.Views, Connection.IsCurrentView,
                    Connection.DisplayRoot, out hitCollider, out hitView, out hitTriangle, out hitPoint);
            }
            var button = hitCollider != null ? hitCollider.GetComponent<QuestButton>() : null;
            var isInteractive = button != null || hitCollider != null &&
                (hitCollider.GetComponent<QuestEditHandle>() != null ||
                 hitCollider.GetComponentInParent<QuestDatumView>() != null ||
                 hitCollider.GetComponent<QuestMeshView>() != null) || hitView != null;
            ShowPointerVisual(ray, hasHit ? hitPoint : ray.GetPoint(.85f), hasHit, isInteractive, pressed, clicked);
            var armButtonClick = button != null && button.ActionId == "Arma punto" && clicked;
            if (_voiceContext != null && _voiceContext.PointArmed && !armButtonClick)
            {
                var contextPage = _voiceContextPage != null && _voiceContextPage.gameObject.activeInHierarchy;
                var canCapturePoint = contextPage && !hasHit && _keyboard == null &&
                    (Spatial == null || !Spatial.EditMode && !Spatial.Busy && !Spatial.Holding) &&
                    (Display == null || !Display.PlacementActive && !Display.TwoHandActive) &&
                    (AssemblyMates == null || !AssemblyMates.Busy) &&
                    (DirectFaceHistory == null || !DirectFaceHistory.Busy);
                if (_voiceContext.ObservePointGesture(QuestVoiceContext.CaptureFence(Connection), _pointerSource,
                    true, pressed, clicked && button == null, canCapturePoint, ray.origin, Connection.DisplayRoot))
                { RefreshVoiceContextUi();return; }
            }
            if (!clicked || _keyboard != null) return;
            if (button != null)
            {
                if (button.DragPanel) { _voiceContext?.CancelPointArm();BeginPanelDrag(ray, hitPoint); }
                else { if (button.ActionId != "Arma punto") _voiceContext?.CancelPointArm();button.Click?.Invoke(); }
                return;
            }
            if (_voiceContext != null && _voiceContext.ExplicitMode &&
                _voiceContextPage != null && _voiceContextPage.gameObject.activeInHierarchy)
            {
                if (AssemblyMates != null && AssemblyMates.Busy || DirectFaceHistory != null && DirectFaceHistory.Busy ||
                    Display != null && Display.PlacementActive || Spatial != null && Spatial.Busy)
                { _voiceContext.CancelPointArm();return; }
                if (!hasHit) return;
                var collectionSectionCap = hitCollider != null && Connection.Section != null &&
                    Connection.Section.IsSectionCapCollider(hitCollider);
                var collectionEdit = hitCollider != null ? hitCollider.GetComponent<QuestEditHandle>() : null;
                CaptureVoiceCollectionHit(hitCollider, hitView, hitTriangle, hitPoint, collectionSectionCap, collectionEdit);
                return;
            }
            if (AssemblyMates != null && AssemblyMates.Busy) return;
            if (DirectFaceHistory != null && DirectFaceHistory.Busy) return;
            if (Display.PlacementActive) { Display.FreezePlacement(); return; }
            if (!hasHit) return;
            var sectionCap = hitCollider != null && Connection.Section != null && Connection.Section.IsSectionCapCollider(hitCollider);
            var edit = hitCollider != null ? hitCollider.GetComponent<QuestEditHandle>() : null;
            if (sectionCap) { _target.text = "Piano di sezione solo visivo · nessun target CAD";return; }
            if (Spatial != null && edit != null && Spatial.Begin(edit, ray, hitPoint, orientation)) return;
            var datum = hitCollider != null ? hitCollider.GetComponentInParent<QuestDatumView>() : null;
            if (datum != null) { SelectDatum(datum);return; }
            var view = hitView ?? (hitCollider != null ? hitCollider.GetComponent<QuestMeshView>() : null);
            if (view == null) return;
            if (_selectedDatum != null) _selectedDatum.SetSelected(false);
            _selectedDatum = null;References?.SelectCurrentDatum(null);
            if (_selected != null) _selected.ClearSelection();
            _selected = view;
            if (Spatial != null) Spatial.Select(view);
            _selectedUploadVersion = view.UploadVersion;
            _selectedMode = _selectionMode;
            var activeSection = Connection.Section != null && Connection.Section.Enabled ? Connection.Section.Plane : null;
            _hit = _selectionMode == 2 ? view.ResolveNearestEdge(hitPoint, .008f, activeSection, Connection.DisplayRoot) :
                _selectionMode == 1 ? view.ResolveFace(hitTriangle) : null;
            if (_hit != null && _selectionMode != 0) References?.SetPickedMesh(view, _hit, _selectionMode == 1);
            else References?.ClearPickedMesh();
            if (_selectionMode == 1) view.SelectFace(_hit);
            else if (_selectionMode == 2) view.SelectEdge(_hit);
            else view.SelectBody();
            if (Commands != null) Commands.Select(view, _hit);
            if (_selectionMode != 0 && _hit == null)
            {
                _selected = null;
                _selectedMode = -1;
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
            if (_editingAssemblyMateValue)
            {
                if (text != null) _valueInput = text;
                if (status == TouchScreenKeyboard.Status.Visible) return;
                _keyboard = null;_editingAssemblyMateValue = false;
                if (status != TouchScreenKeyboard.Status.Canceled) AssemblyMates?.SetValue(_valueInput);
                return;
            }
            if (_editingDirectFaceValue)
            {
                if (text != null) _valueInput = text;
                if (status == TouchScreenKeyboard.Status.Visible) return;
                _keyboard = null;_editingDirectFaceValue = false;
                if (status != TouchScreenKeyboard.Status.Canceled) DirectFaceHistory?.SetFieldValue(_valueInput);
                return;
            }
            if (_editingSection)
            {
                if (!string.IsNullOrEmpty(text)) _valueInput = text;
                if (status == TouchScreenKeyboard.Status.Visible) return;
                _keyboard = null;_editingSection = false;
                var model = Connection?.Client?.Model;
                if (status == TouchScreenKeyboard.Status.Done && Connection?.Section?.Plane != null &&
                    CanApplySectionQuota(_sectionSession, _sectionDocument, model?.SessionId, model?.DocumentId,
                        _valueInput, out var offset)) Connection.Section.TrySetOffsetMm(offset);
                return;
            }
            if (_editingReference)
            {
                if (!string.IsNullOrEmpty(text)) _valueInput = text;
                if (status == TouchScreenKeyboard.Status.Visible) return;
                _keyboard = null;_editingReference = false;
                if (status != TouchScreenKeyboard.Status.Canceled && References != null && References.FormTicket == _referenceForm)
                    References.SetNumericInput(_valueInput, _referenceForm, _referenceInput);
                RefreshReferencePage();return;
            }
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
            _selected = null;_hit = null;_selectedMode = -1;_selectedDatum = view;
            References?.ClearPickedMesh();
            References?.SelectCurrentDatum(view.FeatureId);
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
                _selectedMode = -1;
                if (_target != null) _target.text = "Seleziona con il raggio";
            }
        }
        internal static string SharedSelectionId(string mode, string persistentId, bool ambiguous, string bodyId)
        {
            if (mode == "body") return string.IsNullOrWhiteSpace(bodyId) ? null : bodyId;
            if (mode is not ("face" or "edge") || ambiguous || string.IsNullOrWhiteSpace(persistentId)) return null;
            return persistentId;
        }
        void PublishSelectionToDesktop()
        {
            var client = Connection?.Connected == true ? Connection.Client : null;
            var model = client?.Model;
            var view = _selected;
            if (model == null || view == null || !Connection.IsCurrentView(view) ||
                view.UploadVersion != _selectedUploadVersion) { if (_target != null) _target.text = "Selezione non corrente";return; }
            var mode = _selectionMode == 0 ? "body" : _selectionMode == 1 ? "face" : "edge";
            var id = SharedSelectionId(mode, _hit?.PersistentId, _hit?.ReferenceAmbiguous == true, view.BodyId);
            if (id == null) { if (_target != null) _target.text = "Riferimento CAD non univoco";return; }
            var generation = Connection.ConnectionGeneration;
            var session = model.SessionId;
            var document = model.DocumentId;
            var revision = model.Revision;
            _ = Task.Run(async () =>
            {
                try
                {
                    using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
                    if (Connection.ConnectionGeneration != generation || Connection.Client != client ||
                        client.Model?.SessionId != session || client.Model.DocumentId != document || client.Model.Revision != revision)
                        return;
                    await client.CallAsync(Kreoda.Session.SessionMethods.SetSelection,
                        new Dictionary<string, object> { ["ids"] = new[] { id }, ["publish"] = true, ["baseRevision"] = revision },
                        timeout.Token, expectedSessionId: session).ConfigureAwait(false);
                    _massUi.Enqueue(() => { if (Connection.Client == client && Connection.ConnectionGeneration == generation &&
                        client.Model?.SessionId == session && client.Model.DocumentId == document && client.Model.Revision == revision &&
                        _selected == view && view.UploadVersion == _selectedUploadVersion && _target != null)
                        _target.text = "Target condiviso con Desktop"; });
                }
                catch (Exception) { _massUi.Enqueue(() => { if (Connection.Client == client &&
                    Connection.ConnectionGeneration == generation && _target != null) _target.text = "Condivisione non riuscita"; }); }
            });
        }

        int _pointerSource, _modelLeftSource, _modelRightSource;
        bool _modelRequireRelease;
        static int ChooseInputSource(bool hand, bool controller, bool left) => hand ? (left ? 1 : 2) : controller ? (left ? 3 : 4) : 0;
        void SetPointerSource(int source)
        {
            if (_pointerSource == source) return;
            _voiceContext?.PointerSourceChanged(source);
            ResetIntent();_pointerSource = source;
            _pinching = false;
            _pinchReleaseFrames = 0;
            _requireRelease = true;
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
                // Finger confidence prevents incidental pinches during partial
                // tracking; release must remain stable for two frames to rearm.
                var pinching = hand.GetFingerIsPinching(OVRHand.HandFinger.Index) &&
                    hand.GetFingerPinchStrength(OVRHand.HandFinger.Index) >= .62f;
                pressed = pinching;
                if (pinching)
                {
                    clicked = !_pinching && _pinchReleaseFrames >= 2;
                    _pinching = true;
                    _pinchReleaseFrames = 0;
                }
                else
                {
                    _pinchReleaseFrames = Mathf.Min(2, _pinchReleaseFrames + 1);
                    if (_pinchReleaseFrames == 2) _pinching = false;
                }
            } else {
                var controller = left ? OVRInput.Controller.LTouch : OVRInput.Controller.RTouch;
                clicked = OVRInput.GetDown(OVRInput.Button.PrimaryIndexTrigger, controller);pressed = OVRInput.Get(OVRInput.Button.PrimaryIndexTrigger, controller);
                if (OVRInput.GetDown(OVRInput.Button.Two, controller)) TogglePanel();
                _pinching = false;
                _pinchReleaseFrames = 0;
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

        // Real QuestButton actions in operation-specific screen compositions.
        // Each page declares a workflow as measured rows: one row is one task,
        // not a width/Y guess. Parallel controls share one hitbox-safe row.
        readonly Dictionary<Transform, int> _authoredActionIndex = new Dictionary<Transform, int>();
        readonly Dictionary<string, Transform> _directOperationCards = new Dictionary<string, Transform>();
        // Each page owns an explicit workflow decomposition by row. These are
        // functional regions containing the actual QuestButton descendants.
        static string[] AuthoredZoneNames(string page)
        {
            switch (page)
            {
                case "PC locali": return new[] { "DISPOSITIVI RILEVATI", "RICERCA E PAGINE", "DIAGNOSTICA PC" };
                case "Advanced PC diagnostics": return new[] { "PAIRING E CREDENZIALI", "SELEZIONE TARGET", "PROPRIETA CAD", "SESSIONE PC" };
                case "Home action status": return new[] { "PERCORSI DOPO ESITO" };
                case "CAD configurations": return new[] { "SFOGLIA VARIANTI", "ATTIVA CONFIGURAZIONE", "RITORNA" };
                case "Display controls": return new[] { "AMBIENTE E INPUT", "POSIZIONA MODELLO", "SCALA E INSPEZIONE", "STRUMENTI CAD" };
                case "Optional diagnostics": return new[] { "RITORNO ALLA SCENA" };
                case "Section view": return new[] { "ABILITA PIANO", "ASSI E QUOTA", "SUPERFICI E BANDE", "NAVIGAZIONE" };
                case "Exact CAD editing": return new[] { "SCELTA PARAMETRO", "VALORE E SNAP", "AZIONI E RITORNO" };
                case "Canonical context actions": return new[] { "SELEZIONA COMANDO", "ESEGUI MODIFICA", "STORIA, VINCOLI E SKETCH" };
                case "Riferimenti CAD": return new[] { "CREA DATUM", "SELEZIONE RIFERIMENTI", "CONFIGURA SORGENTI", "VALORI E CONFERMA", "RITORNO A MR" };
                case "Canonical sketch dimensions": return new[] { "SELEZIONA QUOTA", "VALORE E CONFERMA", "VINCOLI E CRONOLOGIA", "RITORNO CAD" };
                case "Hermes voice": return new[] { "REGISTRAZIONE E PUNTO", "CONTESTO E NAVIGAZIONE" };
                case "Contesto Hermes": return new[] { "RACCOLTA E PUNTO", "VOCE E MODALITÀ" };
                default: return Array.Empty<string>();
            }
        }

        // The spatial hierarchy has an explicit operational purpose per
        // surface. Device pickers, decision selectors, live parameter editors,
        // committing actions, history and navigation have different visual
        // affordances provided by QuestUi.OperationPanel.SetRole.
        static QuestUi.OperationPanelRole AuthoredPanelRole(string page, int zone)
        {
            switch (page)
            {
                case "PC locali": return zone == 0 ? QuestUi.OperationPanelRole.DevicePicker :
                    zone == 1 ? QuestUi.OperationPanelRole.Selector : QuestUi.OperationPanelRole.Diagnostic;
                case "Advanced PC diagnostics": return zone == 0 ? QuestUi.OperationPanelRole.ParameterEditor :
                    zone == 1 ? QuestUi.OperationPanelRole.Selector : zone == 2 ? QuestUi.OperationPanelRole.PrimaryCommand : QuestUi.OperationPanelRole.Navigation;
                case "Home action status": return QuestUi.OperationPanelRole.PrimaryCommand;
                case "CAD configurations": return zone == 0 ? QuestUi.OperationPanelRole.Selector :
                    zone == 1 ? QuestUi.OperationPanelRole.PrimaryCommand : QuestUi.OperationPanelRole.Navigation;
                case "Display controls": return zone == 0 ? QuestUi.OperationPanelRole.Selector :
                    zone == 1 ? QuestUi.OperationPanelRole.PrimaryCommand : zone == 2 ? QuestUi.OperationPanelRole.ParameterEditor : QuestUi.OperationPanelRole.Navigation;
                case "Optional diagnostics": return QuestUi.OperationPanelRole.Diagnostic;
                case "Section view": return zone == 0 ? QuestUi.OperationPanelRole.PrimaryCommand :
                    zone == 1 ? QuestUi.OperationPanelRole.ParameterEditor : zone == 2 ? QuestUi.OperationPanelRole.Selector : QuestUi.OperationPanelRole.Navigation;
                case "Exact CAD editing": return zone == 0 ? QuestUi.OperationPanelRole.Selector :
                    zone == 1 ? QuestUi.OperationPanelRole.ParameterEditor : QuestUi.OperationPanelRole.Navigation;
                case "Canonical context actions": return zone == 0 ? QuestUi.OperationPanelRole.Selector :
                    zone == 1 ? QuestUi.OperationPanelRole.PrimaryCommand : QuestUi.OperationPanelRole.History;
                case "Riferimenti CAD": return zone == 0 ? QuestUi.OperationPanelRole.PrimaryCommand :
                    zone == 1 ? QuestUi.OperationPanelRole.DevicePicker : zone == 2 ? QuestUi.OperationPanelRole.Selector :
                    zone == 3 ? QuestUi.OperationPanelRole.ParameterEditor : QuestUi.OperationPanelRole.Navigation;
                case "Canonical sketch dimensions": return zone == 0 ? QuestUi.OperationPanelRole.Selector :
                    zone == 1 ? QuestUi.OperationPanelRole.ParameterEditor : zone == 2 ? QuestUi.OperationPanelRole.History : QuestUi.OperationPanelRole.Navigation;
                case "Hermes voice": return zone == 0 ? QuestUi.OperationPanelRole.PrimaryCommand : QuestUi.OperationPanelRole.Navigation;
                case "Contesto Hermes": return zone == 0 ? QuestUi.OperationPanelRole.PrimaryCommand : QuestUi.OperationPanelRole.Navigation;
                default: throw new InvalidOperationException("No Quest operation-panel role: " + page);
            }
        }

        static int ExpectedActions(string page)
        {
            switch (page)
            {
                case "PC locali": return 7;
                case "Advanced PC diagnostics": return 12;
                case "Home action status": return 2;
                case "CAD configurations": return 4;
                case "Display controls": return 24;
                case "Optional diagnostics": return 1;
                case "Section view": return 15;
                case "Exact CAD editing": return 7;
                case "Canonical context actions": return 8;
                case "Riferimenti CAD": return 24;
                case "Canonical sketch dimensions": return 9;
                case "Hermes voice": return 4;
                case "Contesto Hermes": return 4;
                default: return 0;
            }
        }

        // Semantic ownership is determined by the real action identity, never
        // its construction ordinal, original Y coordinate, or row capacity.
        static int SemanticZone(string page, string action)
        {
            switch (page)
            {
                case "PC locali": return action.StartsWith("PC ", StringComparison.Ordinal) ? 0 : action == "Diagnostica avanzata" ? 2 : 1;
                case "Advanced PC diagnostics":
                    if (action == "Endpoint manuale" || action == "Codice manuale" || action == "Connetti") return 0;
                    if (action == "Corpo" || action == "Faccia" || action == "Bordo") return 1;
                    if (action == "Propriet\u00e0 fisiche" || action == "Spessore minimo" || action == "Centra" || action == "Invia target al PC") return 2;
                    return 3;
                case "Home action status": return 0;
                case "CAD configurations": return action == "Aggiorna" || action == "Successiva" ? 0 : action == "Attiva selezionata" ? 1 : 2;
                case "Display controls":
                    if (action == "MR / VR" || action.StartsWith("Mano ", StringComparison.Ordinal) ||
                        action == "Rileva tavolo" || action == "Configura stanza") return 0;
                    if (action == "Posiziona" || action == "Centra CAD" || action == "Conferma" || action == "Annulla" || action == "\u22125" || action == "+5") return 1;
                    if (action == "Ispezione" || action == "Normale" || action == "1:10" ||
                        action == "1:5" || action == "1:1" || action == "2:1" ||
                        action == "10:1" || action == "Fit") return 2;
                    return 3;
                case "Optional diagnostics": return 0;
                case "Section view": return action == "Attiva sezione" ? 0 : action == "X" || action == "Y" || action == "Z" || action.Contains("mm") || action == "Quota esatta" ? 1 : action == "Inverti" || action == "Azzera" || action == "Zebra" || action == "Curvatura" || action == "Bande →" || action == "Ruota bande" ? 2 : 3;
                case "Exact CAD editing": return action.StartsWith("Feature", StringComparison.Ordinal) || action.StartsWith("Parametro", StringComparison.Ordinal) ? 0 : action == "Valore esatto" || action.StartsWith("Snap", StringComparison.Ordinal) ? 1 : 2;
                case "Canonical context actions": return action.StartsWith("Azione", StringComparison.Ordinal) || action.StartsWith("Campo", StringComparison.Ordinal) ? 0 : action == "Valore" || action == "Conferma" ? 1 : 2;
                case "Riferimenti CAD":
                    if (action.StartsWith("Nuovo ", StringComparison.Ordinal)) return 0;
                    if (action.StartsWith("Datum", StringComparison.Ordinal) || action == "Ispeziona" || action == "Modifica" || action == "Sketch piano" || action == "Indietro") return 1;
                    if (action.StartsWith("Sorgente", StringComparison.Ordinal) || action.StartsWith("Fonti", StringComparison.Ordinal) || action.StartsWith("Campo", StringComparison.Ordinal)) return 2;
                    if (action == "Conferma" || action == "Annulla" || action.StartsWith("Valore", StringComparison.Ordinal) || action.StartsWith("Tipo", StringComparison.Ordinal) || action.StartsWith("Costruzione", StringComparison.Ordinal)) return 3;
                    return 4;
                case "Canonical sketch dimensions": return action.StartsWith("Sketch", StringComparison.Ordinal) || action.StartsWith("Quota", StringComparison.Ordinal) ? 0 : action == "Valore esatto" || action == "Conferma" ? 1 : action == "Annulla" || action == "Undo" || action.StartsWith("Simmetrie", StringComparison.Ordinal) ? 2 : 3;
                case "Hermes voice": return action == "Home" || action == "Contesto" ||
                    action == "Voce con raccolta" || action == "Voce singola" ? 1 : 0;
                case "Contesto Hermes": return action == "Raccolta voce" || action == "Voce singola" ? 1 : 0;
                default: return -1;
            }
        }

        // Explicit spatial compositions. Workflows expose a primary functional
        // surface and a second, independently placed operation lane. Rectangles
        // are metres in the page's local plane; colliders remain children of
        // their owning surface. Reference modals retain alternative stacked
        // geometry because only one form/mode may be visible at a time.
        static Vector4 RawSemanticPanelGeometry(string page, int zone)
        {
            switch (page)
            {
                case "PC locali": return zone == 0 ? new Vector4(-.086f, -.074f, .238f, .332f) :
                    zone == 1 ? new Vector4(.121f, .017f, .167f, .150f) : new Vector4(.121f, -.153f, .167f, .178f);
                case "Advanced PC diagnostics": return zone == 0 ? new Vector4(-.096f, .008f, .210f, .196f) :
                    zone == 1 ? new Vector4(.110f, .008f, .185f, .196f) : zone == 2 ?
                    new Vector4(-.096f, -.172f, .210f, .152f) : new Vector4(.110f, -.172f, .185f, .152f);
                case "Home action status": return new Vector4(0, -.116f, .370f, .177f);
                case "CAD configurations": return zone == 0 ? new Vector4(-.095f, -.0095f, .210f, .230f) :
                    zone == 1 ? new Vector4(.110f, -.0095f, .185f, .230f) : new Vector4(0, -.193f, .350f, .100f);
                case "Display controls": return zone == 0 ? new Vector4(-.096f, .055f, .208f, .093f) :
                    zone == 1 ? new Vector4(.110f, .008f, .185f, .188f) :
                    zone == 2 ? new Vector4(-.096f, -.149f, .208f, .293f) : new Vector4(.110f, -.205f, .185f, .224f);
                case "Optional diagnostics": return new Vector4(0, -.140f, .300f, .140f);
                case "Section view": return zone == 0 ? new Vector4(-.096f, .026f, .208f, .158f) :
                    zone == 1 ? new Vector4(.110f, .026f, .185f, .158f) : zone == 2 ?
                    new Vector4(-.096f, -.150f, .208f, .181f) : new Vector4(.110f, -.150f, .185f, .181f);
                case "Exact CAD editing": return zone == 0 ? new Vector4(-.096f, -.0095f, .208f, .225f) :
                    zone == 1 ? new Vector4(.110f, -.0095f, .185f, .225f) : new Vector4(0, -.186f, .360f, .120f);
                case "Canonical context actions": return zone == 0 ? new Vector4(-.096f, -.0095f, .208f, .225f) :
                    zone == 1 ? new Vector4(.110f, -.0095f, .185f, .225f) : new Vector4(0, -.189f, .360f, .122f);
                case "Riferimenti CAD": return zone == 0 ? new Vector4(0, -.025f, .39f, .125f) : zone == 1 ? new Vector4(0, -.162f, .39f, .175f) : zone == 2 ? new Vector4(0, -.040f, .39f, .15f) : zone == 3 ? new Vector4(0, -.160f, .39f, .11f) : new Vector4(0, -.255f, .32f, .068f);
                case "Canonical sketch dimensions": return zone == 0 ? new Vector4(-.096f, -.0115f, .208f, .235f) :
                    zone == 1 ? new Vector4(.110f, -.0115f, .185f, .235f) : zone == 2 ?
                    new Vector4(-.096f, -.194f, .208f, .119f) : new Vector4(.110f, -.194f, .185f, .119f);
                case "Hermes voice": return zone == 0 ? new Vector4(-.096f, -.196f, .228f, .124f) :
                    new Vector4(.112f, -.205f, .181f, .079f);
                case "Contesto Hermes": return zone == 0 ? new Vector4(-.096f, -.196f, .228f, .124f) :
                    new Vector4(.112f, -.205f, .181f, .079f);
                default: throw new InvalidOperationException("Unknown Quest semantic panel: " + page);
            }
        }

        // The authored rectangles are final placement values. Do not pack them
        // into a generic vertical list: the device selector, configuration
        // commit, MR tools and CAD editors require side-by-side work surfaces.
        static Vector4 SemanticPanelGeometry(string page, int zone)
        {
            var rectangle = RawSemanticPanelGeometry(page, zone);
            if (rectangle.x - rectangle.z * .5f < -.2101f ||
                rectangle.x + rectangle.z * .5f > .2101f ||
                rectangle.y - rectangle.w * .5f < -.3201f ||
                rectangle.y + rectangle.w * .5f > .153f)
                throw new InvalidOperationException("Quest workstation outside title-safe area: " + page + " zone " + zone);
            return rectangle;
        }

        readonly Dictionary<string, QuestUi.OperationPanel> _measuredPanels =
            new Dictionary<string, QuestUi.OperationPanel>();
        readonly Dictionary<string, int> _panelActionCounters = new Dictionary<string, int>();
        // Panel headers now show only their authored heading. Live values are
        // shown once in the page focus and on the original action controls.
        void RefreshPanelReadouts(Transform page, string subject, string value, bool available)
        {
            // Domain status is rendered once in the page focus and in the
            // existing action detail. Do not repeat it across every panel.
        }
        // The secondary line belongs to an existing collider-bearing control,
        // not to a look-alike button. Only authoritative live session fields are
        // shown; missing information clears the line instead of fabricating it.
        void SetLiveActionDetail(Transform page, string id, string value, bool available)
        {
            if (page == null || !_contextActions.TryGetValue(page, out var actions) ||
                !actions.TryGetValue(id, out var label) || label == null) return;
            // The richer workflow card owns its second factual line; avoid
            // replacing that value twice per XR update with a generic detail.
            if (_actionInstruments.ContainsKey(label)) return;
            QuestUi.SetActionDetail(label, value,
                available ? QuestUi.StatusSeverity.Active : QuestUi.StatusSeverity.Warning);
        }

        // Keep the existing action-state mapping, but suppress its duplicate
        // instrument art. The original button still owns its ID and callback.
        static ActionInstrumentKind? InstrumentFor(string page, string action)
        {
            switch (page)
            {
                case "PC locali": return action.StartsWith("PC ", StringComparison.Ordinal) ?
                    ActionInstrumentKind.Peer : action == "Altri PC" ? ActionInstrumentKind.Variant : (ActionInstrumentKind?)null;
                case "Advanced PC diagnostics": return action == "Connetti" || action == "Codice manuale" ?
                    ActionInstrumentKind.Pairing : action == "Corpo" || action == "Faccia" || action == "Bordo" ?
                    ActionInstrumentKind.Datum : (ActionInstrumentKind?)null;
                case "Home action status": return action == "Torna a Home" || action == "Diagnostica PC" ?
                    ActionInstrumentKind.Outcome : (ActionInstrumentKind?)null;
                case "CAD configurations": return action == "Successiva" || action == "Attiva selezionata" ?
                    ActionInstrumentKind.Variant : (ActionInstrumentKind?)null;
                case "Display controls": return action == "Posiziona" || action == "Conferma" || action == "Centra CAD" ?
                    ActionInstrumentKind.Placement : (ActionInstrumentKind?)null;
                case "Optional diagnostics": return action == "Torna a Vista" ? ActionInstrumentKind.Metric : (ActionInstrumentKind?)null;
                case "Section view": return action == "X" || action == "Y" || action == "Z" || action == "Quota esatta" ?
                    ActionInstrumentKind.Plane : (ActionInstrumentKind?)null;
                case "Exact CAD editing": return action == "Parametro →" || action == "Valore esatto" ?
                    ActionInstrumentKind.ValueWell : (ActionInstrumentKind?)null;
                case "Canonical context actions": return action == "Campo →" || action == "Valore" || action == "Conferma" ?
                    ActionInstrumentKind.Command : (ActionInstrumentKind?)null;
                case "Riferimenti CAD": return action.StartsWith("Nuovo ", StringComparison.Ordinal) ||
                    action.StartsWith("Datum ", StringComparison.Ordinal) || action.StartsWith("Sorgente ", StringComparison.Ordinal) ||
                    action == "Valore mm/deg" ? ActionInstrumentKind.Datum : (ActionInstrumentKind?)null;
                case "Canonical sketch dimensions": return action == "Quota →" || action == "Valore esatto" ||
                    action == "Conferma" ? ActionInstrumentKind.Dimension : (ActionInstrumentKind?)null;
                case "Hermes voice": return action == "Parla / Invia" || action == "Stop" || action == "Arma punto" ?
                    ActionInstrumentKind.Voice : (ActionInstrumentKind?)null;
                case "Contesto Hermes": return action == "Arma punto" ? ActionInstrumentKind.Voice : (ActionInstrumentKind?)null;
                default: return null;
            }
        }

        void CreateActionInstrument(string page, string action, TextMesh label, float width, float height)
        {
            var kind = InstrumentFor(page, action);
            if (!kind.HasValue || label == null || height <= .008f) return;
            var hit = label.transform.parent.GetComponentInChildren<QuestButton>();
            if (hit == null) throw new InvalidOperationException("Missing original interactive Quest action " + page + "/" + action);
            if (_instrumentGlass == null) _instrumentGlass = QuestUi.GlassMaterial(ButtonMaterial);
            var root = label.transform.parent;
            var center = hit.transform.localPosition;
            var bottom = center.y - height * .395f;
            var stripWidth = Mathf.Max(.006f, width * (kind.Value == ActionInstrumentKind.Metric ? .72f : .42f));
            var stripX = center.x + (kind.Value == ActionInstrumentKind.Metric ? 0 : width * .22f);
            // Retain hidden state surfaces so current telemetry and tests keep
            // their stable references; only the glass face and blue rail render.
            var line = QuestUi.Surface(root, _instrumentGlass, kind.Value + " / instrument track",
                new Vector3(stripX, bottom, center.z - .0047f), new Vector3(stripWidth, .0011f, .0003f));
            var fill = QuestUi.Surface(root, _instrumentGlass, kind.Value + " / live instrument value",
                new Vector3(stripX - stripWidth * .5f, bottom, center.z - .0052f), new Vector3(.0004f, .0018f, .0004f));
            var marker = QuestUi.Surface(root, _instrumentGlass, kind.Value + " / state marker",
                new Vector3(center.x + width * .385f, center.y + height * .29f, center.z - .0051f),
                new Vector3(.003f, Mathf.Min(.006f, height * .16f), .0004f));
            var second = QuestUi.Surface(root, _instrumentGlass, kind.Value + " / domain geometry",
                new Vector3(center.x + width * .32f, center.y + height * .29f, center.z - .005f),
                new Vector3(.002f, Mathf.Min(.007f, height * .18f), .0004f));
            line.GetComponent<MeshRenderer>().enabled = false;
            fill.GetComponent<MeshRenderer>().enabled = false;
            marker.GetComponent<MeshRenderer>().enabled = false;
            second.GetComponent<MeshRenderer>().enabled = false;
            var visual = new ActionInstrument
            {
                Kind = kind.Value, Track = line.transform, Fill = fill.transform,
                Marker = marker.transform, Secondary = second.transform,
                MarkerRenderer = marker.GetComponent<MeshRenderer>(),
                FillRenderer = fill.GetComponent<MeshRenderer>(),
                SecondaryRenderer = second.GetComponent<MeshRenderer>(),
                TrackWidth = stripWidth, FillOrigin = fill.transform.localPosition
            };
            // Preserve each action's state geometry without drawing duplicate
            // diagrams over the original button.
            switch (kind.Value)
            {
                case ActionInstrumentKind.Peer: // two endpoint nodes and a connection path
                case ActionInstrumentKind.Pairing:
                    second.transform.localScale = new Vector3(.003f, .003f, .0004f);
                    marker.transform.localScale = new Vector3(.003f, .003f, .0004f);
                    break;
                case ActionInstrumentKind.Outcome: // navigation bifurcation
                case ActionInstrumentKind.Command: // commit / routing chevron
                    second.transform.localRotation = Quaternion.Euler(0, 0, 40f);
                    marker.transform.localRotation = Quaternion.Euler(0, 0, -40f);
                    break;
                case ActionInstrumentKind.Variant: // staggered configuration leaves
                    marker.transform.localScale = new Vector3(.005f, .002f, .0004f);
                    second.transform.localScale = new Vector3(.005f, .002f, .0004f);
                    break;
                case ActionInstrumentKind.Placement: // MR placement reticle
                    marker.transform.localScale = new Vector3(.001f, .008f, .0004f);
                    second.transform.localScale = new Vector3(.008f, .001f, .0004f);
                    second.transform.localPosition = marker.transform.localPosition;
                    break;
                case ActionInstrumentKind.Plane: // live orthogonal section normal
                case ActionInstrumentKind.Datum: // datum axis cross
                    marker.transform.localScale = new Vector3(.0012f, .008f, .0004f);
                    second.transform.localScale = new Vector3(.008f, .0012f, .0004f);
                    second.transform.localPosition = marker.transform.localPosition;
                    break;
                case ActionInstrumentKind.ValueWell: // current numeric value underline
                    marker.transform.localScale = new Vector3(.005f, .0015f, .0004f);
                    second.transform.localScale = new Vector3(.001f, .005f, .0004f);
                    break;
                case ActionInstrumentKind.Dimension: // dimension line with endpoint ticks
                    marker.transform.localScale = new Vector3(.001f, .007f, .0004f);
                    second.transform.localScale = new Vector3(.001f, .007f, .0004f);
                    break;
                case ActionInstrumentKind.Voice: // only a real record/busy lamp, no fake waveform
                    marker.transform.localScale = new Vector3(.004f, .004f, .0004f);
                    second.transform.localScale = new Vector3(.003f, .003f, .0004f);
                    break;
                case ActionInstrumentKind.Metric: // actual mesh triangles / budget
                    marker.SetActive(false);second.SetActive(false);
                    break;
            }
            _actionInstruments.Add(label, visual);
            fill.SetActive(false);
            if (kind.Value == ActionInstrumentKind.Voice)
            { marker.SetActive(false); second.SetActive(false); }
        }

        static void TintInstrument(MeshRenderer renderer, Color tone)
        {
            if (renderer == null || renderer.sharedMaterial == null ||
                !renderer.sharedMaterial.HasProperty("_Color")) return;
            var block = new MaterialPropertyBlock();
            renderer.GetPropertyBlock(block);
            block.SetColor("_Color", tone);
            renderer.SetPropertyBlock(block);
        }

        void SetDomainActionCard(Transform page, string id, string actualDetail, bool selected,
            bool dataAvailable, int mode = 0, float normalized = -1f)
        {
            if (page == null || !_contextActions.TryGetValue(page, out var actions) ||
                !actions.TryGetValue(id, out var label) || label == null) return;
            if (!label.transform.parent.gameObject.activeInHierarchy)
            {
                // Hidden reference-modal alternatives may change while hidden;
                // force a fresh real snapshot on their next visible frame.
                _actionCardSnapshots.Remove(label);
                if (_actionInstruments.TryGetValue(label, out var dormant)) dormant.LastState = null;
                return;
            }
            // Never re-enable a disabled CAD action, bypass a confirmation gate
            // or change any QuestButton.Click/ActionId on the service's behalf.
            var context = _contextVisualStates.TryGetValue(label, out var state) ? state : 1;
            var enabled = (context & 1) != 0;
            selected = enabled && (selected || ((context & 2) != 0 &&
                (!_actionInstruments.TryGetValue(label, out var marker) || marker.Kind != ActionInstrumentKind.Peer)));
            var severity = dataAvailable ? QuestUi.StatusSeverity.Active : QuestUi.StatusSeverity.Warning;
            var signature = (enabled ? "1" : "0") + (selected ? "1" : "0") +
                (dataAvailable ? "1" : "0") + "|" + actualDetail;
            if (!_actionCardSnapshots.TryGetValue(label, out var before) || before != signature)
            {
                _actionCardSnapshots[label] = signature;
                QuestUi.SetActionDataCard(label, actualDetail, selected, enabled, severity);
            }
            if (!_actionInstruments.TryGetValue(label, out var visual)) return;
            var validMagnitude = !float.IsNaN(normalized) && !float.IsInfinity(normalized) &&
                normalized >= 0f && normalized <= 1f;
            var visualKey = signature + "|" + mode.ToString(CultureInfo.InvariantCulture) + "|" +
                (validMagnitude ? normalized.ToString("R", CultureInfo.InvariantCulture) : "-");
            if (visual.LastState == visualKey) return;
            visual.LastState = visualKey;
            var active = enabled && dataAvailable;
            var color = active ? selected ? new Color(.35f, .95f, .80f, .94f) :
                new Color(.36f, .75f, 1f, .72f) : new Color(.40f, .51f, .59f, .25f);
            if (visual.Kind == ActionInstrumentKind.Voice)
                color = mode == 1 ? new Color(1f, .29f, .29f, .93f) :
                    mode == 2 ? new Color(1f, .75f, .29f, .84f) : color;
            TintInstrument(visual.MarkerRenderer, color);
            TintInstrument(visual.SecondaryRenderer, color);
            TintInstrument(visual.FillRenderer, color);
            // Only the diagnostic uses a fractional, genuinely measured bar.
            // Other cards use a FULL selection/link underline, never a made-up
            // 30% or 98% progress level masquerading as real telemetry.
            var metricBar = active && visual.Kind == ActionInstrumentKind.Metric && validMagnitude;
            var selectedUnderline = active && selected && visual.Kind != ActionInstrumentKind.Metric &&
                visual.Kind != ActionInstrumentKind.Voice;
            var peerAuthenticated = active && visual.Kind == ActionInstrumentKind.Peer && mode == 2;
            var hasBar = metricBar || selectedUnderline || peerAuthenticated;
            visual.Track.gameObject.SetActive(hasBar);
            visual.Fill.gameObject.SetActive(hasBar);
            if (hasBar)
            {
                var ratio = metricBar ? normalized : 1f;
                var length = Mathf.Max(.0001f, visual.TrackWidth * ratio);
                visual.Fill.localScale = new Vector3(length, visual.Fill.localScale.y, visual.Fill.localScale.z);
                visual.Fill.localPosition = visual.FillOrigin + new Vector3((length - .0004f) * .5f, 0, 0);
            }
            if (visual.Kind == ActionInstrumentKind.Voice)
            {
                visual.Marker.gameObject.SetActive(mode == 1 || mode == 2);
                visual.Secondary.gameObject.SetActive(mode == 2);
            }
            else if (visual.Kind == ActionInstrumentKind.Plane)
            {
                var hasPlane = mode >= 1 && mode <= 3;
                visual.Marker.gameObject.SetActive(hasPlane);
                visual.Secondary.gameObject.SetActive(hasPlane);
                if (hasPlane)
                    visual.Marker.localRotation = Quaternion.Euler(0, 0, (mode - 1) * 45f);
            }
            else if (visual.Kind == ActionInstrumentKind.Peer)
            {
                // A discovered peer is not an authenticated session. The link
                // stroke only appears after actual authenticated connection.
                visual.Marker.gameObject.SetActive(dataAvailable);
                visual.Secondary.gameObject.SetActive(mode == 1 || mode == 2);
                var peerTone = mode == 2 ? new Color(.33f, .92f, .64f, .96f) :
                    mode == 1 ? new Color(1f, .73f, .27f, .90f) : color;
                TintInstrument(visual.MarkerRenderer, peerTone);
                TintInstrument(visual.SecondaryRenderer, peerTone);
            }
            else if (visual.Kind != ActionInstrumentKind.Metric)
            {
                visual.Marker.gameObject.SetActive(active);
                visual.Secondary.gameObject.SetActive(active);
            }
        }

        void RefreshLiveActionDetails(Kreoda.Session.DiscoveredSessionPc[] peers)
        {
            var connected = Connection != null && Connection.Connected;
            for (var slot = 0; slot < _pcChoices.Length; slot++)
            {
                var index = _pcChoicePage * _pcChoices.Length + slot;
                var peer = peers != null && index < peers.Length ? peers[index] : null;
                SetLiveActionDetail(_pcPage, "PC " + (slot + 1), peer == null ? "" :
                    peer.Endpoint.Authority + " · " + (peer.PcId == _selectedPcId ?
                        connected ? "sessione autenticata" : "associazione in corso" : peer.PcId), peer != null);
            }
            SetLiveActionDetail(_pcPage, "Altri PC", peers != null && peers.Length > 0 ?
                "Pagina " + (_pcChoicePage + 1).ToString(CultureInfo.InvariantCulture) : "", peers != null && peers.Length > 0);
            SetLiveActionDetail(_pcPage, "Riprova", Connection.Status, !connected);
            SetLiveActionDetail(_connectionPage, "Endpoint manuale", _endpoint, !string.IsNullOrWhiteSpace(_endpoint));
            SetLiveActionDetail(_connectionPage, "Codice manuale", _code.Length == 0 ? "Codice richiesto" :
                "Codice inserito", _code.Length > 0);
            SetLiveActionDetail(_connectionPage, "Connetti", Connection.Status, connected);
            SetLiveActionDetail(_connectionPage, "Invia target al PC", _selectedDatum != null ?
                _selectedDatum.FeatureId : _hit != null ? _hit.PersistentId :
                _selected != null ? _selected.BodyId : "Nessun target", connected);
            SetLiveActionDetail(_connectionPage, "Proprietà fisiche", _massStatus != null ?
                _massStatus.text : "", connected && _selected != null);
            SetLiveActionDetail(_connectionPage, "Spessore minimo", _thicknessSummary, connected && _selected != null);
            SetLiveActionDetail(_homeNoticePage, "Torna a Home", "", connected);
            var variants = _configurations?.Names;
            var selectedVariant = variants != null && variants.Length != 0 ?
                variants[_configurationIndex % variants.Length] : "";
            SetLiveActionDetail(_configurationPage, "Successiva", selectedVariant, variants != null && variants.Length > 0);
            SetLiveActionDetail(_configurationPage, "Attiva selezionata", selectedVariant == "" ? "" :
                selectedVariant == _configurations.Active ? "Già attiva" :
                _configurationConfirm == selectedVariant ? "Conferma sul PC" : "Richiede conferma", connected);
            SetLiveActionDetail(_configurationPage, "Aggiorna", _configurationStatus != null ?
                _configurationStatus.text : "", connected);
            SetLiveActionDetail(_viewPage, "Posiziona", Display.Status, connected);
            SetLiveActionDetail(_viewPage, "Centra CAD", Display.ScaleName, connected);
            SetLiveActionDetail(_viewPage, "Condividi selezione", _target != null ? _target.text : "", connected);
            SetLiveActionDetail(_metricsPage, "Torna a Vista", connected && Connection.RttMilliseconds.HasValue ?
                "RTT " + Connection.RttMilliseconds.Value.ToString("0.#", CultureInfo.InvariantCulture) + " ms" : Connection.Status, connected);
            SetLiveActionDetail(_sectionPage, "Quota esatta", _sectionQuota != null ? _sectionQuota.text : "", connected);
            SetLiveActionDetail(_sectionPage, "Attiva sezione", Connection.Section != null ?
                Connection.Section.Status : "", connected);
            var intent = Spatial != null ? Spatial.SelectedIntent : null;
            SetLiveActionDetail(_editPage, "Parametro \u2192", intent != null && intent.Parameters.Count > 0 ?
                intent.Parameters[_exactParameter % intent.Parameters.Count] : "", intent != null);
            var field = intent != null && intent.Parameters.Count > 0 ?
                intent.Parameters[_exactParameter % intent.Parameters.Count] : null;
            var draft = Spatial != null ? Spatial.DraftValues : null;
            var values = draft ?? intent?.InitialValues;
            var exactValue = field != null && values != null && values.TryGetValue(field, out var number) ?
                number.ToString("0.###", CultureInfo.InvariantCulture) + " " + intent.Unit : "";
            SetLiveActionDetail(_editPage, "Valore esatto", exactValue, connected && field != null);
            SetLiveActionDetail(_editPage, "Snap 0.1mm / 5deg", Spatial != null ?
                Spatial.SnapEnabled ? "Attivo" : "Disattivato" : "", connected);
            SetLiveActionDetail(_commandPage, "Azione \u2192", Commands != null ? Commands.CommandLabel : "", connected);
            SetLiveActionDetail(_commandPage, "Campo \u2192", Commands != null ? Commands.FieldLabel : "", connected);
            SetLiveActionDetail(_commandPage, "Valore", Commands != null ? Commands.FieldValue : "", connected);
            SetLiveActionDetail(_commandPage, "Conferma", Commands != null ? Commands.Status : "", connected);
            SetLiveActionDetail(_referencePage, "Ispeziona", References != null ? References.SelectedDatumId : "", connected);
            SetLiveActionDetail(_referencePage, "Valore mm/deg", References != null && References.IsFormOpen ?
                References.CurrentFieldValue + " " + References.CurrentFieldUnit : "", connected);
            SetLiveActionDetail(_sketchPage, "Valore esatto", SketchDimensions != null && SketchDimensions.Selected != null ?
                SketchDimensions.Value.ToString("0.###", CultureInfo.InvariantCulture) + " " + SketchDimensions.Selected.Unit : "", connected);
            SetLiveActionDetail(_sketchPage, "Sketch \u2192", SketchDimensions?.Selected != null ?
                SketchDimensions.Selected.SketchId : "", connected);
            SetLiveActionDetail(_voicePage, "Parla / Invia", Voice != null ?
                Voice.Recording ? "Microfono attivo" : "" : "", Voice != null && Voice.Configured);
            SetLiveActionDetail(_voicePage, "Stop", Voice != null && Voice.Busy ?
                Voice.Recording ? "Arresta registrazione" : "Annulla richiesta" : "", Voice != null && Voice.Busy);
        }

        // One live instrument family PER operational page, all attached to the
        // All authored action IDs are checked; unavailable snapshots clear their instrument
        // instead of manufacturing a device, gauge, section plane or waveform.
        void RefreshDomainActionCards(Kreoda.Session.DiscoveredSessionPc[] peers)
        {
            var connected = Connection != null && Connection.Connected;
            var model = connected && Connection.Client?.Model != null;
            var count = peers == null ? 0 : peers.Length;
            for (var slot = 0; slot < _pcChoices.Length; slot++)
            {
                var i = _pcChoicePage * _pcChoices.Length + slot;
                var peer = i < count ? peers[i] : null;
                var chosen = peer != null && !string.IsNullOrEmpty(_selectedPcId) &&
                    peer.PcId == _selectedPcId;
                var authenticated = AuthenticatedSelectedPc(peer);
                var pending = chosen && !connected && !string.IsNullOrEmpty(_selectedPcNotice);
                SetDomainActionCard(_pcPage, "PC " + (slot + 1), peer == null ? "" :
                    ShortVoiceText(peer.Endpoint.Authority + " · " + peer.PcId, 38),
                    authenticated || pending, peer != null, authenticated ? 2 : pending ? 1 : 0);
            }
            SetDomainActionCard(_pcPage, "Altri PC", "Pagina " + (_pcChoicePage + 1) +
                " / " + Mathf.Max(1, (count + _pcChoices.Length - 1) / _pcChoices.Length),
                false, count > _pcChoices.Length);

            // Pairing keeps its true security check and executable callback.
            var endpointReady = !string.IsNullOrWhiteSpace(_endpoint) ||
                !string.IsNullOrWhiteSpace(Connection.SavedEndpoint);
            SetDomainActionCard(_connectionPage, "Connetti", Connection.Status,
                connected, endpointReady, connected ? 2 : !string.IsNullOrEmpty(_selectedPcNotice) ? 1 : 0);
            SetDomainActionCard(_connectionPage, "Codice manuale", _code.Length == 0 ?
                "Codice non inserito" : "Codice inserito", _code.Length > 0, true);
            SetDomainActionCard(_connectionPage, "Corpo", "Target corpo CAD", _selectionMode == 0, model);
            SetDomainActionCard(_connectionPage, "Faccia", "Target faccia CAD", _selectionMode == 1, model);
            SetDomainActionCard(_connectionPage, "Bordo", "Target bordo CAD", _selectionMode == 2, model);

            SetDomainActionCard(_homeNoticePage, "Torna a Home", "", false, true);
            SetDomainActionCard(_homeNoticePage, "Diagnostica PC", Connection.Status,
                !connected, true);

            var variants = _configurations?.Names;
            var variantsReady = model && variants != null && variants.Length > 0 &&
                QuestConfigurations.IsCurrent(Connection.Client.Model, _configurationModel);
            var chosenVariant = variantsReady ? variants[_configurationIndex % variants.Length] : "";
            SetDomainActionCard(_configurationPage, "Successiva", chosenVariant, false, variantsReady);
            SetDomainActionCard(_configurationPage, "Attiva selezionata", chosenVariant,
                variantsReady && _configurationConfirm == chosenVariant, variantsReady);

            var placement = Display != null && Display.PlacementActive;
            SetDomainActionCard(_viewPage, "Posiziona", Display.Status, placement, model, placement ? 1 : 0);
            SetDomainActionCard(_viewPage, "Conferma", "Altezza " +
                (Display.HeightCalibration * 1000f).ToString("0.#", CultureInfo.InvariantCulture) + " mm",
                placement, placement, placement ? 1 : 0);
            SetDomainActionCard(_viewPage, "Centra CAD", Display.ScaleName, false, model);

            var trianglesKnown = model && Connection.TriangleBudget > 0 && Connection.TriangleCount >= 0;
            var fraction = trianglesKnown ? Mathf.Clamp01((float)Connection.TriangleCount / Connection.TriangleBudget) : -1f;
            var measured = trianglesKnown ? Connection.TriangleCount.ToString(CultureInfo.InvariantCulture) + " / " +
                Connection.TriangleBudget.ToString(CultureInfo.InvariantCulture) : "Dati mesh assenti";
            SetDomainActionCard(_metricsPage, "Torna a Vista", measured, false, trianglesKnown, 0, fraction);

            var section = Connection.Section;
            var plane = model && section != null ? section.Plane : null;
            var hasPlane = plane.HasValue && plane.Value.Axis.HasValue;
            var sectionAxis = hasPlane ? plane.Value.Axis.Value : SectionAxis.X;
            var axisMode = hasPlane ? sectionAxis == SectionAxis.X ? 1 :
                sectionAxis == SectionAxis.Y ? 2 : 3 : 0;
            var offset = plane.HasValue ? plane.Value.OffsetMm.ToString("0.###", CultureInfo.InvariantCulture) + " mm" : "Nessun piano";
            foreach (var axis in SectionAxes)
                SetDomainActionCard(_sectionPage, axis, hasPlane ? "Asse " + sectionAxis : "Asse non definito",
                    hasPlane && axis == sectionAxis.ToString(), hasPlane, axisMode);
            SetDomainActionCard(_sectionPage, "Quota esatta", offset, hasPlane, hasPlane, axisMode);
            SetDomainActionCard(_sectionPage, "Zebra", section != null && section.ZebraEnabled ? "Bande riflesse attive" : "Vista normale",
                section != null && section.ZebraEnabled, model);
            SetDomainActionCard(_sectionPage, "Curvatura", section != null && section.CurvatureEnabled ? "Mappa attiva" : "Mappa superficie",
                section != null && section.CurvatureEnabled, model);
            SetDomainActionCard(_sectionPage, "Bande →", section != null ? (section.CurvatureEnabled
                ? section.CurvatureMaximumPerMm.ToString("G3", CultureInfo.InvariantCulture) + " 1/mm" : section.ZebraBands + " bande") : "", false, model);
            SetDomainActionCard(_sectionPage, "Ruota bande", section != null ? (section.CurvatureEnabled
                ? "Scala automatica" : section.ZebraAngleDeg.ToString("0", CultureInfo.InvariantCulture) + "°") : "", false, model);

            var intent = Spatial != null ? Spatial.SelectedIntent : null;
            var hasField = model && intent != null && intent.Parameters.Count > 0;
            var parameter = hasField ? intent.Parameters[_exactParameter % intent.Parameters.Count] : null;
            var numbers = Spatial != null ? Spatial.DraftValues : null;
            if (numbers == null) numbers = intent?.InitialValues;
            var parameterText = "";
            if (parameter != null && numbers != null && numbers.TryGetValue(parameter, out var value))
                parameterText = value.ToString("0.###", CultureInfo.InvariantCulture) + " " + intent.Unit;
            SetDomainActionCard(_editPage, "Parametro →", parameter ?? "Nessun parametro", false, hasField);
            SetDomainActionCard(_editPage, "Valore esatto", parameterText,
                hasField && _pendingExact != null && ReferenceEquals(Spatial.SelectedIntent, _exactIntent), hasField);

            var commandReady = model && Commands != null && !Commands.Busy;
            SetDomainActionCard(_commandPage, "Campo →", Commands != null ? Commands.FieldLabel : "", false,
                commandReady && Commands.SelectedField != null);
            SetDomainActionCard(_commandPage, "Valore", Commands != null ? Commands.FieldValue : "", false,
                commandReady && Commands.SelectedField != null);
            SetDomainActionCard(_commandPage, "Conferma", Commands != null ? Commands.Status : "",
                commandReady && Commands.CanConfirm, commandReady && Commands.CanConfirm);

            var refs = References;
            var form = model && refs != null && refs.IsFormOpen;
            foreach (var newDatum in DatumCreationActions)
                SetDomainActionCard(_referencePage, newDatum, refs != null ? refs.ModeLabel : "",
                    false, model);
            for (var slot = 0; slot < _referenceDatumLabels.Length; slot++)
            {
                var datum = refs?.DatumAt(slot);
                SetDomainActionCard(_referencePage, "Datum pagina " + (slot + 1), datum?.Label ?? "",
                    datum != null && datum.FeatureId == refs.SelectedDatumId,
                    model && datum != null);
            }
            for (var slot = 0; slot < _referenceSourceLabels.Length; slot++)
                SetDomainActionCard(_referencePage, "Sorgente " + (slot + 1),
                    refs != null ? refs.SourceChoiceLabel(slot) : "", false,
                    form && refs.CurrentFieldIsSource);
            SetDomainActionCard(_referencePage, "Valore mm/deg", refs != null ?
                refs.CurrentFieldValue + " " + refs.CurrentFieldUnit : "", false, form);

            var dimension = SketchDimensions != null ? SketchDimensions.Selected : null;
            var dimensionReady = model && SketchDimensions != null && !SketchDimensions.Busy && dimension != null;
            SetDomainActionCard(_sketchPage, "Quota →", dimension != null ? dimension.Kind + " · " +
                dimension.ConstraintId : "Nessuna quota", dimensionReady, dimensionReady);
            SetDomainActionCard(_sketchPage, "Valore esatto", dimensionReady ?
                SketchDimensions.Value.ToString("0.###", CultureInfo.InvariantCulture) + " " + dimension.Unit : "",
                dimensionReady, dimensionReady);
            SetDomainActionCard(_sketchPage, "Conferma", SketchDimensions != null ? SketchDimensions.Status : "",
                false, dimensionReady);

            var voiceReady = Voice != null && Voice.Configured;
            var micState = !voiceReady ? 0 : Voice.Recording ? 1 : Voice.Busy ? 2 : 0;
            SetDomainActionCard(_voicePage, "Parla / Invia", Voice != null ?
                Voice.Recording ? "Microfono attivo" : "" : "", micState == 1, voiceReady, micState);
            SetDomainActionCard(_voicePage, "Stop", "", false,
                voiceReady && Voice.Busy, micState);
        }
        // Legacy normalized slots below are retained only as a historical
        // offline-verifier reference. They are NOT consulted by OperationControl:
        // real hit targets now come from individual action-keyed compositions.
        // Coordinates are panel-content local and independent of constructor XYZ.
        // Explicit workflow footprint: zone-local control count, each index has
        // its own lane and task role. Unlike a global columns layout, per-zone
        // patterns can have asymmetric wide primary actions and compact choices.
        // Each operation has a named spatial role in its actual tool workflow.
        // Slots describe independent control islands, not a generic row engine.
        static Vector4[] PerWorkflowControlGeometry(string page, int zone)
        {
            switch (page)
            {
                case "PC locali": return zone == 0 ? new[] {new Vector4(0,.30f,1,.18f),new Vector4(0,.08f,1,.18f),new Vector4(0,-.14f,1,.18f),new Vector4(0,-.36f,1,.18f)} : zone == 1 ? new[] {new Vector4(-.26f,0,.44f,.60f),new Vector4(.26f,0,.44f,.60f)} : new[] {new Vector4(0,0,.90f,.70f)};
                case "Advanced PC diagnostics": return zone == 0 ? new[] {new Vector4(0,.25f,1,.25f),new Vector4(-.28f,-.22f,.43f,.26f),new Vector4(.28f,-.22f,.43f,.26f)} : zone == 1 ? new[] {new Vector4(-.33f,0,.28f,.62f),new Vector4(0,0,.28f,.62f),new Vector4(.33f,0,.28f,.62f)} : zone == 2 ? new[] {new Vector4(-.26f,.23f,.44f,.30f),new Vector4(.26f,.23f,.44f,.30f),new Vector4(-.26f,-.25f,.44f,.30f),new Vector4(.26f,-.25f,.44f,.30f)} : new[] {new Vector4(-.26f,0,.44f,.60f),new Vector4(.26f,0,.44f,.60f)};
                case "Home action status": return new[] {new Vector4(-.265f,0,.45f,.68f),new Vector4(.27f,0,.43f,.68f)}; // outcome: home versus diagnostic
                case "CAD configurations": return zone == 0 ? new[] {new Vector4(-.27f,0,.46f,.67f),new Vector4(.27f,0,.42f,.67f)} : new[] {new Vector4(0,0,.82f,.76f)}; // browse, activate, leave
                case "Display controls": return zone == 0 ? new[] {new Vector4(-.26f,0,.44f,.60f),new Vector4(.26f,0,.44f,.60f)} : zone == 1 ? new[] {new Vector4(-.27f,.26f,.43f,.29f),new Vector4(.27f,.26f,.43f,.29f),new Vector4(-.35f,-.26f,.25f,.29f),new Vector4(-.11f,-.26f,.20f,.29f),new Vector4(.12f,-.26f,.20f,.29f),new Vector4(.35f,-.26f,.20f,.29f)} : zone == 2 ? new[] {new Vector4(-.37f,.34f,.22f,.22f),new Vector4(-.12f,.34f,.22f,.22f),new Vector4(.12f,.34f,.22f,.22f),new Vector4(.37f,.34f,.22f,.22f),new Vector4(-.25f,-.03f,.44f,.24f),new Vector4(.25f,-.03f,.44f,.24f),new Vector4(-.25f,-.38f,.44f,.24f),new Vector4(.25f,-.38f,.44f,.24f)} : new[] {new Vector4(-.34f,.30f,.29f,.26f),new Vector4(0,.30f,.29f,.26f),new Vector4(.34f,.30f,.29f,.26f),new Vector4(-.34f,-.30f,.29f,.26f),new Vector4(0,-.30f,.29f,.26f),new Vector4(.34f,-.30f,.29f,.26f)};
                case "Optional diagnostics": return new[] {new Vector4(.03f,0,.82f,.72f)}; // metrics -> scene
                case "Section view": return zone == 0 ? new[] {new Vector4(0,0,.90f,.70f)} : zone == 1 ? new[] {new Vector4(-.33f,.33f,.28f,.24f),new Vector4(0,.33f,.28f,.24f),new Vector4(.33f,.33f,.28f,.24f),new Vector4(-.25f,-.08f,.43f,.24f),new Vector4(.25f,-.08f,.43f,.24f),new Vector4(0,-.43f,.76f,.22f)} : zone == 2 ? new[] {new Vector4(-.26f,.32f,.44f,.20f),new Vector4(.26f,.32f,.44f,.20f),new Vector4(-.26f,0,.44f,.20f),new Vector4(.26f,0,.44f,.20f),new Vector4(-.26f,-.32f,.44f,.20f),new Vector4(.26f,-.32f,.44f,.20f)} : new[] {new Vector4(-.26f,0,.44f,.60f),new Vector4(.26f,0,.44f,.60f)};
                case "Exact CAD editing": return zone == 0 ? new[] {new Vector4(-.25f,0,.47f,.66f),new Vector4(.27f,0,.43f,.66f)} : zone == 1 ? new[] {new Vector4(-.26f,0,.48f,.72f),new Vector4(.27f,0,.42f,.72f)} : new[] {new Vector4(-.27f,.26f,.43f,.28f),new Vector4(.27f,.26f,.43f,.28f),new Vector4(0,-.30f,.66f,.32f)}; // owner, value/snap, commit exit
                case "Canonical context actions": return zone == 0 ? new[] {new Vector4(-.27f,0,.45f,.66f),new Vector4(.27f,0,.45f,.66f)} : zone == 1 ? new[] {new Vector4(-.27f,0,.42f,.70f),new Vector4(.25f,0,.49f,.70f)} : new[] {new Vector4(-.27f,.28f,.44f,.28f),new Vector4(.27f,.28f,.44f,.28f),new Vector4(-.25f,-.30f,.44f,.28f),new Vector4(.25f,-.30f,.44f,.28f)}; // command, field, history/navigation
                case "Riferimenti CAD": return zone == 0 ? new[] {new Vector4(-.26f,.26f,.44f,.28f),new Vector4(.26f,.26f,.44f,.28f),new Vector4(0,-.30f,.76f,.28f)} : zone == 1 ? new[] {new Vector4(-.26f,.41f,.44f,.19f),new Vector4(.26f,.41f,.44f,.19f),new Vector4(-.26f,.14f,.44f,.19f),new Vector4(.26f,.14f,.44f,.19f),new Vector4(-.26f,-.14f,.44f,.19f),new Vector4(.26f,-.14f,.44f,.19f),new Vector4(-.26f,-.41f,.44f,.19f),new Vector4(.26f,-.41f,.44f,.19f)} : zone == 2 || zone == 3 ? new[] {new Vector4(-.26f,.34f,.44f,.24f),new Vector4(.26f,.34f,.44f,.24f),new Vector4(-.26f,0,.44f,.24f),new Vector4(.26f,0,.44f,.24f),new Vector4(-.26f,-.34f,.44f,.24f),new Vector4(.26f,-.34f,.44f,.24f)} : new[] {new Vector4(0,0,.90f,.70f)};
                case "Canonical sketch dimensions": return zone == 0 ? new[] {new Vector4(-.26f,0,.45f,.66f),new Vector4(.27f,0,.45f,.66f)} : zone == 1 ? new[] {new Vector4(-.26f,0,.47f,.72f),new Vector4(.28f,0,.41f,.72f)} : zone == 2 ? new[] {new Vector4(-.26f,.25f,.44f,.28f),new Vector4(.26f,.25f,.44f,.28f),new Vector4(0,-.31f,.79f,.30f)} : new[] {new Vector4(-.27f,0,.43f,.64f),new Vector4(.27f,0,.44f,.64f)}; // dimension, input, history, CAD routing
                case "Hermes voice": return zone == 0 ? new[] {new Vector4(-.225f,0,.54f,.73f),new Vector4(.32f,0,.30f,.73f)} : new[] {new Vector4(-.25f,0,.46f,.60f),new Vector4(.25f,0,.46f,.60f)};
                case "Contesto Hermes": return zone == 0 ? new[] {new Vector4(-.125f,0,.75f,.74f),new Vector4(.385f,0,.22f,.60f)} : new[] {new Vector4(-.25f,0,.46f,.60f),new Vector4(.25f,0,.46f,.60f)};
                default: throw new InvalidOperationException("Unknown operation workflow: " + page);
            }
        }

        // Action identity determines placement; construction sequence is only a count assertion.
        static string[] WorkflowActionIds(string page, int zone)
        {
            switch (page)
            {
                case "PC locali":
                    if (zone == 0) return new[] { "PC 1", "PC 2", "PC 3", "PC 4" };
                    if (zone == 1) return new[] { "Altri PC", "Riprova" };
                    return new[] { "Diagnostica avanzata" };
                case "Advanced PC diagnostics":
                    if (zone == 0) return new[] { "Endpoint manuale", "Codice manuale", "Connetti" };
                    if (zone == 1) return new[] { "Corpo", "Faccia", "Bordo" };
                    if (zone == 2) return new[] { "Invia target al PC", "Centra", "Propriet\u00e0 fisiche", "Spessore minimo" };
                    return new[] { "Dimentica PC", "Vista MR / scale" };
                case "Home action status":
                    return new[] { "Torna a Home", "Diagnostica PC" };
                case "CAD configurations":
                    if (zone == 0) return new[] { "Aggiorna", "Successiva" };
                    if (zone == 1) return new[] { "Attiva selezionata" };
                    return new[] { "Indietro" };
                case "Display controls":
                    if (zone == 0) return new[] { "MR / VR", "Mano Auto", "Rileva tavolo", "Configura stanza" };
                    if (zone == 1) return new[] { "Posiziona", "Centra CAD", "Conferma", "Annulla", "\u22125", "+5" };
                    if (zone == 2) return new[] { "1:10", "1:5", "1:1", "2:1", "10:1", "Fit", "Ispezione", "Normale" };
                    return new[] { "Condividi selezione", "UI L/R", "Centra UI", "Sezione", "Riferimenti", "Configurazioni" };
                case "Optional diagnostics":
                    return new[] { "Torna a Vista" };
                case "Section view":
                    if (zone == 0) return new[] { "Attiva sezione" };
                    if (zone == 1) return new[] { "X", "Y", "Z", "\u22125 mm", "+5 mm", "Quota esatta" };
                    if (zone == 2) return new[] { "Zebra", "Curvatura", "Inverti", "Azzera", "Bande →", "Ruota bande" };
                    return new[] { "Indietro", "Metriche" };
                case "Exact CAD editing":
                    if (zone == 0) return new[] { "Feature \u2192", "Parametro \u2192" };
                    if (zone == 1) return new[] { "Valore esatto", "Snap 0.1mm / 5deg" };
                    return new[] { "Annulla modifica", "Azioni CAD", "Vista MR" };
                case "Canonical context actions":
                    if (zone == 0) return new[] { "Azione \u2192", "Campo \u2192" };
                    if (zone == 1) return new[] { "Valore", "Conferma" };
                    return new[] { "Undo", "Redo", "Accoppiamenti", "Quote sketch" };
                case "Riferimenti CAD":
                    if (zone == 0) return new[] { "Nuovo piano", "Nuovo asse", "Nuovo punto" };
                    if (zone == 1) return new[] { "Datum pagina 1", "Datum pagina 2", "Datums \u2190", "Datums \u2192", "Ispeziona", "Modifica", "Sketch piano", "Indietro" };
                    if (zone == 2) return new[] { "Campo \u2190", "Campo \u2192", "Sorgente 1", "Sorgente 2", "Fonti \u2190", "Fonti \u2192" };
                    if (zone == 3) return new[] { "Tipo \u2192", "Costruzione \u2192", "Valore mm/deg", "Valore \u2192", "Conferma", "Annulla" };
                    return new[] { "Vista MR" };
                case "Canonical sketch dimensions":
                    if (zone == 0) return new[] { "Sketch \u2192", "Quota \u2192" };
                    if (zone == 1) return new[] { "Valore esatto", "Conferma" };
                    if (zone == 2) return new[] { "Annulla", "Undo", "Simmetrie / quote" };
                    return new[] { "Azioni CAD", "Modifica CAD" };
                case "Hermes voice":
                    if (zone == 0) return new[] { "Parla / Invia", "Stop" };
                    return new[] { "Home", "Contesto" };
                case "Contesto Hermes":
                    if (zone == 0) return new[] { "Arma punto", "Cancella" };
                    return new[] { "Raccolta voce", "Voce singola" };
                default: throw new InvalidOperationException("Unmapped Quest workflow: " + page);
            }
        }
        static Vector3 PlaceAction(string page, int zone, string actionId, int count,
            float contentWidth, float panelHeight, out float hitWidth, out float hitHeight)
        {
            var ids = WorkflowActionIds(page, zone);
            var index = Array.IndexOf(ids, actionId);
            var slots = PerWorkflowControlGeometry(page, zone);
            if (ids.Length != count || slots.Length != count || index < 0)
                throw new InvalidOperationException("Unmapped Quest action ID: " + page + " / " + actionId);
            var slot = slots[index];
            hitWidth = contentWidth * slot.z;
            hitHeight = panelHeight * .68f * slot.w;
            if (hitHeight <= .008f || hitWidth <= .025f)
                throw new InvalidOperationException("Invalid semantic action geometry: " + page + " / " + zone);
            var y = panelHeight * (-.11f + slot.y * .68f);
            y = Mathf.Clamp(y, -panelHeight * .45f + hitHeight * .5f,
                panelHeight * .23f - hitHeight * .5f);
            return new Vector3(contentWidth * slot.x, y, -.012f);
        }

        // Canonical interactive geometry is now specified by semantic ACTION
        // ID, never its construction ordinal or an interchangeable slot.
        // x and width are fractions of panel.Content width; y and height are
        // fractions of the owning panel's FULL height.  Its usable action band
        // is y [-.45,+.23]. Every rectangle owns ONE original QuestButton.
        enum ControlCompositionKind { PeerCard, Discovery, Pair, Selector, FieldWell,
            Commit, Placement, Scale, Section, Datum, Dimension, History, Console, Route }
        readonly struct AuthoredControl
        {
            public readonly Vector4 Bounds;
            public readonly ControlCompositionKind Kind;
            public AuthoredControl(float x, float y, float width, float height,
                ControlCompositionKind kind)
            {
                Bounds = new Vector4(x, y, width, height);
                Kind = kind;
            }
        }
        static AuthoredControl Card(float x, float y, float width, float height,
            ControlCompositionKind kind)
            => new AuthoredControl(x, y, width, height, kind);

        static AuthoredControl AuthoredActionComposition(string page, string action)
        {
            // Controls in each workflow are designed for different purposes:
            // device rows, numeric wells, dominant commit cards, section-axis
            // pickers, history lanes, and a recording console. No generic grid.
            switch (page)
            {
                case "PC locali":
                    if (action.StartsWith("PC ", StringComparison.Ordinal) &&
                        int.TryParse(action.Substring(3), out var peer) && peer >= 1 && peer <= 4)
                        return peer == 1 ? Card(0f, .091f, .96f, .265f, ControlCompositionKind.PeerCard) :
                            Card(0f, -.119f - (peer - 2) * .135f, .96f, .117f, ControlCompositionKind.PeerCard);
                    if (action == "Altri PC") return Card(-.25f,-.105f,.46f,.45f,ControlCompositionKind.Discovery);
                    if (action == "Riprova") return Card(.25f,-.105f,.46f,.45f,ControlCompositionKind.Discovery);
                    if (action == "Diagnostica avanzata") return Card(0,-.115f,.94f,.59f,ControlCompositionKind.Route);
                    break;
                case "Advanced PC diagnostics":
                    if (action == "Endpoint manuale") return Card(0,.025f,.95f,.38f,ControlCompositionKind.FieldWell);
                    if (action == "Codice manuale") return Card(-.265f,-.335f,.43f,.22f,ControlCompositionKind.FieldWell);
                    if (action == "Connetti") return Card(.25f,-.335f,.48f,.22f,ControlCompositionKind.Pair);
                    if (action == "Corpo") return Card(-.33f,-.11f,.29f,.54f,ControlCompositionKind.Selector);
                    if (action == "Faccia") return Card(0,-.11f,.29f,.54f,ControlCompositionKind.Selector);
                    if (action == "Bordo") return Card(.33f,-.11f,.29f,.54f,ControlCompositionKind.Selector);
                    if (action == "Invia target al PC") return Card(-.255f,.09f,.46f,.22f,ControlCompositionKind.Commit);
                    if (action == "Proprietà fisiche") return Card(-.255f,-.25f,.46f,.29f,ControlCompositionKind.FieldWell);
                    if (action == "Centra") return Card(.255f,.09f,.46f,.22f,ControlCompositionKind.Placement);
                    if (action == "Spessore minimo") return Card(.255f,-.25f,.46f,.29f,ControlCompositionKind.FieldWell);
                    if (action == "Dimentica PC") return Card(-.255f,-.11f,.45f,.52f,ControlCompositionKind.Route);
                    if (action == "Vista MR / scale") return Card(.255f,-.11f,.45f,.52f,ControlCompositionKind.Route);
                    break;
                case "Home action status":
                    if (action == "Torna a Home") return Card(-.25f,-.11f,.46f,.60f,ControlCompositionKind.Route);
                    if (action == "Diagnostica PC") return Card(.25f,-.11f,.46f,.60f,ControlCompositionKind.Discovery);
                    break;
                case "CAD configurations":
                    if (action == "Aggiorna") return Card(-.325f,-.11f,.31f,.60f,ControlCompositionKind.Discovery);
                    if (action == "Successiva") return Card(.165f,-.11f,.64f,.60f,ControlCompositionKind.Selector);
                    if (action == "Attiva selezionata") return Card(0,-.11f,.96f,.60f,ControlCompositionKind.Commit);
                    if (action == "Indietro") return Card(0,-.11f,.86f,.57f,ControlCompositionKind.Route);
                    break;
                case "Display controls":
                    if (action == "MR / VR") return Card(-.25f,.085f,.46f,.22f,ControlCompositionKind.Selector);
                    if (action == "Mano Auto") return Card(.25f,.085f,.46f,.22f,ControlCompositionKind.Selector);
                    if (action == "Rileva tavolo") return Card(-.25f,-.275f,.46f,.22f,ControlCompositionKind.Discovery);
                    if (action == "Configura stanza") return Card(.25f,-.275f,.46f,.22f,ControlCompositionKind.Discovery);
                    if (action == "Posiziona") return Card(-.25f,.102f,.46f,.24f,ControlCompositionKind.Placement);
                    if (action == "Centra CAD") return Card(.25f,.102f,.46f,.24f,ControlCompositionKind.Placement);
                    if (action == "Conferma") return Card(-.348f,-.305f,.284f,.25f,ControlCompositionKind.Commit);
                    if (action == "Annulla") return Card(-.087f,-.305f,.218f,.25f,ControlCompositionKind.Route);
                    if (action == "−5") return Card(.165f,-.305f,.19f,.25f,ControlCompositionKind.FieldWell);
                    if (action == "+5") return Card(.393f,-.305f,.188f,.25f,ControlCompositionKind.FieldWell);
                    if (action == "1:10" || action == "1:5" || action == "1:1" || action == "2:1" || action == "10:1")
                        return Card(action == "1:10" ? -.396f : action == "1:5" ? -.198f :
                            action == "1:1" ? 0f : action == "2:1" ? .198f : .396f,
                            .140f,.186f,.16f,ControlCompositionKind.Scale);
                    if (action == "Fit") return Card(0,-.105f,.92f,.25f,ControlCompositionKind.Placement);
                    if (action == "Ispezione" || action == "Normale")
                        return Card(action == "Ispezione" ? -.25f : .25f,-.343f,.46f,.19f,ControlCompositionKind.Selector);
                    if (action == "Condividi selezione") return Card(0,.151f,.95f,.14f,ControlCompositionKind.Commit);
                    if (action == "UI L/R" || action == "Centra UI" || action == "Sezione")
                        return Card(action == "UI L/R" ? -.33f : action == "Centra UI" ? 0f : .33f,
                            -.070f,.30f,.21f,ControlCompositionKind.Route);
                    if (action == "Riferimenti" || action == "Configurazioni")
                        return Card(action == "Riferimenti" ? -.25f : .25f,-.343f,.46f,.20f,ControlCompositionKind.Route);
                    break;
                case "Optional diagnostics":
                    if (action == "Torna a Vista") return Card(0,-.11f,.96f,.59f,ControlCompositionKind.Route);
                    break;
                case "Section view":
                    if (action == "Attiva sezione") return Card(0,-.11f,.95f,.59f,ControlCompositionKind.Section);
                    if (action == "Zebra" || action == "Curvatura") return Card(action == "Zebra" ? -.25f : .25f,.115f,.45f,.20f,ControlCompositionKind.Selector);
                    if (action == "X" || action == "Y" || action == "Z")
                        return Card(action == "X" ? -.33f : action == "Y" ? 0f : .33f,
                            .125f,.29f,.18f,ControlCompositionKind.Section);
                    if (action == "−5 mm" || action == "+5 mm")
                        return Card(action == "−5 mm" ? -.25f : .25f,-.104f,.46f,.21f,ControlCompositionKind.FieldWell);
                    if (action == "Quota esatta") return Card(0,-.327f,.94f,.22f,ControlCompositionKind.FieldWell);
                    if (action == "Inverti" || action == "Azzera")
                        return Card(action == "Inverti" ? -.25f : .25f,-.135f,.45f,.20f,ControlCompositionKind.Section);
                    if (action == "Bande →" || action == "Ruota bande")
                        return Card(action == "Bande →" ? -.25f : .25f,-.35f,.45f,.20f,ControlCompositionKind.Selector);
                    if (action == "Indietro" || action == "Metriche")
                        return Card(action == "Indietro" ? -.25f : .25f,-.11f,.46f,.54f,ControlCompositionKind.Route);
                    break;
                case "Exact CAD editing":
                    if (action == "Feature →") return Card(0,.055f,.92f,.34f,ControlCompositionKind.Selector);
                    if (action == "Parametro →") return Card(0,-.289f,.92f,.29f,ControlCompositionKind.FieldWell);
                    if (action == "Valore esatto") return Card(0,.04f,.94f,.37f,ControlCompositionKind.FieldWell);
                    if (action == "Snap 0.1mm / 5deg") return Card(0,-.313f,.92f,.25f,ControlCompositionKind.Selector);
                    if (action == "Annulla modifica") return Card(-.25f,.085f,.46f,.25f,ControlCompositionKind.Route);
                    if (action == "Azioni CAD") return Card(.25f,.085f,.46f,.25f,ControlCompositionKind.Route);
                    if (action == "Vista MR") return Card(0,-.319f,.74f,.22f,ControlCompositionKind.Route);
                    break;
                case "Canonical context actions":
                    if (action == "Azione →") return Card(0,.04f,.94f,.37f,ControlCompositionKind.Selector);
                    if (action == "Campo →") return Card(0,-.313f,.92f,.25f,ControlCompositionKind.FieldWell);
                    if (action == "Valore") return Card(0,.04f,.94f,.37f,ControlCompositionKind.FieldWell);
                    if (action == "Conferma") return Card(0,-.313f,.92f,.25f,ControlCompositionKind.Commit);
                    if (action == "Undo") return Card(-.25f,.092f,.46f,.24f,ControlCompositionKind.History);
                    if (action == "Redo") return Card(.25f,.092f,.46f,.24f,ControlCompositionKind.History);
                    if (action == "Accoppiamenti") return Card(-.25f,-.32f,.46f,.22f,ControlCompositionKind.Route);
                    if (action == "Quote sketch") return Card(.25f,-.32f,.46f,.22f,ControlCompositionKind.Route);
                    break;
                case "Riferimenti CAD":
                    if (action == "Nuovo piano") return Card(-.25f,.098f,.46f,.25f,ControlCompositionKind.Datum);
                    if (action == "Nuovo asse") return Card(.25f,.098f,.46f,.25f,ControlCompositionKind.Datum);
                    if (action == "Nuovo punto") return Card(0,-.312f,.90f,.23f,ControlCompositionKind.Datum);
                    if (action == "Datum pagina 1") return Card(-.25f,-.010f,.46f,.44f,ControlCompositionKind.PeerCard);
                    if (action == "Datum pagina 2") return Card(.25f,.120f,.46f,.20f,ControlCompositionKind.PeerCard);
                    if (action == "Datums ←" || action == "Datums →")
                        return Card(action == "Datums ←" ? .13f : .37f,-.110f,.21f,.18f,ControlCompositionKind.Discovery);
                    if (action == "Ispeziona" || action == "Modifica" ||
                        action == "Sketch piano" || action == "Indietro")
                        return Card(action == "Ispeziona" ? -.36f : action == "Modifica" ? -.12f :
                            action == "Sketch piano" ? .12f : .36f,
                            -.351f,.22f,.18f,action == "Indietro" ? ControlCompositionKind.Route : ControlCompositionKind.Datum);
                    if (action == "Campo ←" || action == "Campo →")
                        return Card(action == "Campo ←" ? -.25f : .25f,.125f,.46f,.18f,ControlCompositionKind.Selector);
                    if (action == "Sorgente 1" || action == "Sorgente 2")
                        return Card(action == "Sorgente 1" ? -.25f : .25f,-.111f,.46f,.18f,ControlCompositionKind.Datum);
                    if (action == "Fonti ←" || action == "Fonti →")
                        return Card(action == "Fonti ←" ? -.25f : .25f,-.346f,.46f,.18f,ControlCompositionKind.Discovery);
                    if (action == "Tipo →" || action == "Costruzione →")
                        return Card(action == "Tipo →" ? -.25f : .25f,.125f,.46f,.18f,ControlCompositionKind.Datum);
                    if (action == "Valore mm/deg" || action == "Valore →")
                        return Card(action == "Valore mm/deg" ? -.25f : .25f,-.111f,.46f,.18f,ControlCompositionKind.FieldWell);
                    if (action == "Conferma" || action == "Annulla")
                        return Card(action == "Conferma" ? -.25f : .25f,-.346f,.46f,.18f,
                            action == "Conferma" ? ControlCompositionKind.Commit : ControlCompositionKind.Route);
                    if (action == "Vista MR") return Card(0,-.11f,.95f,.59f,ControlCompositionKind.Route);
                    break;
                case "Canonical sketch dimensions":
                    if (action == "Sketch →") return Card(-.26f,-.11f,.46f,.59f,ControlCompositionKind.Selector);
                    if (action == "Quota →") return Card(.26f,-.11f,.46f,.59f,ControlCompositionKind.Dimension);
                    if (action == "Valore esatto") return Card(0,.04f,.94f,.37f,ControlCompositionKind.FieldWell);
                    if (action == "Conferma") return Card(0,-.313f,.92f,.25f,ControlCompositionKind.Commit);
                    if (action == "Annulla") return Card(-.25f,.085f,.45f,.24f,ControlCompositionKind.Route);
                    if (action == "Undo") return Card(.25f,.085f,.45f,.24f,ControlCompositionKind.History);
                    if (action == "Simmetrie / quote") return Card(0,-.325f,.91f,.22f,ControlCompositionKind.Dimension);
                    if (action == "Azioni CAD") return Card(-.25f,-.11f,.46f,.55f,ControlCompositionKind.Route);
                    if (action == "Modifica CAD") return Card(.25f,-.11f,.46f,.55f,ControlCompositionKind.Route);
                    break;
                case "Hermes voice":
                    if (action == "Parla / Invia") return Card(-.105f,-.11f,.75f,.60f,ControlCompositionKind.Console);
                    if (action == "Stop") return Card(.39f,-.11f,.19f,.60f,ControlCompositionKind.Commit);
                    if (action == "Home") return Card(-.25f,-.11f,.46f,.60f,ControlCompositionKind.Route);
                    if (action == "Contesto") return Card(.25f,-.11f,.46f,.60f,ControlCompositionKind.Route);
                    break;
                case "Contesto Hermes":
                    if (action == "Arma punto") return Card(-.125f,-.11f,.75f,.60f,ControlCompositionKind.Console);
                    if (action == "Cancella") return Card(.385f,-.11f,.22f,.60f,ControlCompositionKind.Commit);
                    if (action == "Raccolta voce") return Card(-.25f,-.11f,.46f,.60f,ControlCompositionKind.Route);
                    if (action == "Voce singola") return Card(.25f,-.11f,.46f,.60f,ControlCompositionKind.Route);
                    break;
            }
            throw new InvalidOperationException("Quest semantic action footprint missing: " + page + " / " + action);
        }

        static Vector3 ComposedActionPosition(string page, int zone, string action,
            float contentWidth, float panelHeight, out float hitWidth, out float hitHeight,
            out ControlCompositionKind kind)
        {
            if (Array.IndexOf(WorkflowActionIds(page, zone), action) < 0)
                throw new InvalidOperationException("Wrong Quest action ownership: " + page + " / " + zone + " / " + action);
            var spec = AuthoredActionComposition(page, action);
            kind = spec.Kind;
            var box = spec.Bounds;
            if (box.z <= 0f || box.w <= 0f ||
                box.x - box.z * .5f < -.5001f || box.x + box.z * .5f > .5001f ||
                box.y - box.w * .5f < -.4501f || box.y + box.w * .5f > .2301f)
                throw new InvalidOperationException("Quest authored card outside content: " + page + " / " + action);
            hitWidth = contentWidth * box.z;
            hitHeight = panelHeight * box.w;
            if (hitWidth <= .025f || hitHeight <= .008f)
                throw new InvalidOperationException("Quest authored card too small: " + page + " / " + action);
            return new Vector3(contentWidth * box.x, panelHeight * box.y, -.012f);
        }

        static void ValidateComposedFootprints()
        {
            // Validate the NEW actual layout, not the obsolete slot tables.
            // This checks every action identity, its physically allocated
            // control area and all pairwise intersections BEFORE raycasting.
            var pageNames = new[] { "PC locali", "Advanced PC diagnostics", "Home action status",
                "CAD configurations", "Display controls", "Optional diagnostics", "Section view",
                "Exact CAD editing", "Canonical context actions", "Riferimenti CAD",
                "Canonical sketch dimensions", "Hermes voice", "Contesto Hermes" };
            var checkedActions = 0;
            foreach (var page in pageNames)
            {
                var capacity = 0;
                var largeRealHitboxes = 0;
                var zoneNames = AuthoredZoneNames(page);
                for (var zone = 0; zone < zoneNames.Length; zone++)
                {
                    var ids = WorkflowActionIds(page, zone);
                    if (ids.Length != SemanticZoneCapacity(page, zone))
                        throw new InvalidOperationException("Invalid Quest action ownership: " + page + " / " + zone);
                    var semantic = SemanticPanelGeometry(page, zone);
                    var inset = Mathf.Min(.018f, semantic.z * .09f);
                    var contentWidth = semantic.z - inset * 2f;
                    var rectangles = new Vector4[ids.Length];
                    for (var i = 0; i < ids.Length; i++)
                    {
                        if (SemanticZone(page, ids[i]) != zone)
                            throw new InvalidOperationException("Quest action mapped to wrong surface: " + ids[i]);
                        ComposedActionPosition(page, zone, ids[i], contentWidth, semantic.w,
                            out var actualWidth, out var actualHeight, out _);
                        if (actualWidth >= .14f && actualHeight >= .072f)
                            largeRealHitboxes++;
                        rectangles[i] = AuthoredActionComposition(page, ids[i]).Bounds;
                        checkedActions++;
                        for (var j = 0; j < i; j++)
                        {
                            var first = rectangles[j]; var second = rectangles[i];
                            var xIntersection = Mathf.Min(first.x + first.z * .5f, second.x + second.z * .5f) -
                                Mathf.Max(first.x - first.z * .5f, second.x - second.z * .5f);
                            var yIntersection = Mathf.Min(first.y + first.w * .5f, second.y + second.w * .5f) -
                                Mathf.Max(first.y - first.w * .5f, second.y - second.w * .5f);
                            if (xIntersection > .0005f && yIntersection > .0005f)
                                throw new InvalidOperationException("Actual Quest composed cards intersect: " +
                                    page + " zone " + zone + " / " + ids[j] + " and " + ids[i]);
                        }
                    }
                    capacity += ids.Length;
                }
                if (capacity != ExpectedActions(page))
                    throw new InvalidOperationException("Actual Quest composed card count mismatch: " + page);
                if (largeRealHitboxes < 1)
                    throw new InvalidOperationException("Missing original large clickable composition on " + page);
            }
            if (checkedActions != 121)
                throw new InvalidOperationException("Expected 121 actual Quest composed card targets, found " + checkedActions);
        }

        void CreateComposedCardArtwork(TextMesh label, ControlCompositionKind kind, float width, float height)
        {
            if (label == null || width < .044f || height < .016f) return;
            // This is a component of the ORIGINAL full-size clickable card,
            // not a second button. All geometry stays inside its hit target,
            // behind the text and without active primitive colliders.
            var button = label.transform.parent.GetComponentInChildren<QuestButton>();
            if (button == null) return;
            var root = label.transform.parent;
            var center = button.transform.localPosition;
            var m = _instrumentGlass ?? (_instrumentGlass = QuestUi.GlassMaterial(ButtonMaterial));
            var accent = kind == ControlCompositionKind.Commit || kind == ControlCompositionKind.Console ?
                new Color(.23f,.82f,.64f,.72f) :
                kind == ControlCompositionKind.FieldWell || kind == ControlCompositionKind.Dimension ?
                new Color(.94f,.67f,.31f,.71f) :
                kind == ControlCompositionKind.History ? new Color(.55f,.63f,.83f,.55f) :
                new Color(.34f,.73f,.94f,.62f);
            void Layer(string name, float x, float y, float w, float h, Color color)
            {
                var surface = QuestUi.Surface(root, m, kind + " / " + name,
                    new Vector3(center.x + width * x, center.y + height * y, center.z - .0049f),
                    new Vector3(width * w, height * h, .0003f));
                TintInstrument(surface.GetComponent<MeshRenderer>(), color);
                surface.GetComponent<MeshRenderer>().enabled = false;
            }
            switch (kind)
            {
                case ControlCompositionKind.PeerCard:
                    Layer("identity spine",-.455f,0,.019f,.78f,accent);
                    Layer("endpoint separator",0,-.32f,.83f,.011f,accent);
                    break;
                case ControlCompositionKind.Pair:
                    Layer("authenticated path",0,-.35f,.79f,.025f,accent);
                    Layer("identity handshake",.420f,.25f,.035f,.32f,accent);
                    break;
                case ControlCompositionKind.FieldWell:
                    Layer("field underline",0,-.37f,.84f,.025f,accent);
                    Layer("field caret",.390f,-.19f,.018f,.23f,accent);
                    break;
                case ControlCompositionKind.Commit:
                    Layer("commit base",0,-.40f,.86f,.055f,accent);
                    Layer("commit signal",-.420f,0,.025f,.69f,accent);
                    break;
                case ControlCompositionKind.Placement:
                case ControlCompositionKind.Section:
                    Layer("calibration baseline",0,-.38f,.82f,.022f,accent);
                    Layer("datum axis",.375f,.11f,.011f,.38f,accent);
                    break;
                case ControlCompositionKind.Scale:
                case ControlCompositionKind.Selector:
                    Layer("selected choice lane",0,-.39f,.80f,.019f,accent);
                    break;
                case ControlCompositionKind.Dimension:
                    Layer("dimension witness",0,-.38f,.85f,.018f,accent);
                    Layer("dimension end",-.410f,-.30f,.016f,.19f,accent);
                    Layer("dimension end",.410f,-.30f,.016f,.19f,accent);
                    break;
                case ControlCompositionKind.Console:
                    Layer("record console left",-.423f,0,.030f,.78f,accent);
                    Layer("transcript channel",0,-.39f,.84f,.028f,accent);
                    break;
                case ControlCompositionKind.History:
                    Layer("undo timeline",0,-.38f,.77f,.017f,accent);
                    break;
                case ControlCompositionKind.Discovery:
                case ControlCompositionKind.Datum:
                    Layer("discovered selector",-.420f,0,.026f,.64f,accent);
                    break;
                default:
                    Layer("navigation path",0,-.38f,.78f,.017f,accent);
                    break;
            }
        }

        void SetLargeComposedCard(Transform page, string actionId, string field, string realValue,
            bool dataReady, bool selected = false)
        {
            if (page == null || !_contextActions.TryGetValue(page, out var actions) ||
                !actions.TryGetValue(actionId, out var label) || label == null) return;
            if (!label.transform.parent.gameObject.activeInHierarchy)
            {
                _largeCardSnapshots.Remove(label);
                return;
            }
            var state = _contextVisualStates.TryGetValue(label, out var found) ? found : 1;
            var enabled = (state & 1) != 0;
            selected = enabled && (selected || (state & 2) != 0);
            var signature = field + "|" + realValue + "|" + enabled + "|" + selected + "|" + dataReady;
            if (_largeCardSnapshots.TryGetValue(label, out var previous) && previous == signature) return;
            _largeCardSnapshots[label] = signature;
            // Worker8's THREE-LINE composition uses the same real clickable
            // QuestButton; it refuses to expand a short surface or its collider.
            QuestUi.SetLargeActionComposition(label, field, realValue, selected, enabled,
                dataReady ? QuestUi.StatusSeverity.Active : QuestUi.StatusSeverity.Warning);
        }

        void RefreshLargeComposedCards(Kreoda.Session.DiscoveredSessionPc[] peers)
        {
            var online = Connection != null && Connection.Connected;
            var model = online && Connection.Client?.Model != null;

            // One device row is a large one-tap ORIGINAL peer action; the
            // endpoint/PcId are actual discovery identity, never a fake PC.
            var first = peers != null && _pcChoicePage * _pcChoices.Length < peers.Length ?
                peers[_pcChoicePage * _pcChoices.Length] : null;
            SetLargeComposedCard(_pcPage, "PC 1", first?.PcId ?? "PC non rilevato",
                first?.Endpoint != null ? first.Endpoint.Authority : Connection?.Status,
                first != null, AuthenticatedSelectedPc(first));

            var endpoint = string.IsNullOrWhiteSpace(_endpoint) ? Connection?.SavedEndpoint : _endpoint;
            SetLargeComposedCard(_connectionPage, "Endpoint manuale", "ENDPOINT PC",
                string.IsNullOrWhiteSpace(endpoint) ? "Nessun endpoint" : endpoint,
                !string.IsNullOrWhiteSpace(endpoint), online);
            SetLargeComposedCard(_homeNoticePage, "Torna a Home", "ESITO REALE",
                "",
                _homeNotice != null);

            var choices = _configurations?.Names;
            var valid = model && choices != null && choices.Length > 0 &&
                QuestConfigurations.IsCurrent(Connection.Client.Model, _configurationModel);
            var variant = valid ? choices[_configurationIndex % choices.Length] : null;
            SetLargeComposedCard(_configurationPage, "Attiva selezionata", "VARIANTE CAD",
                variant ?? "Non caricata", valid, valid && variant == _configurations.Active);

            // The wide FIT tile is a true live scale-control callback, not a
            // decorative 3D illustration. All five other scale presets remain.
            SetLargeComposedCard(_viewPage, "Fit", "SCALA SPAZIALE",
                Display != null ? Display.ScaleName : "—", model, Display != null && Display.ScaleName == "Fit");
            var validMesh = model && Connection.TriangleCount >= 0 && Connection.TriangleBudget > 0;
            SetLargeComposedCard(_metricsPage, "Torna a Vista", "TRIANGOLI / BUDGET",
                validMesh ? Connection.TriangleCount.ToString(CultureInfo.InvariantCulture) + " / " +
                    Connection.TriangleBudget.ToString(CultureInfo.InvariantCulture) : "Nessuna mesh corrente",
                validMesh);

            var section = Connection.Section;
            var hasPlane = model && section != null && section.Plane.HasValue;
            SetLargeComposedCard(_sectionPage, "Attiva sezione", "PIANO DI TAGLIO",
                hasPlane ? section.Plane.Value.OffsetMm.ToString("0.###", CultureInfo.InvariantCulture) +
                    " mm · " + (section.Plane.Value.Axis.HasValue ? section.Plane.Value.Axis.Value.ToString() : "asse assente") :
                    section != null ? section.Status : "Nessuna sessione CAD",
                model && section != null, section != null && section.Enabled);

            var intent = model && Spatial != null ? Spatial.SelectedIntent : null;
            SetLargeComposedCard(_editPage, "Feature →", "FEATURE CAD",
                intent?.FeatureId ?? "Nessuna feature", intent != null);
            var hasParameter = intent != null && intent.Parameters.Count > 0;
            var parameterName = hasParameter ? intent.Parameters[_exactParameter % intent.Parameters.Count] : null;
            var draft = Spatial != null ? Spatial.DraftValues : null;
            if (draft == null) draft = intent?.InitialValues;
            var fieldValue = hasParameter && draft != null && draft.TryGetValue(parameterName, out var value) ?
                value.ToString("0.###", CultureInfo.InvariantCulture) + " " + intent.Unit : "Valore non disponibile";
            SetLargeComposedCard(_editPage, "Valore esatto", parameterName ?? "PARAMETRO CAD",
                fieldValue, hasParameter);

            SetLargeComposedCard(_commandPage, "Azione →", "COMANDO CAD",
                model && Commands != null ? Commands.CommandLabel : "Nessuna azione", model && Commands != null);
            SetLargeComposedCard(_commandPage, "Valore", Commands != null ? Commands.FieldLabel : "CAMPO CAD",
                model && Commands != null ? Commands.FieldValue : "Nessun valore", model && Commands != null);

            var datum = model ? References?.DatumAt(0) : null;
            SetLargeComposedCard(_referencePage, "Datum pagina 1",
                datum?.Kind ?? "DATUM", datum?.FeatureId ?? "Nessun datum",
                datum != null && References.IsHome,
                datum != null && datum.FeatureId == References.SelectedDatumId);

            var dimension = model && SketchDimensions != null ? SketchDimensions.Selected : null;
            SetLargeComposedCard(_sketchPage, "Valore esatto", dimension?.Kind ?? "QUOTA CAD",
                dimension != null ? SketchDimensions.Value.ToString("0.###", CultureInfo.InvariantCulture) +
                    " " + dimension.Unit : "Nessuna quota",
                dimension != null && !SketchDimensions.Busy);

            var voiceReady = Voice != null && Voice.Configured;
            SetLargeComposedCard(_voicePage, "Parla / Invia",
                Voice == null ? "HERMES" : Voice.Recording ? "REGISTRAZIONE" :
                    Voice.Busy ? "ELABORAZIONE" : voiceReady ? "PRONTO" : "IN ATTESA",
                Voice != null && Voice.Recording ? "Microfono attivo" : Voice != null && !voiceReady ? "IN ATTESA" : "",
                voiceReady, Voice != null && Voice.Recording);
        }
        // Structural preflight of nonmodal workstations: overlapping panel
        // surfaces are now a source error instead of a reason to erase glass.
        void ReconcilePanelBackdrops(Transform page)
        {
            if (page == null || page == _referencePage) return;
            var zones = AuthoredZoneNames(page.name).Length;
            for (var i = 0; i < zones; i++)
                for (var j = i + 1; j < zones; j++)
                {
                    var first = SemanticPanelGeometry(page.name, i);
                    var second = SemanticPanelGeometry(page.name, j);
                    if (Mathf.Abs(first.x - second.x) < (first.z + second.z) * .5f &&
                        Mathf.Abs(first.y - second.y) < (first.w + second.w) * .5f)
                        throw new InvalidOperationException("Overlapping Quest functional surfaces: " + page.name);
                }
        }
        static int SemanticZoneCapacity(string page, int zone)
        {
            switch (page)
            {
                case "PC locali": return new[] {4, 2, 1}[zone];
                case "Advanced PC diagnostics": return new[] {3, 3, 4, 2}[zone];
                case "Home action status": return 2;
                case "CAD configurations": return new[] {2, 1, 1}[zone];
                case "Display controls": return new[] {4, 6, 8, 6}[zone];
                case "Optional diagnostics": return 1;
                case "Section view": return new[] {1, 6, 6, 2}[zone];
                case "Exact CAD editing": return new[] {2, 2, 3}[zone];
                case "Canonical context actions": return new[] {2, 2, 4}[zone];
                case "Riferimenti CAD": return new[] {3, 8, 6, 6, 1}[zone];
                case "Canonical sketch dimensions": return new[] {2, 2, 3, 2}[zone];
                case "Hermes voice": return new[] {2, 2}[zone];
                case "Contesto Hermes": return new[] {2, 2}[zone];
                default: return 0;
            }
        }
        TextMesh OperationControl(string text, Vector3 position, float width, Action action,
            float height = .039f, float textSize = .014f)
        {
            var page = _content;
            if (!_authoredActionIndex.TryGetValue(page, out var sequence)) sequence = 0;
            _authoredActionIndex[page] = sequence + 1;
            var capacity = ExpectedActions(page.name);
            if (capacity == 0 || sequence >= capacity)
                throw new InvalidOperationException("Unmapped Quest control: " + page.name + " / " + text);
            var names = AuthoredZoneNames(page.name);
            var groupIndex = SemanticZone(page.name, text);
            if (groupIndex < 0 || groupIndex >= names.Length)
                throw new InvalidOperationException("Unmapped Quest semantic action: " + page.name + " / " + text);
            var key = page.GetInstanceID().ToString(CultureInfo.InvariantCulture) + ":" + groupIndex;
            if (!_measuredPanels.TryGetValue(key, out var panel))
            {
                var spec = SemanticPanelGeometry(page.name, groupIndex);
                panel = QuestUi.CreateOperationPanel(page, Font, PanelMaterial,
                    page.name + " / " + names[groupIndex], names[groupIndex],
                    new Vector3(spec.x, spec.y, .026f), spec.z, spec.w, RegisterTextBounds);
                panel.SetRole(AuthoredPanelRole(page.name, groupIndex));
                _measuredPanels.Add(key, panel);
            }
            _panelActionCounters.TryGetValue(key, out var index);
            _panelActionCounters[key] = index + 1;
            var zoneCount = SemanticZoneCapacity(page.name, groupIndex);
            if (index >= zoneCount)
                throw new InvalidOperationException("Quest panel zone capacity exceeded: " + page.name + " / " + names[groupIndex]);
            var dimensions = SemanticPanelGeometry(page.name, groupIndex);
            var location = ComposedActionPosition(page.name, groupIndex, text,
                panel.Width, dimensions.w, out var hitWidth, out var hitHeight, out var composition);
            var label = QuestUi.OperationAction(panel.Content, Font, ButtonMaterial, text, text,
                location, hitWidth, hitHeight,
                action, RegisterTextBounds);
            CreateActionInstrument(page.name, text, label, hitWidth, hitHeight);
            CreateComposedCardArtwork(label, composition, hitWidth, hitHeight);
            if (!_contextActions.TryGetValue(page, out var bound))
            {
                bound = new Dictionary<string, TextMesh>(StringComparer.Ordinal);
                _contextActions.Add(page, bound);
            }
            if (bound.ContainsKey(text))
                throw new InvalidOperationException("Duplicate Quest action identity in " + page.name + ": " + text);
            bound.Add(text, label);
            return label;
        }

        void ValidateAuthoredActionGeometry()
        {
            ValidateComposedFootprints();
            ValidateProjectionPageLayout();
            // Source-level contract, verified when all pages are constructed.
            // All authored slots must be consumed, including conditional Voice.
            var pages = new[] { _pcPage, _connectionPage, _homeNoticePage,
                _configurationPage, _viewPage, _metricsPage, _sectionPage,
                _editPage, _commandPage, _referencePage, _sketchPage, _voicePage, _voiceContextPage };
            if (_domainFocus.Count != 13 || _measuredPanels.Count != 39)
                throw new InvalidOperationException("Quest compact UI requires 13 summaries and 39 semantic panels");
            foreach (var page in pages)
            {
                if (page == null) continue;
                var expected = ExpectedActions(page.name);
                _authoredActionIndex.TryGetValue(page, out var actual);
                if (actual != expected)
                    throw new InvalidOperationException("Quest UI action map incomplete: " +
                        page.name + " expected=" + expected + " actual=" + actual);
                if (!_contextActions.TryGetValue(page, out var commands) ||
                    !commands.Values.Any(label => label != null && _actionInstruments.ContainsKey(label)))
                    throw new InvalidOperationException("Missing real live action instrument on " + page.name);
                if (!_domainFocus.TryGetValue(page, out var stage) || stage.Stage == null ||
                    stage.Stage.Root == null || stage.Stage.Value == null)
                    throw new InvalidOperationException("Missing full-width live domain stage on " + page.name);
                if (stage.Stage.Root.GetComponentsInChildren<QuestButton>(true).Length != 0 ||
                    stage.Stage.Root.GetComponentsInChildren<Collider>(true).Any(c => c.enabled))
                    throw new InvalidOperationException("Focus stage must not capture input on " + page.name);
                for (var z = 0; z < AuthoredZoneNames(page.name).Length; z++)
                {
                    var zone = SemanticPanelGeometry(page.name, z);
                    if (zone.y + zone.w * .5f > .1100f)
                        throw new InvalidOperationException("Focus stage overlaps live buttons on " + page.name);
                }
                var hits = page.GetComponentsInChildren<QuestButton>(true);
                for (var a = 0; a < hits.Length; a++)
                {
                    if (!ControlVisibleWithinPage(hits[a].transform, page)) continue;
                    var first = hits[a].GetComponent<BoxCollider>();
                    if (first == null) continue;
                    var boundsA = ColliderPageBounds(page, first);
                    for (var b = a + 1; b < hits.Length; b++)
                    {
                        if (!ControlVisibleWithinPage(hits[b].transform, page)) continue;
                        var second = hits[b].GetComponent<BoxCollider>();
                        if (second == null) continue;
                        var boundsB = ColliderPageBounds(page, second);
                        var overlapping = boundsA.xMin < boundsB.xMax - .0005f &&
                            boundsB.xMin < boundsA.xMax - .0005f &&
                            boundsA.yMin < boundsB.yMax - .0005f &&
                            boundsB.yMin < boundsA.yMax - .0005f;
                        if (overlapping)
                            Debug.LogError("Quest UI collider overlap in " + page.name + ": " +
                                hits[a].ActionId + " / " + hits[b].ActionId);
                    }
                }
            }
            foreach (var pair in _actionInstruments)
            {
                var original = pair.Key.transform.parent.GetComponentsInChildren<QuestButton>(true);
                if (original.Length != 1 || !ReferenceEquals(original[0].transform.parent, pair.Key.transform.parent))
                    throw new InvalidOperationException("Quest instrument must reuse exactly one original clickable action");
                // QuestUi.Surface creates primitives; every extra primitive's
                // collider must stay disabled, including on inactive CAD modals.
                foreach (var collider in pair.Key.transform.parent.GetComponentsInChildren<Collider>(true))
                    if (collider.GetComponent<QuestButton>() == null && collider.enabled)
                        throw new InvalidOperationException("Non-action Quest instrument captured XR raycast");
            }
        }

        void ValidateProjectionPageLayout()
        {
            if (_projectionPage == null) return;
            if (!QuestProjectionLayout.Validate(out var error)) throw new InvalidOperationException(error);
            var buttons = _projectionPage.GetComponentsInChildren<QuestButton>(true);
            if (buttons.Length != QuestProjectionLayout.Actions.Length)
                throw new InvalidOperationException("Quest projection page must keep one real hit target per action");
            foreach (var control in QuestProjectionLayout.Actions)
            {
                var button = buttons.FirstOrDefault(item => item != null && item.ActionId == control.Id);
                if (button == null || button.GetComponent<Collider>() == null ||
                    button.transform.parent == null || !ReferenceEquals(button.transform.parent.parent, _projectionPage))
                    throw new InvalidOperationException("Missing projection action hitbox " + control.Id);
            }
            foreach (var collider in _projectionPage.GetComponentsInChildren<Collider>(true))
                if (collider.enabled && collider.GetComponent<QuestButton>() == null)
                    throw new InvalidOperationException("Projection display surface captured XR input");
        }

        static Rect ColliderPageBounds(Transform page, BoxCollider collider)
        {
            var lo = new Vector2(float.PositiveInfinity, float.PositiveInfinity);
            var hi = new Vector2(float.NegativeInfinity, float.NegativeInfinity);
            for (var x = -1; x <= 1; x += 2)
            for (var y = -1; y <= 1; y += 2)
            for (var z = -1; z <= 1; z += 2)
            {
                var corner = collider.center + Vector3.Scale(collider.size * .5f, new Vector3(x,y,z));
                var p = page.InverseTransformPoint(collider.transform.TransformPoint(corner));
                lo = Vector2.Min(lo, new Vector2(p.x,p.y));
                hi = Vector2.Max(hi, new Vector2(p.x,p.y));
            }
            return Rect.MinMaxRect(lo.x,lo.y,hi.x,hi.y);
        }

        static bool ControlVisibleWithinPage(Transform control, Transform page)
        {
            // The page itself may be inactive while another screen is shown;
            // only consider modal controls active beneath its root.
            for (var t = control; t != null && t != page; t = t.parent)
                if (!t.gameObject.activeSelf) return false;
            return true;
        }

        TextMesh Button(string text, Vector3 position, float width, Action action, float height = .039f, float textSize = .013f)
        {
            var label = QuestUi.Button(_content, Font, ButtonMaterial, text, text, position, width, height, textSize,
                action, RegisterTextBounds);
            // Each real control gets a restrained glass inset and a separate
            // luminous baseline. Decorations never participate in raycasts.
            if (_content != _panel && PanelMaterial != null)
            {
                var tint = QuestUi.GlassMaterial(PanelMaterial);
                tint.color = new Color(.13f, .30f, .46f, .32f);
                QuestUi.Surface(label.transform.parent, tint, text + " inset",
                    position + new Vector3(0, 0, .008f),
                    new Vector3(width * .965f, height * .89f, .001f));
                var rail = QuestUi.GlassMaterial(PanelMaterial);
                rail.color = action == null ? new Color(.23f, .40f, .55f, .27f) :
                    new Color(.31f, .74f, 1f, .52f);
                QuestUi.Surface(label.transform.parent, rail, text + " bottom rim",
                    position + new Vector3(0, -height * .46f, -.008f),
                    new Vector3(width * .84f, .001f, .001f));
            }
            return label;
        }

        TextMesh Label(Transform parent, string text, Vector3 position, float size)
        {
            return QuestUi.Label(parent, Font, text, position, size, new Vector2(.38f, .025f), RegisterTextBounds);
        }

        void RegisterTextBounds(TextMesh label, Vector2 bounds) => _textLimits[label] = bounds;

        void LateUpdate()
        {
            var head = Rig != null ? Rig.centerEyeAnchor : Camera.main?.transform;
            bool palm = LeftHand != null && LeftHand.IsTracked && LeftHand.IsPointerPoseValid &&
                LeftHand.HandConfidence == OVRHand.TrackingConfidence.High && head != null;
            foreach (var group in _compactMenu)
            {
                group.gameObject.SetActive(!_panel.gameObject.activeSelf);
                if (palm)
                {
                    var point = LeftHand.PointerPose.position + head.right * .04f + head.up * .08f;
                    group.SetPositionAndRotation(point, Quaternion.LookRotation(point - head.position, head.up));
                }
                else group.SetPositionAndRotation(transform.TransformPoint(new Vector3(0, .24f, 0)), transform.rotation);
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
            _voiceContext?.CancelPointArm();
            if (_voicePointMarker != null)
            { if (Application.isPlaying) Destroy(_voicePointMarker);else DestroyImmediate(_voicePointMarker);_voicePointMarker = null; }
            DirectFaceHistory?.CancelPending("Controlli chiusi; acquisizioni annullate.");
            if (_projections != null)
            {
                _projections.Changed -= RefreshProjectionPage;
                _projections.Dispose();
            }
            _projectionStage?.Dispose();
            _projectionStage = null;
            if (References != null) References.Changed -= RefreshReferencePage;
            if (Connection != null) Connection.SceneChanged -= RefreshSelection;
            foreach (var stage in _domainFocus.Values)
                stage.Stage?.Dispose();
            _domainFocus.Clear();
            _actionInstruments.Clear();
            _actionCardSnapshots.Clear();
            _largeCardSnapshots.Clear();
            // GlassMaterial creates a per-workstation shader material. Release
            // it with the originating UI instead of leaking on scene reload.
            if (_instrumentGlass != null)
            {
                if (Application.isPlaying) Destroy(_instrumentGlass);
                else DestroyImmediate(_instrumentGlass);
                _instrumentGlass = null;
            }
        }
        void OnApplicationFocus(bool focused) { if (!focused) ResetIntent(); }
        void OnApplicationPause(bool paused) { if (paused) ResetIntent(); }
    }
}
