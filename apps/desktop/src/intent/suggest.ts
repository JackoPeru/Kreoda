import type { FeatureSummary } from "../ipc/coreClient";

// Deterministic intent inference WITHOUT AI (§27, §0.8): geometry/context
// heuristics over the read-only projection. The LLM layer (§28) may add
// accelerator suggestions later; these work offline first.

export type IntentSuggestion =
  | {
      kind: "equalSize";
      /** Hole feature ids to unify. */
      ids: string[];
      diameterMm: number;
      text: string;
    }
  | {
      kind: "symmetricPair";
      ids: string[];
      text: string;
    };

const DIA_TOL_MM = 0.01;

/**
 * Equal-size holes: holes with diameters in the same neighborhood (within
 * half a millimeter or 10%, whichever is larger) but not exactly equal get
 * different values → suggest unifying. Exactly-equal holes stay silent
 * (no nagging for correct models).
 */
export function suggestEqualHoles(
  features: FeatureSummary[],
): IntentSuggestion | null {
  const holes = features.filter((f) => f.type === "Hole");
  if (holes.length < 2) return null;
  const band = (a: number, b: number): boolean => {
    const tol = Math.max(0.5, 0.1 * Math.min(a, b));
    return Math.abs(a - b) < tol;
  };
  // Deterministic grouping (§27): sort by diameter first so the partition
  // never depends on feature creation order (first-fit is order-sensitive).
  const sorted = [...holes].sort(
    (a, b) => (a.paramsMm[0] ?? 0) - (b.paramsMm[0] ?? 0),
  );
  const groups: FeatureSummary[][] = [];
  for (const h of sorted) {
    const d = h.paramsMm[0] ?? 0;
    const g = groups.find((gg) => band(gg[0]!.paramsMm[0] ?? 0, d));
    if (g) g.push(h);
    else groups.push([h]);
  }
  for (const g of groups) {
    if (g.length < 2) continue;
    const dias = g.map((h) => h.paramsMm[0] ?? 0);
    const min = Math.min(...dias);
    const max = Math.max(...dias);
    if (max - min >= DIA_TOL_MM) {
      return {
        kind: "equalSize",
        ids: g.map((h) => h.featureId),
        diameterMm: dias[0]!,
        text: `Keep these ${g.length} holes the same size (⌀${dias[0]!.toFixed(1)} mm)?`,
      };
    }
  }
  return null;
}

/** All Phase 6 deterministic rules in priority order. */
export function suggestIntent(
  features: FeatureSummary[],
): IntentSuggestion | null {
  return suggestEqualHoles(features);
}

const DISMISSED_KEY = "intentcad.dismissedSuggestions";

export function dismissedIds(): string[] {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

export function dismissSuggestion(key: string): void {
  try {
    const cur = dismissedIds();
    if (!cur.includes(key)) {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify([...cur, key]));
    }
  } catch {
    // Private mode etc: dismissal is best-effort.
  }
}

/** Stable dismissal key for a suggestion (ids sorted). */
export function suggestionKey(s: IntentSuggestion): string {
  return `${s.kind}:${[...s.ids].sort().join(",")}`;
}
