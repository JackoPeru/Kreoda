using System.Net;
using System.Text;
using System.Text.Json;
using Kreoda.QuestFoundation;
using Xunit;

namespace Kreoda.SessionClient.Tests;

public sealed class HermesVoiceClientTests
{
    sealed class Handler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> action) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) => action(request, ct);
    }
    static string? RunId(VoiceServiceException error) => error.RunId;
    [Fact]
    public async Task QuestTokenIsSentOnlyToConfiguredBridgeAndReplyUsesActualWireFields()
    {
        using var http = new HttpClient(new Handler((request, _) => {
            Assert.Equal("127.0.0.1", request.RequestUri!.Host);
            Assert.Equal("quest-fixture-private-token", request.Headers.Authorization?.Parameter);
            Assert.Equal("/voice/turn", request.RequestUri.AbsolutePath);
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{\"text\":\"Ciao\",\"sessionId\":\"s1\",\"runId\":\"r1\"}", Encoding.UTF8, "application/json") });
        }));
        using var voice = new HermesVoiceClient(new Uri("http://127.0.0.1:9843/"), "quest-fixture-private-token", http);
        using var context = JsonDocument.Parse("{}");
        var reply = await voice.TalkAsync("Ciao", context.RootElement);
        Assert.Equal("Ciao", reply.Text);Assert.Equal("r1", reply.RunId);
    }
    [Fact]
    public async Task StopCancelsAnInFlightVoiceRequest()
    {
        using var http = new HttpClient(new Handler(async (_, ct) => { await Task.Delay(Timeout.Infinite, ct);return new(HttpStatusCode.OK); }));
        using var voice = new HermesVoiceClient(new Uri("http://127.0.0.1:9843/"), "quest-fixture-private-token", http);
        using var cancel = new CancellationTokenSource(50);using var context = JsonDocument.Parse("{}");
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => voice.TalkAsync("Ciao", context.RootElement, cancel.Token));
    }
    [Fact]
    public async Task HttpFailureCannotBecomeAnEmptySuccessfulTranscript()
    {
        using var http = new HttpClient(new Handler((_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.ServiceUnavailable) {
            Content = new StringContent("{\"error\":\"Servizio Hermes non raggiungibile\"}"),
        })));
        using var voice = new HermesVoiceClient(new Uri("http://127.0.0.1:9843/"), "quest-fixture-private-token", http);
        var error = await Assert.ThrowsAsync<VoiceServiceException>(() => voice.TranscribeAsync(VoiceWave.EncodeMono(new float[160], 16000)));
        Assert.Equal(503, error.StatusCode);
    }

    [Fact]
    public async Task VoiceHttpErrorCarriesValidatedRunIdAndPreservesStatusAndMessage()
    {
        using var http = new HttpClient(new Handler((_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.BadGateway) {
            Content = new StringContent("{\"error\":\"Hermes: failed\",\"runId\":\"run-1\",\"stage\":\"hermes\"}"),
        })));
        using var voice = new HermesVoiceClient(new Uri("http://127.0.0.1:9843/"), "quest-fixture-private-token", http);
        using var context = JsonDocument.Parse("{}");
        var error = await Assert.ThrowsAsync<VoiceServiceException>(() => voice.TalkAsync("Ciao", context.RootElement));
        Assert.Equal(502, error.StatusCode);Assert.Equal("Hermes: failed", error.Message);Assert.Equal("run-1", RunId(error));
    }

    public static IEnumerable<object[]> MalformedRunIds => new[] {
        new object[] { "bad id" }, new object[] { "é" }, new object[] { new string('x', 129) },
    };

    [Theory]
    [MemberData(nameof(MalformedRunIds))]
    public async Task MalformedVoiceErrorRunIdIsIgnored(string runId)
    {
        var body = JsonSerializer.Serialize(new { error = "Hermes: failed", runId });
        using var http = new HttpClient(new Handler((_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.BadGateway) {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
        })));
        using var voice = new HermesVoiceClient(new Uri("http://127.0.0.1:9843/"), "quest-fixture-private-token", http);
        using var context = JsonDocument.Parse("{}");
        var error = await Assert.ThrowsAsync<VoiceServiceException>(() => voice.TalkAsync("Ciao", context.RootElement));
        Assert.Equal(502, error.StatusCode);Assert.Equal("Hermes: failed", error.Message);Assert.Null(RunId(error));
    }

    [Fact]
    public async Task MissingVoiceErrorRunIdIsIgnoredAndLegacyConstructorRemainsAvailable()
    {
        var runIdProperty = typeof(VoiceServiceException).GetProperty(nameof(VoiceServiceException.RunId));
        Assert.NotNull(runIdProperty);Assert.False(runIdProperty!.CanWrite);
        Assert.NotNull(typeof(VoiceServiceException).GetConstructor(new[] { typeof(int), typeof(string) }));
        var legacy = new VoiceServiceException(409, "legacy");
        Assert.Equal(409, legacy.StatusCode);Assert.Equal("legacy", legacy.Message);Assert.Null(RunId(legacy));
        using var http = new HttpClient(new Handler((_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.BadGateway) {
            Content = new StringContent("{\"error\":\"Hermes: failed\",\"stage\":\"hermes\"}", Encoding.UTF8, "application/json"),
        })));
        using var voice = new HermesVoiceClient(new Uri("http://127.0.0.1:9843/"), "quest-fixture-private-token", http);
        using var context = JsonDocument.Parse("{}");
        var error = await Assert.ThrowsAsync<VoiceServiceException>(() => voice.TalkAsync("Ciao", context.RootElement));
        Assert.Equal(502, error.StatusCode);Assert.Equal("Hermes: failed", error.Message);Assert.Null(RunId(error));
    }

    [Fact]
    public async Task NonObjectVoiceErrorBodyKeepsStatusFallbackAndHasNoRunId()
    {
        using var http = new HttpClient(new Handler((_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.BadGateway) {
            Content = new StringContent("[]", Encoding.UTF8, "application/json"),
        })));
        using var voice = new HermesVoiceClient(new Uri("http://127.0.0.1:9843/"), "quest-fixture-private-token", http);
        using var context = JsonDocument.Parse("{}");
        var error = await Assert.ThrowsAsync<VoiceServiceException>(() => voice.TalkAsync("Ciao", context.RootElement));
        Assert.Equal(502, error.StatusCode);Assert.Equal("Servizio vocale: HTTP 502", error.Message);Assert.Null(RunId(error));
    }
}
