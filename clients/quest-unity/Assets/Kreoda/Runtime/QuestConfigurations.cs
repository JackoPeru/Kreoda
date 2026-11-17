using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Kreoda.Session;

namespace Kreoda.QuestRuntime
{
    internal static class QuestConfigurations
    {
        internal sealed class Snapshot
        {
            internal string Active;
            internal string[] Names;
        }

        internal static Snapshot Parse(JsonElement response)
        {
            if (response.ValueKind != JsonValueKind.Object)
                throw new FormatException("Risposta configurazioni non valida");
            // Session relay wraps native query payload in result; accept native payload for fixture parity.
            var result = response.TryGetProperty("result", out var wrapped) ? wrapped : response;
            if (result.ValueKind != JsonValueKind.Object || !result.TryGetProperty("active", out var active) ||
                active.ValueKind != JsonValueKind.String || !result.TryGetProperty("named", out var named) ||
                named.ValueKind != JsonValueKind.Object) throw new FormatException("Risposta configurazioni non valida");
            var names = named.EnumerateObject().Select(property => property.Name).ToArray();
            if (names.Length > 64 || names.Any(name => !ValidName(name)) ||
                (active.GetString()!.Length > 0 && !names.Contains(active.GetString(), StringComparer.Ordinal)))
                throw new FormatException("Configurazioni CAD non valide");
            return new Snapshot { Active = active.GetString(), Names = names };
        }

        internal static bool ValidName(string name) => !string.IsNullOrWhiteSpace(name) && name.Length <= 64 &&
            name.All(c => !char.IsControl(c));

        internal static bool IsCurrent(SessionModelState current, SessionModelState captured) =>
            current != null && captured != null && current.SessionId == captured.SessionId &&
            current.DocumentId == captured.DocumentId && current.Revision == captured.Revision;
    }
}
