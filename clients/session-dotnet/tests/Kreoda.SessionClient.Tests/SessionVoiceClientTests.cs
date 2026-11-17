using System.Diagnostics;
using System.Text.Json;
using Kreoda.QuestFoundation;
using Kreoda.Session;
using Xunit;

namespace Kreoda.SessionClient.Tests;

public sealed class SessionVoiceClientTests
{
    const string Session = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const string Document = "doc-voice";

    [Fact]
    public async Task HelloAdvertisesVoiceCapabilityAndReadinessUsesPairedSessionIdentity()
    {
        await using var server = StartServer();
        await using var session = await Connect(server);
        using var voice = new SessionVoiceClient(session);

        var readiness = await voice.GetVoiceStatusAsync();

        Assert.False(readiness.Configured);
        Assert.True(readiness.Reachable);
        Assert.Equal(Session, readiness.Identity.SessionId);
        Assert.Equal(Document, readiness.Identity.DocumentId);
        Assert.Equal(0, readiness.Identity.Revision);
        var hello = Requests(server).Single(request => request.GetProperty("method").GetString() == "hello");
        Assert.Contains(SessionMethods.VoiceV1Capability,
            hello.GetProperty("params").GetProperty("capabilities").EnumerateArray().Select(value => value.GetString()));
        Assert.Contains(Requests(server), request => request.GetProperty("method").GetString() == "getVoiceStatus");
    }

    [Fact]
    public async Task SilentVoiceStatusExpiresAsTypedTimeoutAndLeavesBorrowedSessionConnected()
    {
        var server = StartServer(withholdVoiceStatus: true);
        Kreoda.Session.SessionClient? session = null;
        SessionVoiceClient? voice = null;
        try
        {
            session = await Connect(server);
            voice = new SessionVoiceClient(session);
            var stopwatch = Stopwatch.StartNew();
            var pending = voice.GetVoiceStatusAsync();
            var timeout = await Assert.ThrowsAsync<VoiceServiceException>(async () =>
                await pending.WaitAsync(TimeSpan.FromSeconds(7)));

            Assert.Equal(504, timeout.StatusCode);
            Assert.Equal("VOICE_TIMEOUT", timeout.ErrorCode);
            Assert.Equal("status", timeout.Stage);
            Assert.Equal("Il servizio vocale non risponde", timeout.Message);
            Assert.True(stopwatch.Elapsed < TimeSpan.FromSeconds(7));
            Assert.True(session.IsConnected);
        }
        finally
        {
            voice?.Dispose();
            if (session is not null) await session.DisposeAsync();
            await server.DisposeAsync();
        }
    }

    [Fact]
    public async Task UnsupportedPeerCannotReportVoiceReady()
    {
        await using var server = StartServer(supportsVoice: false);
        await using var session = await Connect(server);
        using var voice = new SessionVoiceClient(session);

        var error = await Assert.ThrowsAsync<SessionException>(() => voice.GetVoiceStatusAsync());

        Assert.Equal("NOT_IMPLEMENTED", error.Code);
        Assert.DoesNotContain(Requests(server), request => request.GetProperty("method").GetString() == "getVoiceStatus");
    }

    [Fact]
    public async Task TranscribeTurnAndSpeechUseExactVoiceRpcContextAndSeparateInnerHermesIdentity()
    {
        var requestId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
        var inputWav = VoiceWave.EncodeMono(new float[160], 16000);
        var outputWav = VoiceWave.EncodeMono(new[] { 0f, 0.5f, -0.5f }, 16000);
        await using var server = StartServer(request => request.GetProperty("method").GetString() switch
        {
            "transcribeVoice" => ReplyResult(request, new { sessionId = Session, documentId = Document, revision = 0L,
                voiceRequestId = requestId, text = "Ciao" }),
            "voiceTurn" => ReplyResult(request, new { sessionId = Session, documentId = Document, revision = 0L,
                voiceRequestId = requestId, reply = new { text = "Risposta", sessionId = "hermes-inner-1", runId = "run_1" } }),
            "synthesizeVoice" => ReplyResult(request, new { sessionId = Session, documentId = Document, revision = 0L,
                voiceRequestId = requestId, wavBase64 = Convert.ToBase64String(outputWav) }),
            _ => null,
        });
        await using var session = await Connect(server);
        using var voice = new SessionVoiceClient(session);
        var context = Context(requestId: requestId);

        Assert.Equal("Ciao", await voice.TranscribeAsync(inputWav, context));
        var reply = await voice.TalkAsync("Ciao", context);
        var audio = await voice.SpeechAsync("Risposta", context);

        Assert.Equal("Risposta", reply.Text);
        Assert.Equal("hermes-inner-1", reply.SessionId);
        Assert.NotEqual(Session, reply.SessionId);
        Assert.Equal("run_1", reply.RunId);
        Assert.Equal(3, audio.Samples.Length);
        var requests = Requests(server);
        var stt = requests.Single(request => request.GetProperty("method").GetString() == "transcribeVoice");
        Assert.Equal(Session, stt.GetProperty("sessionId").GetString());
        Assert.Equal(Convert.ToBase64String(inputWav), stt.GetProperty("params").GetProperty("wavBase64").GetString());
        var turn = requests.Single(request => request.GetProperty("method").GetString() == "voiceTurn");
        var sentContext = turn.GetProperty("params").GetProperty("context");
        Assert.Equal("selection-a", sentContext.GetProperty("selectionIds")[0].GetString());
        Assert.Equal("box", sentContext.GetProperty("selectionContext").GetProperty("kind").GetString());
        var speech = requests.Single(request => request.GetProperty("method").GetString() == "synthesizeVoice");
        Assert.Equal(0, speech.GetProperty("params").GetProperty("expectedRevision").GetInt64());
    }

    [Fact]
    public async Task SourceFenceIsCheckedAtSocketSendAndStaleTranscriptionCannotStartTurn()
    {
        var reads = 0;
        await using var firstServer = StartServer();
        await using var firstSession = await Connect(firstServer);
        using var firstVoice = new SessionVoiceClient(firstSession, () => Interlocked.Increment(ref reads) == 1);
        var context = Context();
        await Assert.ThrowsAsync<VoiceServiceException>(() => firstVoice.TranscribeAsync(VoiceWave.EncodeMono(new float[160], 16000), context));
        Assert.DoesNotContain(Requests(firstServer), request => request.GetProperty("method").GetString() == "transcribeVoice");

        var sourceCurrent = true;
        await using var secondServer = StartServer(request =>
        {
            if (request.GetProperty("method").GetString() == "transcribeVoice")
            {
                sourceCurrent = false;
                return ReplyResult(request, new { sessionId = Session, documentId = Document, revision = 0L,
                    voiceRequestId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", text = "Ciao" });
            }
            return null;
        });
        await using var secondSession = await Connect(secondServer);
        using var secondVoice = new SessionVoiceClient(secondSession, () => sourceCurrent);
        await Assert.ThrowsAsync<VoiceServiceException>(() => secondVoice.TranscribeAsync(VoiceWave.EncodeMono(new float[160], 16000), context));
        Assert.DoesNotContain(Requests(secondServer), request => request.GetProperty("method").GetString() == "voiceTurn");
    }

    [Fact]
    public async Task CancellationSendsCancelRpcToSameSessionAndVoiceRequest()
    {
        var received = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        var cancelled = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        await using var server = StartServer();
        server.ExtendedHandler = request =>
        {
            switch (request.GetProperty("method").GetString())
            {
                case "transcribeVoice":
                    received.TrySetResult(request.Clone());
                    return Task.FromResult<LoopbackWsResponse?>(new LoopbackWsResponse(null));
                case "cancelVoice":
                    cancelled.TrySetResult(request.Clone());
                    return Task.FromResult<LoopbackWsResponse?>(new LoopbackWsResponse(ReplyResult(request, new
                    {
                        sessionId = Session, documentId = Document, revision = 0L,
                        voiceRequestId = request.GetProperty("params").GetProperty("voiceRequestId").GetString(),
                        status = "cancelRequested",
                    })));
                default:
                    return Task.FromResult<LoopbackWsResponse?>(null);
            }
        };
        await using var session = await Connect(server);
        using var voice = new SessionVoiceClient(session);
        using var cancel = new CancellationTokenSource();
        var pending = voice.TranscribeAsync(VoiceWave.EncodeMono(new float[160], 16000), Context(), cancel.Token);
        var sent = await received.Task.WaitAsync(TimeSpan.FromSeconds(3));
        cancel.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => pending);
        var cleanup = await cancelled.Task.WaitAsync(TimeSpan.FromSeconds(3));
        Assert.Equal(Session, cleanup.GetProperty("sessionId").GetString());
        Assert.Equal("cancelVoice", cleanup.GetProperty("method").GetString());
        Assert.Equal(sent.GetProperty("params").GetProperty("voiceRequestId").GetString(),
            cleanup.GetProperty("params").GetProperty("voiceRequestId").GetString());
        Assert.Equal(Document, cleanup.GetProperty("params").GetProperty("documentId").GetString());
    }

    [Fact]
    public async Task ProviderDisposeAfterSourceSwitchCancelsOnlyItsCapturedSession()
    {
        var sourceCurrent = true;
        var received = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        var cancelled = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        await using var server = StartServer();
        server.ExtendedHandler = request =>
        {
            switch (request.GetProperty("method").GetString())
            {
                case "transcribeVoice":
                    received.TrySetResult(request.Clone());
                    return Task.FromResult<LoopbackWsResponse?>(new LoopbackWsResponse(null));
                case "cancelVoice":
                    cancelled.TrySetResult(request.Clone());
                    return Task.FromResult<LoopbackWsResponse?>(new LoopbackWsResponse(ReplyResult(request, new
                    {
                        sessionId = Session, documentId = Document, revision = 0L,
                        voiceRequestId = request.GetProperty("params").GetProperty("voiceRequestId").GetString(),
                        status = "cancelRequested",
                    })));
                default:
                    return Task.FromResult<LoopbackWsResponse?>(null);
            }
        };
        await using var session = await Connect(server);
        using var voice = new SessionVoiceClient(session, () => sourceCurrent);
        var pending = voice.TranscribeAsync(VoiceWave.EncodeMono(new float[160], 16000), Context());
        var sent = await received.Task.WaitAsync(TimeSpan.FromSeconds(3));

        sourceCurrent = false;
        voice.Dispose();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => pending);
        var cleanup = await cancelled.Task.WaitAsync(TimeSpan.FromSeconds(4));

        Assert.Equal("cancelVoice", cleanup.GetProperty("method").GetString());
        Assert.Equal(Session, cleanup.GetProperty("sessionId").GetString());
        Assert.Equal(Document, cleanup.GetProperty("params").GetProperty("documentId").GetString());
        Assert.Equal(sent.GetProperty("params").GetProperty("voiceRequestId").GetString(),
            cleanup.GetProperty("params").GetProperty("voiceRequestId").GetString());
        Assert.True(session.IsConnected, "disposing a voice provider must not dispose its borrowed CAD session");
        Assert.DoesNotContain(Requests(server), request => request.GetProperty("method").GetString() is "voiceTurn" or "synthesizeVoice");
    }

    [Fact]
    public async Task SpeechUsesLatestModelRevisionAfterVoiceTurn()
    {
        var revision = 0L;
        var requestId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
        var wav = VoiceWave.EncodeMono(new float[160], 16000);
        await using var server = StartServer(request => request.GetProperty("method").GetString() switch
        {
            "voiceTurn" => ReplyResult(request, new { sessionId = Session, documentId = Document, revision = 1L,
                voiceRequestId = requestId, reply = new { text = "Creato", sessionId = (string?)null, runId = "run_1" } }),
            "synthesizeVoice" => ReplyResult(request, new { sessionId = Session, documentId = Document, revision,
                voiceRequestId = requestId, wavBase64 = Convert.ToBase64String(wav) }),
            _ => null,
        }, revision: () => revision);
        await using var session = await Connect(server);
        using var voice = new SessionVoiceClient(session);
        var context = Context(requestId: requestId);

        await voice.TalkAsync("crea", context);
        revision = 1;
        await session.SnapshotAsync(Document);
        var snapshotCountBeforeSpeech = Requests(server).Count(request => request.GetProperty("method").GetString() == "snapshot");
        await voice.SpeechAsync("Creato", context);

        var speech = Requests(server).Single(request => request.GetProperty("method").GetString() == "synthesizeVoice");
        Assert.Equal(1, speech.GetProperty("params").GetProperty("expectedRevision").GetInt64());
        Assert.Equal(snapshotCountBeforeSpeech,
            Requests(server).Count(request => request.GetProperty("method").GetString() == "snapshot"));
    }

    [Fact]
    public async Task SpeechSynchronizesOwnTurnRevisionBeforeSynthesisWithoutRepeatingTurn()
    {
        var revision = 7L;
        var requestId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
        var wav = VoiceWave.EncodeMono(new[] { 0f, 0.5f, -0.5f }, 16000);
        var turns = 0;
        await using var server = StartServer(request =>
        {
            switch (request.GetProperty("method").GetString())
            {
                case "voiceTurn":
                    turns++;
                    revision = 8;
                    return ReplyResult(request, new { sessionId = Session, documentId = Document, revision = 8L,
                        voiceRequestId = requestId, reply = new { text = "Creato", sessionId = (string?)null, runId = "run_8" } });
                case "synthesizeVoice":
                    return ReplyResult(request, new { sessionId = Session, documentId = Document, revision,
                        voiceRequestId = requestId, wavBase64 = Convert.ToBase64String(wav) });
                default:
                    return null;
            }
        }, revision: () => revision);
        await using var session = await Connect(server);
        using var voice = new SessionVoiceClient(session);
        var context = Context(requestId: requestId, revision: 7);

        var reply = await voice.TalkAsync("crea", context);
        Assert.Equal("Creato", reply.Text);
        Assert.True(session.Model!.Revision == 7, "the voice reply can precede its own delta application");
        Assert.Equal(1, Requests(server).Count(request => request.GetProperty("method").GetString() == "snapshot"));

        await voice.SpeechAsync(reply.Text, context);

        var speech = Requests(server).Single(request => request.GetProperty("method").GetString() == "synthesizeVoice");
        Assert.Equal(8, speech.GetProperty("params").GetProperty("expectedRevision").GetInt64());
        Assert.Equal(8, session.Model!.Revision);
        Assert.Equal(1, turns);
        Assert.Equal(2, Requests(server).Count(request => request.GetProperty("method").GetString() == "snapshot"));
        Assert.DoesNotContain(Requests(server), request => request.GetProperty("method").GetString() == "cancelVoice");
    }

    [Fact]
    public async Task FailedSpeechRevisionSyncKeepsTurnReplyAndRunIdWithoutSynthesizing()
    {
        const string requestId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
        var turns = 0;
        await using var server = StartServer(request =>
        {
            switch (request.GetProperty("method").GetString())
            {
                case "voiceTurn":
                    turns++;
                    return ReplyResult(request, new { sessionId = Session, documentId = Document, revision = 8L,
                        voiceRequestId = requestId, reply = new { text = "Creato", sessionId = (string?)null, runId = "run_8" } });
                case "synthesizeVoice":
                    return ReplyResult(request, new { sessionId = Session, documentId = Document, revision = 7L,
                        voiceRequestId = requestId, wavBase64 = Convert.ToBase64String(VoiceWave.EncodeMono(new float[32], 16000)) });
                default:
                    return null;
            }
        }, revision: () => 7L);
        await using var session = await Connect(server);
        using var voice = new SessionVoiceClient(session);
        var context = Context(requestId: requestId, revision: 7);

        var reply = await voice.TalkAsync("crea", context);
        Assert.Equal("Creato", reply.Text);
        var error = await Assert.ThrowsAsync<VoiceServiceException>(() => voice.SpeechAsync(reply.Text, context));

        Assert.Equal("speech-sync", error.Stage);
        Assert.Equal("run_8", error.RunId);
        Assert.Equal("Risposta ricevuta; modello non sincronizzato. Controlla il PC prima di ripetere.", error.Message);
        Assert.Equal(1, turns);
        Assert.Equal(2, Requests(server).Count(request => request.GetProperty("method").GetString() == "snapshot"));
        Assert.DoesNotContain(Requests(server), request => request.GetProperty("method").GetString() == "synthesizeVoice");
    }

    [Fact]
    public async Task RejectsStaleLineageOversizedWavContextAndInvalidVoiceResultsBeforeSending()
    {
        await using var server = StartServer();
        await using var session = await Connect(server);
        using var voice = new SessionVoiceClient(session);

        await Assert.ThrowsAsync<VoiceServiceException>(() => voice.TranscribeAsync(new byte[1024 * 1024 + 1], Context()));
        await Assert.ThrowsAsync<VoiceServiceException>(() => voice.TalkAsync("Ciao", Context(documentId: "doc-other")));
        using var largeContextDoc = JsonDocument.Parse(JsonSerializer.Serialize(new { body = new string('x', 65536) }));
        await Assert.ThrowsAsync<VoiceServiceException>(() => voice.TalkAsync("Ciao", largeContextDoc.RootElement));

        Assert.DoesNotContain(Requests(server), request => request.GetProperty("method").GetString() is "transcribeVoice" or "voiceTurn");
    }

    [Fact]
    public async Task InvalidTranscriptionIdentityAndOversizedTextAreRejected()
    {
        await using var mismatchServer = StartServer(request => request.GetProperty("method").GetString() == "transcribeVoice"
            ? ReplyResult(request, new { sessionId = Session, documentId = "doc-other", revision = 0L,
                voiceRequestId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", text = "Ciao" }) : null);
        await using var mismatchSession = await Connect(mismatchServer);
        using var mismatchVoice = new SessionVoiceClient(mismatchSession);
        await Assert.ThrowsAsync<VoiceServiceException>(() => mismatchVoice.TranscribeAsync(VoiceWave.EncodeMono(new float[160], 16000), Context()));

        await using var oversizedServer = StartServer(request => request.GetProperty("method").GetString() == "transcribeVoice"
            ? ReplyResult(request, new { sessionId = Session, documentId = Document, revision = 0L,
                voiceRequestId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", text = new string('x', 8001) }) : null);
        await using var oversizedSession = await Connect(oversizedServer);
        using var oversizedVoice = new SessionVoiceClient(oversizedSession);
        await Assert.ThrowsAsync<VoiceServiceException>(() => oversizedVoice.TranscribeAsync(VoiceWave.EncodeMono(new float[160], 16000), Context()));
    }

    [Fact]
    public async Task InvalidSynthesisBase64AndWavAreRejected()
    {
        await using var server = StartServer(request => request.GetProperty("method").GetString() == "synthesizeVoice"
            ? ReplyResult(request, new { sessionId = Session, documentId = Document, revision = 0L,
                voiceRequestId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", wavBase64 = Convert.ToBase64String(new byte[44]) }) : null);
        await using var session = await Connect(server);
        using var voice = new SessionVoiceClient(session);
        await Assert.ThrowsAsync<VoiceServiceException>(() => voice.SpeechAsync("Ciao", Context()));

        await using var malformedServer = StartServer(request => request.GetProperty("method").GetString() == "synthesizeVoice"
            ? ReplyResult(request, new { sessionId = Session, documentId = Document, revision = 0L,
                voiceRequestId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", wavBase64 = "A===\n" }) : null);
        await using var malformedSession = await Connect(malformedServer);
        using var malformedVoice = new SessionVoiceClient(malformedSession);
        await Assert.ThrowsAsync<VoiceServiceException>(() => malformedVoice.SpeechAsync("Ciao", Context()));
    }

    [Fact]
    public async Task RollbackUnconfirmedPreservesValidatedDiagnosticsAndDropsMismatchedRecovery()
    {
        const string requestId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
        static object Recovery(string sessionId, string documentId, long baseRevision) => new
        {
            requestId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            transactionId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            sessionId, documentId, baseRevision,
            ownerClientId = "client-44444444-4444-4444-8444-444444444444",
            causeCode = "HttpRequestException",
        };
        await using var validServer = StartServer(request => request.GetProperty("method").GetString() == "voiceTurn"
            ? ErrorReply(request, Recovery(Session, Document, 6)) : null, revision: () => 7L);
        await using var validSession = await Connect(validServer);
        using var validVoice = new SessionVoiceClient(validSession);
        var valid = await Assert.ThrowsAsync<VoiceServiceException>(() => validVoice.TalkAsync("Ciao", Context(requestId: requestId, revision: 7)));
        Assert.Equal("ROLLBACK_UNCONFIRMED", valid.ErrorCode);
        Assert.Equal("uncertain", valid.Status);
        Assert.Equal("agent", valid.Stage);
        Assert.Equal("run_1", valid.RunId);
        Assert.Equal(6, valid.Recovery?.BaseRevision);
        Assert.Equal("client-44444444-4444-4444-8444-444444444444", valid.Recovery?.OwnerClientId);
        Assert.Equal("HttpRequestException", valid.Recovery?.CauseCode);
        Assert.True(valid.RecoveryPersisted);

        await using var invalidServer = StartServer(request => request.GetProperty("method").GetString() == "voiceTurn"
            ? ErrorReply(request, Recovery(Session, "doc-other", 0)) : null);
        await using var invalidSession = await Connect(invalidServer);
        using var invalidVoice = new SessionVoiceClient(invalidSession);
        var invalid = await Assert.ThrowsAsync<VoiceServiceException>(() => invalidVoice.TalkAsync("Ciao", Context(requestId: requestId)));
        Assert.Equal("ROLLBACK_UNCONFIRMED", invalid.ErrorCode);
        Assert.Equal("uncertain", invalid.Status);
        Assert.Null(invalid.Recovery);
        Assert.Null(invalid.RecoveryPersisted);

        await using var foreignSessionServer = StartServer(request => request.GetProperty("method").GetString() == "voiceTurn"
            ? ErrorReply(request, Recovery("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", Document, 0)) : null);
        await using var foreignSessionClient = await Connect(foreignSessionServer);
        using var foreignSessionVoice = new SessionVoiceClient(foreignSessionClient);
        var wrongSession = await Assert.ThrowsAsync<VoiceServiceException>(() =>
            foreignSessionVoice.TalkAsync("Ciao", Context(requestId: requestId)));
        Assert.Equal("ROLLBACK_UNCONFIRMED", wrongSession.ErrorCode);
        Assert.Equal("uncertain", wrongSession.Status);
        Assert.Null(wrongSession.Recovery);
        Assert.Null(wrongSession.RecoveryPersisted);
    }

    [Fact]
    public async Task RecoveryDiagnosticsRejectUnknownFields()
    {
        await using var server = StartServer(request => request.GetProperty("method").GetString() == "voiceTurn"
            ? ErrorReply(request, new
            {
                requestId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                transactionId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                sessionId = Session, documentId = Document, baseRevision = 0L,
                ownerClientId = "desktop", causeCode = "NEED_FULL_SNAPSHOT", extra = "not in the contract",
            }) : null);
        await using var session = await Connect(server);
        using var voice = new SessionVoiceClient(session);

        var error = await Assert.ThrowsAsync<VoiceServiceException>(() => voice.TalkAsync("Ciao", Context()));

        Assert.Equal("ROLLBACK_UNCONFIRMED", error.ErrorCode);
        Assert.Null(error.Recovery);
        Assert.Null(error.RecoveryPersisted);
    }

    [Fact]
    public void SessionExceptionClonesOnlyBoundedDetails()
    {
        JsonElement details;
        using (var document = JsonDocument.Parse("{\"stage\":\"turn\",\"runId\":\"run_1\"}")) details = document.RootElement.Clone();
        var error = new SessionException("VOICE_FAILED", "bounded", details);
        Assert.Equal("turn", error.ErrorDetails?.GetProperty("stage").GetString());

        using var oversized = JsonDocument.Parse(JsonSerializer.Serialize(new { value = new string('x', 65536) }));
        Assert.Null(new SessionException("VOICE_FAILED", "large", oversized.RootElement).ErrorDetails);
    }

    static LoopbackWsServer StartServer(Func<JsonElement, string?>? voiceReply = null, bool supportsVoice = true,
        Func<long>? revision = null, bool withholdVoiceStatus = false)
    {
        var server = new LoopbackWsServer(request => request.GetProperty("method").GetString() switch
        {
            "hello" => Reply(request, new
            {
                clientId = "client-44444444-4444-4444-8444-444444444444",
                sessionId = Session,
                documentId = Document,
                capabilities = supportsVoice ? new[] { "voice-v1", "incremental-deltas" } : new[] { "incremental-deltas" },
            }),
            "snapshot" => Reply(request, new
            {
                sessionId = Session, documentId = Document, revision = revision?.Invoke() ?? 0L,
                features = Array.Empty<object>(), sketches = Array.Empty<object>(), bodies = Array.Empty<object>(),
            }),
            "getVoiceStatus" when withholdVoiceStatus => null,
            "getVoiceStatus" => Reply(request, new
            {
                result = new { sessionId = Session, documentId = Document, revision = revision?.Invoke() ?? 0L, configured = false, reachable = true },
            }),
            _ => voiceReply?.Invoke(request),
        });
        server.Start();
        return server;
    }

    static Task<Kreoda.Session.SessionClient> Connect(LoopbackWsServer server) =>
        Kreoda.Session.SessionClient.ConnectAsync(new Uri($"ws://127.0.0.1:{server.Port}/"), "fixture-session-token", "quest");

    static string Reply(JsonElement request, object payload)
    {
        var result = new Dictionary<string, object?>
        {
            ["requestId"] = request.GetProperty("requestId").GetString(),
            ["ok"] = true,
        };
        foreach (var property in JsonSerializer.SerializeToElement(payload).EnumerateObject())
            result[property.Name] = property.Value.Clone();
        return JsonSerializer.Serialize(result);
    }

    static string ReplyResult(JsonElement request, object result) => Reply(request, new { result });

    static string ErrorReply(JsonElement request, object recovery) => JsonSerializer.Serialize(new
    {
        requestId = request.GetProperty("requestId").GetString(), ok = false, errorCode = "ROLLBACK_UNCONFIRMED",
        error = "Rollback remains uncertain", stage = "agent", runId = "run_1", status = "uncertain",
        recovery, recoveryPersisted = true,
    });

    static JsonElement Context(string requestId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", string sessionId = Session,
        string documentId = Document, long revision = 0)
    {
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(new
        {
            voiceRequestId = requestId, sessionId, documentId, revision, project = "Kreoda",
            selectionIds = new[] { "selection-a" }, selectionContext = new { kind = "box" },
        }));
        return document.RootElement.Clone();
    }

    static JsonElement[] Requests(LoopbackWsServer server)
    {
        lock (server.Received)
            return server.Received.Select(raw => JsonSerializer.Deserialize<JsonElement>(raw)).ToArray();
    }
}
