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
}
