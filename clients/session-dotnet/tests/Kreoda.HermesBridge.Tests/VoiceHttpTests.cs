using System.Net;
using System.Net.Http.Headers;
using System.Text;
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
