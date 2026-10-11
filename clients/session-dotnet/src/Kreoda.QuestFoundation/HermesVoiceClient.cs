using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace Kreoda.QuestFoundation;

public sealed record VoiceReply(string Text, string? SessionId, string RunId);
public sealed class VoiceServiceException(int statusCode, string message) : Exception(message)
{
    public int StatusCode { get; } = statusCode;
}

/// <summary>Quest talks to its configured private PC voice proxy; Hermes credentials remain on the PC.</summary>
public sealed class HermesVoiceClient : IDisposable
{
    readonly Uri _endpoint;
    readonly string _token;
    readonly HttpClient _http;
    readonly bool _ownsHttp;
    public HermesVoiceClient(Uri endpoint, string deviceToken, HttpClient? http = null)
    {
        if (!endpoint.IsAbsoluteUri || endpoint.Scheme is not ("http" or "https") ||
            endpoint.UserInfo.Length != 0 || endpoint.Query.Length != 0 || endpoint.Fragment.Length != 0 || deviceToken.Length is < 16 or > 4096)
            throw new ArgumentException("Private voice configuration is invalid");
        _endpoint = endpoint;_token = deviceToken;_ownsHttp = http is null;
        _http = http ?? new HttpClient(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = Timeout.InfiniteTimeSpan };
    }
    public async Task<string> TranscribeAsync(byte[] wav, CancellationToken ct = default)
    {
        VoiceWave.Inspect(wav, 30);
        if (wav.Length > 1048576) throw new ArgumentException("Microphone WAV is outside limits");
        using var content = new ByteArrayContent(wav);content.Headers.ContentType = new("audio/wav");
        var result = await JsonPost("transcribe", content, TimeSpan.FromSeconds(60), ct);
        return Text(result, "text");
    }
    public async Task<VoiceReply> TalkAsync(string text, JsonElement context, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(text) || text.Length > 8000 || context.ValueKind != JsonValueKind.Object || context.GetRawText().Length > 65536)
            throw new ArgumentException("Voice request is outside limits");
        using var content = new StringContent(JsonSerializer.Serialize(new { text, context }), Encoding.UTF8, "application/json");
        var result = await JsonPost("turn", content, TimeSpan.FromSeconds(180), ct);
        return new(Text(result, "text"), result.TryGetProperty("sessionId", out var session) && session.ValueKind == JsonValueKind.String ? session.GetString() : null,
            Text(result, "runId"));
    }
    public async Task<VoiceAudio> SpeechAsync(string text, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(text) || text.Length > 8000) throw new ArgumentException("Speech text is outside limits");
        using var content = new StringContent(JsonSerializer.Serialize(new { text, context = new { } }), Encoding.UTF8, "application/json");
        var bytes = await Post("speech", content, 4194304, TimeSpan.FromSeconds(60), ct);
        return VoiceWave.Decode(bytes);
    }
    static string Text(JsonElement result, string name) => result.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String &&
        !string.IsNullOrWhiteSpace(value.GetString()) ? value.GetString()! : throw new VoiceServiceException(502, "Risposta vocale incompleta");
    async Task<JsonElement> JsonPost(string route, HttpContent content, TimeSpan timeout, CancellationToken ct)
    {
        var bytes = await Post(route, content, 65536, timeout, ct);
        try { using var json = JsonDocument.Parse(bytes);return json.RootElement.Clone(); }
        catch (JsonException) { throw new VoiceServiceException(502, "Risposta vocale non valida"); }
    }
    async Task<byte[]> Post(string route, HttpContent content, int maximum, TimeSpan timeout, CancellationToken ct)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);deadline.CancelAfter(timeout);
        using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(_endpoint.AbsoluteUri.TrimEnd('/') + "/voice/" + route));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _token);request.Content = content;
        using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, deadline.Token).ConfigureAwait(false);
        var bytes = await Read(response.Content, response.IsSuccessStatusCode ? maximum : 65536, deadline.Token).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode) {
            var message = "Servizio vocale: HTTP " + (int)response.StatusCode;
            try {
                using var error = JsonDocument.Parse(bytes);
                if (error.RootElement.TryGetProperty("error", out var text) && text.ValueKind == JsonValueKind.String && text.GetString()!.Length <= 512)
                    message = text.GetString()!;
            } catch (JsonException) { }
            throw new VoiceServiceException((int)response.StatusCode, message);
        }
        return bytes;
    }
    static async Task<byte[]> Read(HttpContent content, int maximum, CancellationToken ct)
    {
        if (content.Headers.ContentLength > maximum) throw new VoiceServiceException(502, "Risposta vocale fuori limite");
        using var stream = await content.ReadAsStreamAsync().ConfigureAwait(false);using var output = new MemoryStream();var bytes = new byte[8192];
        int count;while ((count = await stream.ReadAsync(bytes, 0, bytes.Length, ct).ConfigureAwait(false)) != 0) {
            if (output.Length + count > maximum) throw new VoiceServiceException(502, "Risposta vocale fuori limite");
            output.Write(bytes, 0, count);
        }
        return output.ToArray();
    }
    public void Dispose() { if (_ownsHttp) _http.Dispose(); }
}
