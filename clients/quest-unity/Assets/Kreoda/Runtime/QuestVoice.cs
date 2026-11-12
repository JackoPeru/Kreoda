using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Kreoda.QuestFoundation;
using Kreoda.Session;
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
        public bool Configured => _ready && _provider != null && IsBoundToCurrentSource();
        public string Status { get; private set; } = "Voce non configurata";
        public string Transcript { get; private set; } = "";
        public string Reply { get; private set; } = "";

        readonly ConcurrentQueue<Action> _main = new ConcurrentQueue<Action>();
        IVoiceClient _provider;
        // Kept as a separate reference for the explicit legacy provider and existing editor diagnostics.
        HermesVoiceClient _client;
        SessionClient _boundClient;
        SourceSnapshot _observedSource, _boundSource;
        CancellationTokenSource _run;
        TaskCompletionSource<bool> _playDone;
        AudioClip _microphone, _ownedClip;
        VoiceCapture _capture;
        string _device, _file, _legacyEndpoint, _legacyToken;
        float _started, _nextProbeAt;
        long _sourceEpoch, _boundEpoch, _ticket, _probeId;
        int _probeAttempt;
        bool _probePending, _ready, _destroyed;
        QuestVoiceContext.VoiceSnapshot _micContext;

        [Serializable] sealed class SavedVoice { public string Endpoint, Token; }

        sealed class SourceSnapshot
        {
            internal readonly QuestConnection Connection;
            internal readonly bool Connected, HasModel;
            internal readonly SessionClient Client;
            internal readonly long Generation;
            internal readonly string SessionId, DocumentId;

            internal SourceSnapshot(QuestConnection connection, bool connected, SessionClient client,
                long generation, bool hasModel, string sessionId, string documentId)
            {
                Connection = connection;Connected = connected;Client = client;Generation = generation;
                HasModel = hasModel;SessionId = sessionId;DocumentId = documentId;
            }

            internal bool HasLineage => Connected && Client != null && Client.IsConnected && HasModel &&
                !string.IsNullOrWhiteSpace(SessionId) && !string.IsNullOrWhiteSpace(DocumentId);

            internal bool SameSource(SourceSnapshot other) => other != null &&
                ReferenceEquals(Connection, other.Connection) && Connected == other.Connected &&
                ReferenceEquals(Client, other.Client) && Generation == other.Generation && HasModel == other.HasModel &&
                string.Equals(SessionId, other.SessionId, StringComparison.Ordinal) &&
                string.Equals(DocumentId, other.DocumentId, StringComparison.Ordinal);

            internal bool SameLineage(SourceSnapshot other) => other != null && HasLineage && other.HasLineage &&
                ReferenceEquals(Connection, other.Connection) && ReferenceEquals(Client, other.Client) &&
                Generation == other.Generation && SessionId == other.SessionId && DocumentId == other.DocumentId;
        }

        sealed class VoiceCapture
        {
            internal IVoiceClient Provider;
            internal SessionClient Client;
            internal QuestConnection Connection;
            internal QuestVoiceContext.VoiceSnapshot Context;
            internal JsonElement WireContext;
            internal string SessionId, DocumentId, VoiceRequestId;
            internal long Revision, Generation, SourceEpoch, Ticket;
        }

        void Awake()
        {
            string directory;
#if UNITY_EDITOR
            directory = QuestConnection.ResolveEditorStorageDirectory(Application.persistentDataPath);
#else
            directory = Application.persistentDataPath;
#endif
#if UNITY_ANDROID && !UNITY_EDITOR
            using (var player = new AndroidJavaClass("com.unity3d.player.UnityPlayer"))
            using (var activity = player.GetStatic<AndroidJavaObject>("currentActivity"))
            using (var files = activity.Call<AndroidJavaObject>("getFilesDir"))
                directory = files.Call<string>("getAbsolutePath");
#endif
            _file = Path.Combine(directory, "kreoda-voice.json");
            try
            {
                if (File.Exists(_file))
                {
                    var saved = JsonUtility.FromJson<SavedVoice>(File.ReadAllText(_file));
                    if (saved != null && ValidateLegacyConfiguration(saved.Endpoint, saved.Token))
                    { _legacyEndpoint = saved.Endpoint;_legacyToken = saved.Token; }
                    else Status = "Configurazione voce non valida";
                }
            }
            catch { Status = "Configurazione voce non valida"; }
#if UNITY_ANDROID && !UNITY_EDITOR
            using (var player = new AndroidJavaClass("com.unity3d.player.UnityPlayer"))
            using (var activity = player.GetStatic<AndroidJavaObject>("currentActivity"))
            using (var intent = activity.Call<AndroidJavaObject>("getIntent"))
            {
                using var component = intent.Call<AndroidJavaObject>("getComponent");
                var endpoint = intent.Call<string>("getStringExtra", "kreoda.voice-url");
                var token = intent.Call<string>("getStringExtra", "kreoda.voice-token");
                intent.Call("removeExtra", "kreoda.voice-url");intent.Call("removeExtra", "kreoda.voice-token");
                ApplyStartupConfiguration(component?.Call<string>("getClassName"), endpoint, token);
            }
#endif
            RefreshSourceBinding();
        }

        bool ApplyStartupConfiguration(string component, string endpoint, string token)
        {
            if (!QuestProvisioning.Trusted(component) || !StoreLegacyCandidate(endpoint, token, false)) return false;
            Status = TryPersistLegacyCandidate(true) ? "Configurazione voce salvata" : "Configurazione voce non salvata";
            return true;
        }

        public bool Configure(string endpoint, string token, bool persist)
        {
            HermesVoiceClient next;
            try { next = new HermesVoiceClient(new Uri(endpoint), token); }
            catch { Status = "Configurazione voce non valida";return false; }

            _legacyEndpoint = endpoint;_legacyToken = token;
            var saved = persist && TryPersistLegacyCandidate(true);
            RefreshSourceBinding();
            var source = CaptureSource();
            if (!source.HasLineage)
            {
                CancelRun(null);DisposeProvider();AdvanceSourceEpoch();
                _boundSource = null;_boundClient = null;_ready = false;
                next.Dispose();
                Status = source.Connected ? "Servizi di sessione in avvio…" : saved
                    ? "PC non connesso · configurazione salvata" : "PC non connesso · configurazione in memoria";
                return true;
            }

            CancelRun(null);DisposeProvider();AdvanceSourceEpoch();
            Bind(source, next, legacy: true, ready: true);
            Status = !persist || saved ? "Hermes pronto · premi Parla" : "Hermes pronto; configurazione non salvata";
            return true;
        }

        bool StoreLegacyCandidate(string endpoint, string token, bool persist)
        {
            if (!ValidateLegacyConfiguration(endpoint, token)) return false;
            _legacyEndpoint = endpoint;_legacyToken = token;
            TryPersistLegacyCandidate(persist);
            return true;
        }

        bool ValidateLegacyConfiguration(string endpoint, string token)
        {
            try { using (var validator = new HermesVoiceClient(new Uri(endpoint), token)) { } return true; }
            catch { return false; }
        }

        bool TryPersistLegacyCandidate(bool persist)
        {
            if (!persist) return true;
            try
            {
                File.WriteAllText(_file, JsonUtility.ToJson(new SavedVoice { Endpoint = _legacyEndpoint, Token = _legacyToken }));
                return true;
            }
            catch { return false; }
        }

        internal bool TryCaptureRecordingSnapshot(out QuestVoiceContext.VoiceSnapshot snapshot, out string error)
        {
            if (Controls != null) return Controls.TryCaptureVoiceSnapshot(out snapshot, out error);
            var model = Connection != null ? Connection.Client?.Model : null;
            if (model == null || Connection == null || !Connection.Connected)
            { snapshot = null;error = "Modello non connesso";return false; }
            snapshot = new QuestVoiceContext.VoiceSnapshot(QuestVoiceContext.CaptureFence(Connection),
                Array.Empty<string>(), null, false, 0, Array.Empty<object>(), Array.Empty<int>());
            error = null;return true;
        }

        bool IsRecordingSnapshotCurrent(QuestVoiceContext.VoiceSnapshot snapshot)
        {
            if (Controls != null) return Controls.IsVoiceSnapshotCurrent(snapshot);
            var model = Connection != null ? Connection.Client?.Model : null;
            if (model == null || Connection == null || !Connection.Connected) return false;
            var current = new QuestVoiceContext.VoiceSnapshot(QuestVoiceContext.CaptureFence(Connection),
                Array.Empty<string>(), null, false, 0, Array.Empty<object>(), Array.Empty<int>());
            return snapshot != null && snapshot.Matches(current);
        }

        SourceSnapshot CaptureSource()
        {
            var connection = Connection;
            if (connection == null) return new SourceSnapshot(null, false, null, 0, false, null, null);
            var client = connection.Client;
            var model = client != null ? client.Model : null;
            return new SourceSnapshot(connection, connection.Connected, client, connection.ConnectionGeneration,
                model != null, model != null ? model.SessionId : null, model != null ? model.DocumentId : null);
        }

        bool IsCapturedSourceCurrent(SourceSnapshot source, long epoch)
        {
            if (source == null) return false;
            return IsCapturedSourceCurrent(source.Connection, source.Client, source.Generation,
                source.SessionId, source.DocumentId, epoch);
        }

        bool IsCapturedSourceCurrent(VoiceCapture capture)
        {
            return capture != null && IsCapturedSourceCurrent(capture.Connection, capture.Client, capture.Generation,
                capture.SessionId, capture.DocumentId, capture.SourceEpoch);
        }

        bool IsCapturedSourceCurrent(QuestConnection expectedConnection, SessionClient expectedClient,
            long expectedGeneration, string expectedSessionId, string expectedDocumentId, long expectedEpoch)
        {
            try
            {
                if (ReferenceEquals(expectedConnection, null)) return false;
                var currentConnection = Connection;
                var currentClient = expectedConnection.Client;
                if (ReferenceEquals(currentClient, null)) return false;
                var model = currentClient.Model;
                return SourceStampMatches(Volatile.Read(ref _sourceEpoch), expectedEpoch,
                    currentConnection, expectedConnection, currentClient, expectedClient,
                    expectedConnection.Connected, expectedConnection.ConnectionGeneration, expectedGeneration,
                    currentClient.IsConnected, model?.SessionId, model?.DocumentId,
                    expectedSessionId, expectedDocumentId);
            }
            catch { return false; }
        }

        internal static bool SourceStampMatches(long currentEpoch, long expectedEpoch,
            object currentConnection, object expectedConnection, object currentClient, object expectedClient,
            bool connected, long currentGeneration, long expectedGeneration, bool clientConnected,
            string sessionId, string documentId, string expectedSessionId, string expectedDocumentId)
        {
            return currentEpoch == expectedEpoch &&
                !ReferenceEquals(currentConnection, null) && ReferenceEquals(currentConnection, expectedConnection) &&
                !ReferenceEquals(currentClient, null) && ReferenceEquals(currentClient, expectedClient) &&
                connected && currentGeneration == expectedGeneration && clientConnected &&
                string.Equals(sessionId, expectedSessionId, StringComparison.Ordinal) &&
                string.Equals(documentId, expectedDocumentId, StringComparison.Ordinal);
        }

        void RefreshSourceBinding()
        {
            var source = CaptureSource();
            if (_observedSource == null || !_observedSource.SameSource(source)) BindForSourceChange(source);
            if (_provider is SessionVoiceClient && !_ready && !_probePending && !Busy && !Recording &&
                Time.realtimeSinceStartup >= _nextProbeAt) BeginVoiceProbe();
        }

        void BindForSourceChange(SourceSnapshot source)
        {
            CancelRun(null);DisposeProvider();
            _sourceEpoch = Interlocked.Increment(ref _sourceEpoch);
            _observedSource = source;_boundSource = null;_boundClient = null;_boundEpoch = _sourceEpoch;
            _ready = false;_probePending = false;_probeAttempt = 0;_probeId++;
            if (!source.Connected) { Status = "PC non connesso";return; }
            if (!source.HasLineage) { Status = "Servizi di sessione in avvio…";return; }

            if (SupportsVoiceV1(source.Client))
            {
                var epoch = _sourceEpoch;
                Bind(source, new SessionVoiceClient(source.Client,
                    () => IsCapturedSourceCurrent(source, epoch)), legacy: false, ready: false);
                Status = "Servizi vocali in avvio…";_nextProbeAt = Time.realtimeSinceStartup;
                return;
            }
            Status = "Voce non configurata sul PC";
        }

        static bool SupportsVoiceV1(SessionClient client)
        {
            foreach (var capability in client.ServerCapabilities)
                if (string.Equals(capability, SessionMethods.VoiceV1Capability, StringComparison.Ordinal)) return true;
            return false;
        }

        void Bind(SourceSnapshot source, IVoiceClient provider, bool legacy, bool ready)
        {
            _provider = provider;_client = legacy ? provider as HermesVoiceClient : null;
            _boundSource = source;_boundClient = source.Client;_boundEpoch = _sourceEpoch;_ready = ready;
        }

        bool IsBoundToCurrentSource()
        {
            return _provider != null && _boundSource != null && _boundEpoch == Volatile.Read(ref _sourceEpoch) &&
                _boundSource.SameLineage(CaptureSource());
        }

        bool CaptureLineageCurrent(VoiceCapture capture)
        {
            if (capture == null || capture.SourceEpoch != Volatile.Read(ref _sourceEpoch) ||
                !ReferenceEquals(_provider, capture.Provider) || !ReferenceEquals(_boundClient, capture.Client) ||
                _boundSource == null || _boundEpoch != capture.SourceEpoch) return false;
            var current = CaptureSource();
            return _boundSource.SameLineage(current) && ReferenceEquals(current.Connection, capture.Connection) &&
                ReferenceEquals(current.Client, capture.Client) && current.Generation == capture.Generation &&
                current.SessionId == capture.SessionId && current.DocumentId == capture.DocumentId;
        }

        bool CaptureSemanticCurrent(VoiceCapture capture)
        {
            if (!CaptureLineageCurrent(capture)) return false;
            var model = capture.Client.Model;
            return model != null && model.SessionId == capture.SessionId && model.DocumentId == capture.DocumentId &&
                model.Revision == capture.Revision && IsRecordingSnapshotCurrent(capture.Context);
        }

        VoiceCapture CaptureVoiceRequest(SourceSnapshot source, QuestVoiceContext.VoiceSnapshot context)
        {
            var model = source.Client.Model;
            var requestId = Guid.NewGuid().ToString("D");
            var wireContext = JsonSerializer.SerializeToElement(new Dictionary<string, object>
            {
                ["voiceRequestId"] = requestId,
                ["project"] = "Kreoda",
                ["sessionId"] = model.SessionId,
                ["documentId"] = model.DocumentId,
                ["revision"] = model.Revision,
                ["selectionIds"] = context.SelectionIds,
                ["selectionContext"] = context.SelectionContextValue(),
                ["units"] = "mm; angoli con unità dichiarata",
                ["language"] = "it",
            });
            return new VoiceCapture
            {
                Provider = _provider,Client = source.Client,Connection = source.Connection,Context = context,
                WireContext = wireContext,SessionId = model.SessionId,DocumentId = model.DocumentId,
                VoiceRequestId = requestId,Revision = model.Revision,Generation = source.Generation,
                SourceEpoch = _sourceEpoch,
            };
        }

        public void Toggle()
        {
            if (Recording) { FinishRecording();return; }
            if (Busy) { Cancel();return; }
            RefreshSourceBinding();
            var source = CaptureSource();
            if (!source.Connected) { Status = "PC non connesso";return; }
            if (!source.HasLineage) { Status = "Servizi di sessione in avvio…";return; }
            if (!Configured)
            {
                if (_provider == null && !SupportsVoiceV1(source.Client)) Status = "Voce non configurata sul PC";
                return;
            }
#if UNITY_ANDROID && !UNITY_EDITOR
            if (!UnityEngine.Android.Permission.HasUserAuthorizedPermission(UnityEngine.Android.Permission.Microphone))
            { Status = "Microfono non autorizzato";return; }
#endif
            if (Microphone.devices.Length == 0) { Status = "Microfono non disponibile";return; }
            CancelRun(null);
            string snapshotError = null;
            try
            {
                if (!TryCaptureRecordingSnapshot(out _micContext, out snapshotError))
                    throw new InvalidOperationException(snapshotError ?? "Contesto voce non valido");
                var capture = CaptureVoiceRequest(source, _micContext);
                if (!CaptureSemanticCurrent(capture)) throw new InvalidOperationException("Contesto CAD cambiato; ripeti la domanda");
                _device = Microphone.devices[0];
                _microphone = Microphone.Start(_device, false, 30, 16000);
                if (_microphone == null) throw new InvalidOperationException("Microfono non disponibile");
                if (!CaptureSemanticCurrent(capture)) throw new InvalidOperationException("Modello cambiato; ripeti la domanda");
                _capture = capture;_started = Time.realtimeSinceStartup;Recording = Busy = true;
                Transcript = Reply = "";Status = "Ascolto · premi Invia";
            }
            catch (Exception error)
            {
                CancelRun(null);
                Status = !string.IsNullOrWhiteSpace(snapshotError) ? snapshotError : ShortError(error.Message, "Impossibile avviare il microfono");
            }
        }

        void FinishRecording()
        {
            var clip = _microphone;
            var capture = _capture;
            if (clip == null || capture == null) { Cancel();return; }
            try
            {
                var frames = Microphone.GetPosition(_device);
                if (frames == 0 && Time.realtimeSinceStartup - _started >= 29) frames = clip.samples;
                Microphone.End(_device);Recording = false;
                if (frames <= 0) throw new ArgumentException("Nessun audio registrato");
                var raw = new float[frames * clip.channels];
                if (!clip.GetData(raw, 0)) throw new ArgumentException("Audio microfono non disponibile");
                var mono = new float[frames];
                for (var i = 0; i < frames; i++)
                    for (var channel = 0; channel < clip.channels; channel++) mono[i] += raw[i * clip.channels + channel] / clip.channels;
                var rate = clip.frequency;DestroyOwned(clip);_microphone = null;
                if (!CaptureSemanticCurrent(capture)) throw new InvalidOperationException("Modello o contesto cambiato; ripeti la domanda");
                _run = new CancellationTokenSource();var token = _run.Token;
                capture.Ticket = ++_ticket;Status = "Trascrizione…";
                _ = Task.Run(() => Flow(capture, mono, rate, token));
            }
            catch (Exception error)
            {
                CancelRun(null);Status = ShortError(error.Message, "Audio non disponibile");
            }
        }

        async Task Flow(VoiceCapture capture, float[] samples, int rate, CancellationToken token)
        {
            try
            {
                ThrowIfSourceChanged(capture, token);
                var text = await capture.Provider.TranscribeAsync(VoiceWave.EncodeMono(samples, rate), capture.WireContext, token).ConfigureAwait(false);
                await PostCaptureAsync(capture, () => { Transcript = text;Status = "Hermes sta rispondendo…"; },
                    requireSemantic: true, "Contesto CAD cambiato; ripeti la domanda", token).ConfigureAwait(false);
                ThrowIfSourceChanged(capture, token);
                var reply = await capture.Provider.TalkAsync(text, capture.WireContext, token).ConfigureAwait(false);
                await PostCaptureAsync(capture, () => { Reply = reply.Text;Status = "Preparazione della risposta…"; },
                    requireSemantic: false, null, token).ConfigureAwait(false);

                foreach (var segment in SpeechSegments(reply.Text))
                {
                    ThrowIfSourceChanged(capture, token);
                    var audio = await capture.Provider.SpeechAsync(segment, capture.WireContext, token).ConfigureAwait(false);
                    var done = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
                    using (token.Register(() => done.TrySetCanceled()))
                    {
                        await PostCaptureAsync(capture, () => Play(audio, done), requireSemantic: false, null, token).ConfigureAwait(false);
                        await done.Task.ConfigureAwait(false);
                    }
                }
                await PostCaptureAsync(capture, () => Complete(capture, "Voce pronta · premi Parla"),
                    requireSemantic: false, null, token).ConfigureAwait(false);
            }
            catch (OperationCanceledException) { }
            catch (Exception error)
            {
                try
                {
                    await PostCaptureAsync(capture, () => Complete(capture,
                        error is VoiceServiceException ? ShortError(error.Message, "Voce non disponibile") : "Voce non disponibile"),
                        requireSemantic: false, null, token).ConfigureAwait(false);
                }
                catch (OperationCanceledException) { }
            }
        }

        void ThrowIfSourceChanged(VoiceCapture capture, CancellationToken token)
        {
            token.ThrowIfCancellationRequested();
            if (!IsCapturedSourceCurrent(capture))
                throw new OperationCanceledException(token);
        }

        async Task<bool> PostCaptureAsync(VoiceCapture capture, Action action, bool requireSemantic,
            string staleStatus, CancellationToken token)
        {
            var completion = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            using (token.Register(() => completion.TrySetCanceled()))
            {
                _main.Enqueue(() =>
                {
                    if (completion.Task.IsCompleted) return;
                    if (_destroyed || capture.Ticket != _ticket || !isActiveAndEnabled)
                    { completion.TrySetCanceled();return; }
                    if (!CaptureLineageCurrent(capture))
                    {
                        CancelRun("PC o sessione cambiata · richiesta fermata");
                        completion.TrySetCanceled();return;
                    }
                    if (requireSemantic && !CaptureSemanticCurrent(capture))
                    {
                        CancelRun(staleStatus ?? "Contesto CAD cambiato; ripeti la domanda");
                        completion.TrySetCanceled();return;
                    }
                    try { action();completion.TrySetResult(true); }
                    catch (Exception error) { completion.TrySetException(error); }
                });
                return await completion.Task.ConfigureAwait(false);
            }
        }

        internal static IEnumerable<string> SpeechSegments(string text)
        {
            for (var offset = 0; offset < text.Length;)
            {
                var count = Math.Min(600, text.Length - offset);
                if (offset + count < text.Length)
                {
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
            if (!_ownedClip.SetData(audio.Samples, 0))
            { StopPlayback();done.TrySetException(new InvalidOperationException("Audio decode unavailable"));return; }
            _playDone = done;Audio.clip = _ownedClip;Audio.Play();
        }

        void BeginVoiceProbe()
        {
            var provider = _provider as SessionVoiceClient;
            if (provider == null || Busy || Recording || _probePending) return;
            _probePending = true;var epoch = _sourceEpoch;var probe = ++_probeId;
            _ = Task.Run(async () =>
            {
                SessionVoiceReadiness readiness = null;Exception failure = null;
                try { readiness = await provider.GetVoiceStatusAsync().ConfigureAwait(false); }
                catch (Exception error) { failure = error; }
                _main.Enqueue(() =>
                {
                    if (_destroyed || epoch != _sourceEpoch || probe != _probeId || !ReferenceEquals(_provider, provider)) return;
                    _probePending = false;
                    if (!IsBoundToCurrentSource()) return;
                    if (failure == null && readiness != null && readiness.Configured && readiness.Reachable)
                    {
                        _ready = true;Status = "Voce pronta · premi Parla";return;
                    }
                    _ready = false;
                    Status = failure != null || readiness == null || !readiness.Reachable
                        ? "Servizi vocali in avvio…" : "Voce non configurata sul PC";
                    var delay = ProbeDelaySeconds(_probeAttempt++);
                    _nextProbeAt = Time.realtimeSinceStartup + delay;
                });
            });
        }

        internal static int ProbeDelaySeconds(int attempt)
        {
            var delays = new[] { 1, 2, 5, 10 };
            return delays[Math.Max(0, Math.Min(delays.Length - 1, attempt))];
        }

        void Complete(VoiceCapture capture, string status)
        {
            if (capture == null || capture.Ticket != _ticket) return;
            Busy = false;Recording = false;_run?.Dispose();_run = null;
            _capture = null;_micContext = null;Status = status;
        }

        void Update()
        {
            RefreshSourceBinding();
            while (_main.TryDequeue(out var action)) action();
            if (Recording && Time.realtimeSinceStartup - _started >= 29.5f) FinishRecording();
            if (Busy && Connection != null && !Connection.Connected) Cancel();
#if !UNITY_EDITOR
            if (Busy && (!OVRManager.isHmdPresent || !OVRPlugin.GetNodePositionTracked(OVRPlugin.Node.EyeCenter))) Cancel();
#endif
            if (_playDone != null && Audio != null && !Audio.isPlaying)
            {
                var completed = _playDone;_playDone = null;StopPlayback();completed.TrySetResult(true);
            }
        }

        void StopPlayback()
        {
            if (Audio != null && Audio.clip == _ownedClip && _ownedClip != null) { Audio.Stop();Audio.clip = null; }
            if (_ownedClip != null) { DestroyOwned(_ownedClip);_ownedClip = null; }
            _playDone?.TrySetCanceled();_playDone = null;
        }

        static void DestroyOwned(UnityEngine.Object value)
        { if (Application.isPlaying) Destroy(value);else DestroyImmediate(value); }

        public void Cancel() => CancelRun(Configured ? "Voce fermata" : IdleStatus());

        void CancelRun(string status)
        {
            _ticket++;_probeId++;
            if (Recording && !string.IsNullOrEmpty(_device)) Microphone.End(_device);
            Recording = Busy = false;_micContext = null;_capture = null;
            if (_microphone != null) { DestroyOwned(_microphone);_microphone = null; }
            _run?.Cancel();_run?.Dispose();_run = null;StopPlayback();
            while (_main.TryDequeue(out _)) { }
            _probePending = false;
            if (status != null) Status = status;
        }

        void DisposeProvider()
        {
            var provider = _provider;
            _provider = null;_client = null;_boundClient = null;_boundSource = null;_ready = false;
            provider?.Dispose();
        }

        void AdvanceSourceEpoch() => _sourceEpoch = Interlocked.Increment(ref _sourceEpoch);

        string IdleStatus()
        {
            var source = CaptureSource();
            if (!source.Connected) return "PC non connesso";
            if (!source.HasLineage) return "Servizi di sessione in avvio…";
            if (_provider == null) return "Voce non configurata sul PC";
            if (!_ready && _provider is SessionVoiceClient) return "Servizi vocali in avvio…";
            return _ready ? "Voce pronta · premi Parla" : "Voce non configurata sul PC";
        }

        static string ShortError(string value, string fallback) =>
            !string.IsNullOrWhiteSpace(value) ? (value.Length <= 120 ? value : fallback) : fallback;

        void OnApplicationFocus(bool focus) { if (!focus) Cancel(); }
        void OnApplicationPause(bool pause) { if (pause) Cancel(); }
        void OnDisable() { Cancel(); }
        void OnDestroy() { _destroyed = true;CancelRun(null);DisposeProvider(); }
    }
}
