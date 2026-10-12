using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Kreoda.QuestFoundation;
using Xunit;

namespace Kreoda.HermesBridge.Tests;

public sealed class VoiceHttpTests
{
    sealed class Handler : HttpMessageHandler
    {
        public int Calls;
        public bool Timeout;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Calls++;
            if (Timeout) return Task.FromException<HttpResponseMessage>(new OperationCanceledException("upstream deadline"));
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) {
                Content = new StringContent("{\"text\":\"Il progetto Kreoda\"}", Encoding.UTF8, "application/json"),
            });
        }
    }
    sealed class GatewayHandler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> action) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) => action(request, ct);
    }
    static HttpResponseMessage Json(HttpStatusCode status, string json) => new(status) { Content = new StringContent(json, Encoding.UTF8, "application/json") };
    static string TurnBody(string voiceRequestId = "voice-1") => JsonSerializer.Serialize(new {
        text = "Ciao",
        context = new { voiceRequestId, sessionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", documentId = "doc-phase1", revision = 7 },
    });

    [Fact]
    public async Task FailedNativeTurnReturnsOnlyValidatedRunIdInExistingErrorResponse()
    {
        var submits = 0;var stops = 0;
        using var upstream = new HttpClient(new GatewayHandler((request, _) => {
            if (request.RequestUri!.AbsolutePath.EndsWith("/stop")) { stops++;return Task.FromResult(Json(HttpStatusCode.OK, "{}")); }
            if (request.Method == HttpMethod.Post) { submits++;return Task.FromResult(Json(HttpStatusCode.OK, "{\"run_id\":\"run-1\",\"status\":\"queued\"}")); }
            return Task.FromResult(Json(HttpStatusCode.OK, "{\"run_id\":\"run-1\",\"status\":\"failed\"}"));
        }));
        await using var wire = new CadBridgeTests.Wire();await using var session = await wire.Connect();
        await using var cad = new CadBridge(_ => Task.FromResult(session));
        var hermes = new HermesGatewayClient(upstream, new(new Uri("http://127.0.0.1:8642/v1/"), "gateway-fixture-secret", "kreoda-project"), pollInterval: TimeSpan.FromMilliseconds(1));
        await using var app = BridgeHost.Build(cad, "http://127.0.0.1:0", hermes, "quest-device-fixture-token");
        await app.StartAsync();
        try {
            using var client = new HttpClient { BaseAddress = new Uri(app.Urls.Single()) };
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "quest-device-fixture-token");
            using var response = await client.PostAsync("/voice/turn", new StringContent(TurnBody(), Encoding.UTF8, "application/json"));
            Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);
            var body = await response.Content.ReadAsStringAsync();using var json = JsonDocument.Parse(body);
            Assert.Equal("Hermes: failed", json.RootElement.GetProperty("error").GetString());
            Assert.Equal("hermes", json.RootElement.GetProperty("stage").GetString());
            Assert.Equal("run-1", json.RootElement.GetProperty("runId").GetString());
            Assert.DoesNotContain("gateway-fixture-secret", body);Assert.DoesNotContain("quest-device-fixture-token", body);
            Assert.Equal(1, submits);Assert.Equal(1, stops);
        } finally { await app.StopAsync(); }
    }

    [Fact]
    public async Task UnfinishedCadAfterCompletedReplyKeepsKnownRunId()
    {
        await using var wire = new CadBridgeTests.Wire();await using var session = await wire.Connect();
        await using var cad = new CadBridge(_ => Task.FromResult(session));
        using var parameters = JsonDocument.Parse("{}");
        using var upstream = new HttpClient(new GatewayHandler(async (request, ct) => {
            if (request.RequestUri!.AbsolutePath.EndsWith("/stop")) return Json(HttpStatusCode.OK, "{}");
            if (request.Method == HttpMethod.Post) return Json(HttpStatusCode.OK, "{\"run_id\":\"run-1\",\"status\":\"queued\"}");
            await cad.BeginAsync("unfinished fixture", new[] { new CadCheck("measureVolume", parameters.RootElement.Clone(), "volumeMm3", 100000) },
                ct: ct, originRequestId: "voice-1");
            return Json(HttpStatusCode.OK, "{\"run_id\":\"run-1\",\"status\":\"completed\",\"output\":\"Pronto\"}");
        }));
        var hermes = new HermesGatewayClient(upstream, new(new Uri("http://127.0.0.1:8642/v1/"), "gateway-fixture-secret", "kreoda-project"), pollInterval: TimeSpan.FromMilliseconds(1));
        await using var app = BridgeHost.Build(cad, "http://127.0.0.1:0", hermes, "quest-device-fixture-token");
        await app.StartAsync();
        try {
            using var client = new HttpClient { BaseAddress = new Uri(app.Urls.Single()) };
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "quest-device-fixture-token");
            using var response = await client.PostAsync("/voice/turn", new StringContent(TurnBody(), Encoding.UTF8, "application/json"));
            Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);
            var body = await response.Content.ReadAsStringAsync();using var json = JsonDocument.Parse(body);
            Assert.Equal("cad", json.RootElement.GetProperty("stage").GetString());
            Assert.Equal("run-1", json.RootElement.GetProperty("runId").GetString());
            Assert.Equal(1, wire.Rollbacks);Assert.Equal(0, wire.Commits);
        } finally { await app.StopAsync(); }
    }

    [Fact]
    public async Task UpstreamTimeoutReturnsTypedErrorWithoutClaimingCadRollback()
    {
        using var upstream = new HttpClient(new Handler { Timeout = true });
        var hermes = new HermesGatewayClient(upstream, new(new Uri("http://127.0.0.1:8642/v1/"), "gateway-fixture-secret", "kreoda-project"));
        await using var cad = new CadBridge(_ => throw new InvalidOperationException("CAD not needed for TTS"));
        await using var app = BridgeHost.Build(cad, "http://127.0.0.1:0", hermes, "quest-device-fixture-token");
        await app.StartAsync();
        try {
            using var client = new HttpClient { BaseAddress = new Uri(app.Urls.Single()) };
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "quest-device-fixture-token");
            using var result = await client.PostAsync("/voice/speech", new StringContent("{\"text\":\"Prova\",\"context\":{}}", Encoding.UTF8, "application/json"));
            Assert.Equal(HttpStatusCode.GatewayTimeout, result.StatusCode);
            var body = await result.Content.ReadAsStringAsync();Assert.Contains("timeout", body);Assert.Contains("modello", body);
            Assert.DoesNotContain("gateway-fixture-secret", body);
        } finally { await app.StopAsync(); }
    }

    [Fact]
    public async Task VoiceRequiresDeviceTokenAndReturnsRealTranscriptionWithoutLeakingGatewayKey()
    {
        var handler = new Handler();using var upstream = new HttpClient(handler);
        var hermes = new HermesGatewayClient(upstream, new(new Uri("http://127.0.0.1:8642/v1/"), "gateway-fixture-secret", "kreoda-project"));
        await using var cad = new CadBridge(_ => throw new InvalidOperationException("CAD not needed for STT"));
        await using var app = BridgeHost.Build(cad, "http://127.0.0.1:0", hermes, "quest-device-fixture-token");
        await app.StartAsync();
        try {
            using var client = new HttpClient { BaseAddress = new Uri(app.Urls.Single()) };
            using var denied = await client.PostAsync("/voice/transcribe", new ByteArrayContent(VoiceWave.EncodeMono(new float[160], 16000)));
            Assert.Equal(HttpStatusCode.Unauthorized, denied.StatusCode);Assert.Equal(0, handler.Calls);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "quest-device-fixture-token");
            using var accepted = await client.PostAsync("/voice/transcribe", new ByteArrayContent(VoiceWave.EncodeMono(new float[160], 16000)));
            Assert.Equal(HttpStatusCode.OK, accepted.StatusCode);
            var body = await accepted.Content.ReadAsStringAsync();Assert.Contains("Il progetto Kreoda", body);
            Assert.DoesNotContain("gateway-fixture-secret", body);Assert.Equal(1, handler.Calls);
        } finally { await app.StopAsync(); }
    }
}
