using System.Text;
using System.Text.Json;
using Kreoda.Session;

namespace Kreoda.QuestFoundation;

public sealed record VoiceSessionIdentity(string SessionId, string DocumentId, long Revision);
public sealed record SessionVoiceReadiness(bool Configured, bool Reachable, VoiceSessionIdentity Identity);
public sealed record VoiceRecoveryIdentity(string RequestId, string TransactionId, string SessionId,
    string DocumentId, long BaseRevision, string? OwnerClientId, string CauseCode);

/// <summary>Voice transport bound to one authenticated CAD session. It never owns that session.</summary>
public sealed class SessionVoiceClient : IVoiceClient
{
    private const int MaximumContextBytes = 65536;
    private const int MaximumVoiceText = 8000;
    private const int MaximumWavBytes = 4 * 1024 * 1024;
    private const int MaximumInputWavBytes = 1024 * 1024;
    private static readonly TimeSpan VoiceStatusTimeout = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan VoiceSttTimeout = TimeSpan.FromSeconds(65);
    private static readonly TimeSpan VoiceTurnTimeout = TimeSpan.FromSeconds(190);
    private static readonly TimeSpan VoiceSpeechTimeout = TimeSpan.FromSeconds(65);
    private static readonly TimeSpan SpeechSyncTimeout = TimeSpan.FromSeconds(5);

    private readonly SessionClient _session;
    private readonly Func<bool> _sourceCurrent;
    private readonly CancellationTokenSource _lifetime = new();
    private VoiceTalkReceipt? _lastTalkReceipt;
    private int _disposed;

    public SessionVoiceClient(SessionClient session, Func<bool>? sourceCurrent = null)
    {
        _session = session ?? throw new ArgumentNullException(nameof(session));
        _sourceCurrent = sourceCurrent ?? (() => true);
    }

    public async Task<SessionVoiceReadiness> GetVoiceStatusAsync(CancellationToken ct = default)
    {
        ThrowIfDisposed();
        EnsureVoiceCapability();
        var identity = CurrentIdentity();
        var result = await CallResultAsync(SessionMethods.GetVoiceStatus,
            new Dictionary<string, object?>(), identity, null, ct, VoiceStatusTimeout, "status").ConfigureAwait(false);
        if (!TryIdentity(result, out var reply) || reply != identity ||
            !TryBoolean(result, "configured", out var configured) || !TryBoolean(result, "reachable", out var reachable))
            throw InvalidReply("voice status identity or readiness is invalid");
        return new(configured, reachable, identity);
    }

    public async Task<string> TranscribeAsync(byte[] wav, JsonElement context, CancellationToken ct = default)
    {
        ThrowIfDisposed();
        EnsureVoiceCapability();
        if (wav is null || wav.Length > MaximumInputWavBytes)
            throw new VoiceServiceException(400, "Microphone WAV is outside limits", errorCode: "BAD_PARAMS");
        try { VoiceWave.Inspect(wav, 30); }
        catch (ArgumentException error)
        {
            throw new VoiceServiceException(400, error.Message, errorCode: "BAD_PARAMS");
        }

        var request = ReadContext(context);
        var identity = new VoiceSessionIdentity(request.SessionId, request.DocumentId, request.Revision);
        EnsureContextCurrent(identity);
        var result = await CallResultAsync(SessionMethods.TranscribeVoice, new Dictionary<string, object?>
        {
            ["documentId"] = identity.DocumentId,
            ["expectedRevision"] = identity.Revision,
            ["voiceRequestId"] = request.VoiceRequestId,
            ["wavBase64"] = Convert.ToBase64String(wav.ToArray()),
        }, identity, request.VoiceRequestId, ct, VoiceSttTimeout, "stt").ConfigureAwait(false);
        ValidateResponseIdentity(result, identity, request.VoiceRequestId);
        return ReadVoiceText(result, "text");
    }

    public async Task<VoiceReply> TalkAsync(string text, JsonElement context, CancellationToken ct = default)
    {
        ThrowIfDisposed();
        EnsureVoiceCapability();
        ValidateText(text, "Voice request text");
        var request = ReadContext(context);
        var identity = new VoiceSessionIdentity(request.SessionId, request.DocumentId, request.Revision);
        EnsureContextCurrent(identity);
        var result = await CallResultAsync(SessionMethods.VoiceTurn, new Dictionary<string, object?>
        {
            ["documentId"] = identity.DocumentId,
            ["expectedRevision"] = identity.Revision,
            ["voiceRequestId"] = request.VoiceRequestId,
            // Keep the full context, including selectionContext, exactly as captured by Quest.
            ["context"] = context.Clone(),
            ["text"] = text,
        }, identity, request.VoiceRequestId, ct, VoiceTurnTimeout, "turn", allowRevisionAdvance: true).ConfigureAwait(false);
        ValidateResponseIdentity(result, identity, request.VoiceRequestId, allowRevisionAdvance: true);
        if (!result.TryGetProperty("reply", out var reply) || reply.ValueKind != JsonValueKind.Object)
            throw InvalidReply("voice turn reply is missing");
        var answer = ReadVoiceText(reply, "text");
        var runId = ReadSafeId(reply, "runId", required: true)!;
        var hermesSessionId = ReadSafeId(reply, "sessionId", required: false);
        if (!TryIdentity(result, out var turnIdentity)) throw InvalidReply("voice turn identity is invalid");
        Volatile.Write(ref _lastTalkReceipt, new VoiceTalkReceipt(request.VoiceRequestId, turnIdentity.SessionId,
            turnIdentity.DocumentId, turnIdentity.Revision, runId));
        return new(answer, hermesSessionId, runId);
    }

    public async Task<VoiceAudio> SpeechAsync(string text, JsonElement context, CancellationToken ct = default)
    {
        ThrowIfDisposed();
        EnsureVoiceCapability();
        ValidateText(text, "Speech text");
        var request = ReadContext(context);
        // Synthesis follows a successful agent turn, which may have advanced the model revision.
        var identity = CurrentIdentity();
        EnsureContextLineage(request, identity);
        var receipt = Volatile.Read(ref _lastTalkReceipt);
        if (receipt is not null && receipt.VoiceRequestId == request.VoiceRequestId &&
            receipt.SessionId == request.SessionId && receipt.DocumentId == request.DocumentId &&
            identity.Revision < receipt.MinimumRevision)
            identity = await SynchronizeSpeechRevisionAsync(request, identity, receipt, ct).ConfigureAwait(false);
        var result = await CallResultAsync(SessionMethods.SynthesizeVoice, new Dictionary<string, object?>
        {
            ["documentId"] = identity.DocumentId,
            ["expectedRevision"] = identity.Revision,
            ["voiceRequestId"] = request.VoiceRequestId,
            ["text"] = text,
        }, identity, request.VoiceRequestId, ct, VoiceSpeechTimeout, "speech").ConfigureAwait(false);
        ValidateResponseIdentity(result, identity, request.VoiceRequestId);

        if (!result.TryGetProperty("wavBase64", out var encoded) || encoded.ValueKind != JsonValueKind.String)
            throw InvalidReply("synthesized WAV is missing");
        var base64 = encoded.GetString()!;
        if (base64.Length == 0 || base64.Length > ((MaximumWavBytes + 2) / 3) * 4 || base64.Length % 4 != 0 ||
            base64.Any(character => !(character is >= 'A' and <= 'Z' or >= 'a' and <= 'z' or >= '0' and <= '9' or '+' or '/' or '=')))
            throw InvalidReply("synthesized WAV encoding is invalid or too large");
        byte[] wav;
        try { wav = Convert.FromBase64String(base64); }
        catch (FormatException) { throw InvalidReply("synthesized WAV encoding is invalid"); }
        if (wav.Length > MaximumWavBytes || Convert.ToBase64String(wav) != base64)
            throw InvalidReply("synthesized WAV encoding is invalid or too large");
        try { return VoiceWave.Decode(wav, 120); }
        catch (ArgumentException error) { throw InvalidReply("synthesized WAV is invalid: " + error.Message); }
    }

    private async Task<JsonElement> CallResultAsync(string method, IDictionary<string, object?> parameters,
        VoiceSessionIdentity identity, string? voiceRequestId, CancellationToken ct, TimeSpan timeout,
        string timeoutStage, bool allowRevisionAdvance = false)
    {
        ThrowIfDisposed();
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, _lifetime.Token);
        linked.CancelAfter(timeout);
        var sent = 0;
        using var cancellation = voiceRequestId is null
            ? default
            : linked.Token.Register(() =>
            {
                if (Interlocked.CompareExchange(ref sent, 0, 0) != 0)
                    _ = CancelRemoteAsync(identity.SessionId, identity.DocumentId, voiceRequestId);
            });
        try
        {
            EnsureCurrent(identity, checkRevision: true);
            var reply = await _session.CallAsync(method, parameters, linked.Token,
                expectedSessionId: identity.SessionId,
                beforeSend: () =>
                {
                    EnsureCurrent(identity, checkRevision: true);
                    Interlocked.Exchange(ref sent, 1);
                }).ConfigureAwait(false);
            linked.Token.ThrowIfCancellationRequested();
            EnsureCurrent(identity, checkRevision: !allowRevisionAdvance);
            if (!reply.TryGetProperty("result", out var result) || result.ValueKind != JsonValueKind.Object)
                throw InvalidReply("voice response payload is missing");
            return result.Clone();
        }
        catch (SessionException error) when (linked.IsCancellationRequested || ct.IsCancellationRequested)
        {
            if (ct.IsCancellationRequested || _lifetime.IsCancellationRequested)
            {
                var cancelledToken = ct.IsCancellationRequested ? ct : _lifetime.Token;
                throw new OperationCanceledException("Voice request cancelled", error, cancelledToken);
            }
            throw VoiceTimeout(timeoutStage);
        }
        catch (SessionException error)
        {
            throw ToVoiceException(error, identity);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested || _lifetime.IsCancellationRequested)
        {
            throw;
        }
        catch (OperationCanceledException) when (linked.IsCancellationRequested)
        {
            throw VoiceTimeout(timeoutStage);
        }
    }

    private async Task CancelRemoteAsync(string sessionId, string documentId, string voiceRequestId)
    {
        try
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(3));
            await _session.CallAsync(SessionMethods.CancelVoice, new Dictionary<string, object?>
            {
                ["documentId"] = documentId,
                ["voiceRequestId"] = voiceRequestId,
            }, timeout.Token, expectedSessionId: sessionId,
                beforeSend: () => EnsureCancelLineageCurrent(sessionId, documentId)).ConfigureAwait(false);
        }
        catch { /* Cancellation cleanup is best-effort; the original cancellation remains authoritative. */ }
    }

    private async Task<VoiceSessionIdentity> SynchronizeSpeechRevisionAsync(VoiceRequestContext request,
        VoiceSessionIdentity current, VoiceTalkReceipt receipt, CancellationToken ct)
    {
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, _lifetime.Token);
        linked.CancelAfter(SpeechSyncTimeout);
        try
        {
            EnsureContextLineage(request, current);
            await _session.SnapshotAsync(request.DocumentId, linked.Token).ConfigureAwait(false);
            linked.Token.ThrowIfCancellationRequested();
            var synchronized = CurrentIdentity();
            EnsureContextLineage(request, synchronized);
            if (synchronized.Revision < receipt.MinimumRevision)
                throw new InvalidOperationException("snapshot did not reach the completed voice turn revision");
            return synchronized;
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested || _lifetime.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception error) when (ct.IsCancellationRequested || _lifetime.IsCancellationRequested)
        {
            var cancelledToken = ct.IsCancellationRequested ? ct : _lifetime.Token;
            throw new OperationCanceledException("Voice request cancelled", error, cancelledToken);
        }
        catch (Exception)
        {
            throw new VoiceServiceException(502,
                "Risposta ricevuta; modello non sincronizzato. Controlla il PC prima di ripetere.",
                receipt.RunId, stage: "speech-sync");
        }
    }

    private static VoiceServiceException VoiceTimeout(string stage) =>
        new(504, "Il servizio vocale non risponde", errorCode: "VOICE_TIMEOUT", stage: stage);

    private VoiceSessionIdentity CurrentIdentity()
    {
        var model = _session.Model;
        if (!_session.IsConnected || model is null || string.IsNullOrWhiteSpace(model.SessionId) ||
            string.IsNullOrWhiteSpace(model.DocumentId) || model.Revision < 0 ||
            model.Revision > SessionContract.MaximumRevision || model.SessionId != _session.SessionId)
            throw new VoiceServiceException(409, "Voice requires a current CAD model", errorCode: "NOT_CONNECTED");
        return new(model.SessionId, model.DocumentId, model.Revision);
    }

    private VoiceRequestContext ReadContext(JsonElement context)
    {
        if (context.ValueKind != JsonValueKind.Object || Encoding.UTF8.GetByteCount(context.GetRawText()) > MaximumContextBytes ||
            !TryString(context, "voiceRequestId", out var requestId) || !Guid.TryParseExact(requestId, "D", out _) ||
            !TryString(context, "sessionId", out var sessionId) || !TryString(context, "documentId", out var documentId) ||
            !TryRevision(context, "revision", out var revision))
            throw new VoiceServiceException(400, "Voice context is outside limits", errorCode: "BAD_PARAMS");
        return new(requestId, sessionId, documentId, revision);
    }

    private void EnsureContextCurrent(VoiceSessionIdentity expected)
    {
        var current = CurrentIdentity();
        if (current != expected)
            throw new VoiceServiceException(409, "Voice context no longer matches the current CAD model", errorCode: "NEED_FULL_SNAPSHOT");
        try { EnsureCurrent(expected, checkRevision: true); }
        catch (SessionException error) { throw ToVoiceException(error, expected); }
    }

    private void EnsureContextLineage(VoiceRequestContext context, VoiceSessionIdentity current)
    {
        if (context.SessionId != current.SessionId || context.DocumentId != current.DocumentId)
            throw new VoiceServiceException(409, "Voice context belongs to another CAD session", errorCode: "NEED_FULL_SNAPSHOT");
        try { EnsureCurrent(current, checkRevision: true); }
        catch (SessionException error) { throw ToVoiceException(error, current); }
    }

    private void EnsureCurrent(VoiceSessionIdentity expected, bool checkRevision)
    {
        ThrowIfDisposed();
        bool sourceCurrent;
        try { sourceCurrent = _sourceCurrent(); }
        catch { sourceCurrent = false; }
        var current = _session.Model;
        if (!sourceCurrent || !_session.IsConnected || current is null || current.SessionId != expected.SessionId ||
            current.DocumentId != expected.DocumentId || _session.SessionId != expected.SessionId ||
            checkRevision && current.Revision != expected.Revision)
            throw new SessionException("NEED_FULL_SNAPSHOT", "voice source or CAD model changed");
    }

    private void EnsureCancelLineageCurrent(string sessionId, string documentId)
    {
        var current = _session.Model;
        if (!_session.IsConnected || current is null || current.SessionId != sessionId ||
            current.DocumentId != documentId || _session.SessionId != sessionId)
            throw new SessionException("NEED_FULL_SNAPSHOT", "captured voice session changed before cancellation");
    }

    private void EnsureVoiceCapability()
    {
        if (!_session.ServerCapabilities.Contains(SessionMethods.VoiceV1Capability, StringComparer.Ordinal))
            throw new SessionException("NOT_IMPLEMENTED", "PC does not support voice-v1");
    }

    private static void ValidateResponseIdentity(JsonElement result, VoiceSessionIdentity expected, string voiceRequestId,
        bool allowRevisionAdvance = false)
    {
        if (!TryIdentity(result, out var actual) || actual.SessionId != expected.SessionId || actual.DocumentId != expected.DocumentId ||
            (allowRevisionAdvance ? actual.Revision < expected.Revision : actual.Revision != expected.Revision) ||
            !TryString(result, "voiceRequestId", out var actualRequestId) || actualRequestId != voiceRequestId)
            throw InvalidReply("voice response identity does not match the request");
    }

    private static bool TryIdentity(JsonElement value, out VoiceSessionIdentity identity)
    {
        identity = default!;
        if (!TryString(value, "sessionId", out var sessionId) || !TryString(value, "documentId", out var documentId) ||
            !TryRevision(value, "revision", out var revision)) return false;
        identity = new(sessionId, documentId, revision);
        return true;
    }

    private static bool TryString(JsonElement value, string name, out string result, int maximum = 512)
    {
        result = string.Empty;
        if (value.ValueKind != JsonValueKind.Object || !value.TryGetProperty(name, out var property) ||
            property.ValueKind != JsonValueKind.String) return false;
        var text = property.GetString();
        if (string.IsNullOrWhiteSpace(text) || text.Length > maximum) return false;
        result = text;
        return true;
    }

    private static bool TryRevision(JsonElement value, string name, out long revision)
    {
        revision = -1;
        return value.ValueKind == JsonValueKind.Object && value.TryGetProperty(name, out var property) &&
            property.ValueKind == JsonValueKind.Number && property.TryGetInt64(out revision) &&
            revision is >= 0 and <= SessionContract.MaximumRevision;
    }

    private static bool TryBoolean(JsonElement value, string name, out bool result)
    {
        result = false;
        if (value.ValueKind != JsonValueKind.Object || !value.TryGetProperty(name, out var property) ||
            property.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return false;
        result = property.GetBoolean();
        return true;
    }

    private static string ReadVoiceText(JsonElement value, string name)
    {
        if (!TryString(value, name, out var text, MaximumVoiceText))
            throw InvalidReply("voice text is missing or outside limits");
        return text;
    }

    private static string? ReadSafeId(JsonElement value, string name, bool required)
    {
        if (!value.TryGetProperty(name, out var property) || property.ValueKind == JsonValueKind.Null)
        {
            if (required) throw InvalidReply("voice reply identity is missing");
            return null;
        }
        if (property.ValueKind != JsonValueKind.String) throw InvalidReply("voice reply identity is invalid");
        var id = property.GetString();
        if (string.IsNullOrWhiteSpace(id) || id.Length > 128 || id.Any(character =>
                !(character is >= 'A' and <= 'Z' or >= 'a' and <= 'z' or >= '0' and <= '9' or '_' or '-' or '.')))
            throw InvalidReply("voice reply identity is invalid");
        return id;
    }

    private static void ValidateText(string text, string name)
    {
        if (string.IsNullOrWhiteSpace(text) || text.Length > MaximumVoiceText)
            throw new VoiceServiceException(400, name + " is outside limits", errorCode: "BAD_PARAMS");
    }

    private static VoiceServiceException ToVoiceException(SessionException error, VoiceSessionIdentity expected)
    {
        string? stage = null, runId = null, status = null;
        VoiceRecoveryIdentity? recovery = null;
        bool? recoveryPersisted = null;
        var details = error.ErrorDetails;
        if (details is { ValueKind: JsonValueKind.Object } root)
        {
            stage = ReadBoundedToken(root, "stage", 64);
            runId = ReadSafeId(root, "runId", required: false);
            status = ReadBoundedToken(root, "status", 64);
            if (root.TryGetProperty("recovery", out var rawRecovery) && TryRecovery(rawRecovery, expected, out var validRecovery))
            {
                recovery = validRecovery;
                if (TryBoolean(root, "recoveryPersisted", out var persisted)) recoveryPersisted = persisted;
            }
        }
        return new VoiceServiceException(502, error.Message, runId, error.Code, status, stage, recovery, recoveryPersisted);
    }

    private static bool TryRecovery(JsonElement value, VoiceSessionIdentity expected, out VoiceRecoveryIdentity recovery)
    {
        recovery = default!;
        if (value.ValueKind != JsonValueKind.Object) return false;
        var allowedFields = new HashSet<string>(StringComparer.Ordinal)
        { "requestId", "transactionId", "sessionId", "documentId", "baseRevision", "ownerClientId", "causeCode" };
        var seenFields = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in value.EnumerateObject())
            if (!allowedFields.Contains(property.Name) || !seenFields.Add(property.Name)) return false;
        if (seenFields.Count != allowedFields.Count) return false;
        if (value.ValueKind != JsonValueKind.Object || !TryString(value, "requestId", out var requestId) || !Guid.TryParseExact(requestId, "D", out _) ||
            !TryString(value, "transactionId", out var transactionId) || !Guid.TryParseExact(transactionId, "D", out _) ||
            !TryString(value, "sessionId", out var sessionId) || sessionId != expected.SessionId ||
            !TryString(value, "documentId", out var documentId) || documentId != expected.DocumentId ||
            !TryRevision(value, "baseRevision", out var baseRevision) ||
            !TryString(value, "causeCode", out var causeCode, 128) ||
            causeCode.Any(character => !(character is >= 'A' and <= 'Z' or >= 'a' and <= 'z' or >= '0' and <= '9' or '_' or '.' or '-')))
            return false;

        string? ownerClientId = null;
        if (value.TryGetProperty("ownerClientId", out var owner))
        {
            if (owner.ValueKind == JsonValueKind.String)
            {
                ownerClientId = owner.GetString();
                if (ownerClientId is null || ownerClientId.Length > 128 ||
                    (ownerClientId != "desktop" &&
                     (!ownerClientId.StartsWith("client-", StringComparison.Ordinal) ||
                      !Guid.TryParseExact(ownerClientId.Substring("client-".Length), "D", out _))))
                    return false;
            }
            else if (owner.ValueKind != JsonValueKind.Null) return false;
        }
        else return false;
        recovery = new(requestId, transactionId, sessionId, documentId, baseRevision, ownerClientId, causeCode);
        return true;
    }

    private static string? ReadBoundedToken(JsonElement value, string name, int maximum)
    {
        if (!TryString(value, name, out var token) || token.Length > maximum || token.Any(character =>
                !(character is >= 'A' and <= 'Z' or >= 'a' and <= 'z' or >= '0' and <= '9' or '_' or '-')))
            return null;
        return token;
    }

    private static VoiceServiceException InvalidReply(string message) =>
        new(502, message, errorCode: "BAD_MODEL");

    private void ThrowIfDisposed()
    {
        if (Volatile.Read(ref _disposed) != 0) throw new ObjectDisposedException(nameof(SessionVoiceClient));
    }

    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) == 0) _lifetime.Cancel();
    }

    private sealed record VoiceTalkReceipt(string VoiceRequestId, string SessionId, string DocumentId,
        long MinimumRevision, string RunId);
    private sealed record VoiceRequestContext(string VoiceRequestId, string SessionId, string DocumentId, long Revision);
}
