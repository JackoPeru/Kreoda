using ModelContextProtocol.AspNetCore;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Kreoda.HermesBridge;

public static class BridgeHost
{
    public static WebApplication Build(CadBridge cad, string url, HermesGatewayClient? hermes = null, string? voiceToken = null)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme != "http" || !uri.IsLoopback)
            throw new ArgumentException("Bridge must bind an explicitly configured loopback HTTP endpoint");
        var builder = WebApplication.CreateBuilder(new[] { "--urls", url });
        builder.Configuration["AllowedHosts"] = "localhost;127.0.0.1;[::1]";
        builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 2 * 1024 * 1024);
        builder.Services.AddSingleton(cad);
        builder.Services.AddMcpServer().WithHttpTransport(options => options.SessionMode = HttpServerSessionMode.Stateless)
            .WithTools<CadTools>().WithResources<ProjectResources>();
        var app = builder.Build();
        app.MapMcp("/mcp");
        var voiceConfigured = hermes is not null && voiceToken is { Length: >= 16 };
        app.MapGet("/health", () => Results.Ok(new { service = "kreoda-hermes-bridge", mcp = true, voiceConfigured }));
        if (voiceConfigured) MapVoice(app, cad, hermes!, voiceToken!);
        return app;
    }
    sealed record VoiceTurn(string Text, JsonElement Context);
    static IResult VoiceError(string error, string stage, int statusCode, Exception cause)
    {
        var runId = HermesGatewayClient.ValidatedRunId(cause);
        return runId is null
            ? Results.Json(new { error, stage }, statusCode: statusCode)
            : Results.Json(new { error, stage, runId }, statusCode: statusCode);
    }
    static void MapVoice(WebApplication app, CadBridge cad, HermesGatewayClient hermes, string token)
    {
        var expected = SHA256.HashData(Encoding.UTF8.GetBytes(token));
        var turnGate = new SemaphoreSlim(1, 1);
        var group = app.MapGroup("/voice").AddEndpointFilter(async (invocation, next) => {
            var auth = invocation.HttpContext.Request.Headers.Authorization.ToString();
            if (!auth.StartsWith("Bearer ", StringComparison.Ordinal) ||
                !CryptographicOperations.FixedTimeEquals(expected, SHA256.HashData(Encoding.UTF8.GetBytes(auth[7..]))))
                return Results.Unauthorized();
            try { return await next(invocation); }
            catch (CadRecoveryRequiredException error) {
                return Results.Json(new { error = "Annullamento CAD non confermato; verifica la transazione prima di ripetere.",
                    stage = "cad", status = "uncertain", errorCode = "ROLLBACK_UNCONFIRMED", recovery = error.Recovery,
                    recoveryPersisted = error.RecoveryPersisted }, statusCode: 502);
            }
            catch (HermesVoiceException error) { return VoiceError(error.Message, error.Stage, 502, error); }
            catch (Exception error) when (error is ArgumentException or JsonException) { return Results.BadRequest(new { error = "Richiesta vocale non valida" }); }
            catch (HttpRequestException error) { return VoiceError("Servizio Hermes non raggiungibile", "network", 502, error); }
            catch (OperationCanceledException error) when (!invocation.HttpContext.RequestAborted.IsCancellationRequested) {
                return VoiceError("Tempo scaduto. Controlla il modello prima di ripetere.", "timeout", 504, error);
            }
            catch (Kreoda.Session.SessionException error) { return Results.Conflict(new { error = "Modello cambiato o altra richiesta attiva; ripeti la domanda", errorCode = error.Code, stage = "cad" }); }
        });
        group.MapPost("/transcribe", async (HttpContext context) => {
            using var content = new StreamContent(context.Request.Body);
            content.Headers.ContentLength = context.Request.ContentLength;
            var wav = await HermesGatewayClient.Bytes(content, 1048576, context.RequestAborted);
            var text = await hermes.TranscribeAsync(wav, context.RequestAborted);
            return Results.Ok(new { text });
        });
        group.MapPost("/turn", async (HttpContext context) => {
            if (!await turnGate.WaitAsync(0, context.RequestAborted)) return Results.Conflict(new { error = "Hermes sta già rispondendo" });
            string? origin = null;
            try {
                var request = await ReadTurn(context);
                origin = await cad.BeginVoiceAsync(request.Context, context.RequestAborted);
                var reply = await hermes.TalkAsync(request.Text, request.Context, context.RequestAborted);
                var unfinished = await cad.EndVoiceAsync(origin);origin = null;
                return unfinished ? Results.Json(new { error = "Hermes non ha confermato le modifiche; richiesta CAD annullata", stage = "cad", runId = reply.RunId }, statusCode: 502) : Results.Ok(reply);
            } finally { if (origin is not null) await cad.EndVoiceAsync(origin);turnGate.Release(); }
        });
        group.MapPost("/speech", async (HttpContext context) => {
            var request = await ReadTurn(context);
            var wav = await hermes.SpeechAsync(request.Text, context.RequestAborted);
            return Results.Bytes(wav, "audio/wav");
        });
    }
    static async Task<VoiceTurn> ReadTurn(HttpContext context)
    {
        using var content = new StreamContent(context.Request.Body);content.Headers.ContentLength = context.Request.ContentLength;
        var bytes = await HermesGatewayClient.Bytes(content, 65536, context.RequestAborted);
        return JsonSerializer.Deserialize<VoiceTurn>(bytes, new JsonSerializerOptions(JsonSerializerDefaults.Web))
            ?? throw new ArgumentException("Missing voice turn");
    }
}
