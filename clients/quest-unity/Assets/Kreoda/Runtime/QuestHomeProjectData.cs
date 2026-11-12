using Kreoda.Session;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;

namespace Kreoda.QuestRuntime
{
    internal sealed class QuestHomeProjectData
    {
        readonly static int Limit = 4;
        readonly List<Entry> _recent = new List<Entry>();
        string _serverSummary;
        int? _serverProjectCount;
        internal sealed class Entry
        {
            internal string SessionId, DocumentId;
            internal long Revision;
            internal int Bodies;
        }
        internal IReadOnlyList<Entry> Recent => _recent;
        internal int RecentProjectCount => _serverProjectCount ?? _recent.Count;
        internal bool HasRecentProjects => RecentProjectCount > 0;
        internal bool HasServerSnapshot => _serverProjectCount.HasValue;
        internal void Observe(SessionModelState model)
        {
            if (model == null || string.IsNullOrWhiteSpace(model.DocumentId) || string.IsNullOrWhiteSpace(model.SessionId)) return;
            var existing = _recent.FindIndex(e => e.SessionId == model.SessionId && e.DocumentId == model.DocumentId);
            if (existing >= 0 && model.Revision < _recent[existing].Revision) return;
            if (existing >= 0) _recent.RemoveAt(existing);
            _recent.Insert(0, new Entry { SessionId = model.SessionId, DocumentId = model.DocumentId,
                Revision = model.Revision, Bodies = model.Bodies?.Count ?? 0 });
            if (_recent.Count > Limit) _recent.RemoveAt(_recent.Count - 1);
        }
        internal string RecentSummary()
        {
            if (HasServerSnapshot) return _serverSummary;
            if (_recent.Count == 0) return Summary(null);
            return string.Join("\n", _recent.Take(3).Select(e =>
                Short(e.DocumentId) + " · r" + e.Revision + " · " + e.Bodies + " corpi"));
        }
        internal bool ApplyServerProjects(JsonElement response)
        {
            if (response.ValueKind != JsonValueKind.Object ||
                !response.TryGetProperty("result", out var result) || result.ValueKind != JsonValueKind.Object ||
                !result.TryGetProperty("projects", out var projects) || projects.ValueKind != JsonValueKind.Array ||
                projects.GetArrayLength() > 100) return false;
            var names = new List<string>();
            foreach (var project in projects.EnumerateArray())
            {
                if (project.ValueKind != JsonValueKind.Object ||
                    !project.TryGetProperty("name", out var name) || name.ValueKind != JsonValueKind.String ||
                    !project.TryGetProperty("openedAt", out var opened) || opened.ValueKind != JsonValueKind.Number ||
                    !opened.TryGetInt64(out var openedMs))
                    return false;
                var title = name.GetString();
                if (string.IsNullOrWhiteSpace(title) || title.Length > 200 ||
                    openedMs < 0 || openedMs > 253402300799999L) return false;
                var timestamp = DateTimeOffset.FromUnixTimeMilliseconds(openedMs);
                if (names.Count < 3)
                    names.Add(Clean(title, 24) + " · " + timestamp.ToString("yyyy-MM-dd HH:mm"));
            }
            _serverProjectCount = projects.GetArrayLength();
            _serverSummary = names.Count == 0 ? "Nessun progetto recente sul PC" : string.Join("\n", names);
            return true;
        }
        internal void ClearServerProjects() { _serverSummary = null; _serverProjectCount = null; }
        // A display-only recent-project entry is never an authorization to open a host file.
        // Opening is gated until the public protocol provides server-issued opaque IDs.
        internal static bool HasCanonicalOpenCapability(IReadOnlyCollection<string> advertisedMethods) => false;
        static string Clean(string text, int limit)
        {
            var safe = new string(text.Where(c => !char.IsControl(c)).ToArray()).Trim();
            return safe.Length > limit ? safe.Substring(0, limit - 1) + "…" : safe;
        }
        static string Short(string id) => id.Length > 12 ? id.Substring(0, 12) + "…" : id;
        internal static string Summary(SessionModelState model)
        {
            if (model == null) return "Connetti il PC per vedere\nil documento corrente";
            var document = model.DocumentId ?? "";
            var shortId = Short(document);
            return "Documento " + shortId + "\nRev " + model.Revision + " · " + model.Bodies.Count + " corpi";
        }
    }
}
