using System;
using System.Threading.Tasks;
using Kreoda.QuestFoundation;
using UnityEngine;
using UnityEngine.Android;

namespace Kreoda.QuestRuntime
{
    /// <summary>
    /// Contact provenance is distinct from visual accuracy: only MetaRoomTable
    /// was produced by an opted-in, tracked SDK TABLE/DESK room anchor.
    /// Physical alignment still requires headset-wearer verification.
    /// </summary>
    public enum QuestPlacementProvenance
    {
        Unknown,
        MetaRoomTable,
        ColliderUnverified,
        ManualProjection
    }

    public sealed class QuestDisplay : MonoBehaviour
    {
        public QuestConnection Connection;
        public OVRCameraRig Rig;
        public Material MarkerMaterial;
        public string Status { get; private set; } = "Vista locale · posiziona sul tavolo";
        public string ScaleName { get; private set; } = "Fit";
        public float HeightCalibration { get; private set; }
        public bool PlacementActive { get; private set; }
        public bool FollowPointer { get; private set; }
        public bool TwoHandActive { get; private set; }
        public QuestPlacementProvenance ConfirmedProvenance { get; private set; }
        Vector3 _handMidpoint, _handAxis, _handPosition, _handScale;
        Quaternion _handRotation;
        Transform Root => Connection.DisplayRoot;
        Vector3 _anchor, _localContact, _oldPosition, _oldScale, _oldAnchor, _oldContact;
        Quaternion _oldRotation;
        string _oldScaleName;
        float _oldCalibration;
        bool _hasAnchor, _oldHasAnchor, _candidateTracked, _preferencesReady, _firstModel;
        QuestPlacementProvenance _candidateProvenance;
        QuestSpatialAnchorStore _anchorStore;
        IQuestSpatialAnchorBackend _anchorBackend;
        QuestAnchorScope _activeScope;
        bool _hasAuthenticatedScope, _restoreStarted, _liveSavedAnchor, _rootHiddenForLostAnchor;
        // A temporarily unavailable Meta UUID may become localizable later.
        // Only two delayed retries are allowed per authenticated scope.
        const int MaxRestoreAttempts = 3;
        int _restoreAttempts;
        bool _restoreRetryScheduled;
        float _restoreRetryAt;
        long _confirmationGeneration;
        PermissionCallbacks _pendingAnchorPermission;
        Task<QuestAnchorOutcome> _restoreOperation, _saveOperation;
        public string AnchorPersistenceStatus { get; private set; } = "Ancora locale non verificata";
#if UNITY_EDITOR
        // Controlled EditMode seam; builds for Quest only ever use the Meta SDK.
        internal IQuestSpatialAnchorBackend EditorAnchorBackend;
        internal string EditorAnchorStoragePath;
        internal QuestAnchorScope? EditorAuthenticatedScope;
        internal Task<QuestAnchorOutcome> EditorSaveOperation => _saveOperation;
        internal Task<QuestAnchorOutcome> EditorRestoreOperation => _restoreOperation;
        internal Action<Action, Action, Action> EditorPermissionRequest;
        internal Func<float> EditorAnchorClock;
#endif
        GameObject _marker;
        readonly Transform[] _footprintEdges = new Transform[4];
        // Direction arrows distinguish the two real CAD horizontal axes while
        // the user rotates the footprint. They are a non-interactive placement
        // instrument, not additional targets or a fabricated compass bearing.
        readonly Transform[] _footprintAxes = new Transform[6];
        Material _footprintGlass;

        void Start()
        {
            ScaleName = PlayerPrefs.GetString("kreoda-display-scale", "Fit");
            if (ScaleName != "Fit" && ScaleName != "Manuale")
                try { DisplayTransform.Preset(ScaleName); } catch (ArgumentException) { ScaleName = "Fit"; }
            HeightCalibration = Mathf.Clamp(PlayerPrefs.GetFloat("kreoda-table-calibration", 0), -.1f, .1f);
            if (!Finite(HeightCalibration)) HeightCalibration = 0;
            var scale = PlayerPrefs.GetFloat("kreoda-display-magnification", 1);
            if (Finite(scale) && scale > 0) Root.localScale = Vector3.one * scale;
            _preferencesReady = true;
            Connection.SceneChanged += FirstModel;
            FirstModel();
        }

        void EnsureAnchorStore()
        {
            if (_anchorStore != null) return;
#if UNITY_EDITOR
            if (EditorAnchorBackend == null || string.IsNullOrWhiteSpace(EditorAnchorStoragePath)) return;
            _anchorBackend = EditorAnchorBackend;
            _anchorStore = new QuestSpatialAnchorStore(_anchorBackend, EditorAnchorStoragePath);
#else
            if (Application.platform != RuntimePlatform.Android) return;
            _anchorBackend = new OvrQuestSpatialAnchorBackend();
            _anchorStore = new QuestSpatialAnchorStore(_anchorBackend, Application.persistentDataPath);
#endif
        }

        // The room id remains deliberately empty until Meta supplies a trusted,
        // stable identifier. Localization by saved UUID establishes the place;
        // a raw Unity tracking origin or guessed room name never does.
        bool TryAuthenticatedScope(out QuestAnchorScope scope)
        {
            scope = default;
#if UNITY_EDITOR
            if (EditorAuthenticatedScope.HasValue)
            {
                scope = EditorAuthenticatedScope.Value;
                return scope.IsValid;
            }
#endif
            if (Connection == null || !Connection.Connected) return false;
            var pcId = Connection.ActiveAuthenticatedPcId;
            var model = Connection.Client?.Model;
            if (string.IsNullOrWhiteSpace(pcId) || model == null) return false;
            scope = new QuestAnchorScope(pcId, model.DocumentId, model.SessionId,
                Connection.ConnectionGeneration);
            return scope.IsValid;
        }

        bool CurrentScope(QuestAnchorScope scope) => _hasAuthenticatedScope &&
            _activeScope.Equals(scope) && TryAuthenticatedScope(out var current) && current.Equals(scope);

        bool CurrentConfirmation(QuestAnchorScope scope, long confirmedGeneration) =>
            _confirmationGeneration == confirmedGeneration && CurrentScope(scope);

        float AnchorNow()
        {
#if UNITY_EDITOR
            if (EditorAnchorClock != null) return EditorAnchorClock();
#endif
            return Time.realtimeSinceStartup;
        }

        void CancelRestoreRetry()
        {
            _restoreRetryScheduled = false;
            _restoreAttempts = 0;
        }

        void InvalidatePendingAnchorIntent()
        {
            _confirmationGeneration++;
            _pendingAnchorPermission = null;
            CancelRestoreRetry();
            if (_hasAuthenticatedScope) _anchorStore?.UseSession(_activeScope);
            _liveSavedAnchor = false;
            RevealHiddenCadRoot();
        }

        void RevealHiddenCadRoot()
        {
            if (!_rootHiddenForLostAnchor) return;
            _rootHiddenForLostAnchor = false;
            if (Connection != null && Connection.DisplayRoot != null)
                Connection.DisplayRoot.gameObject.SetActive(true);
        }

        void SynchronizeAnchorScope()
        {
            EnsureAnchorStore();
            if (!TryAuthenticatedScope(out var scope))
            {
                if (!_hasAuthenticatedScope) return;
                RevealHiddenCadRoot();
                _confirmationGeneration++;
                _pendingAnchorPermission = null;
                CancelRestoreRetry();
                _anchorStore?.UseSession(default);
                _hasAuthenticatedScope = false;
                _restoreStarted = _liveSavedAnchor = _firstModel = _hasAnchor = false;
                ConfirmedProvenance = QuestPlacementProvenance.Unknown;
                AnchorPersistenceStatus = "PC non autenticato · ancoraggio disattivato";
                Recenter();
                return;
            }
            if (_hasAuthenticatedScope && _activeScope.Equals(scope)) return;
            RevealHiddenCadRoot();
            var changed = _hasAuthenticatedScope;
            _confirmationGeneration++;
            _pendingAnchorPermission = null;
            CancelRestoreRetry();
            if (changed) { CancelPlacement();EndTwoHand(false); }
            _hasAuthenticatedScope = true;
            _activeScope = scope;
            _anchorStore?.UseSession(scope);
            _restoreStarted = _liveSavedAnchor = _firstModel = _hasAnchor = false;
            ConfirmedProvenance = QuestPlacementProvenance.Unknown;
            AnchorPersistenceStatus = "Verifica ancora locale per questo documento in attesa";
            if (changed)
            {
                // A temporary head-relative view must not suppress the new
                // document's persisted-anchor lookup.
                Recenter();
                _hasAnchor = _firstModel = false;
            }
        }

        void Update()
        {
            SynchronizeAnchorScope();
            if (!_firstModel) FirstModel();
            // No permission prompts or per-frame backend retry calls:
            // at most two backoff-gated additional attempts after NotLocalized.
            if (_restoreRetryScheduled && !PlacementActive && !TwoHandActive &&
                _hasAuthenticatedScope && _anchorStore != null && _anchorBackend != null &&
                _anchorBackend.IsPermitted && Connection.PendingMeshCount == 0 &&
                Bounds(out _, out _) && AnchorNow() >= _restoreRetryAt)
            {
                _restoreRetryScheduled = false;
                _restoreAttempts++;
                _restoreOperation = RestoreCurrentScopeAsync(_activeScope, _confirmationGeneration);
            }
            if (!_liveSavedAnchor || _anchorStore == null || !_hasAuthenticatedScope ||
                PlacementActive || TwoHandActive) return;
            if (!_anchorStore.TryGetTrackedDisplayPose(out var localized, out var record) ||
                !MatchesCurrentCadContact(record))
            {
                // A stale, unlocalized CAD root is not a trustworthy world
                // placement: hide the physical geometry until the real Meta
                // anchor is tracked again. The HUD remains outside this root.
                if (!_rootHiddenForLostAnchor && Root != null)
                {
                    _rootHiddenForLostAnchor = true;
                    Root.gameObject.SetActive(false);
                }
                AnchorPersistenceStatus = "Tracking ancora Meta perso · allineamento fisico non verificato";
                Status = AnchorPersistenceStatus;
                return;
            }
            RevealHiddenCadRoot();
            Root.SetPositionAndRotation(localized.position, localized.rotation);
            _localContact = record.ContactModelPoint;
            _anchor = Root.TransformPoint(_localContact);
            _hasAnchor = true;
        }

        bool MatchesCurrentCadContact(QuestAnchorRecord record)
        {
            if (record == null || !record.IsValid() || !Bounds(out var min, out var max)) return false;
            var current = new Vector3((min.x + max.x) * .5f, min.y, (min.z + max.z) * .5f);
            return Vector3.Distance(current, record.ContactModelPoint) <= .002f;
        }

        async Task<QuestAnchorOutcome> RestoreCurrentScopeAsync(QuestAnchorScope scope,
            long confirmationGeneration)
        {
            var result = await _anchorStore.RestoreAsync(scope);
            if (!CurrentConfirmation(scope, confirmationGeneration) ||
                result.Status == QuestAnchorStatus.Superseded)
                return new QuestAnchorOutcome(QuestAnchorStatus.Superseded);
            if (result.Status == QuestAnchorStatus.Restored && MatchesCurrentCadContact(result.Record))
            {
                CancelRestoreRetry();
                Root.localScale = Vector3.one * result.Record.DisplayScale;
                Root.SetPositionAndRotation(result.DisplayWorldPose.position, result.DisplayWorldPose.rotation);
                _localContact = result.Record.ContactModelPoint;
                _anchor = Root.TransformPoint(_localContact);
                _hasAnchor = _firstModel = _liveSavedAnchor = true;
                HeightCalibration = result.Record.HeightCalibrationMetres;
                ScaleName = "Manuale";
                ConfirmedProvenance = QuestPlacementProvenance.Unknown;
                AnchorPersistenceStatus = "Ancora Meta locale ricaricata · verifica allineamento fisico sul visore";
                Status = AnchorPersistenceStatus;
                SetPreviewStyle(false);
                return result;
            }
            _liveSavedAnchor = false;
            var failedAttempt = _restoreAttempts;
            var retryNotLocalized = result.Status == QuestAnchorStatus.NotLocalized &&
                                    failedAttempt > 0 && failedAttempt < MaxRestoreAttempts;
            AnchorPersistenceStatus = result.Success
                ? "Geometria CAD modificata: vecchio ancoraggio rifiutato" :
                "Ancora locale assente, negata o non localizzata: vista temporanea";
            FallbackFirstModel(AnchorPersistenceStatus);
            // Initial fallback may call Recenter, which legitimately revokes the
            // previous epoch. Schedule the retry only AFTER that fallback and
            // only if the authenticated PC/document scope is still current.
            if (retryNotLocalized && CurrentScope(scope) && _anchorBackend != null &&
                _anchorBackend.IsPermitted && !PlacementActive && !TwoHandActive)
            {
                _restoreAttempts = failedAttempt;
                _restoreRetryAt = AnchorNow() + (failedAttempt == 1 ? 2f : 4f);
                _restoreRetryScheduled = true;
            }
            if (result.Status == QuestAnchorStatus.Restored)
                return new QuestAnchorOutcome(QuestAnchorStatus.InvalidContext);
            return result;
        }

        void FallbackFirstModel(string reason)
        {
            if (_firstModel || PlacementActive || Connection.PendingMeshCount > 0 || !Bounds(out _, out _)) return;
            _firstModel = true;
            Recenter();
            if (ScaleName != "Manuale") SetScale(ScaleName);
            if (!string.IsNullOrEmpty(reason)) Status = reason;
        }

        async Task<QuestAnchorOutcome> SaveConfirmedAnchorAsync(QuestAnchorScope scope,
            Pose contactPose, Pose displayPose, float scale, Vector3 contactModel, float calibration,
            long confirmationGeneration)
        {
            var result = await _anchorStore.SaveConfirmedAsync(scope, contactPose, displayPose,
                scale, contactModel, calibration);
            if (!CurrentConfirmation(scope, confirmationGeneration))
                return new QuestAnchorOutcome(QuestAnchorStatus.Superseded);
            _liveSavedAnchor = result.Status == QuestAnchorStatus.Saved;
            AnchorPersistenceStatus = _liveSavedAnchor
                ? "Ancora Meta salvata localmente · verifica allineamento dopo riavvio"
                : "Modello posizionato ma ancora locale non salvata (" + result.Status + ")";
            Status = AnchorPersistenceStatus;
            return result;
        }

        void SaveOnlyExplicitConfirmedPlacement()
        {
            SynchronizeAnchorScope();
            if (!_hasAuthenticatedScope || _anchorStore == null || !Bounds(out _, out _) ||
                !_hasAnchor || !Finite(Root.position) || !Finite(_anchor))
            {
                AnchorPersistenceStatus = "Nessun PC/documento autenticato: posizione valida solo in questa sessione";
                return;
            }
            var scope = _activeScope;
            // _anchor includes the explicitly requested height calibration;
            // Meta itself receives a point ON the chosen physical contact.
            var contactPose = new Pose(_anchor - Vector3.up * HeightCalibration, Root.rotation);
            var displayPose = new Pose(Root.position, Root.rotation);
            var scale = Root.localScale.x;
            var contactModel = _localContact;
            var calibration = HeightCalibration;
            // Invalidate older saves even if a second Confirm happens under
            // exactly the same PC/document/session. Otherwise an old callback
            // could overwrite this newer confirmed pose on disk.
            InvalidatePendingAnchorIntent();
            var confirmationGeneration = _confirmationGeneration;
            var permissionResolved = false;
            void CommitWhenPermitted()
            {
                if (permissionResolved || !CurrentConfirmation(scope, confirmationGeneration)) return;
                if (_anchorBackend == null || !_anchorBackend.IsPermitted)
                {
                    Denied();
                    return;
                }
                permissionResolved = true;
                _pendingAnchorPermission = null;
                _saveOperation = SaveConfirmedAnchorAsync(scope, contactPose, displayPose,
                    scale, contactModel, calibration, confirmationGeneration);
            }
            if (_anchorBackend.IsPermitted) { CommitWhenPermitted(); return; }
            AnchorPersistenceStatus = "Permesso Anchor API assente · posizione valida solo in questa sessione";
            void Denied()
            {
                if (permissionResolved || !CurrentConfirmation(scope, confirmationGeneration)) return;
                permissionResolved = true;
                _pendingAnchorPermission = null;
                AnchorPersistenceStatus = "Permesso Anchor API negato · ancoraggio non salvato";
                Status = AnchorPersistenceStatus;
            }
#if UNITY_EDITOR
            if (EditorPermissionRequest != null)
            {
                EditorPermissionRequest(CommitWhenPermitted, Denied, Denied);
                return;
            }
#endif
            if (Application.platform != RuntimePlatform.Android) return;
            // Only an actual Confirm user gesture may request this permission.
            // A denied/ignored prompt never triggers SaveAnchorAsync.
            _pendingAnchorPermission = new PermissionCallbacks();
            _pendingAnchorPermission.PermissionGranted += _ => CommitWhenPermitted();
            _pendingAnchorPermission.PermissionDenied += _ => Denied();
            _pendingAnchorPermission.PermissionDeniedAndDontAskAgain += _ => Denied();
            Status = "Autorizzazione Meta Anchor richiesta sul visore; salvataggio in attesa";
            Permission.RequestUserPermission("com.oculus.permission.USE_ANCHOR_API", _pendingAnchorPermission);
        }

        bool Bounds(out Vector3 min, out Vector3 max)
        {
            min = new Vector3(float.PositiveInfinity, float.PositiveInfinity, float.PositiveInfinity);
            max = -min;
            bool found = false;
            foreach (var view in Connection.Views)
            {
                if (view == null || view.BboxMetres == null) continue;
                var box = view.BboxMetres;
                // A malformed or stale CAD bounding box must not become a
                // physical contact guide or throw during a Quest gesture.
                if (box.Length != 6 ||
                    double.IsNaN(box[0]) || double.IsNaN(box[1]) || double.IsNaN(box[2]) ||
                    double.IsNaN(box[3]) || double.IsNaN(box[4]) || double.IsNaN(box[5]) ||
                    double.IsInfinity(box[0]) || double.IsInfinity(box[1]) || double.IsInfinity(box[2]) ||
                    double.IsInfinity(box[3]) || double.IsInfinity(box[4]) || double.IsInfinity(box[5]) ||
                    box[3] < box[0] || box[4] < box[1] || box[5] < box[2]) continue;
                min = Vector3.Min(min, new Vector3((float)box[0], (float)box[1], (float)box[2]));
                max = Vector3.Max(max, new Vector3((float)box[3], (float)box[4], (float)box[5]));
                found = true;
            }
            return found && Finite(min) && Finite(max);
        }

        public bool Place(Vector3 anchor, float yaw)
        {
            if (!Finite(anchor) || !Finite(yaw) || !Bounds(out var min, out var max)) return false;
            _localContact = new Vector3((min.x + max.x) / 2, min.y, (min.z + max.z) / 2);
            _anchor = anchor;
            _hasAnchor = true;
            Root.rotation = Quaternion.Euler(0, yaw, 0);
            ApplyContact();
            return true;
        }

        void ApplyContact()
        {
            Root.position = _anchor - Root.rotation * Vector3.Scale(_localContact, Root.localScale);
            UpdatePlacementFootprint();
        }

        public bool SetScale(string name)
        {
            if (!Bounds(out var min, out var max)) { Status = "Attendi il modello prima di cambiare scala"; return false; }
            double magnification;
            try
            {
                // Vertices are already metres. Fit's target is 350 CAD mm;
                // its result is the same dimensionless magnification as presets.
                magnification = name == "Fit" ? DisplayTransform.Fit(
                    new[] { min.x * 1000d, min.y * 1000d, min.z * 1000d },
                    new[] { max.x * 1000d, max.y * 1000d, max.z * 1000d }, 350).Scale : DisplayTransform.Preset(name).Scale;
            }
            catch (ArgumentException) { Status = "Scala non disponibile: modello senza estensione"; return false; }
            var scale = (float)magnification;
            if (!Finite(scale) || scale <= 0 || !Finite((max - min) * scale)) return false;
            if (!_hasAnchor) Place(Root.position, Root.eulerAngles.y);
            _localContact = new Vector3((min.x + max.x) / 2, min.y, (min.z + max.z) / 2);
            Root.localScale = Vector3.one * scale;
            ScaleName = name;
            ApplyContact();
            var invalidatedStoredScale = !PlacementActive && (_liveSavedAnchor ||
                _saveOperation != null && !_saveOperation.IsCompleted);
            if (invalidatedStoredScale)
            {
                InvalidatePendingAnchorIntent();
                AnchorPersistenceStatus = "Scala modificata: ripeti Posiziona/Conferma per salvare l'ancora";
            }
            Status = invalidatedStoredScale
                ? "Scala " + name + " · modifica non salvata; al prossimo avvio ritorna il precedente ancoraggio"
                : "Scala " + name + " · quote CAD in mm";
            if (!PlacementActive) SavePreferences();
            return true;
        }

        public bool BeginPlacement()
        {
            EndTwoHand(false);
            if (PlacementActive || !Bounds(out _, out _)) return false;
            InvalidatePendingAnchorIntent();
            _oldPosition = Root.position; _oldRotation = Root.rotation; _oldScale = Root.localScale;
            _oldAnchor = _anchor; _oldContact = _localContact; _oldHasAnchor = _hasAnchor;
            _oldScaleName = ScaleName; _oldCalibration = HeightCalibration;
            PlacementActive = FollowPointer = true;
            SetPreviewStyle(true);
            _candidateTracked = false;
            _candidateProvenance = QuestPlacementProvenance.Unknown;
            Status = "Punta a una superficie → seleziona per fermare\nSenza collider: punto manuale sul raggio a 0,85 m";
            CreatePlacementFootprint();
            return true;
        }

        // The footprint is the actual transformed CAD bounding rectangle at the
        // physical contact plane, not a fabricated guide or screen overlay.
        // Its four translucent rails and anchor dot cannot consume hand rays.
        void CreatePlacementFootprint()
        {
            if (MarkerMaterial == null || !Bounds(out _, out _)) return;
            _marker = new GameObject("Physical CAD footprint");
            _footprintGlass = QuestUi.GlassMaterial(MarkerMaterial);
            _footprintGlass.color = new Color(.13f, .56f, .80f, .55f);
            var contact = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            contact.name = "Real CAD contact anchor";
            contact.transform.SetParent(_marker.transform, false);
            contact.transform.localScale = Vector3.one * .010f;
            contact.GetComponent<Collider>().enabled = false;
            contact.GetComponent<MeshRenderer>().sharedMaterial = _footprintGlass;
            for (var index = 0; index < _footprintEdges.Length; index++)
            {
                var edge = GameObject.CreatePrimitive(PrimitiveType.Cube);
                edge.name = "CAD footprint edge " + index;
                edge.transform.SetParent(_marker.transform, false);
                edge.GetComponent<Collider>().enabled = false;
                edge.GetComponent<MeshRenderer>().sharedMaterial = _footprintGlass;
                _footprintEdges[index] = edge.transform;
            }
            for (var index = 0; index < _footprintAxes.Length; index++)
            {
                var guide = GameObject.CreatePrimitive(PrimitiveType.Cube);
                guide.name = "CAD local " + (index < 3 ? "X" : "Z") + " direction " + (index % 3);
                guide.transform.SetParent(_marker.transform, false);
                guide.GetComponent<Collider>().enabled = false;
                guide.GetComponent<MeshRenderer>().sharedMaterial = _footprintGlass;
                _footprintAxes[index] = guide.transform;
            }
            UpdatePlacementFootprint();
        }

        static void SetFootprintSegment(Transform target, Vector3 from, Vector3 to, float thickness)
        {
            if (target == null) return;
            var displacement = to - from;
            target.localPosition = (from + to) * .5f;
            target.localRotation = Quaternion.FromToRotation(Vector3.right, displacement);
            target.localScale = new Vector3(displacement.magnitude, thickness, thickness);
        }

        void UpdatePlacementFootprint()
        {
            if (_marker == null) return;
            // Cyan means the controller is still moving the actual placement;
            // amber means the contact is frozen awaiting user confirmation.
            if (_footprintGlass != null)
            {
                var tint = FollowPointer ? new Color(.13f, .56f, .80f, .55f) :
                    new Color(.94f, .61f, .18f, .65f);
                if (_footprintGlass.color != tint) _footprintGlass.color = tint;
            }
            _marker.transform.SetPositionAndRotation(_anchor, Root.rotation);
            if (!Bounds(out var min, out var max)) { _marker.SetActive(false); return; }
            var width = (max.x - min.x) * Root.localScale.x;
            var depth = (max.z - min.z) * Root.localScale.z;
            // Never display an unbounded/degenerate preview as a plausible CAD
            // footprint; all values originate from the current mesh bounds.
            var valid = Finite(width) && Finite(depth) && width > .001f && depth > .001f &&
                width < 10f && depth < 10f;
            _marker.SetActive(valid && _candidateTracked);
            if (!valid) return;
            var thickness = .0018f;
            for (var i = 0; i < _footprintEdges.Length; i++)
            {
                var edge = _footprintEdges[i];
                if (edge == null) continue;
                var horizontal = i < 2;
                edge.localPosition = horizontal ?
                    new Vector3(0, .001f, (i == 0 ? -1f : 1f) * depth * .5f) :
                    new Vector3((i == 2 ? -1f : 1f) * width * .5f, .001f, 0);
                edge.localScale = horizontal ?
                    new Vector3(width, thickness, thickness) :
                    new Vector3(thickness, thickness, depth);
            }
            // The arrowheads point along the transformed CAD +X and +Z axes.
            // They scale with actual model bounds and disappear when too small
            // to distinguish, instead of clipping through a narrow footprint.
            var xLength = Mathf.Min(width * .26f, .09f);
            var zLength = Mathf.Min(depth * .26f, .09f);
            var xVisible = xLength >= .015f;
            var zVisible = zLength >= .015f;
            for (var i = 0; i < _footprintAxes.Length; i++)
                if (_footprintAxes[i] != null) _footprintAxes[i].gameObject.SetActive(i < 3 ? xVisible : zVisible);
            const float guideY = .0025f;
            if (xVisible)
            {
                var tip = new Vector3(xLength, guideY, 0);
                var wing = Mathf.Min(.010f, xLength * .22f);
                SetFootprintSegment(_footprintAxes[0], new Vector3(0, guideY, 0), tip, .0015f);
                SetFootprintSegment(_footprintAxes[1], new Vector3(xLength - wing, guideY, -wing * .55f), tip, .0015f);
                SetFootprintSegment(_footprintAxes[2], new Vector3(xLength - wing, guideY, wing * .55f), tip, .0015f);
            }
            if (zVisible)
            {
                var tip = new Vector3(0, guideY, zLength);
                var wing = Mathf.Min(.010f, zLength * .22f);
                SetFootprintSegment(_footprintAxes[3], new Vector3(0, guideY, 0), tip, .0015f);
                SetFootprintSegment(_footprintAxes[4], new Vector3(-wing * .55f, guideY, zLength - wing), tip, .0015f);
                SetFootprintSegment(_footprintAxes[5], new Vector3(wing * .55f, guideY, zLength - wing), tip, .0015f);
            }
        }

        public void UpdatePlacement(Vector3 point, float yaw, bool tracked)
            => UpdatePointerPlacement(point, yaw, tracked, tracked, false);

        public void UpdatePointerPlacement(Vector3 point, float yaw, bool tracked, bool hasContact, bool manual)
            => UpdatePointerPlacement(point, yaw, tracked, hasContact,
                manual ? QuestPlacementProvenance.ManualProjection : QuestPlacementProvenance.ColliderUnverified);

        public void UpdatePointerPlacement(Vector3 point, float yaw, bool tracked, bool hasContact,
            QuestPlacementProvenance provenance)
        {
            if (!PlacementActive) return;
            // After a valid freeze the user's hand may aim at Confirm instead
            // of at the table. Contact is only required while the preview moves.
            _candidateTracked = tracked && Finite(yaw) &&
                (!FollowPointer || hasContact && Finite(point));
            if (!_candidateTracked)
            {
                if (_marker != null) _marker.SetActive(false);
                Status = tracked ? "Raggio bloccato o non valido: scegli una superficie libera" :
                    "Tracking perso: conferma disabilitata";
                return;
            }
            if (FollowPointer)
            {
                if (!Place(point + Vector3.up * HeightCalibration, yaw))
                {
                    _candidateTracked = false;
                    if (_marker != null) _marker.SetActive(false);
                    Status = "Anteprima non valida: conferma disabilitata";
                    return;
                }
                _candidateProvenance = provenance;
                Status = provenance == QuestPlacementProvenance.MetaRoomTable
                    ? "Anteprima su piano TABLE/DESK Meta · verifica allineamento sul visore\nSeleziona per fermare · Conferma o Annulla"
                    : provenance == QuestPlacementProvenance.ManualProjection
                    ? "Anteprima manuale · punto proiettato sul raggio a 0,85 m\nSeleziona per fermare · Conferma o Annulla"
                    : "Aggancio a superficie con collider · tavolo non verificato\nSeleziona per fermare · Conferma o Annulla";
            }
            else UpdatePlacementFootprint();
        }

        public void FreezePlacement()
        {
            if (!PlacementActive || !_candidateTracked) return;
            FollowPointer = !FollowPointer;
            UpdatePlacementFootprint();
            Status = FollowPointer ? "Muovi/orienta il raggio · seleziona per fermare" :
                _candidateProvenance == QuestPlacementProvenance.MetaRoomTable
                    ? "Piano TABLE/DESK Meta fermato · verifica quota e orientamento, Conferma o Annulla" :
                _candidateProvenance == QuestPlacementProvenance.ManualProjection
                    ? "Punto manuale fermato · regola quota, Conferma o Annulla" :
                    "Collider locale fermato · verifica allineamento, Conferma o Annulla";
        }

        public bool ConfirmPlacement(bool tracked)
        {
            if (!PlacementActive || FollowPointer || !_candidateTracked || !tracked) return false;
            PlacementActive = false;
            SetPreviewStyle(false);
            RemoveMarker();
            ConfirmedProvenance = _candidateProvenance;
            Status = _candidateProvenance == QuestPlacementProvenance.MetaRoomTable
                ? "Modello su piano TABLE/DESK Meta · allineamento fisico da verificare sul visore" :
                _candidateProvenance == QuestPlacementProvenance.ManualProjection
                    ? "Modello posizionato · punto manuale, non verificato sul tavolo" :
                    "Modello posizionato · collider locale; tavolo non verificato";
            if (_preferencesReady) PlayerPrefs.SetString("kreoda-placement-mode", "table");
            SavePreferences();
            // This is the sole physical-placement commit path: neither the
            // preview nor opening an MR menu can persist a world anchor.
            SaveOnlyExplicitConfirmedPlacement();
            return true;
        }

        public void AdjustHeight(float deltaMetres)
        {
            if (!PlacementActive || !Finite(deltaMetres)) return;
            var prior = HeightCalibration;
            HeightCalibration = Mathf.Clamp(HeightCalibration + deltaMetres, -.1f, .1f);
            if (_hasAnchor) { _anchor.y += HeightCalibration - prior; ApplyContact(); }
            Status = "Quota modello: " + (HeightCalibration * 1000).ToString("0") + " mm · Conferma o Annulla";
        }

        public void CancelPlacement()
        {
            if (!PlacementActive) return;
            InvalidatePendingAnchorIntent();
            Root.SetPositionAndRotation(_oldPosition, _oldRotation); Root.localScale = _oldScale;
            _anchor = _oldAnchor; _localContact = _oldContact; _hasAnchor = _oldHasAnchor;
            ScaleName = _oldScaleName; HeightCalibration = _oldCalibration;
            PlacementActive = FollowPointer = false;
            SetPreviewStyle(false);
            RemoveMarker();
            Status = "Posizionamento annullato";
        }

        public void Recenter()
        {
            var previouslySaved = _liveSavedAnchor;
            EndTwoHand(false);
            CancelPlacement();
            InvalidatePendingAnchorIntent();
            if (previouslySaved)
            {
                AnchorPersistenceStatus = "Vista ricentrata solo ora: il vecchio ancoraggio salvato resta per il prossimo avvio";
            }
            ConfirmedProvenance = QuestPlacementProvenance.Unknown;
            var head = Rig != null ? Rig.centerEyeAnchor : Camera.main?.transform;
            if (head == null) return;
            var forward = Vector3.ProjectOnPlane(head.forward, Vector3.up).normalized;
            if (forward.sqrMagnitude < .01f) forward = Vector3.forward;
            Place(head.position + forward * .8f - Vector3.up * .3f, Mathf.Atan2(forward.x, forward.z) * (180f / (float)Math.PI));
            Status = previouslySaved
                ? "Vista centrata davanti a te · il vecchio ancoraggio locale tornerà al riavvio; Posiziona/Conferma per sostituirlo"
                : "Vista centrata davanti a te";
            if (_preferencesReady) { PlayerPrefs.SetString("kreoda-placement-mode", "head"); SavePreferences(); }
        }

        void FirstModel()
        {
            SynchronizeAnchorScope();
            SetPreviewStyle(PlacementActive);
            if (_firstModel || PlacementActive || Connection.PendingMeshCount > 0 || !Bounds(out _, out _)) return;
            if (_hasAnchor) { _firstModel = true; return; }
            if (_hasAuthenticatedScope && _anchorStore != null && _anchorBackend != null &&
                _anchorBackend.IsPermitted)
            {
                if (!_restoreStarted)
                {
                    _restoreStarted = true;
                    _restoreAttempts = 1;
                    AnchorPersistenceStatus = "Ricerca ancora Meta locale · nessuna trasformazione Unity riutilizzata";
                    Status = AnchorPersistenceStatus;
                    _restoreOperation = RestoreCurrentScopeAsync(_activeScope, _confirmationGeneration);
                }
                return;
            }
            FallbackFirstModel(_hasAuthenticatedScope
                ? "Ancora Meta non autorizzata · vista temporanea, posizione non ripristinata"
                : null);
            // Upon authenticated session or document changes Sync resets this
            // one-shot guard; old CAD pose never bleeds into a new document.
        }

        void SetPreviewStyle(bool active)
        {
            foreach (var view in Connection.Views) if (view != null) view.SetPreview(active);
        }

        void SavePreferences()
        {
            if (!_preferencesReady) return;
            PlayerPrefs.SetString("kreoda-display-scale", ScaleName);
            PlayerPrefs.SetFloat("kreoda-display-magnification", Root.localScale.x);
            PlayerPrefs.SetFloat("kreoda-table-calibration", HeightCalibration);
            PlayerPrefs.Save();
        }

        void RemoveMarker()
        {
            if (_marker == null) return;
            if (Application.isPlaying) Destroy(_marker); else DestroyImmediate(_marker);
            _marker = null;
            for (var i = 0; i < _footprintEdges.Length; i++) _footprintEdges[i] = null;
            for (var i = 0; i < _footprintAxes.Length; i++) _footprintAxes[i] = null;
            if (_footprintGlass != null)
            {
                if (Application.isPlaying) Destroy(_footprintGlass); else DestroyImmediate(_footprintGlass);
                _footprintGlass = null;
            }
        }
        static bool Finite(float value) => !float.IsNaN(value) && !float.IsInfinity(value);
        static bool Finite(Vector3 value) => Finite(value.x) && Finite(value.y) && Finite(value.z);
        public bool BeginTwoHand(Vector3 left, Vector3 right)
        {
            if (TwoHandActive || !Finite(left) || !Finite(right) || (right - left).magnitude < .03f || !Bounds(out _, out _)) return false;
            InvalidatePendingAnchorIntent();
            CancelPlacement();_handMidpoint = (left + right) / 2;_handAxis = right - left;
            _handPosition = Root.position;_handRotation = Root.rotation;_handScale = Root.localScale;
            TwoHandActive = true;return true;
        }
        public void UpdateTwoHand(Vector3 left, Vector3 right, bool tracked)
        {
            if (!TwoHandActive) return;
            if (!tracked || !Finite(left) || !Finite(right) || (right - left).magnitude < .03f) { EndTwoHand(false);return; }
            var ratio = Mathf.Clamp((right - left).magnitude / _handAxis.magnitude, .01f / _handScale.x, 100 / _handScale.x);
            var rotation = Quaternion.FromToRotation(_handAxis, right - left);
            Root.SetPositionAndRotation((left + right) / 2 + rotation * (_handPosition - _handMidpoint) * ratio, rotation * _handRotation);
            Root.localScale = _handScale * ratio;
        }
        public void EndTwoHand(bool confirm)
        {
            if (!TwoHandActive) return;
            TwoHandActive = false;
            if (!confirm) { Root.SetPositionAndRotation(_handPosition, _handRotation);Root.localScale = _handScale;return; }
            var previouslySaved = _liveSavedAnchor;
            InvalidatePendingAnchorIntent();
            _anchor = Root.TransformPoint(_localContact);_hasAnchor = true;ScaleName = "Manuale";
            if (previouslySaved)
            {
                AnchorPersistenceStatus = "Manipolazione non persistita: il vecchio ancoraggio torna al prossimo avvio";
            }
            Status = previouslySaved
                ? "Manipolazione non salvata · Posiziona/Conferma per sostituire il vecchio ancoraggio"
                : "Vista libera · quote CAD in mm";
            SavePreferences();
        }
        void OnApplicationFocus(bool focused) { if (!focused) { CancelPlacement();EndTwoHand(false); } }
        void OnApplicationPause(bool paused) { if (paused) { CancelPlacement();EndTwoHand(false); } }
        void OnDestroy()
        {
            if (Connection != null) { Connection.SceneChanged -= FirstModel; SetPreviewStyle(false); }
            _confirmationGeneration++;
            _pendingAnchorPermission = null;
            _anchorStore?.Dispose();
            _anchorStore = null;
            RemoveMarker();
        }
    }
}
