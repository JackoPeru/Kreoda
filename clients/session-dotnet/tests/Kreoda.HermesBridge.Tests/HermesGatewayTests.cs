using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Xunit;

namespace Kreoda.HermesBridge.Tests;

public sealed class HermesGatewayTests
{
    sealed class Handler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> reply) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) => reply(request, ct);
    }
    static HttpResponseMessage Json(string json) => new(HttpStatusCode.OK) { Content = new StringContent(json, Encoding.UTF8, "application/json") };
    const string ConfigPrefix = "{\"gatewayUrl\":\"http://127.0.0.1:8642/v1/\",\"apiKey\":\"fixture-token\",\"sessionKey\":\"kreoda-project\"";
    static HermesOptions Config(string properties = "") => JsonSerializer.Deserialize<HermesOptions>(
        ConfigPrefix + (properties.Length == 0 ? "" : "," + properties) + "}", new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
    static readonly HermesOptions Options = new(new Uri("http://127.0.0.1:8642/v1/"), "fixture-token", "kreoda-project");
    static byte[] TinyWav() => Kreoda.QuestFoundation.VoiceWave.EncodeMono(new float[160], 16000);
    sealed record SeenMultipartPart(string? DispositionType, string? Name, string? FileName, string? ContentType, string Text);
    sealed record SeenAudioRequest(string Url, string? Authorization, string? SessionKey, string? SessionId, string? ContentType,
        string? Body, IReadOnlyList<SeenMultipartPart> MultipartParts);
    static string? Header(HttpRequestMessage request, string name) => request.Headers.TryGetValues(name, out var values) ? values.Single() : null;
    static string? Unquote(string? value) => value is { Length: >= 2 } && value[0] == '"' && value[^1] == '"' ? value[1..^1] : value;
    static IReadOnlyList<SeenMultipartPart> MultipartParts(MediaTypeHeaderValue contentType, byte[] bytes)
    {
        var boundary = Unquote(contentType.Parameters.Single(parameter => string.Equals(parameter.Name, "boundary", StringComparison.OrdinalIgnoreCase)).Value)
            ?? throw new InvalidOperationException("Multipart boundary missing");
        var result = new List<SeenMultipartPart>();
        foreach (var segment in Encoding.Latin1.GetString(bytes).Split("--" + boundary, StringSplitOptions.RemoveEmptyEntries)) {
            var part = segment.TrimStart('\r', '\n');
            if (part.StartsWith("--", StringComparison.Ordinal)) continue;
            var split = part.IndexOf("\r\n\r\n", StringComparison.Ordinal);
            if (split < 0) continue;
            var headers = part[..split].Split("\r\n");
            var dispositionHeader = headers.Single(header => header.StartsWith("Content-Disposition:", StringComparison.OrdinalIgnoreCase));
            var disposition = ContentDispositionHeaderValue.Parse(dispositionHeader["Content-Disposition:".Length..].Trim());
            var mediaTypeHeader = headers.FirstOrDefault(header => header.StartsWith("Content-Type:", StringComparison.OrdinalIgnoreCase));
            var mediaType = mediaTypeHeader is null ? null : mediaTypeHeader["Content-Type:".Length..].Trim();
            result.Add(new(disposition.DispositionType, Unquote(disposition.Name), Unquote(disposition.FileName), mediaType,
                part[(split + 4)..].TrimEnd('\r', '\n')));
        }
        return result;
    }
    static async Task<SeenAudioRequest> Snapshot(HttpRequestMessage request, CancellationToken ct)
    {
        var contentType = request.Content?.Headers.ContentType;
        var bytes = request.Content is null ? null : await request.Content.ReadAsByteArrayAsync(ct);
        var parts = contentType is not null && contentType.MediaType == "multipart/form-data" && bytes is not null
            ? MultipartParts(contentType, bytes) : Array.Empty<SeenMultipartPart>();
        var body = bytes is null || contentType?.MediaType == "multipart/form-data" ? null : Encoding.UTF8.GetString(bytes);
        return new(request.RequestUri!.AbsoluteUri, request.Headers.Authorization?.ToString(), Header(request, "X-Hermes-Session-Key"),
            Header(request, "X-Hermes-Session-Id"), contentType?.MediaType, body, parts);
    }
    static void AssertTranscriptionMultipart(SeenAudioRequest request)
    {
        Assert.Equal("multipart/form-data", request.ContentType);
        Assert.Equal(2, request.MultipartParts.Count);
        var file = Assert.Single(request.MultipartParts.Where(part => part.Name == "file"));
        Assert.Equal("form-data", file.DispositionType);
        Assert.Equal("quest.wav", file.FileName);
        Assert.Equal("audio/wav", file.ContentType);
        var beamSize = Assert.Single(request.MultipartParts.Where(part => part.Name == "beam_size"));
        Assert.Equal("1", beamSize.Text);
    }
    static HttpResponseMessage Wave() => new(HttpStatusCode.OK) { Content = new ByteArrayContent(TinyWav()) };
    static HttpClient AudioHttp(List<SeenAudioRequest> seen) => new(new Handler(async (request, ct) => {
        seen.Add(await Snapshot(request, ct));
        return request.RequestUri!.AbsolutePath.EndsWith("/audio/speech", StringComparison.Ordinal) ? Wave() : Json("{\"text\":\"Ciao\"}");
    }));

    [Fact]
    public async Task CallsHermesRunsWithDurableIdentityAndStoresConversationContinuity()
    {
        string? saved = null;var posts = 0;
        using var http = new HttpClient(new Handler(async (request, ct) => {
            Assert.Equal("fixture-token", request.Headers.Authorization?.Parameter);
            Assert.Equal("kreoda-project", request.Headers.GetValues("X-Hermes-Session-Key").Single());
            if (request.Method == HttpMethod.Post) {
                posts++;
                Assert.NotEmpty(request.Headers.GetValues("Idempotency-Key").Single());
                using var body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(ct));
                Assert.Contains("Kreoda", body.RootElement.GetProperty("input").GetString());
                Assert.False(body.RootElement.TryGetProperty("messages", out _));
                Assert.False(body.RootElement.TryGetProperty("model_options", out _));
                return Json("{\"run_id\":\"run-1\",\"status\":\"queued\"}");
            }
            return Json("{\"run_id\":\"run-1\",\"status\":\"completed\",\"output\":\"Pronto\",\"session_id\":\"session-1\"}");
        }));
        var gateway = new HermesGatewayClient(http, Options, id => { saved = id;return Task.CompletedTask; }, TimeSpan.FromMilliseconds(1));
        var reply = await gateway.TalkAsync("Descrivi il progetto", JsonDocument.Parse("{}").RootElement);
        Assert.Equal("Pronto", reply.Text);Assert.Equal("session-1", saved);Assert.Equal(1, posts);
    }

    [Fact]
    public async Task CancellationStopsAcceptedHermesRunWithoutSubmittingAgain()
    {
        using var cancel = new CancellationTokenSource();var submits = 0;var stops = 0;
        using var http = new HttpClient(new Handler((request, ct) => {
            if (request.RequestUri!.AbsolutePath.EndsWith("/stop")) { stops++;Assert.Equal("/v1/runs/run-1/stop", request.RequestUri.AbsolutePath);return Task.FromResult(Json("{}")); }
            if (request.Method == HttpMethod.Post) { submits++;return Task.FromResult(Json("{\"run_id\":\"run-1\",\"status\":\"queued\"}")); }
            cancel.Cancel();ct.ThrowIfCancellationRequested();return Task.FromResult(Json("{}"));
        }));
        var gateway = new HermesGatewayClient(http, Options, pollInterval: TimeSpan.FromMilliseconds(1));
        var error = await Assert.ThrowsAnyAsync<OperationCanceledException>(() => gateway.TalkAsync("Ciao", JsonDocument.Parse("{}").RootElement, cancel.Token));
        Assert.IsAssignableFrom<OperationCanceledException>(error);
        Assert.True(error.CancellationToken.IsCancellationRequested);
        Assert.Equal("run-1", error.Data["kreoda.hermes.runId"]);
        Assert.Equal(1, submits);Assert.Equal(1, stops);
    }

    [Theory]
    [InlineData("failed")]
    [InlineData("cancelled")]
    [InlineData("awaiting_approval")]
    [InlineData("unknown")]
    public async Task NonSuccessHermesStatusCannotBecomeAReply(string status)
    {
        var submits = 0;var stops = 0;
        using var http = new HttpClient(new Handler((request, _) => Task.FromResult(Reply(request))));
        HttpResponseMessage Submit() { submits++;return Json("{\"run_id\":\"run-1\",\"status\":\"queued\"}"); }
        HttpResponseMessage Reply(HttpRequestMessage request)
        {
            if (request.RequestUri!.AbsolutePath.EndsWith("/stop")) { stops++;return Json("{}"); }
            if (request.Method == HttpMethod.Post) return Submit();
            return Json($"{{\"run_id\":\"run-1\",\"status\":\"{status}\"}}");
        }
        var gateway = new HermesGatewayClient(http, Options, pollInterval: TimeSpan.FromMilliseconds(1));
        var error = await Assert.ThrowsAsync<HermesVoiceException>(() => gateway.TalkAsync("Ciao", JsonDocument.Parse("{}").RootElement));
        Assert.Equal("run-1", error.Data["kreoda.hermes.runId"]);
        Assert.Equal(1, submits);Assert.Equal(1, stops);
    }

    [Fact]
    public async Task CancellationBeforeSubmissionAcknowledgementHasNoRunIdOrStop()
    {
        using var cancel = new CancellationTokenSource();var submits = 0;var stops = 0;
        using var http = new HttpClient(new Handler((request, ct) => {
            if (request.RequestUri!.AbsolutePath.EndsWith("/stop")) { stops++;return Task.FromResult(Json("{}")); }
            submits++;cancel.Cancel();ct.ThrowIfCancellationRequested();return Task.FromResult(Json("{}"));
        }));
        var gateway = new HermesGatewayClient(http, Options, pollInterval: TimeSpan.FromMilliseconds(1));
        var error = await Assert.ThrowsAnyAsync<OperationCanceledException>(() => gateway.TalkAsync("Ciao", JsonDocument.Parse("{}").RootElement, cancel.Token));
        Assert.False(error.Data.Contains("kreoda.hermes.runId"));
        Assert.Equal(1, submits);Assert.Equal(0, stops);
    }

    [Theory]
    [InlineData("{\"run_id\":\"bad id\",\"status\":\"queued\"}")]
    [InlineData("{\"status\":\"queued\"}")]
    public async Task InvalidAcceptedIdentityIsNotRetained(string accepted)
    {
        using var http = new HttpClient(new Handler((request, _) => Task.FromResult(request.Method == HttpMethod.Post ? Json(accepted) : Json("{}"))));
        var gateway = new HermesGatewayClient(http, Options, pollInterval: TimeSpan.FromMilliseconds(1));
        var error = await Assert.ThrowsAsync<HermesVoiceException>(() => gateway.TalkAsync("Ciao", JsonDocument.Parse("{}").RootElement));
        Assert.False(error.Data.Contains("kreoda.hermes.runId"));
    }

    [Fact]
    public async Task LostSubmissionAckUsesTheSameDurableKeyAndBody()
    {
        var keys = new List<string>();var bodies = new List<string>();
        using var http = new HttpClient(new Handler(async (request, ct) => {
            if (request.Method == HttpMethod.Post) {
                keys.Add(request.Headers.GetValues("Idempotency-Key").Single());bodies.Add(await request.Content!.ReadAsStringAsync(ct));
                if (keys.Count == 1) throw new HttpRequestException("accepted response lost");
                return Json("{\"run_id\":\"run-1\",\"status\":\"queued\"}");
            }
            return Json("{\"run_id\":\"run-1\",\"status\":\"completed\",\"output\":\"Pronto\"}");
        }));
        var gateway = new HermesGatewayClient(http, Config("\"reasoningEffort\":\"low\""), pollInterval: TimeSpan.FromMilliseconds(1));
        var reply = await gateway.TalkAsync("Ciao", JsonDocument.Parse("{}").RootElement);
        Assert.Equal("Pronto", reply.Text);Assert.Equal(2, keys.Count);Assert.Equal(keys[0], keys[1]);Assert.Equal(bodies[0], bodies[1]);
        using var body = JsonDocument.Parse(bodies[0]);
        Assert.Equal("low", body.RootElement.GetProperty("model_options").GetProperty("reasoning").GetProperty("effort").GetString());
    }

    [Fact]
    public async Task LegacyAudioRequestsKeepGatewayUrlsAndHeaders()
    {
        var seen = new List<SeenAudioRequest>();
        using var http = AudioHttp(seen);
        var gateway = new HermesGatewayClient(http, Config("\"conversationId\":\"legacy-session\""));
        await gateway.SpeechAsync("Ciao");
        Assert.Equal("Ciao", await gateway.TranscribeAsync(TinyWav()));
        Assert.Equal(2, seen.Count);
        Assert.Equal("http://127.0.0.1:8642/v1/audio/speech", seen[0].Url);
        Assert.Equal("http://127.0.0.1:8642/v1/audio/transcriptions", seen[1].Url);
        foreach (var request in seen) {
            Assert.Equal("Bearer fixture-token", request.Authorization);
            Assert.Equal("kreoda-project", request.SessionKey);
            Assert.Equal("legacy-session", request.SessionId);
        }
        Assert.Equal("application/json", seen[0].ContentType);
        AssertTranscriptionMultipart(seen[1]);
        Assert.Contains("\"input\":\"Ciao\"", seen[0].Body!);
        Assert.Contains("\"voice\":\"if_sara\"", seen[0].Body!);
        Assert.Contains("\"lang\":\"it\"", seen[0].Body!);
        Assert.Contains("\"speed\":1", seen[0].Body!);
        Assert.Contains("\"response_format\":\"wav\"", seen[0].Body!);
    }

    [Fact]
    public async Task ResidentAudioOverridesUseIndependentUrlsAndBearerKeys()
    {
        var seen = new List<SeenAudioRequest>();
        using var http = AudioHttp(seen);
        var options = Config("""
            "speechBaseUrl":"http://speech.example/root/v1/",
            "speechApiKey":"speech-fixture",
            "transcribeBaseUrl":"http://stt.example/v1",
            "transcribeApiKey":"transcribe-fixture",
            "conversationId":"gateway-session"
            """);
        var gateway = new HermesGatewayClient(http, options);
        await gateway.SpeechAsync("Ciao");
        Assert.Equal("Ciao", await gateway.TranscribeAsync(TinyWav()));
        Assert.Equal("http://speech.example/root/v1/audio/speech", seen[0].Url);
        Assert.Equal("http://stt.example/v1/audio/transcriptions", seen[1].Url);
        Assert.Equal("Bearer speech-fixture", seen[0].Authorization);
        Assert.Equal("Bearer transcribe-fixture", seen[1].Authorization);
        Assert.DoesNotContain("fixture-token", seen[0].Authorization ?? "");
        Assert.DoesNotContain("fixture-token", seen[1].Authorization ?? "");
        foreach (var request in seen) { Assert.Null(request.SessionKey);Assert.Null(request.SessionId); }
        AssertTranscriptionMultipart(seen[1]);
    }

    [Fact]
    public async Task ResidentAudioOverrideWithoutKeyOmitsAuthorization()
    {
        var seen = new List<SeenAudioRequest>();
        using var http = AudioHttp(seen);
        var gateway = new HermesGatewayClient(http, Config("\"transcribeBaseUrl\":\"http://stt.example/v1\""));
        Assert.Equal("Ciao", await gateway.TranscribeAsync(TinyWav()));
        Assert.Equal("http://stt.example/v1/audio/transcriptions", seen.Single().Url);
        Assert.Null(seen[0].Authorization);
        Assert.Null(seen[0].SessionKey);Assert.Null(seen[0].SessionId);
    }

    [Fact]
    public async Task SpeechOnlyOverrideLeavesTranscriptionOnGateway()
    {
        var seen = new List<SeenAudioRequest>();
        using var http = AudioHttp(seen);
        var gateway = new HermesGatewayClient(http, Config("""
            "speechBaseUrl":"http://speech.example/v1",
            "speechApiKey":"speech-fixture",
            "conversationId":"gateway-session"
            """));
        await gateway.SpeechAsync("Ciao");
        await gateway.TranscribeAsync(TinyWav());
        Assert.Equal("http://speech.example/v1/audio/speech", seen[0].Url);
        Assert.Equal("Bearer speech-fixture", seen[0].Authorization);
        Assert.Null(seen[0].SessionKey);Assert.Null(seen[0].SessionId);
        Assert.Equal("http://127.0.0.1:8642/v1/audio/transcriptions", seen[1].Url);
        Assert.Equal("Bearer fixture-token", seen[1].Authorization);
        Assert.Equal("kreoda-project", seen[1].SessionKey);Assert.Equal("gateway-session", seen[1].SessionId);
    }

    [Fact]
    public async Task TranscriptionOnlyOverrideLeavesSpeechOnGateway()
    {
        var seen = new List<SeenAudioRequest>();
        using var http = AudioHttp(seen);
        var gateway = new HermesGatewayClient(http, Config("""
            "transcribeBaseUrl":"http://stt.example/v1",
            "transcribeApiKey":"transcribe-fixture",
            "conversationId":"gateway-session"
            """));
        await gateway.SpeechAsync("Ciao");
        await gateway.TranscribeAsync(TinyWav());
        Assert.Equal("http://127.0.0.1:8642/v1/audio/speech", seen[0].Url);
        Assert.Equal("Bearer fixture-token", seen[0].Authorization);
        Assert.Equal("kreoda-project", seen[0].SessionKey);Assert.Equal("gateway-session", seen[0].SessionId);
        Assert.Equal("http://stt.example/v1/audio/transcriptions", seen[1].Url);
        Assert.Equal("Bearer transcribe-fixture", seen[1].Authorization);
        Assert.Null(seen[1].SessionKey);Assert.Null(seen[1].SessionId);
    }

    [Theory]
    [InlineData("speechBaseUrl", "http://user:secret@speech.example/v1")]
    [InlineData("speechBaseUrl", "https://speech.example/v1?private=1")]
    [InlineData("speechBaseUrl", "https://speech.example/v1#fragment")]
    [InlineData("speechBaseUrl", "ftp://speech.example/v1")]
    [InlineData("transcribeBaseUrl", "http://user:secret@stt.example/v1")]
    [InlineData("transcribeBaseUrl", "https://stt.example/v1?private=1")]
    [InlineData("transcribeBaseUrl", "https://stt.example/v1#fragment")]
    [InlineData("transcribeBaseUrl", "ftp://stt.example/v1")]
    public void RejectsMalformedAudioBaseUrlBeforeAnyRequest(string property, string url)
    {
        var sent = 0;
        using var http = new HttpClient(new Handler((_, _) => { sent++;return Task.FromResult(Json("{}")); }));
        var extra = "\"" + property + "\":" + JsonSerializer.Serialize(url);
        var error = Assert.Throws<ArgumentException>(() => new HermesGatewayClient(http, Config(extra)));
        Assert.Equal("Private Hermes gateway configuration is required", error.Message);
        Assert.Equal(0, sent);
    }

    [Theory]
    [InlineData("speechApiKey", "")]
    [InlineData("speechApiKey", "private\r\nX-Evil: yes")]
    [InlineData("transcribeApiKey", "")]
    [InlineData("transcribeApiKey", "private\r\nX-Evil: yes")]
    public void RejectsMalformedExplicitAudioCredentialBeforeAnyRequest(string property, string invalidKey)
    {
        var sent = 0;
        using var http = new HttpClient(new Handler((_, _) => { sent++;return Task.FromResult(Json("{}")); }));
        var extra = "\"" + property + "\":" + JsonSerializer.Serialize(invalidKey);
        var error = Assert.Throws<ArgumentException>(() => new HermesGatewayClient(http, Config(extra)));
        Assert.Equal("Private Hermes gateway configuration is required", error.Message);
        if (invalidKey.Length > 0) Assert.DoesNotContain(invalidKey, error.ToString());
        Assert.Equal(0, sent);
    }

    [Theory]
    [InlineData("")]
    [InlineData("none")]
    [InlineData("high")]
    [InlineData("LOW")]
    public void RejectsUnsupportedReasoningEffortBeforeAnyRequest(string effort)
    {
        var sent = 0;
        using var http = new HttpClient(new Handler((_, _) => { sent++;return Task.FromResult(Json("{}")); }));
        var extra = "\"reasoningEffort\":" + JsonSerializer.Serialize(effort);
        var error = Assert.Throws<ArgumentException>(() => new HermesGatewayClient(http, Config(extra)));
        Assert.Equal("Private Hermes gateway configuration is required", error.Message);
        if (effort.Length > 0) Assert.DoesNotContain(effort, error.ToString());
        Assert.Equal(0, sent);
    }
}
