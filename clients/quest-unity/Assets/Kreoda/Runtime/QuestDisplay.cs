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
        Transform Root => Connection.DisplayRoot;
        Vector3 _anchor, _localContact, _oldPosition, _oldScale, _oldAnchor, _oldContact;
        Quaternion _oldRotation;
        string _oldScaleName;
        float _oldCalibration;
        bool _hasAnchor, _oldHasAnchor, _candidateTracked, _preferencesReady, _firstModel;
        GameObject _marker;

        void Start()
        {
            ScaleName = PlayerPrefs.GetString("kreoda-display-scale", "Fit");
            if (ScaleName != "Fit")
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
            if (_marker != null) _marker.transform.position = _anchor;
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
            if (PlacementActive || !Bounds(out _, out _)) return false;
            _oldPosition = Root.position; _oldRotation = Root.rotation; _oldScale = Root.localScale;
            _oldAnchor = _anchor; _oldContact = _localContact; _oldHasAnchor = _hasAnchor;
            _oldScaleName = ScaleName; _oldCalibration = HeightCalibration;
            PlacementActive = FollowPointer = true;
            SetPreviewStyle(true);
            _candidateTracked = false;
            Status = "Controller sul tavolo → trigger ferma\nRuota controller per orientare · poi Conferma";
            if (MarkerMaterial != null)
            {
                _marker = GameObject.CreatePrimitive(PrimitiveType.Sphere);
                _marker.name = "Physical placement contact";
                _marker.transform.localScale = Vector3.one * .012f;
                _marker.GetComponent<Collider>().enabled = false;
                _marker.GetComponent<MeshRenderer>().sharedMaterial = MarkerMaterial;
            }
            return true;
        }

        public void UpdatePlacement(Vector3 point, float yaw, bool tracked)
        {
            if (!PlacementActive) return;
            _candidateTracked = tracked && Finite(point) && Finite(yaw);
            if (!_candidateTracked) { Status = "Tracking perso: conferma disabilitata"; return; }
            if (FollowPointer) Place(point + Vector3.up * HeightCalibration, yaw);
        }

        public void FreezePlacement()
        {
            if (!PlacementActive || !_candidateTracked) return;
            FollowPointer = !FollowPointer;
            Status = FollowPointer ? "Muovi/ruota controller · trigger ferma" : "Punto fermato · regola quota, Conferma o Annulla";
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
            Status = "Quota controller: " + (HeightCalibration * 1000).ToString("0") + " mm · Conferma o Annulla";
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
            CancelPlacement();
            var head = Rig != null ? Rig.centerEyeAnchor : Camera.main?.transform;
            if (head == null) return;
            var forward = Vector3.ProjectOnPlane(head.forward, Vector3.up).normalized;
            if (forward.sqrMagnitude < .01f) forward = Vector3.forward;
            Place(head.position + forward * .8f - Vector3.up * .3f, Mathf.Atan2(forward.x, forward.z) * Mathf.Rad2Deg);
            Status = "Vista centrata davanti a te";
            if (_preferencesReady) { PlayerPrefs.SetString("kreoda-placement-mode", "head"); SavePreferences(); }
        }

        void FirstModel()
        {
            SetPreviewStyle(PlacementActive);
            if (_firstModel || PlacementActive || Connection.PendingMeshCount > 0 || !Bounds(out _, out _)) return;
            if (_hasAnchor) { _firstModel = true; return; }
            _firstModel = true;
            Recenter(); SetScale(ScaleName);
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
        }
        static bool Finite(float value) => !float.IsNaN(value) && !float.IsInfinity(value);
        static bool Finite(Vector3 value) => Finite(value.x) && Finite(value.y) && Finite(value.z);
        void OnApplicationFocus(bool focused) { if (!focused) CancelPlacement(); }
        void OnApplicationPause(bool paused) { if (paused) CancelPlacement(); }
        void OnDestroy()
        {
            if (Connection != null) { Connection.SceneChanged -= FirstModel; SetPreviewStyle(false); }
            RemoveMarker();
        }
    }
}
