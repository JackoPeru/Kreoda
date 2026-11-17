using System.Text.Json;
using Kreoda.Session;
using Xunit;

namespace Kreoda.SessionClient.Tests;

/// <summary>
/// Two real managed SessionClient WebSocket connections to distinct loopback
/// endpoints sharing one deterministic in-memory relay state. The fake relay
/// supplies authorization/transaction decisions; the assertions under test
/// are the *real client's* correlation, lineage and error propagation.
/// No native core, Electron, Hermes gateway, or network outside 127.0.0.1.
/// </summary>
public sealed class TwoClientRevocationInFlightTests
{
    private const string OldSession = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    private const string NewSession = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    private const string OldDocument = "two-client-old";
    private const string NewDocument = "two-client-new";
    private const string Transaction = "txn-revoked-a";
    private const string SourceOperation = "11111111-1111-4111-8111-111111111111";

    private static readonly TimeSpan Deadline = TimeSpan.FromSeconds(7);

    private sealed class RelayFixture
    {
        private readonly object _gate = new();
        private bool _open;
        private bool _revoked;
        private int _staged;
        private int _revision = 0;  // authority never publishes a revoked stage
        private int _undoCount = 0; // no commit means no native Undo group
        private int _crossSessionReplayAttempts;
        private string _session = OldSession;
        private string _document = OldDocument;

        public TaskCompletionSource<JsonElement> CommitArrived { get; } =
            new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource ReleaseCommit { get; } =
            new(TaskCreationOptions.RunContinuationsAsynchronously);

        public (int Revision, int UndoCount, bool Open, int Staged) Counters
        {
            get
            {
                lock (_gate) return (_revision, _undoCount, _open, _staged);
            }
        }

        public int CrossSessionReplayAttempts
        {
            get { lock (_gate) return _crossSessionReplayAttempts; }
        }

        public void RevokeAndRotate()
        {
            lock (_gate)
            {
                _revoked = true;
                _open = false;
                _staged = 0;
                _session = NewSession;
                _document = NewDocument;
            }
        }

        public string Handle(JsonElement request)
        {
            var method = request.GetProperty("method").GetString();
            lock (_gate)
            {
                switch (method)
                {
                    case SessionMethods.Hello:
                        var token = request.GetProperty("params").GetProperty("token").GetString();
                        if (token is not ("client-a-token" or "client-b-token"))
                            return Error(request, "UNAUTHORIZED");
                        return Ok(request, new
                        {
                            clientId = token == "client-a-token" ? "client-a" : "client-b",
                            sessionId = _session,
                            documentId = _document,
                            revision = _revision,
                            capabilities = new[] { SessionMethods.OperationReplayCapability },
                        });

                    case SessionMethods.Snapshot:
                        var document = request.GetProperty("params").GetProperty("documentId").GetString();
                        if (document != _document || EnvelopeSession(request) != _session)
                            return Error(request, "CONFLICT");
                        return Ok(request, new
                        {
                            sessionId = _session,
                            documentId = _document,
                            revision = _revision,
                            features = Array.Empty<object>(),
                            sketches = Array.Empty<object>(),
                            bodies = Array.Empty<object>(),
                        });

                    case SessionMethods.TxnBegin:
                        if (_revoked) return Error(request, "UNAUTHORIZED");
                        if (EnvelopeSession(request) != _session) return Error(request, "CONFLICT");
                        if (_open) return Error(request, "CONFLICT");
                        Assert.Equal(Transaction,
                            request.GetProperty("params").GetProperty("transactionId").GetString());
                        _open = true;
                        return Ok(request, new { transactionId = Transaction });

                    case SessionMethods.Invoke:
                        // Assert the explicit replay is the original operation,
                        // not a fresh GUID accidentally accepted/rejected by
                        // the scripted authority.
                        if (!request.TryGetProperty("operationId", out var op) ||
                            op.GetString() != SourceOperation)
                            return Error(request, "BAD_PARAMS");
                        if (EnvelopeSession(request) != _session ||
                            request.GetProperty("params").GetProperty("documentId").GetString() != _document)
                        {
                            ++_crossSessionReplayAttempts;
                            return Error(request, "CONFLICT");
                        }
                        if (_revoked) return Error(request, "UNAUTHORIZED");
                        if (!_open) return Error(request, "CONFLICT");
                        Assert.Equal(SourceOperation, request.GetProperty("operationId").GetString());
                        Assert.Equal(Transaction,
                            request.GetProperty("params").GetProperty("transactionId").GetString());
                        _staged = 1;
                        // Never publish a delta/revision from an uncommitted transaction.
                        return Ok(request, new { staged = true, revision = _revision });

                    default:
                        throw new InvalidOperationException("Unexpected fake relay method: " + method);
                }
            }
        }

        public async Task<LoopbackWsResponse?> HoldCommitAsync(
            JsonElement request, bool forgedStaleSuccess)
        {
            if (request.GetProperty("method").GetString() != SessionMethods.TxnCommit)
                return null;
            Assert.Equal(Transaction, request.GetProperty("params").GetProperty("transactionId").GetString());
            Assert.Equal(OldSession, EnvelopeSession(request));
            CommitArrived.TrySetResult(request.Clone());
            await ReleaseCommit.Task.WaitAsync(Deadline);

            lock (_gate)
            {
                // The fake authority has revoked A and discarded its staged
                // work; even an injected ACK must not be mistaken for a commit.
                Assert.True(_revoked);
                Assert.False(_open);
                Assert.Equal(0, _staged);
                Assert.Equal(0, _revision);
                Assert.Equal(0, _undoCount);
                return new LoopbackWsResponse(forgedStaleSuccess
                    ? Ok(request, new
                    {
                        transactionId = Transaction, sessionId = OldSession,
                        documentId = OldDocument, revision = 1, committed = true,
                    })
                    : Error(request, "UNAUTHORIZED"));
            }
        }

        private static string? EnvelopeSession(JsonElement request) =>
            request.TryGetProperty("sessionId", out var session) ? session.GetString() : null;

        private static string Ok(JsonElement request, object payload)
        {
            var result = new Dictionary<string, object?>
            {
                ["requestId"] = request.GetProperty("requestId").GetString(),
                ["ok"] = true,
            };
            foreach (var field in JsonSerializer.SerializeToElement(payload).EnumerateObject())
                result[field.Name] = field.Value.Clone();
            return JsonSerializer.Serialize(result);
        }

        private static string Error(JsonElement request, string code) =>
            JsonSerializer.Serialize(new
            {
                requestId = request.GetProperty("requestId").GetString(),
                ok = false,
                errorCode = code,
                error = "test relay deliberately rejected this fenced request",
            });
    }

    private static async Task<Session.SessionClient> ConnectAsync(
        LoopbackWsServer server, string token)
    {
        return await Session.SessionClient.ConnectAsync(
            new Uri($"ws://127.0.0.1:{server.Port}/"), token, "xunit");
    }

    private static async Task RotateAsync(
        LoopbackWsServer aServer, LoopbackWsServer bServer,
        Session.SessionClient a, Session.SessionClient b)
    {
        var aRestart = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var bRestart = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        a.CoreRestarted += () => aRestart.TrySetResult();
        b.CoreRestarted += () => bRestart.TrySetResult();
        var rotated = JsonSerializer.Serialize(new
        {
            @event = "core-restarted", sessionId = NewSession, documentId = NewDocument, revision = 0,
        });
        await aServer.PushAsync(rotated);
        await bServer.PushAsync(rotated);
        await Task.WhenAll(aRestart.Task, bRestart.Task).WaitAsync(Deadline);
        Assert.Equal(NewSession, a.SessionId);
        Assert.Equal(NewSession, b.SessionId);
    }

    [Fact]
    public async Task RevokedCommitIsUnauthorizedAndReplayCannotCrossRotatedSession()
    {
        var relay = new RelayFixture();
        await using var aServer = new LoopbackWsServer(relay.Handle)
        {
            ExtendedHandler = request => relay.HoldCommitAsync(request, forgedStaleSuccess: false),
        };
        await using var bServer = new LoopbackWsServer(relay.Handle);
        aServer.Start();
        bServer.Start();
        await using var a = await ConnectAsync(aServer, "client-a-token");
        await using var b = await ConnectAsync(bServer, "client-b-token");

        Assert.NotEqual(a.ClientId, b.ClientId);
        Assert.Equal(OldSession, a.SessionId);
        Assert.Equal(OldSession, b.SessionId);

        await a.TxnBeginAsync(Transaction, OldDocument).WaitAsync(Deadline);
        await a.CallAsync(SessionMethods.Invoke, new Dictionary<string, object?>
        {
            ["type"] = 3,
            ["documentId"] = OldDocument,
            ["transactionId"] = Transaction,
            ["fields"] = new Dictionary<string, object?>
            {
                ["featureId"] = "staged-box", ["widthMm"] = 10,
                ["heightMm"] = 10, ["depthMm"] = 10,
            },
        }, operationId: SourceOperation, expectedSessionId: OldSession).WaitAsync(Deadline);

        Assert.Equal((0, 0, true, 1), relay.Counters);

        // A's commit request is actually on the wire, but its server
        // response is deliberately held. B can snapshot independently.
        var committing = a.TxnCommitAsync(Transaction, OldDocument);
        try
        {
            var heldRequest = await relay.CommitArrived.Task.WaitAsync(Deadline);
            Assert.Equal(SessionMethods.TxnCommit,
                heldRequest.GetProperty("method").GetString());
            Assert.Equal(OldSession, heldRequest.GetProperty("sessionId").GetString());
            Assert.True(Guid.TryParse(heldRequest.GetProperty("operationId").GetString(), out _));
            var whileInFlight = await b.SnapshotAsync(OldDocument).WaitAsync(Deadline);
            Assert.Equal(0, whileInFlight.GetProperty("revision").GetInt32());
            Assert.Equal(OldDocument, whileInFlight.GetProperty("documentId").GetString());
            Assert.Equal((0, 0, true, 1), relay.Counters);

            relay.RevokeAndRotate();
            await RotateAsync(aServer, bServer, a, b);
        }
        finally { relay.ReleaseCommit.TrySetResult(); }

        var rejected = await Assert.ThrowsAsync<SessionException>(
            () => committing.WaitAsync(Deadline));
        Assert.Equal("UNAUTHORIZED", rejected.Code);
        Assert.Equal((0, 0, false, 0), relay.Counters);

        var bAfter = await b.SnapshotAsync(NewDocument).WaitAsync(Deadline);
        Assert.Equal(NewSession, bAfter.GetProperty("sessionId").GetString());
        Assert.Equal(NewDocument, bAfter.GetProperty("documentId").GetString());
        Assert.Equal(0, bAfter.GetProperty("revision").GetInt32());

        // Explicit replay keeps the original operationId and old session
        // fence on the wire. The shared fake authority refuses cross-lineage
        // reuse; the REAL managed client must surface CONFLICT, not success.
        var invokeParams = new Dictionary<string, object?>
        {
            ["type"] = 3, ["documentId"] = OldDocument, ["transactionId"] = Transaction,
            ["fields"] = new Dictionary<string, object?> { ["featureId"] = "staged-box" },
        };
        var conflict = await Assert.ThrowsAsync<SessionException>(() =>
            a.ReplayOperationAsync(SessionMethods.Invoke, invokeParams,
                SourceOperation, OldSession).WaitAsync(Deadline));
        Assert.Equal("CONFLICT", conflict.Code);
        Assert.Equal(1, relay.CrossSessionReplayAttempts);
        Assert.Equal((0, 0, false, 0), relay.Counters);
    }

    [Fact]
    public async Task LateSuccessfulCommitAckFromRetiredLineageMustNotCompleteManagedCall()
    {
        var relay = new RelayFixture();
        await using var aServer = new LoopbackWsServer(relay.Handle)
        {
            ExtendedHandler = request => relay.HoldCommitAsync(request, forgedStaleSuccess: true),
        };
        await using var bServer = new LoopbackWsServer(relay.Handle);
        aServer.Start();
        bServer.Start();
        await using var a = await ConnectAsync(aServer, "client-a-token");
        await using var b = await ConnectAsync(bServer, "client-b-token");
        await a.TxnBeginAsync(Transaction, OldDocument).WaitAsync(Deadline);

        // This test intentionally probes a hostile/buggy old-session ACK.
        // The fake authority never commits or creates an Undo.
        var committing = a.TxnCommitAsync(Transaction, OldDocument);
        try
        {
            await relay.CommitArrived.Task.WaitAsync(Deadline);
            Assert.Equal(0, (await b.SnapshotAsync(OldDocument).WaitAsync(Deadline))
                .GetProperty("revision").GetInt32());
            relay.RevokeAndRotate();
            await RotateAsync(aServer, bServer, a, b);
        }
        finally { relay.ReleaseCommit.TrySetResult(); }

        // A stale positive ACK is not authorization. The client must reject
        // it after its session+document generation changes, even when the
        // requestId still matches. A PASS here would be a real client guard,
        // not a claim that the fake relay is authoritative production code.
        var stale = await Assert.ThrowsAsync<SessionException>(
            () => committing.WaitAsync(Deadline));
        Assert.Equal("NEED_FULL_SNAPSHOT", stale.Code);
        Assert.Equal((0, 0, false, 0), relay.Counters);
        var bAfter = await b.SnapshotAsync(NewDocument).WaitAsync(Deadline);
        Assert.Equal(0, bAfter.GetProperty("revision").GetInt32());
    }
}
