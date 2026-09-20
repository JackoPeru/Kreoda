import { useEffect, useMemo, useRef, useState } from "react";
import type { SketchModel } from "@intentcad/protocol";
import { coreClient } from "../ipc/coreClient";
import { updateFeatureSummary } from "../model/sync";
import { useDocumentUiStore } from "../stores";

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Default 100×50 rectangle with H/V + 2 dimensions (first-run content). */
export function defaultRectModel(w = 100, h = 50): SketchModel {
  return {
    points: [
      { id: "p0", x: 0, y: 0, fixed: false },
      { id: "p1", x: w, y: 0, fixed: false },
      { id: "p2", x: w, y: h, fixed: false },
      { id: "p3", x: 0, y: h, fixed: false },
    ],
    lines: [
      { id: "l0", p1: "p0", p2: "p1" },
      { id: "l1", p1: "p1", p2: "p2" },
      { id: "l2", p1: "p2", p2: "p3" },
      { id: "l3", p1: "p3", p2: "p0" },
    ],
    circles: [],
    arcs: [],
    constraints: [
      { id: "h0", kind: "horizontal", refs: ["l0"], value: 0 },
      { id: "h2", kind: "horizontal", refs: ["l2"], value: 0 },
      { id: "v1", kind: "vertical", refs: ["l1"], value: 0 },
      { id: "v3", kind: "vertical", refs: ["l3"], value: 0 },
      { id: "dim-w", kind: "distance", refs: ["p0", "p1"], value: w },
      { id: "dim-h", kind: "distance", refs: ["p1", "p2"], value: h },
    ],
  };
}

const VIEW = 220; // svg units; fit ~200mm with margin

/** 2D sketch editor (§21): SVG overlay, drag-to-solve, inference badges. */
export function SketchEditor({
  sketchId,
  onClose,
}: {
  sketchId: string;
  onClose: () => void;
}) {
  const sketch = useDocumentUiStore((s) =>
    s.sketches.find((k) => k.featureId === sketchId),
  );
  const [model, setModel] = useState<SketchModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("loading…");
  const [dragging, setDragging] = useState<string | null>(null);
  const dragRef = useRef<{ id: string; moved: boolean } | null>(null);
  // Latest model mirror (incl. in-flight previews): commits read from here,
  // never from a stale render closure (§15 — no pointer-frequency React).
  const modelRef = useRef<SketchModel | null>(null);
  const previewSeq = useRef(0);
  // Pre-drag snapshot for Escape-cancel (restores without committing).
  const dragBaseRef = useRef<SketchModel | null>(null);
  const [inference, setInference] = useState<string | null>(null);

  // Escape cancels an ACTIVE drag (restores pre-drag state, no commit).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && dragRef.current && dragBaseRef.current) {
        dragRef.current = null;
        previewSeq.current++;
        setDragging(null);
        setInference(null);
        setModel(dragBaseRef.current);
        modelRef.current = dragBaseRef.current;
        dragBaseRef.current = null;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Load full model on open.
  useEffect(() => {
    let cancelled = false;
    setModel(null);
    setError(null);
    coreClient
      .requestSketch(sketchId)
      .then((full) => {
        if (cancelled) return;
        if (full.points.length === 0) {
          // First-run content: dimensioned rectangle, committed once.
          const rect = defaultRectModel();
          void coreClient
            .updateSketch({ featureId: sketchId, model: rect })
            .then(
              () => {
                if (!cancelled) {
                  setModel(rect);
                  modelRef.current = rect;
                  setStatus("solved · 0 dof");
                  refreshSummary(sketchId);
                }
              },
              (e: unknown) => {
                if (!cancelled) {
                  setModel(rect);
                  modelRef.current = rect;
                  setError(e instanceof Error ? e.message : "solve failed");
                }
              },
            );
        } else {
          const loaded: SketchModel = {
            points: full.points,
            lines: full.lines,
            circles: full.circles,
            arcs: full.arcs ?? [],
            constraints: full.constraints,
          };
          setModel(loaded);
          modelRef.current = loaded;
          setStatus("solved");
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "load failed");
      });
    return () => {
      cancelled = true;
    };
  }, [sketchId]);

  const bounds = useMemo(() => {
    if (!model || model.points.length === 0)
      return { minX: -10, minY: -10, w: 120, h: 80 };
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const p of model.points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    const pad = 15;
    return {
      minX: minX - pad,
      minY: minY - pad,
      w: Math.max(10, maxX - minX + pad * 2),
      h: Math.max(10, maxY - minY + pad * 2),
    };
  }, [model]);

  const toClient = (x: number, y: number): [number, number] => {
    const sx = ((x - bounds.minX) / bounds.w) * VIEW;
    const sy = VIEW - ((y - bounds.minY) / bounds.h) * VIEW;
    return [sx, sy];
  };
  const fromClient = (sx: number, sy: number): [number, number] => {
    const x = bounds.minX + (sx / VIEW) * bounds.w;
    const y = bounds.minY + ((VIEW - sy) / VIEW) * bounds.h;
    return [x, y];
  };
  const pointById = (id: string) => model?.points.find((p) => p.id === id);
  const commitModel = async (next: SketchModel): Promise<boolean> => {
    setError(null);
    try {
      const r = await coreClient.updateSketch({
        featureId: sketchId,
        model: next,
      });
      // Display the SOLVED coordinates from the server, not the unsolved
      // local draft — otherwise points visibly ignore the new dimension.
      const solved: SketchModel = r.solved
        ? {
            points: r.solved.points,
            lines: r.solved.lines,
            circles: r.solved.circles,
            arcs: r.solved.arcs ?? [],
            constraints: next.constraints,
          }
        : next;
      setModel(solved);
      modelRef.current = solved;
      setStatus(
        `solved · residual ${(r.residual ?? 0).toExponential(1)} · dof ${r.dofs ?? "?"}`,
      );
      if (r.conflicting?.length) {
        setError(`conflict: ${r.conflicting.join(", ")}`);
        return false;
      }
      await refreshSummary(sketchId);
      // Downstream solids depend on this sketch (§53): re-pull their meshes
      // so the viewport shows the recomputed geometry, not stale buffers.
      const dependents = useDocumentUiStore
        .getState()
        .features.filter((f) => f.dependsOn?.includes(sketchId));
      for (const d of dependents) {
        const mesh = await coreClient.requestMesh(d.featureId, 1);
        const s = useDocumentUiStore.getState();
        s.upsertMesh(d.featureId, mesh, r.revision ?? s.revision);
        updateFeatureSummary(
          d.featureId,
          { volumeMm3: mesh.volumeMm3 },
          r.revision ?? s.revision,
        );
      }
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "commit failed");
      // Roll back the optimistic preview: re-fetch stored state (§13).
      try {
        const full = await coreClient.requestSketch(sketchId);
        const restored: SketchModel = {
          points: full.points,
          lines: full.lines,
          circles: full.circles,
          arcs: full.arcs ?? [],
          constraints: full.constraints,
        };
        setModel(restored);
        modelRef.current = restored;
      } catch {
        // Restoration is best-effort; the error banner stays.
      }
      return false;
    }
  };

  const onPointDown = (id: string) => (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    // Snapshot for Escape-cancel (pre-drag model).
    dragBaseRef.current = modelRef.current;
    dragRef.current = { id, moved: false };
    setDragging(id);
  };

  const onPointMove = (id: string) => async (e: React.PointerEvent) => {
    const drag = dragRef.current;
    const base = modelRef.current;
    if (!drag || drag.id !== id || !base) return;
    const svg = (e.currentTarget as unknown as SVGElement).ownerSVGElement as
      | SVGSVGElement
      | null;
    const rect = svg?.getBoundingClientRect();
    if (!rect) return;
    const sx = ((e.clientX - rect.left) / rect.width) * VIEW;
    const sy = ((e.clientY - rect.top) / rect.height) * VIEW;
    const [x, y] = fromClient(sx, sy);
    drag.moved = true;
    // Deterministic inference badges (§21.6): near-horizontal/vertical drag
    // shows intent; commit happens on release (§13 preview, no Undo spam).
    const start = base.points.find((p) => p.id === id);
    if (start) {
      const dx = Math.abs(x - start.x);
      const dy = Math.abs(y - start.y);
      setInference(
        dx < 3 && dy < 3
          ? null
          : dx < 2
            ? "│ near vertical"
            : dy < 2
              ? "─ near horizontal"
              : null,
      );
    }
    try {
      // Monotonic seq: only the latest preview may paint (no stale wins).
      const seq = ++previewSeq.current;
      const r = await coreClient.updateSketch({
        featureId: sketchId,
        model: base,
        isPreview: true,
        dragPointId: id,
        dragX: x,
        dragY: y,
      });
      if (seq !== previewSeq.current) return; // superseded
      if (r.solved) {
        setModel((prev) => {
          if (!prev) return prev;
          const next: SketchModel = {
            ...prev,
            points: prev.points.map((p) => {
              const s = (
                r.solved!.points as { id: string; x: number; y: number }[]
              ).find((q) => q.id === p.id);
              return s ? { ...p, x: s.x, y: s.y } : p;
            }),
          };
          modelRef.current = next;
          return next;
        });
      }
    } catch {
      // Preview failures are silent during drag; release reports honestly.
    }
  };

  const onPointUp = (id: string) => async (e: React.PointerEvent) => {
    void id;
    void e;
    const drag = dragRef.current;
    dragRef.current = null;
    dragBaseRef.current = null;
    setDragging(null);
    setInference(null);
    previewSeq.current++; // invalidate in-flight previews
    const live = modelRef.current;
    if (!drag?.moved || !live) return;
    // Commit the LIVE preview state (not a stale render closure).
    await commitModel(live);
  };

  if (!sketch) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="h-[80vh] w-[720px] rounded-lg border border-white/15 bg-[#10141b] p-4">
        <div className="flex items-center gap-2 pb-2">
          <span className="text-sm font-semibold">
            Sketch · {sketch.planeKind} plane
          </span>
          <span className="font-mono text-[11px] text-white/40">
            {sketchId.slice(0, 13)}…
          </span>
          <div className="flex-1" />
          <span className="text-[11px] text-white/50">{status}</span>
          <button
            onClick={onClose}
            className="rounded-md px-2.5 py-1 text-sm text-white/70 hover:bg-white/10"
          >
            Done
          </button>
        </div>
        {error && (
          <div className="mb-2 rounded-md bg-red-950 px-2.5 py-1.5 text-xs text-red-200">
            {error}
          </div>
        )}
        <div className="flex gap-3">
          <svg
            viewBox={`0 0 ${VIEW} ${VIEW}`}
            className="h-[60vh] w-[60vh] shrink-0 rounded-md bg-[#0b0e13] touch-none select-none"
            data-testid="sketch-canvas"
          >
            {model?.lines.map((l) => {
              const a = pointById(l.p1);
              const b = pointById(l.p2);
              if (!a || !b) return null;
              const [x1, y1] = toClient(a.x, a.y);
              const [x2, y2] = toClient(b.x, b.y);
              const horiz = model.constraints.some(
                (c) => c.kind === "horizontal" && c.refs.includes(l.id),
              );
              return (
                <g key={l.id}>
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke="#9cc2ff"
                    strokeWidth={2}
                  />
                  {horiz && (
                    <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 6} fill="#7ee2a8" fontSize={11} textAnchor="middle">
                      H
                    </text>
                  )}
                </g>
              );
            })}
            {model?.circles.map((c) => {
              const o = pointById(c.center);
              if (!o) return null;
              const [cx, cy] = toClient(o.x, o.y);
              const scale = VIEW / Math.max(bounds.w, bounds.h);
              return (
                <circle
                  key={c.id}
                  cx={cx}
                  cy={cy}
                  r={c.r * scale}
                  fill="none"
                  stroke="#9cc2ff"
                  strokeWidth={2}
                />
              );
            })}
            {(
              (model?.arcs ?? []) as {
                id: string;
                center: string;
                r: number;
                startAngleRad: number;
                endAngleRad: number;
              }[]
            ).map((a) => {
              const o = pointById(a.center);
              if (!o) return null;
              const [cx, cy] = toClient(o.x, o.y);
              const scale = VIEW / Math.max(bounds.w, bounds.h);
              const r = a.r * scale;
              const sx = cx + r * Math.cos(a.startAngleRad);
              const sy = cy - r * Math.sin(a.startAngleRad);
              const ex = cx + r * Math.cos(a.endAngleRad);
              const ey = cy - r * Math.sin(a.endAngleRad);
              let sweep = a.endAngleRad - a.startAngleRad;
              while (sweep < 0) sweep += Math.PI * 2;
              const large = sweep > Math.PI ? 1 : 0;
              return (
                <path
                  key={a.id}
                  d={`M ${sx} ${sy} A ${r} ${r} 0 ${large} 0 ${ex} ${ey}`}
                  fill="none"
                  stroke="#9cc2ff"
                  strokeWidth={2}
                />
              );
            })}
            {model?.points.map((p) => {
              const [cx, cy] = toClient(p.x, p.y);
              const active = dragging === p.id;
              // Keep labels inside the canvas: flip anchor near edges.
              const anchor = cx > VIEW - 60 ? "end" : "start";
              const lx = cx > VIEW - 60 ? cx - 8 : cx + 8;
              return (
                <g key={p.id}>
                  <circle
                    cx={cx}
                    cy={cy}
                    r={active ? 7 : 5}
                    fill={active ? "#ffb020" : "#4f8cff"}
                    stroke="#0b0e13"
                    strokeWidth={1.5}
                    style={{ cursor: "grab" }}
                    onPointerDown={onPointDown(p.id)}
                    onPointerMove={onPointMove(p.id)}
                    onPointerUp={onPointUp(p.id)}
                    data-testid={`sk-point-${p.id}`}
                  />
                  <text x={lx} y={cy - 6} fill="rgba(255,255,255,.55)" fontSize={10} textAnchor={anchor}>
                    {p.x.toFixed(1)},{p.y.toFixed(1)}
                  </text>
                </g>
              );
            })}
          </svg>
          <div className="min-w-0 flex-1 text-xs text-white/70">
            <div className="pb-1 text-[11px] uppercase tracking-wide text-white/45">
              Dimensions
            </div>
            {model?.constraints
              .filter(
                (c) =>
                  c.kind === "distance" ||
                  c.kind === "radius" ||
                  c.kind === "diameter",
              )
              .map((c) => (
                <DimensionRow
                  key={c.id}
                  id={c.id}
                  label={
                    c.kind === "distance"
                      ? `dist ${c.refs.join("–")}`
                      : `${c.kind} ${c.refs.join(",")}`
                  }
                  value={c.value}
                  onCommit={async (v) => {
                    if (!model) return;
                    const next: SketchModel = {
                      ...model,
                      constraints: model.constraints.map((k) =>
                        k.id === c.id ? { ...k, value: v } : k,
                      ),
                    };
                    await commitModel(next);
                  }}
                />
              ))}
            <div className="pt-3 text-[11px] uppercase tracking-wide text-white/45">
              Constraints ({model?.constraints.length ?? 0})
            </div>
            <div className="max-h-48 overflow-auto font-mono text-[11px] text-white/55">
              {(model?.constraints ?? []).map((c) => (
                <div key={c.id}>
                  {c.kind} {c.refs.join(",")}
                  {c.kind === "distance" || c.kind === "radius" ? ` = ${c.value}` : ""}
                </div>
              ))}
            </div>
            {inference && (
              <div className="pt-2 text-amber-200">inference: {inference}</div>
            )}
            <div className="pt-2 text-white/45">
              Drag a point to solve live. Release commits one Undo step.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DimensionRow({
  id,
  label,
  value,
  onCommit,
}: {
  id: string;
  label: string;
  value: number;
  onCommit: (v: number) => Promise<void>;
}) {
  return (
    <label className="mb-1.5 block" key={id}>
      <span className="text-white/60">{label}</span>
      <input
        key={`${id}:${value}`}
        defaultValue={String(value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const v = Number((e.target as HTMLInputElement).value);
            if (Number.isFinite(v)) void onCommit(v);
          }
        }}
        className="mt-0.5 w-full rounded-md bg-white/5 px-2 py-1 font-mono text-white outline-none focus:bg-white/10"
      />
    </label>
  );
}

async function refreshSummary(sketchId: string): Promise<void> {
  try {
    const full = await coreClient.requestSketch(sketchId);
    useDocumentUiStore.getState().upsertSketch({
      featureId: sketchId,
      planeKind: full.planeKind,
      points: full.points.length,
      lines: full.lines.length,
      circles: full.circles.length,
      constraints: full.constraints.length,
      model: full,
    });
  } catch {
    // Summary refresh is best-effort; the editor already shows solved state.
  }
}
