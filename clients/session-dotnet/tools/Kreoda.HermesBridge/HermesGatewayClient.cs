using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace Kreoda.HermesBridge;

public sealed record HermesOptions(Uri GatewayUrl, string ApiKey, string SessionKey, string? ConversationId = null, string? ModelAlias = null,
    Uri? SpeechBaseUrl = null, string? SpeechApiKey = null, Uri? TranscribeBaseUrl = null, string? TranscribeApiKey = null, string? ReasoningEffort = null);
public sealed record HermesReply(string Text, string? SessionId, string RunId);
public sealed class HermesVoiceException(string stage, string message) : Exception(message)
{
    public string Stage { get; } = stage;
}

/// <summary>Talk to the actual Hermes Agent and its resident voice services, not its underlying LLM.</summary>
public sealed class HermesGatewayClient
{
    internal const string RunIdDataKey = "kreoda.hermes.runId";
    readonly HttpClient _http;
    readonly HermesOptions _options;
    readonly Func<string, Task>? _saveSession;
    readonly TimeSpan _pollInterval;
    string? _conversation;
    public HermesGatewayClient(HttpClient http, HermesOptions options, Func<string, Task>? saveSession = null, TimeSpan? pollInterval = null)
    {
        if (!ValidUrl(options.GatewayUrl) || !ValidOptionalUrl(options.SpeechBaseUrl) || !ValidOptionalUrl(options.TranscribeBaseUrl) ||
            string.IsNullOrWhiteSpace(options.ApiKey) || !ValidBearerCredential(options.ApiKey) ||
            options.SessionKey is not { Length: >= 1 and <= 128 } ||
            !ValidBearerCredential(options.SpeechApiKey) || !ValidBearerCredential(options.TranscribeApiKey) ||
            options.ReasoningEffort is not null && options.ReasoningEffort is not ("low" or "medium" or "xhigh"))
            throw new ArgumentException("Private Hermes gateway configuration is required");
        _http = http;_options = options;_saveSession = saveSession;_conversation = options.ConversationId;
        _pollInterval = pollInterval ?? TimeSpan.FromMilliseconds(500);
        if (_pollInterval <= TimeSpan.Zero || _pollInterval > TimeSpan.FromSeconds(5)) throw new ArgumentOutOfRangeException(nameof(pollInterval));
    }
    static bool ValidOptionalUrl(Uri? uri) => uri is null || ValidUrl(uri);
    static bool ValidUrl(Uri? uri) => uri is { IsAbsoluteUri: true } && (uri.Scheme is "http" or "https") &&
        !string.IsNullOrEmpty(uri.Host) && string.IsNullOrEmpty(uri.UserInfo) &&
        string.IsNullOrEmpty(uri.Query) && string.IsNullOrEmpty(uri.Fragment);
    static bool ValidBearerCredential(string? value)
    {
        if (value is null) return true;
        if (string.IsNullOrWhiteSpace(value)) return false;
        try { _ = new AuthenticationHeaderValue("Bearer", value);return true; }
        catch (FormatException) { return false; }
    }
    HttpRequestMessage Request(HttpMethod method, string route)
    {
        var request = new HttpRequestMessage(method, new Uri(_options.GatewayUrl.AbsoluteUri.TrimEnd('/') + "/" + route));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _options.ApiKey);
        request.Headers.Add("X-Hermes-Session-Key", _options.SessionKey);
        if (_conversation is not null) request.Headers.Add("X-Hermes-Session-Id", _conversation);
        return request;
    }
    HttpRequestMessage AudioRequest(HttpMethod method, string route, Uri? baseUrl, string? apiKey)
    {
        if (baseUrl is null) return Request(method, route);
        var request = new HttpRequestMessage(method, new Uri(baseUrl.AbsoluteUri.TrimEnd('/') + "/" + route));
        if (apiKey is not null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
        return request;
    }
    public async Task<HermesReply> TalkAsync(string text, JsonElement context, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(text) || text.Length > 8000 || context.ValueKind != JsonValueKind.Object || context.GetRawText().Length > 65536)
            throw new ArgumentException("Voice text and CAD context must be bounded");
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);deadline.CancelAfter(TimeSpan.FromSeconds(600));
        var token = deadline.Token;string? run = null;var complete = false;
        try {
            var key = "kreoda-" + Guid.NewGuid().ToString("D");
            var body = new Dictionary<string, object?> {
                ["input"] = SpatialVoiceIntent.BuildInput(text, context),
            };
            if (_conversation is not null) body["session_id"] = _conversation;
            if (_options.ModelAlias is not null) body["model"] = _options.ModelAlias;
            if (_options.ReasoningEffort is not null)
                body["model_options"] = new { reasoning = new { effort = _options.ReasoningEffort } };
            var payload = JsonSerializer.Serialize(body);
            async Task<JsonElement> Submit(CancellationToken cancellation)
            {
                using var submit = Request(HttpMethod.Post, "runs");submit.Headers.Add("Idempotency-Key", key);
                submit.Content = new StringContent(payload, Encoding.UTF8, "application/json");
                return await ReadJson(submit, "hermes", cancellation);
            }
            JsonElement accepted;
            try { accepted = await Submit(token); }
            catch (HttpRequestException) when (!token.IsCancellationRequested) {
                // Hermes advertises durable runs_idempotency: replay identical content/key, never a new turn.
                using var recovery = CancellationTokenSource.CreateLinkedTokenSource(token);recovery.CancelAfter(TimeSpan.FromSeconds(5));
                accepted = await Submit(recovery.Token);
            }
            run = RequiredId(accepted, "run_id");
            while (true) {
                token.ThrowIfCancellationRequested();
                using var poll = Request(HttpMethod.Get, "runs/" + Uri.EscapeDataString(run));
                var status = await ReadJson(poll, "hermes", token);
                if (!status.TryGetProperty("status", out var value) || value.ValueKind != JsonValueKind.String)
                    throw new HermesVoiceException("hermes", "Hermes non ha restituito lo stato della richiesta");
                var state = value.GetString();
                if (state == "completed") {
                    if (!status.TryGetProperty("output", out var output) || output.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(output.GetString()))
                        throw new HermesVoiceException("hermes", "Hermes ha terminato senza una risposta testuale");
                    var session = status.TryGetProperty("session_id", out var sid) && sid.ValueKind == JsonValueKind.String ? sid.GetString() : null;
                    if (session is not null) {
                        ValidateId(session);_conversation = session;if (_saveSession is not null) await _saveSession(session);
                    }
                    complete = true;return new(output.GetString()!, session, run);
                }
                if (state is not ("queued" or "running"))
                    throw new HermesVoiceException(state == "awaiting_approval" ? "approval" : "hermes", "Hermes: " + state);
                await Task.Delay(_pollInterval, token);
            }
        }
        catch (Exception error) {
            if (run is not null) error.Data[RunIdDataKey] = run;
            throw;
        }
        finally {
            if (run is not null && !complete) {
                using var cleanup = new CancellationTokenSource(TimeSpan.FromSeconds(5));
                using var stop = Request(HttpMethod.Post, "runs/" + Uri.EscapeDataString(run) + "/stop");
                stop.Content = new StringContent("{}", Encoding.UTF8, "application/json");
                try { using var response = await _http.SendAsync(stop, cleanup.Token); }
                catch { /* Original failure/cancellation remains visible; never resubmit a mutating turn. */ }
            }
        }
    }
    public async Task<string> TranscribeAsync(byte[] wav, CancellationToken ct = default)
    {
        RequireWave(wav, 1048576);
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);deadline.CancelAfter(TimeSpan.FromSeconds(60));
        using var request = AudioRequest(HttpMethod.Post, "audio/transcriptions", _options.TranscribeBaseUrl, _options.TranscribeApiKey);
        var form = new MultipartFormDataContent();
        var audio = new ByteArrayContent(wav);audio.Headers.ContentType = new("audio/wav");
        form.Add(audio, "file", "quest.wav");form.Add(new StringContent("1"), "beam_size");request.Content = form;
        var result = await ReadJson(request, "stt", deadline.Token);
        if (!result.TryGetProperty("text", out var text) || text.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(text.GetString()))
            throw new HermesVoiceException("stt", "Nessuna frase riconosciuta");
        return text.GetString()!.Trim();
    }
    public async Task<byte[]> SpeechAsync(string text, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(text) || text.Length > 8000) throw new ArgumentException("Speech text must be bounded");
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);deadline.CancelAfter(TimeSpan.FromSeconds(60));
        using var request = AudioRequest(HttpMethod.Post, "audio/speech", _options.SpeechBaseUrl, _options.SpeechApiKey);
        request.Content = new StringContent(JsonSerializer.Serialize(new { input = text, voice = "if_sara", lang = "it", speed = 1, response_format = "wav" }), Encoding.UTF8, "application/json");
        using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, deadline.Token);
        if (!response.IsSuccessStatusCode) throw new HermesVoiceException("tts", "Sintesi vocale: HTTP " + (int)response.StatusCode);
        var wav = await Bytes(response.Content, 4194304, deadline.Token);RequireWave(wav, 4194304);return wav;
    }
    async Task<JsonElement> ReadJson(HttpRequestMessage request, string stage, CancellationToken ct)
    {
        using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
        if (!response.IsSuccessStatusCode) throw new HermesVoiceException(stage, "Servizio Hermes: HTTP " + (int)response.StatusCode);
        var bytes = await Bytes(response.Content, 65536, ct);
        try { using var json = JsonDocument.Parse(bytes);return json.RootElement.Clone(); }
        catch (JsonException) { throw new HermesVoiceException(stage, "Risposta Hermes non valida"); }
    }
    static string RequiredId(JsonElement root, string key)
    {
        if (!root.TryGetProperty(key, out var value) || value.ValueKind != JsonValueKind.String) throw new HermesVoiceException("hermes", "Identità della richiesta Hermes assente");
        var id = value.GetString()!;ValidateId(id);return id;
    }
    static void ValidateId(string id)
    {
        if (!IsValidId(id))
            throw new HermesVoiceException("hermes", "Identità Hermes non valida");
    }
    static bool IsValidId(string id) => id.Length is >= 1 and <= 128 &&
        id.All(c => char.IsAsciiLetterOrDigit(c) || c is '_' or '-' or '.');
    internal static string? ValidatedRunId(Exception error) =>
        error.Data[RunIdDataKey] is string id && IsValidId(id) ? id : null;
    internal static void RequireWave(byte[] wav, int max)
    {
        if (wav.Length is < 44 || wav.Length > max || Encoding.ASCII.GetString(wav, 0, 4) != "RIFF" || Encoding.ASCII.GetString(wav, 8, 4) != "WAVE")
            throw new HermesVoiceException("audio", "Audio WAV non valido o fuori limite");
        try { Kreoda.QuestFoundation.VoiceWave.Inspect(wav, max <= 1048576 ? 30 : 120); }
        catch (ArgumentException) { throw new HermesVoiceException("audio", "Formato o durata WAV non validi"); }
    }
    internal static async Task<byte[]> Bytes(HttpContent content, int max, CancellationToken ct)
    {
        if (content.Headers.ContentLength > max) throw new HermesVoiceException("transport", "Risposta fuori limite");
        using var stream = await content.ReadAsStreamAsync(ct);using var buffer = new MemoryStream();var chunk = new byte[8192];
        int count;while ((count = await stream.ReadAsync(chunk, ct)) != 0) {
            if (buffer.Length + count > max) throw new HermesVoiceException("transport", "Risposta fuori limite");
            buffer.Write(chunk, 0, count);
        }
        return buffer.ToArray();
    }
}
