using System.Text.Json;
using Kreoda.Session;
using Xunit;

namespace Kreoda.SessionClient.Tests;

public sealed class SessionContextTests
{
    const string Session = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    static string Reply(JsonElement request, object fields)
    {
        var result = new Dictionary<string, object?> { ["requestId"] = request.GetProperty("requestId").GetString(), ["ok"] = true };
        foreach (var field in JsonSerializer.SerializeToElement(fields).EnumerateObject()) result[field.Name] = field.Value.Clone();
        return JsonSerializer.Serialize(result);
    }
    [Theory]
    [InlineData(7, true)] [InlineData(8, false)]
    public async Task TypedContextReplyMustMatchCapturedDocumentRevision(long replyRevision, bool accepted)
    {
        await using var server = new LoopbackWsServer(request => request.GetProperty("method").GetString() switch {
            SessionMethods.Hello => Reply(request, new { clientId = "client", sessionId = Session, documentId = "doc-phase1", revision = 7, capabilities = SessionMethods.ServerCapabilities }),
            SessionMethods.Snapshot => Reply(request, new { sessionId = Session, documentId = "doc-phase1", revision = 7,
                features = Array.Empty<object>(), sketches = Array.Empty<object>(), bodies = Array.Empty<object>(), tips = Array.Empty<string>() }),
            SessionMethods.ListCommands => Reply(request, new { result = new { sessionId = Session, documentId = "doc-phase1", revision = replyRevision, contextValid = true,
                commands = new[] { new { id = "CreateFillet", label = "Fillet", description = "Round edge", supportsPreview = false, available = true,
                    boundParameters = new { targetId = "box", edgeIds = new[] { "box:e1" } } } } } }),
            _ => null });
        server.Start();await using var client = await Kreoda.Session.SessionClient.ConnectAsync(new Uri($"ws://127.0.0.1:{server.Port}/"), "t", "agent");
        if (accepted) {
            var context = await client.ContextCommandsAsync(new[] { "box:e1" }, "doc-phase1", 7);
            Assert.True(context.Commands.Single().Available);Assert.False(context.Commands.Single().SupportsPreview);
        } else {
            var error = await Assert.ThrowsAsync<SessionException>(() => client.ContextCommandsAsync(new[] { "box:e1" }, "doc-phase1", 7));
            Assert.Equal("NEED_FULL_SNAPSHOT", error.Code);
        }
    }
}
