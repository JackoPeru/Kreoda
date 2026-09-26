import { useEffect, useRef, useState } from "react";
import { commandAvailability, executeCommand } from "../commands/execute";
import {
  connectedEdgeIds,
  similarFaceIds,
} from "../interaction/selectSimilar";
import { selectionAnchorPoint } from "../interaction/selectionAnchor";
import {
  isSketchId,
  selectionKindOf,
  useDocumentUiStore,
  useSelectionStore,
  useToolStore,
} from "../stores";
import { DismissBackdrop } from "./workspace/DismissBackdrop";
import { useT } from "../i18n";

/**
 * Context-sensitive tools (§18, §69): exposes ONLY actions valid for the
 * current selection, floating near the selection anchor (UX-2). Position
 * is set imperatively every frame from selectionAnchorPoint() — no React
 * state at pointer frequency (§15). Availability itself comes from the
 * command registry (same definitions gating toolbar, palette and AI tools).
 */
export function ContextToolbar({
  onHole,
  onDressUp,
  onSketch,
  onExtrude,
  onEditSketch,
  onInstance,
  onOpenProps,
}: {
  onHole: () => void;
  onDressUp: (kind: "fillet" | "chamfer") => void;
  onSketch: () => void;
  onExtrude: () => void;
  onEditSketch: (id: string) => void;
  onInstance: () => void;
  onOpenProps: () => void;
}) {
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const activeTool = useToolStore((s) => s.activeTool);
  const setTool = useToolStore((s) => s.setTool);
  const [moreOpen, setMoreOpen] = useState(false);
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  // Re-render trigger for registry reads touching the sketch store (M12):
  // availability is computed live at render/click from getState().
  useDocumentUiStore((s) => s.sketches.length);
  useDocumentUiStore((s) => s.features.length);

  // Imperative anchor tracking: selection/mesh reads only, no re-renders.
  // Writes are skipped when the anchor hasn't moved (no per-frame layout).
  // Y is clamped so the toolbar never leaves the viewport top edge.
  useEffect(() => {
    let raf = 0;
    let lastX = NaN;
    let lastY = NaN;
    const tick = (): void => {
      raf = requestAnimationFrame(tick);
      const el = rootRef.current;
      if (!el) return;
      const anchor = selectionAnchorPoint();
      const x = anchor ? anchor.x : -1;
      const y = anchor ? Math.max(anchor.y, 64) : -1;
      if (x === lastX && y === lastY) return;
      lastX = x;
      lastY = y;
      if (anchor) {
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        el.style.transform = "translate(-50%,-135%)";
      } else {
        // Sketches and off-screen anchors: default docked spot.
        el.style.left = "50%";
        el.style.top = "68px";
        el.style.transform = "translateX(-50%)";
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const kinds = new Set(selectedIds.map(selectionKindOf));
  const candidates: { id: string; label: string; hint: string }[] = [];
  if (kinds.has("face")) {
    candidates.push(
      { id: "PullFace", label: t("ctx.pullFace"), hint: t("ctx.pullFaceHint") },
      { id: "CreateHole", label: t("ctx.hole"), hint: t("ctx.holeHint") },
      { id: "CreateSketch", label: t("ctx.sketchHere"), hint: t("ctx.sketchHereHint") },
    );
  }
  if (kinds.has("edge")) {
    candidates.push(
      { id: "CreateFillet", label: t("ctx.round"), hint: t("ctx.roundHint") },
      { id: "CreateChamfer", label: t("ctx.corner"), hint: t("ctx.cornerHint") },
    );
  }
  const bareIds = selectedIds.filter((id) => id.indexOf(":") < 0);
  const sketchId = bareIds.find((id) => isSketchId(id));
  if (sketchId !== undefined) {
    // Sketch nouns: extrude only when the registry agrees; editing the 2D
    // model through the real solver path is always valid.
    if (commandAvailability("CreateExtrude").available) {
      candidates.push({
        id: "CreateExtrude",
        label: t("ctx.pullSketch"),
        hint: t("ctx.pullSketchHint"),
      });
    }
    candidates.push({
      id: "EditSketch",
      label: t("ctx.editSketch"),
      hint: t("ctx.editSketchHint"),
    });
  }
  // Single solid body: the only supported transform is a placed copy.
  // No generic Move/Rotate/Scale is exposed (no such commands exist).
  if (
    bareIds.length > 0 &&
    sketchId === undefined &&
    commandAvailability("CreateInstance").available
  ) {
    candidates.push({
      id: "CopyPlaced",
      label: t("ctx.copyPlaced"),
      hint: t("ctx.copyPlacedHint"),
    });
  }
  // Bulk selection helpers (§16): similar faces / connected edges.
  if (kinds.has("face") && selectedIds.length === 1) {
    candidates.push({
      id: "SelectSimilar",
      label: t("ctx.similar"),
      hint: t("ctx.similarHint"),
    });
  }
  if (kinds.has("edge") && selectedIds.length === 1) {
    candidates.push({
      id: "SelectConnected",
      label: t("ctx.connected"),
      hint: t("ctx.connectedHint"),
    });
  }
  // Two selected solids: fuse / cut / common through the real boolean op.
  const booleanAvail = commandAvailability("CreateBoolean");
  if (booleanAvail.available) {
    candidates.push(
      { id: "BooleanFuse", label: t("ctx.combine"), hint: t("ctx.combineHint") },
      { id: "BooleanCut", label: t("ctx.subtract"), hint: t("ctx.subtractHint") },
      { id: "BooleanCommon", label: t("ctx.overlap"), hint: t("ctx.overlapHint") },
    );
  }
  if (candidates.length === 0) return null;

  const selectLiveIds = (ids: string[]): void => {
    // Drop ids whose body vanished (e.g. post-undo stale mesh).
    const meshes = useDocumentUiStore.getState().meshes;
    const live = ids.filter((id) => {
      const cut = id.indexOf(":");
      return cut >= 0 && cut < id.length - 1 && id.slice(0, cut) in meshes;
    });
    const sel = useSelectionStore.getState();
    sel.clear();
    for (const fid of live.length > 0 ? live : ids.slice(0, 1)) {
      sel.select(fid, true);
    }
  };

  const runBoolean = (
    op: "fuse" | "cut" | "common",
  ): void => {
    const bodies = selectedIds.filter(
      (sid) => !sid.includes(":") && !isSketchId(sid),
    );
    if (bodies.length >= 2) {
      void executeCommand("CreateBoolean", {
        op,
        targetId: bodies[0],
        toolId: bodies[1],
      });
    }
  };

  const run = (id: string): void => {
    if (id === "PullFace") setTool(activeTool === "pull" ? "select" : "pull");
    else if (id === "CreateHole") onHole();
    else if (id === "CreateFillet") onDressUp("fillet");
    else if (id === "CreateChamfer") onDressUp("chamfer");
    else if (id === "CreateSketch") onSketch();
    else if (id === "CreateExtrude") onExtrude();
    else if (id === "EditSketch" && sketchId !== undefined) onEditSketch(sketchId);
    else if (id === "CopyPlaced") onInstance();
    else if (id === "SelectSimilar") {
      const faceId = selectedIds[0]!;
      const meshes = useDocumentUiStore.getState().meshes;
      selectLiveIds(similarFaceIds(meshes, faceId));
    } else if (id === "SelectConnected") {
      const edgeId = selectedIds[0]!;
      const meshes = useDocumentUiStore.getState().meshes;
      selectLiveIds(connectedEdgeIds(meshes, edgeId));
    } else if (id === "BooleanFuse") runBoolean("fuse");
    else if (id === "BooleanCut") runBoolean("cut");
    else if (id === "BooleanCommon") runBoolean("common");
  };

  const isAvailable = (id: string): boolean => {
    if (
      id === "PullFace" ||
      id === "EditSketch" ||
      id === "CopyPlaced" ||
      id === "SelectSimilar" ||
      id === "SelectConnected" ||
      id === "BooleanFuse" ||
      id === "BooleanCut" ||
      id === "BooleanCommon"
    ) {
      return true;
    }
    return commandAvailability(id).available;
  };

  return (
    <>
      {moreOpen && (
        <DismissBackdrop onClose={() => setMoreOpen(false)} label={t("ctx.closeMore")} />
      )}
      <div
        ref={rootRef}
        className="pointer-events-auto absolute z-40 flex items-center gap-1 rounded-lg border border-white/10 bg-black/70 px-2 py-1 backdrop-blur-[var(--kreoda-surface-blur)]"
        style={{ left: "50%", top: "68px", transform: "translateX(-50%)" }}
        data-testid="context-toolbar"
        onKeyDown={(e) => {
          if (e.key === "Escape") setMoreOpen(false);
        }}
      >
        {candidates.map((c) => (
          <button
            key={c.id}
            onClick={() => run(c.id)}
            disabled={!isAvailable(c.id)}
            title={c.hint}
            className={`rounded-md px-2.5 py-1.5 text-xs hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40 ${c.id === "PullFace" && activeTool === "pull" ? "bg-white/15 text-white" : "text-white/85"}`}
          >
            {c.label}
          </button>
        ))}
        <div className="relative">
          <button
            onClick={() => setMoreOpen((o) => !o)}
            aria-label={t("ctx.moreActions")}
            aria-expanded={moreOpen}
            title={t("ctx.moreActionsHint")}
            className="rounded-md px-2 py-1.5 text-xs text-white/70 hover:bg-white/10 hover:text-white"
          >
            ⋯
          </button>
          {moreOpen && (
            <div role="menu" className="kreoda-float-elevated absolute right-0 top-full z-50 mt-2 w-44 p-1.5">
              <button
                onClick={() => {
                  setMoreOpen(false);
                  onOpenProps();
                }}
                className="flex w-full items-center rounded-[var(--kreoda-radius-sm)] px-2.5 py-1.5 text-left text-sm text-white/85 hover:bg-white/10"
              >
                {t("common.properties")}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
