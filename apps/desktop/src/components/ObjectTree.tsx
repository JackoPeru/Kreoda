import { useMemo } from "react";
import { buildTreeItems, useDocumentUiStore, useSelectionStore } from "../stores";

/** Object tree (nouns) + compact feature history (§26). */
export function ObjectTree() {
  const features = useDocumentUiStore((s) => s.features);
  const sketches = useDocumentUiStore((s) => s.sketches);
  // Derive OUTSIDE the subscription: the selector must return a stable
  // reference or getSnapshot never stabilizes (infinite update loop).
  const items = useMemo(
    () => buildTreeItems(features, sketches),
    [features, sketches],
  );
  const select = useSelectionStore((s) => s.select);
  const selectedIds = useSelectionStore((s) => s.selectedIds);

  return (
    <div className="w-60 shrink-0 border-r border-white/10 bg-[#0e1218] p-2">
      <div className="px-2 py-1 text-xs uppercase tracking-wide text-white/50">
        Objects
      </div>
      {items.length === 0 && (
        <div className="px-2 py-1.5 text-xs text-white/40">
          Empty — add a box to begin.
        </div>
      )}
      {items.map((o) => (
        <button
          key={o.id}
          onClick={() => select(o.id, false)}
          className={`block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-white/5 ${selectedIds.includes(o.id) ? "bg-white/10" : ""}`}
        >
          {o.name}
        </button>
      ))}
      <div className="mt-3 px-2 py-1 text-xs uppercase tracking-wide text-white/50">
        History
      </div>
      <div className="px-2 text-xs text-white/60">
        {features.length === 0 ? "—" : features.map((f) => f.type).join(" → ")}
      </div>
    </div>
  );
}
