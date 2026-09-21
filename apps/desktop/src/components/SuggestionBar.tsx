import { useMemo, useState } from "react";
import { executeCommand } from "../commands/execute";
import {
  dismissedIds,
  dismissSuggestion,
  suggestIntent,
  suggestionKey,
} from "../intent/suggest";
import { useDocumentUiStore } from "../stores";

/** Intent suggestion bar (§27): deterministic heuristics, Apply/Dismiss. */
export function SuggestionBar() {
  const features = useDocumentUiStore((s) => s.features);
  const revision = useDocumentUiStore((s) => s.revision);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string[]>(() => dismissedIds());

  const suggestion = useMemo(
    () => suggestIntent(features),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [features, revision],
  );

  if (!suggestion || dismissed.includes(suggestionKey(suggestion))) {
    return null;
  }

  const apply = async (): Promise<void> => {
    if (suggestion.kind !== "equalSize") return;
    setBusy(true);
    setError(null);
    try {
      // Unify all holes to the first diameter — one Undo step each would
      // spam history, so note the tradeoff: sequential commits (simple,
      // honest) rather than a fake compound transaction.
      for (const id of suggestion.ids) {
        await executeCommand("SetDimension", {
          featureId: id,
          paramName: "diameterMm",
          valueMm: suggestion.diameterMm,
        });
      }
      dismissSuggestion(suggestionKey(suggestion));
      setDismissed(dismissedIds());
    } catch (e) {
      setError(e instanceof Error ? e.message : "apply failed");
    } finally {
      setBusy(false);
    }
  };

  const dismiss = (): void => {
    dismissSuggestion(suggestionKey(suggestion));
    setDismissed(dismissedIds());
  };

  return (
    <div
      className="pointer-events-auto flex w-full items-center justify-center gap-2 rounded-[var(--kreoda-radius-md)] border border-[var(--kreoda-accent)]/30 bg-black/75 px-3 py-1.5 text-xs text-white/85 backdrop-blur-[var(--kreoda-surface-blur)]"
      data-testid="suggestion-bar"
    >
      <span>✦ {suggestion.text}</span>
      <button
        onClick={() => void apply()}
        disabled={busy}
        className="rounded-md bg-amber-500/90 px-2 py-0.5 font-medium text-black hover:bg-amber-400 disabled:opacity-50"
      >
        {busy ? "…" : "Apply"}
      </button>
      <button
        onClick={dismiss}
        disabled={busy}
        className="rounded-md px-1.5 py-0.5 text-white/60 hover:bg-white/10 hover:text-white disabled:opacity-40"
      >
        ✕
      </button>
      {error && <span className="text-red-300">{error}</span>}
    </div>
  );
}
