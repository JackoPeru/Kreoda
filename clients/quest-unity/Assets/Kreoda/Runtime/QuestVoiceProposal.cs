using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;

namespace Kreoda.QuestRuntime
{
    /// <summary>Read-only proposal references. Never reconstruct executable CAD steps on Quest.</summary>
    internal sealed class QuestVoiceProposal
    {
        internal string ProposalId, SessionId, DocumentId;
        internal long Revision;
        internal string[] ChoiceIds, Descriptions;

        internal static QuestVoiceProposal Parse(JsonElement envelope, string sessionId, string documentId, long revision)
        {
            if (envelope.ValueKind != JsonValueKind.Object ||
                !envelope.TryGetProperty("proposal", out var proposal) || proposal.ValueKind != JsonValueKind.Object ||
                !proposal.TryGetProperty("version", out var version) || version.GetInt32() != 1 ||
                !proposal.TryGetProperty("proposalId", out var id) || id.ValueKind != JsonValueKind.String ||
                !proposal.TryGetProperty("sessionId", out var session) || session.GetString() != sessionId ||
                !proposal.TryGetProperty("documentId", out var document) || document.GetString() != documentId ||
                !proposal.TryGetProperty("revision", out var rev) || rev.GetInt64() != revision ||
                !proposal.TryGetProperty("choices", out var choices) || choices.ValueKind != JsonValueKind.Array ||
                choices.GetArrayLength() is < 1 or > 8 || string.IsNullOrWhiteSpace(id.GetString()))
                throw new FormatException("Proposta CAD assente o obsoleta");
            var ids = new List<string>();var descriptions = new List<string>();
            foreach (var choice in choices.EnumerateArray())
            {
                if (choice.ValueKind != JsonValueKind.Object ||
                    !choice.TryGetProperty("id", out var key) || key.ValueKind != JsonValueKind.String ||
                    !choice.TryGetProperty("description", out var label) || label.ValueKind != JsonValueKind.String ||
                    string.IsNullOrWhiteSpace(key.GetString()) || key.GetString().Length > 128 ||
                    string.IsNullOrWhiteSpace(label.GetString()) || label.GetString().Length > 512)
                    throw new FormatException("Scelta CAD non valida");
                ids.Add(key.GetString());descriptions.Add(label.GetString());
            }
            if (ids.Distinct(StringComparer.Ordinal).Count() != ids.Count)
                throw new FormatException("Scelte CAD duplicate");
            return new QuestVoiceProposal { ProposalId = id.GetString(), SessionId = sessionId,
                DocumentId = documentId, Revision = revision, ChoiceIds = ids.ToArray(), Descriptions = descriptions.ToArray() };
        }
    }
}
