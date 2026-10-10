using UnityEngine;
using UnityEngine.Profiling;

namespace Kreoda.QuestRuntime
{
    public sealed class QuestEnvironment : MonoBehaviour
    {
        public OVRCameraRig Rig;
        public OVRManager Manager;
        public OVRPassthroughLayer Layer;
        public QuestConnection Connection;
        public GameObject VrReference;
        public bool PreferMr { get; private set; } = true;
        public bool IsMrVisible { get; private set; }
        public string Status { get; private set; } = "MR in avvio · ambiente VR disponibile";
        public string Diagnostics { get; private set; } = "Metriche: attendi un campione";
        Camera[] _eyes;
        bool _layerResumed;
        double _nextEnvironment, _lastSample, _frameSeconds;
        int _frames;

        void Start()
        {
            _eyes = Rig.GetComponentsInChildren<Camera>(true);
            Layer.passthroughLayerResumed.AddListener(LayerResumed);
            OVRManager.OnPassthroughInitializedStateChange += InitializationChanged;
            PreferMr = PlayerPrefs.GetInt("kreoda-passthrough", 1) != 0;
            SetPreference(PreferMr, false);
            _lastSample = Time.realtimeSinceStartupAsDouble;
        }

        public void Toggle() => SetPreference(!PreferMr, true);

        void SetPreference(bool mr, bool save)
        {
            PreferMr = mr;
            _layerResumed = false;
            // Failed initialization is latched by Core207. Offer VR and app
            // relaunch instead of pretending an enable toggle retries it.
            var canStart = mr && !OVRManager.HasInsightPassthroughInitFailed();
            Manager.isInsightPassthroughEnabled = canStart;
            Layer.enabled = canStart;
            Layer.hidden = !canStart;
            RefreshEnvironment();
            if (save) { PlayerPrefs.SetInt("kreoda-passthrough", mr ? 1 : 0); PlayerPrefs.Save(); }
        }

        void LayerResumed(OVRPassthroughLayer layer) { _layerResumed = true; RefreshEnvironment(); }
        void InitializationChanged(bool initialized) { if (!initialized) _layerResumed = false; RefreshEnvironment(); }

        void RefreshEnvironment()
        {
            var failed = OVRManager.HasInsightPassthroughInitFailed();
            var visible = PreferMr && !failed && OVRManager.IsInsightPassthroughInitialized() &&
                _layerResumed && Layer.isActiveAndEnabled;
            IsMrVisible = visible;
            if (_eyes != null)
                foreach (var eye in _eyes)
                {
                    eye.clearFlags = CameraClearFlags.SolidColor;
                    eye.backgroundColor = visible ? Color.clear : new Color(.035f, .045f, .065f, 1);
                }
            if (VrReference != null && VrReference.activeSelf == visible) VrReference.SetActive(!visible);
            Status = !PreferMr ? "VR · stesso modello CAD" : visible ? "MR attivo · passthrough presentato" :
                failed ? "MR non disponibile · VR attivo. Riavvia app per riprovare" :
                OVRManager.IsInsightPassthroughInitPending() ? "MR in avvio · VR temporaneo" :
                "MR non pronto · VR disponibile";
        }

        void Update()
        {
            _frames++;
            _frameSeconds += Time.unscaledDeltaTime;
            var now = Time.realtimeSinceStartupAsDouble;
            if (now >= _nextEnvironment) { _nextEnvironment = now + .25; RefreshEnvironment(); }
            if (now - _lastSample < 1) return;
            var seconds = now - _lastSample;
            var fps = _frames / seconds;
            var frameMs = _frames > 0 ? _frameSeconds * 1000 / _frames : 0;
            var refresh = OVRManager.display?.displayFrequency ?? 0;
            var target = refresh > 0 ? refresh.ToString("0") + " Hz" : "n/d";
            Diagnostics = string.Format("{0:0} FPS · {1:0.0} ms · target {2}\nRTT {3} · mesh ultimo {4}\nUnity {5:0.0} MB · {6:N0} triangoli\nPreview n/d · scartate/cancellate {7}",
                fps, frameMs, target, Milliseconds(Connection.RttMilliseconds), Milliseconds(Connection.MeshMilliseconds),
                Profiler.GetTotalAllocatedMemoryLong() / 1048576d, Connection.TriangleCount, Connection.DiscardedMeshes);
            _lastSample = now; _frames = 0; _frameSeconds = 0;
        }

        static string Milliseconds(double? value) => value.HasValue ? value.Value.ToString("0.0") + " ms" : "n/d";
        void OnApplicationPause(bool paused)
        {
            _lastSample = Time.realtimeSinceStartupAsDouble; _frames = 0; _frameSeconds = 0;
            if (paused) { _layerResumed = false; IsMrVisible = false; }
        }
        void OnDestroy()
        {
            if (Layer != null) Layer.passthroughLayerResumed.RemoveListener(LayerResumed);
            OVRManager.OnPassthroughInitializedStateChange -= InitializationChanged;
        }
    }
}
