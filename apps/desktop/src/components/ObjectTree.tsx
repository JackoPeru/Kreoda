import { useMemo, useState } from "react";
import { buildTreeItems, useDocumentUiStore, useSelectionStore } from "../stores";

/**
 * Object tree (nouns) + body history (Slice 4): one row per Body, with
 * expandable per-feature history (Box → Hole → Fillet). A body with a
 * single root feature renders as one flat row exactly as before (no
 * nesting noise). Row labels are unchanged — only grouping is new.
 */
export function ObjectTree() {
  const features = useDocumentUiStore((s) => s.features);
  const bodies = useDocumentUiStore((s) => s.bodies);
  const sketches = useDocumentUiStore((s) => s.sketches);
  // Derive OUTSIDE the subscription: the selector must return a stable
  // reference or getSnapshot never stabilizes (infinite update loop).
  const items = useMemo(
    () => buildTreeItems(features, sketches, bodies),
    [features, sketches, bodies],
  );
  const select = useSelectionStore((s) => s.select);
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  // Collapsed parents by body id (default: history visible).
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const rowClass = (active: boolean): string =>
    `block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-white/5 ${active ? "bg-white/10" : ""}`;

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
      {items.map((o) =>
        o.children ? (
          <div key={o.id}>
            <button
              onClick={() => toggle(o.id)}
              data-testid={`object-tree-${o.id}`}
              className={rowClass(false)}
            >
              {collapsed.has(o.id) ? "▸" : "▾"} {o.name}
            </button>
            {!collapsed.has(o.id) &&
              o.children.map((c) => (
                <button
                  key={c.id}
                  onClick={() => select(c.id, false)}
                  data-testid={`object-tree-${c.id}`}
                  className={`${rowClass(selectedIds.includes(c.id))} ml-4 w-[calc(100%-1rem)]`}
                >
                  {c.name}
                </button>
              ))}
          </div>
        ) : (
          <button
            key={o.id}
            onClick={() => select(o.id, false)}
            data-testid={`object-tree-${o.id}`}
            className={rowClass(selectedIds.includes(o.id))}
          >
            {o.name}
          </button>
        ),
      )}
      <div className="mt-3 px-2 py-1 text-xs uppercase tracking-wide text-white/50">
        History
      </div>
      <div className="px-2 text-xs text-white/60">
        {features.length === 0 ? "—" : features.map((f) => f.type).join(" → ")}
      </div>
    </div>
  );
}
