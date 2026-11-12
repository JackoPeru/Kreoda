using System;
using Kreoda.QuestFoundation;
using UnityEngine;

namespace Kreoda.QuestRuntime
{
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
        Vector3 _handMidpoint, _handAxis, _handPosition, _handScale;
        Quaternion _handRotation;
        Transform Root => Connection.DisplayRoot;
        Vector3 _anchor, _localContact, _oldPosition, _oldScale, _oldAnchor, _oldContact;
        Quaternion _oldRotation;
        string _oldScaleName;
        float _oldCalibration;
        bool _hasAnchor, _oldHasAnchor, _candidateTracked, _preferencesReady, _firstModel;
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
            Status = "Scala " + name + " · quote CAD in mm";
            if (!PlacementActive) SavePreferences();
            return true;
        }

        public bool BeginPlacement()
        {
            EndTwoHand(false);
            if (PlacementActive || !Bounds(out _, out _)) return false;
            _oldPosition = Root.position; _oldRotation = Root.rotation; _oldScale = Root.localScale;
            _oldAnchor = _anchor; _oldContact = _localContact; _oldHasAnchor = _hasAnchor;
            _oldScaleName = ScaleName; _oldCalibration = HeightCalibration;
            PlacementActive = FollowPointer = true;
            SetPreviewStyle(true);
            _candidateTracked = false;
            Status = "Punta sul tavolo → seleziona per fermare\nOrienta il raggio · poi Conferma";
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
        {
            if (!PlacementActive) return;
            _candidateTracked = tracked && Finite(point) && Finite(yaw);
            if (!_candidateTracked)
            {
                if (_marker != null) _marker.SetActive(false);
                Status = "Tracking perso: conferma disabilitata";
                return;
            }
            if (FollowPointer) Place(point + Vector3.up * HeightCalibration, yaw);
            else UpdatePlacementFootprint();
        }

        public void FreezePlacement()
        {
            if (!PlacementActive || !_candidateTracked) return;
            FollowPointer = !FollowPointer;
            UpdatePlacementFootprint();
            Status = FollowPointer ? "Muovi/orienta il raggio · seleziona per fermare" : "Punto fermato · regola quota, Conferma o Annulla";
        }

        public bool ConfirmPlacement(bool tracked)
        {
            if (!PlacementActive || FollowPointer || !_candidateTracked || !tracked) return false;
            PlacementActive = false;
            SetPreviewStyle(false);
            RemoveMarker();
            Status = "Modello posizionato · ancoraggio locale per questa sessione";
            if (_preferencesReady) PlayerPrefs.SetString("kreoda-placement-mode", "table");
            SavePreferences();
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
            EndTwoHand(false);
            CancelPlacement();
            var head = Rig != null ? Rig.centerEyeAnchor : Camera.main?.transform;
            if (head == null) return;
            var forward = Vector3.ProjectOnPlane(head.forward, Vector3.up).normalized;
            if (forward.sqrMagnitude < .01f) forward = Vector3.forward;
            Place(head.position + forward * .8f - Vector3.up * .3f, Mathf.Atan2(forward.x, forward.z) * (180f / (float)Math.PI));
            Status = "Vista centrata davanti a te";
            if (_preferencesReady) { PlayerPrefs.SetString("kreoda-placement-mode", "head"); SavePreferences(); }
        }

        void FirstModel()
        {
            SetPreviewStyle(PlacementActive);
            if (_firstModel || PlacementActive || Connection.PendingMeshCount > 0 || !Bounds(out _, out _)) return;
            if (_hasAnchor) { _firstModel = true; return; }
            _firstModel = true;
            Recenter(); if (ScaleName != "Manuale") SetScale(ScaleName);
            // CAD changes after initial hydration never recenter or recompute Fit.
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
            _anchor = Root.TransformPoint(_localContact);_hasAnchor = true;ScaleName = "Manuale";
            Status = "Vista libera · quote CAD in mm";SavePreferences();
        }
        void OnApplicationFocus(bool focused) { if (!focused) { CancelPlacement();EndTwoHand(false); } }
        void OnApplicationPause(bool paused) { if (paused) { CancelPlacement();EndTwoHand(false); } }
        void OnDestroy()
        {
            if (Connection != null) { Connection.SceneChanged -= FirstModel; SetPreviewStyle(false); }
            RemoveMarker();
        }
    }
}
