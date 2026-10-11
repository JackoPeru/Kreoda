using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Kreoda.QuestFoundation;
using UnityEngine;

namespace Kreoda.QuestRuntime
{
    public sealed class QuestVoice : MonoBehaviour
    {
        public QuestConnection Connection;
        public QuestControls Controls;
        public AudioSource Audio;
        public bool Recording { get; private set; }
        public bool Busy { get; private set; }
        public bool Configured => _client != null;
        public string Status { get; private set; } = "Voce non configurata";
        public string Transcript { get; private set; } = "";
        public string Reply { get; private set; } = "";
        readonly ConcurrentQueue<Action> _main = new ConcurrentQueue<Action>();
        HermesVoiceClient _client;
        CancellationTokenSource _run;
        TaskCompletionSource<bool> _playDone;
        AudioClip _microphone, _ownedClip;
        string _device, _file;
        float _started;
        string _micSession, _micDocument;
        long _micRevision;
        string[] _micSelection;
        long _ticket;
        bool _destroyed;

        [Serializable] sealed class SavedVoice { public string Endpoint, Token; }
        void Awake()
        {
            var directory = Application.persistentDataPath;
#if UNITY_ANDROID && !UNITY_EDITOR
            using (var player = new AndroidJavaClass("com.unity3d.player.UnityPlayer"))
            using (var activity = player.GetStatic<AndroidJavaObject>("currentActivity"))
            using (var files = activity.Call<AndroidJavaObject>("getFilesDir"))
                directory = files.Call<string>("getAbsolutePath");
#endif
            _file = Path.Combine(directory, "kreoda-voice.json");
            try {
                if (File.Exists(_file)) {
                    var saved = JsonUtility.FromJson<SavedVoice>(File.ReadAllText(_file));
                    Configure(saved.Endpoint, saved.Token, false);
                }
            } catch { Status = "Configurazione voce non valida"; }
#if UNITY_ANDROID && !UNITY_EDITOR
            using (var player = new AndroidJavaClass("com.unity3d.player.UnityPlayer"))
            using (var activity = player.GetStatic<AndroidJavaObject>("currentActivity"))
            using (var intent = activity.Call<AndroidJavaObject>("getIntent")) {
                using var component = intent.Call<AndroidJavaObject>("getComponent");
                var endpoint = intent.Call<string>("getStringExtra", "kreoda.voice-url");
                var token = intent.Call<string>("getStringExtra", "kreoda.voice-token");
                intent.Call("removeExtra", "kreoda.voice-url");intent.Call("removeExtra", "kreoda.voice-token");
                ApplyStartupConfiguration(component?.Call<string>("getClassName"), endpoint, token);
            }
#endif
        }
        bool ApplyStartupConfiguration(string component, string endpoint, string token)
        {
            return QuestProvisioning.Trusted(component) && !string.IsNullOrEmpty(endpoint) && Configure(endpoint, token, true);
        }
        public bool Configure(string endpoint, string token, bool persist)
        {
            HermesVoiceClient next;
            try { next = new HermesVoiceClient(new Uri(endpoint), token); }
            catch { Status = "Configurazione voce non valida";return false; }
            Cancel();_client?.Dispose();_client = next;Status = "Hermes pronto · premi Parla";
            if (persist) {
                try { File.WriteAllText(_file, JsonUtility.ToJson(new SavedVoice { Endpoint = endpoint, Token = token })); }
                catch { Status = "Voce pronta; configurazione non salvata"; }
            }
            return true;
        }
        public void Toggle()
        {
            if (Recording) { FinishRecording();return; }
            if (Busy) { Cancel();return; }
            if (!Configured) { Status = "Voce non configurata";return; }
            if (Connection == null || !Connection.Connected) { Status = "Collega il modello prima di parlare";return; }
#if UNITY_ANDROID && !UNITY_EDITOR
            if (!UnityEngine.Android.Permission.HasUserAuthorizedPermission(UnityEngine.Android.Permission.Microphone)) {
                Status = "Microfono non autorizzato";return;
            }
#endif
            if (Microphone.devices.Length == 0) { Status = "Microfono non disponibile";return; }
            Cancel();_device = Microphone.devices[0];
            try {
                var model = Connection.Client?.Model ?? throw new InvalidOperationException("Modello non connesso");
                _micSession = model.SessionId;_micDocument = model.DocumentId;_micRevision = model.Revision;
                _micSelection = Controls != null ? Controls.SelectionForVoice() : Array.Empty<string>();
                _microphone = Microphone.Start(_device, false, 30, 16000);
                if (_microphone == null) throw new InvalidOperationException();
                _started = Time.realtimeSinceStartup;Recording = Busy = true;
                Transcript = Reply = "";Status = "Ascolto · premi Invia";
            } catch { Cancel();Status = "Impossibile avviare il microfono"; }
        }
        void FinishRecording()
        {
            var clip = _microphone;
            if (clip == null) { Cancel();return; }
            try {
                var frames = Microphone.GetPosition(_device);
                if (frames == 0 && Time.realtimeSinceStartup - _started >= 29) frames = clip.samples;
                Microphone.End(_device);Recording = false;
                if (frames <= 0) throw new ArgumentException("Nessun audio registrato");
                var raw = new float[frames * clip.channels];
                if (!clip.GetData(raw, 0)) throw new ArgumentException("Audio microfono non disponibile");
                var mono = new float[frames];
                for (var i = 0; i < frames; i++) for (var c = 0; c < clip.channels; c++) mono[i] += raw[i * clip.channels + c] / clip.channels;
                var rate = clip.frequency;DestroyOwned(clip);_microphone = null;
                var model = Connection.Client?.Model ?? throw new InvalidOperationException("Modello non connesso");
                if (model.SessionId != _micSession || model.DocumentId != _micDocument || model.Revision != _micRevision)
                    throw new InvalidOperationException("Modello cambiato; ripeti la domanda");
                var context = JsonSerializer.SerializeToElement(new Dictionary<string, object> {
                    ["voiceRequestId"] = Guid.NewGuid().ToString("D"),
                    ["project"] = "Kreoda", ["sessionId"] = model.SessionId, ["documentId"] = model.DocumentId,
                    ["revision"] = model.Revision, ["selectionIds"] = _micSelection,
                    ["units"] = "mm; angoli con unità dichiarata", ["language"] = "it",
                });
                _run = new CancellationTokenSource();var token = _run.Token;var ticket = ++_ticket;var client = _client;
                Status = "Trascrizione…";
                _ = Task.Run(() => Flow(ticket, client, mono, rate, context, token));
            } catch (Exception error) { Cancel();Status = error.Message.Length <= 120 ? error.Message : "Audio non disponibile"; }
        }
        async Task Flow(long ticket, HermesVoiceClient client, float[] samples, int rate, JsonElement context, CancellationToken token)
        {
            try {
                var text = await client.TranscribeAsync(VoiceWave.EncodeMono(samples, rate), token).ConfigureAwait(false);
                Post(ticket, () => { Transcript = text;Status = "Hermes sta rispondendo…"; });
                var reply = await client.TalkAsync(text, context, token).ConfigureAwait(false);
                Post(ticket, () => { Reply = reply.Text;Status = "Hermes parla…"; });
                foreach (var segment in SpeechSegments(reply.Text)) {
                    token.ThrowIfCancellationRequested();
                    var audio = await client.SpeechAsync(segment, token).ConfigureAwait(false);
                    var done = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
                    using (token.Register(() => done.TrySetCanceled())) {
                        Post(ticket, () => Play(audio, done));
                        await done.Task.ConfigureAwait(false);
                    }
                }
                Post(ticket, () => Complete("Hermes pronto · premi Parla"));
            } catch (OperationCanceledException) { }
            catch (Exception error) { Post(ticket, () => Complete(error is VoiceServiceException ? error.Message : "Voce non disponibile")); }
        }
        void Complete(string status) { Busy = false;_run?.Dispose();_run = null;Status = status; }
        internal static IEnumerable<string> SpeechSegments(string text)
        {
            for (var offset = 0; offset < text.Length;) {
                var count = Math.Min(600, text.Length - offset);
                if (offset + count < text.Length) {
                    var space = text.LastIndexOf(' ', offset + count - 1, count);
                    if (space > offset) count = space - offset + 1;
                }
                var part = text.Substring(offset, count).Trim();offset += count;
                if (part.Length > 0) yield return part;
            }
        }
        void Play(VoiceAudio audio, TaskCompletionSource<bool> done)
        {
            StopPlayback();
            if (Audio == null) { done.TrySetException(new InvalidOperationException("Audio output unavailable"));return; }
            _ownedClip = AudioClip.Create("Hermes reply", audio.Samples.Length / audio.Channels, audio.Channels, audio.SampleRate, false);
            if (!_ownedClip.SetData(audio.Samples, 0)) { StopPlayback();done.TrySetException(new InvalidOperationException("Audio decode unavailable"));return; }
            _playDone = done;Audio.clip = _ownedClip;Audio.Play();
        }
        void Post(long ticket, Action action) => _main.Enqueue(() => { if (!_destroyed && ticket == _ticket && isActiveAndEnabled) action(); });
        void Update()
        {
            while (_main.TryDequeue(out var action)) action();
            if (Recording && Time.realtimeSinceStartup - _started >= 29.5f) FinishRecording();
            if (Busy && Connection != null && !Connection.Connected) Cancel();
#if !UNITY_EDITOR
            if (Busy && (!OVRManager.isHmdPresent || !OVRPlugin.GetNodePositionTracked(OVRPlugin.Node.EyeCenter))) Cancel();
#endif
            if (_playDone != null && Audio != null && !Audio.isPlaying) {
                var completed = _playDone;_playDone = null;StopPlayback();completed.TrySetResult(true);
            }
        }
        void StopPlayback()
        {
            if (Audio != null && Audio.clip == _ownedClip && _ownedClip != null) { Audio.Stop();Audio.clip = null; }
            if (_ownedClip != null) { DestroyOwned(_ownedClip);_ownedClip = null; }
            _playDone?.TrySetCanceled();_playDone = null;
        }
        static void DestroyOwned(UnityEngine.Object value) { if (Application.isPlaying) Destroy(value);else DestroyImmediate(value); }
        public void Cancel()
        {
            _ticket++;
            if (Recording && !string.IsNullOrEmpty(_device)) Microphone.End(_device);
            Recording = Busy = false;
            if (_microphone != null) { DestroyOwned(_microphone);_microphone = null; }
            _run?.Cancel();_run?.Dispose();_run = null;StopPlayback();
            while (_main.TryDequeue(out _)) { }
            Status = Configured ? "Voce fermata" : "Voce non configurata";
        }
        void OnApplicationFocus(bool focus) { if (!focus) Cancel(); }
        void OnApplicationPause(bool pause) { if (pause) Cancel(); }
        void OnDisable() { Cancel(); }
        void OnDestroy() { _destroyed = true;Cancel();_client?.Dispose();_client = null; }
    }
}
