import { useMemo, useState } from "react";
import { buildTreeItems, useDocumentUiStore, useSelectionStore } from "../stores";
import { useLocale, useT, featureTypeName } from "../i18n";
import { coreClient } from "../ipc/coreClient";
import { syncFromCoreList } from "../model/sync";

/**
 * Object tree (nouns) + body history (Slice 4): one row per Body, with
 * expandable per-feature history (Box → Hole → Fillet). A body with a
 * single root feature renders as one flat row exactly as before (no
 * nesting noise). Row labels are unchanged — only grouping is new.
 */
export function ObjectTree({ onInsertHole }: { onInsertHole?: () => void } = {}) {
  const features = useDocumentUiStore((s) => s.features);
  const bodies = useDocumentUiStore((s) => s.bodies);
  const sketches = useDocumentUiStore((s) => s.sketches);
  const datums = useDocumentUiStore((s) => s.datums);
  // Derive OUTSIDE the subscription: the selector must return a stable
  // reference or getSnapshot never stabilizes (infinite update loop).
  // Locale is a dep so tree labels re-translate on language switch.
  const locale = useLocale();
  const items = useMemo(
    () => buildTreeItems(features, sketches, bodies, datums),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [features, sketches, bodies, datums, locale],
  );
  const select = useSelectionStore((s) => s.select);
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const t = useT();
  // Collapsed parents by body id (default: history visible).
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [visibilityBusy, setVisibilityBusy] = useState<string | null>(null);
  const [visibilityError, setVisibilityError] = useState("");
  const toggleVisibility = async (bodyId: string, visible: boolean): Promise<void> => {
    setVisibilityBusy(bodyId); setVisibilityError("");
    try {
      await coreClient.setBodyVisibility(bodyId, !visible);
      const snapshot = await coreClient.requestSnapshot();
      await syncFromCoreList(snapshot.features, snapshot.revision, snapshot.sketches, null, snapshot.datums);
    } catch (e) { setVisibilityError(e instanceof Error ? e.message : String(e)); }
    finally { setVisibilityBusy(null); }
  };
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
        {t("common.objects")}
      </div>
      {items.length === 0 && (
        <div className="px-2 py-1.5 text-xs text-white/40">
          {t("tree.empty")}
        </div>
      )}
      {visibilityError && <div role="alert" className="text-xs text-red-300">{visibilityError}</div>}
      {items.map((o) =>
        o.children ? (
          <div key={o.id}>
            {bodies.some(b => b.bodyId === o.id) && <button
              aria-label={`Toggle visibility ${o.id}`}
              data-testid={`body-visibility-${o.id}`}
              disabled={visibilityBusy !== null}
              onClick={() => { const body = bodies.find(b => b.bodyId === o.id)!; void toggleVisibility(o.id, body.visible !== false); }}
              className="rounded px-2 text-xs text-white/60 disabled:opacity-40"
            >{bodies.find(b => b.bodyId === o.id)?.visible === false ? "Show" : "Hide"}</button>}
            <button
              onClick={() => toggle(o.id)}
              data-testid={`object-tree-${o.id}`}
              className={rowClass(false)}
            >
              {collapsed.has(o.id) ? "▸" : "▾"} {o.name}
            </button>
            {!collapsed.has(o.id) &&
              o.children.map((c, i) => (
                <div key={c.id} className="flex items-center">
                <button
                  onClick={() => select(c.id, false)}
                  data-testid={`object-tree-${c.id}`}
                  className={`${rowClass(selectedIds.includes(c.id))} ml-4 w-[calc(100%-1rem)]`}
                >
                  {c.name}
                </button>
                {onInsertHole && features.find((f) => f.featureId === c.id)?.type === "Box" &&
                  features.find((f) => f.featureId === o.children?.[i + 1]?.id)?.dependsOn[0] === c.id && (
                  <button
                    data-testid={`insert-hole-after-${c.id}`}
                    aria-label={t("tree.insertHole")}
                    title={t("tree.insertHoleHint")}
                    className="shrink-0 rounded px-2 py-1 text-white/60 hover:bg-white/10"
                    onClick={() => { select(`${c.id}:box.+Z`, false); onInsertHole(); }}
                  >＋</button>
                )}
                </div>
              ))}
          </div>
        ) : (
          <div key={o.id} className="flex items-center">
          {bodies.some(b => b.bodyId === o.id || b.tipFeatureId === o.id) && <button
            aria-label={`Toggle visibility ${o.id}`}
            data-testid={`body-visibility-${o.id}`}
            disabled={visibilityBusy !== null}
            onClick={() => { const body = bodies.find(b => b.bodyId === o.id || b.tipFeatureId === o.id)!; void toggleVisibility(body.bodyId, body.visible !== false); }}
            className="rounded px-2 text-xs text-white/60 disabled:opacity-40"
          >{bodies.find(b => b.bodyId === o.id || b.tipFeatureId === o.id)?.visible === false ? "Show" : "Hide"}</button>}
          <button
            onClick={() => select(o.id, false)}
            data-testid={`object-tree-${o.id}`}
            className={rowClass(selectedIds.includes(o.id))}
          >
            {o.name}
          </button>
          </div>
        ),
      )}
      <div className="mt-3 px-2 py-1 text-xs uppercase tracking-wide text-white/50">
        {t("common.history")}
      </div>
      <div data-testid="object-tree-history" className="px-2 text-xs text-white/60">
        {features.length === 0 ? t("tree.historyEmpty") : [
          ...bodies.flatMap((b) => b.history),
          ...features.filter((f) => !bodies.some((b) => b.history.includes(f.featureId))).map((f) => f.featureId),
        ].map((id) => featureTypeName(features.find((f) => f.featureId === id)!.type)).join(" → ")}
      </div>
    </div>
  );
}
