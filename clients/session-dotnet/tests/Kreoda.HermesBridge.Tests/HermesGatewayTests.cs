using System.Net;
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
    static readonly HermesOptions Options = new(new Uri("http://127.0.0.1:8642/v1/"), "fixture-token", "kreoda-project");

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
            if (request.RequestUri!.AbsolutePath.EndsWith("/stop")) { stops++;return Task.FromResult(Json("{}")); }
            if (request.Method == HttpMethod.Post) { submits++;return Task.FromResult(Json("{\"run_id\":\"run-1\",\"status\":\"queued\"}")); }
            cancel.Cancel();ct.ThrowIfCancellationRequested();return Task.FromResult(Json("{}"));
        }));
        var gateway = new HermesGatewayClient(http, Options, pollInterval: TimeSpan.FromMilliseconds(1));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => gateway.TalkAsync("Ciao", JsonDocument.Parse("{}").RootElement, cancel.Token));
        Assert.Equal(1, submits);Assert.Equal(1, stops);
    }

    [Theory]
    [InlineData("failed")]
    [InlineData("cancelled")]
    [InlineData("awaiting_approval")]
    [InlineData("unknown")]
    public async Task NonSuccessHermesStatusCannotBecomeAReply(string status)
    {
        using var http = new HttpClient(new Handler((request, _) => Task.FromResult(request.Method == HttpMethod.Post
            ? Json("{\"run_id\":\"run-1\",\"status\":\"queued\"}")
            : Json($"{{\"run_id\":\"run-1\",\"status\":\"{status}\"}}"))));
        var gateway = new HermesGatewayClient(http, Options, pollInterval: TimeSpan.FromMilliseconds(1));
        await Assert.ThrowsAsync<HermesVoiceException>(() => gateway.TalkAsync("Ciao", JsonDocument.Parse("{}").RootElement));
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
        var gateway = new HermesGatewayClient(http, Options, pollInterval: TimeSpan.FromMilliseconds(1));
        var reply = await gateway.TalkAsync("Ciao", JsonDocument.Parse("{}").RootElement);
        Assert.Equal("Pronto", reply.Text);Assert.Equal(2, keys.Count);Assert.Equal(keys[0], keys[1]);Assert.Equal(bodies[0], bodies[1]);
    }
}
