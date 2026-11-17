using System;
using System.Collections.Generic;
using System.Text.Json;
using Kreoda.Session;

namespace Kreoda.QuestRuntime
{
    // Read-only typed state. A projectId is a server-issued ephemeral capability, never a path.
    internal sealed class QuestOpenableProjects
    {
        internal sealed class Entry { internal string Id, Name; internal long ExpiresAt; }
        internal string SessionId, DocumentId;
        internal long Revision;
        internal Entry[] Projects;

        internal static QuestOpenableProjects Parse(JsonElement envelope, SessionModelState model, long nowMs)
        {
            if (model == null || envelope.ValueKind != JsonValueKind.Object ||
                !envelope.TryGetProperty("result", out var result) || result.ValueKind != JsonValueKind.Object ||
                !result.TryGetProperty("sessionId", out var session) || session.ValueKind != JsonValueKind.String ||
                !result.TryGetProperty("documentId", out var document) || document.ValueKind != JsonValueKind.String ||
                !result.TryGetProperty("revision", out var revision) || !revision.TryGetInt64(out var rev) ||
                session.GetString() != model.SessionId || document.GetString() != model.DocumentId || rev != model.Revision ||
                !result.TryGetProperty("projects", out var projects) || projects.ValueKind != JsonValueKind.Array ||
                projects.GetArrayLength() > 20) return null;
            var entries = new List<Entry>();
            var ids = new HashSet<string>(StringComparer.Ordinal);
            foreach (var item in projects.EnumerateArray())
            {
                if (item.ValueKind != JsonValueKind.Object ||
                    !item.TryGetProperty("projectId", out var id) || id.ValueKind != JsonValueKind.String ||
                    !item.TryGetProperty("name", out var name) || name.ValueKind != JsonValueKind.String ||
                    !item.TryGetProperty("expiresAt", out var expiry) || !expiry.TryGetInt64(out var expires)) return null;
                var token = id.GetString();var title = name.GetString();
                if (string.IsNullOrWhiteSpace(token) || token.Length > 128 || !ids.Add(token) ||
                    string.IsNullOrWhiteSpace(title) || title.Length > 256 ||
                    title.IndexOfAny(new[] { '/', '\\' }) >= 0 || HasControl(title) || expires <= nowMs ||
                    expires > nowMs + 120000) return null;
                entries.Add(new Entry { Id = token, Name = title, ExpiresAt = expires });
            }
            return new QuestOpenableProjects { SessionId = model.SessionId, DocumentId = model.DocumentId,
                Revision = rev, Projects = entries.ToArray() };
        }

        static bool HasControl(string value)
        {
            foreach (var character in value) if (char.IsControl(character)) return true;
            return false;
        }

        internal bool IsCurrent(SessionModelState model, long nowMs, int index) =>
            model != null && model.SessionId == SessionId && model.DocumentId == DocumentId &&
            model.Revision == Revision && Projects != null && index >= 0 && index < Projects.Length &&
            Projects[index].ExpiresAt > nowMs;

        internal static bool OpenReplyAccepted(JsonElement envelope, string oldSessionId)
        {
            if (envelope.ValueKind != JsonValueKind.Object ||
                !envelope.TryGetProperty("result", out var result) || result.ValueKind != JsonValueKind.Object ||
                !result.TryGetProperty("status", out var status) || status.ValueKind != JsonValueKind.String ||
                status.GetString() != "opened" ||
                !result.TryGetProperty("sessionId", out var session) || session.ValueKind != JsonValueKind.String ||
                !result.TryGetProperty("revision", out var revision) || !revision.TryGetInt64(out var rev)) return false;
            var newSession = session.GetString();
            return !string.IsNullOrWhiteSpace(newSession) && newSession != oldSessionId && rev >= 0;
        }
    }
}
