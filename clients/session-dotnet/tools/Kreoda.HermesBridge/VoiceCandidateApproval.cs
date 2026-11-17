using System.Text.Json;
using Kreoda.ModelingAgent;

namespace Kreoda.HermesBridge;

/// <summary>Only server-produced, explicitly registered options can be approved; text is never executable.</summary>
public sealed class VoiceCandidateApproval
{
    public sealed record Choice(string Id, string Description);
    public sealed record Proposal(int Version, string ProposalId, string SessionId, string DocumentId,
        long Revision, IReadOnlyList<Choice> Choices);
    sealed record Pending(Proposal Public, IReadOnlyDictionary<string, GeneratedCadOption> Options,
        IReadOnlyList<CadCheck> Checks);
    readonly Dictionary<string, Pending> _pending = new(StringComparer.Ordinal);
    readonly object _gate = new();

    public Proposal Register(string sessionId, string documentId, long revision,
        IReadOnlyList<GeneratedCadOption> options, IReadOnlyList<CadCheck> checks)
    {
        if (string.IsNullOrWhiteSpace(sessionId) || string.IsNullOrWhiteSpace(documentId) || revision < 0 ||
            options.Count is < 1 or > 8 || checks.Count is < 1 or > 32 ||
            options.Any(o => string.IsNullOrWhiteSpace(o.Id) || o.Id.Length > 128 ||
                string.IsNullOrWhiteSpace(o.Description) || o.Description.Length > 512 ||
                o.Steps.Count is < 1 or > 16) ||
            options.Select(o => o.Id).Distinct(StringComparer.Ordinal).Count() != options.Count)
            throw new ArgumentException("A bounded catalog-backed option and checks are required");
        var id = Guid.NewGuid().ToString("D");
        var proposal = new Proposal(1, id, sessionId, documentId, revision,
            options.Select(o => new Choice(o.Id, o.Description)).ToArray());
        lock (_gate) {
            if (_pending.Count >= 16) _pending.Clear();
            _pending.Add(id, new(proposal, options.ToDictionary(o => o.Id, StringComparer.Ordinal), checks));
        }
        return proposal;
    }

    public async Task<JsonElement> ApproveAsync(string proposalId, string choiceId, string sessionId,
        string documentId, long revision, CadBridge cad, CancellationToken ct = default)
    {
        Pending pending;
        GeneratedCadOption choice;
        lock (_gate) {
            if (!_pending.TryGetValue(proposalId, out pending!) || pending.Public.Version != 1 ||
                pending.Public.SessionId != sessionId || pending.Public.DocumentId != documentId ||
                pending.Public.Revision != revision || !pending.Options.TryGetValue(choiceId, out choice!))
                throw new ArgumentException("Unknown or stale explicit CAD choice");
            // Consume before any async execution: duplicate approvals cannot run twice.
            _pending.Remove(proposalId);
        }
        return await cad.ExecuteGeneratedAsync(choice, pending.Checks, ct);
    }
}
