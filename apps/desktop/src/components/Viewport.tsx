import { useEffect, useRef, useState } from "react";
import { CadViewport } from "../viewport/CadViewport";
import { useDocumentUiStore, useSelectionStore, useToolStore } from "../stores";
import { clampDimension, resolvePullTarget } from "../interaction/pull";
import { coreClient } from "../ipc/coreClient";
import { executeCommand } from "../commands/execute";
import { setViewportHandle } from "../viewport/viewportHandle";
import { markPullLearned } from "./Onboarding";
import { useReferenceStore } from "../reference/store";

interface PullSession {
  featureId: string;
  faceId: string;
  paramName: string;
  startValueMm: number;
  axisX: number;
  axisY: number;
  startClientX: number;
  startClientY: number;
  mmPerPx: number;
  lastSentValue: number;
  lastSentAt: number;
  moved: boolean;
}

/** Imperative viewport host — keeps pointer events out of React (§15). */
export function Viewport() {
  const ref = useRef<HTMLDivElement>(null);
  const vpRef = useRef<CadViewport | null>(null);
  const sessionRef = useRef<PullSession | null>(null);
  const hover = useSelectionStore((s) => s.hover);
  const select = useSelectionStore((s) => s.select);
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const mode = useSelectionStore((s) => s.mode);
  const activeTool = useToolStore((s) => s.activeTool);
  const meshes = useDocumentUiStore((s) => s.meshes);
  const meshRevision = useDocumentUiStore((s) => s.meshRevision);
  const refPlanes = useReferenceStore((s) => s.planes);
  const [pullHint, setPullHint] = useState<string | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const vp = new CadViewport(ref.current, {
      onHover: (id) => {
        if (sessionRef.current) return;
        hover(id);
        vp.setHover(id);
      },
      onSelect: (id, additive) => {
        if (sessionRef.current) return;
        select(id, additive);
      },
    });
    vpRef.current = vp;
    setViewportHandle({
      faceScreenPoint: (featureId, role) =>
        vpRef.current?.faceScreenPoint(featureId, role) ?? null,
      setView: (name) => vpRef.current?.setView(name),
      projectPoint: (p) => vpRef.current?.projectPoint(p) ?? null,
      viewDir: () => vpRef.current?.viewDir() ?? null,
      beginReferenceMeasure: (id) =>
        vpRef.current?.beginReferenceMeasure(id) ?? Promise.resolve(null),
      cancelReferenceMeasure: () => vpRef.current?.cancelReferenceMeasure(),
    });
    return () => {
      try {
        vpRef.current?.cancelReferenceMeasure();
      } catch {
        // Best-effort: unmount must never throw.
      }
      setViewportHandle(null);
      vp.dispose();
      vpRef.current = null;
    };
  }, [hover, select]);

  // Canonical → scene sync (§66): only on committed mesh updates, never on
  // pointer frequency. Slice 4: the meshes map holds VISIBLE tips only
  // (one entry per physical object) — syncMeshes reconciles the rest away.
  useEffect(() => {
    vpRef.current?.syncMeshes(meshes);
  }, [meshes, meshRevision]);

  // Reference planes (§29 Stage A): view aids, reconciled like meshes.
  useEffect(() => {
    vpRef.current?.syncReferencePlanes(refPlanes);
  }, [refPlanes]);

  useEffect(() => {
    vpRef.current?.setSelected(selectedIds);
  }, [selectedIds]);

  useEffect(() => {
    // auto = contextual face picking (§16); body/edge/face force the filter.
    vpRef.current?.setPickMode(
      mode === "body" || mode === "edge" || mode === "face" ? mode : "auto",
    );
  }, [mode]);

  // Direct manipulation loop (§17): drag face → source parameter.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const endSession = (cancelled: boolean): void => {
      const vp = vpRef.current;
      const s = sessionRef.current;
      sessionRef.current = null;
      if (vp) {
        vp.setCameraInputEnabled(true);
        vp.showPreviewMesh(null);
      }
      if (cancelled) setPullHint(null);
    };

    const onPointerDown = (e: PointerEvent): void => {
      const vp = vpRef.current;
      if (!vp || activeTool !== "pull" || e.button !== 0) return;
      const hit = vp.pickFaceAt(e.clientX, e.clientY);
      if (!hit) {
        setPullHint("Pull: click a free face (+X, +Y, +Z, cap, wall)");
        return;
      }
      const feature = useDocumentUiStore
        .getState()
        .features.find((f) => f.featureId === hit.featureId);
      if (!feature) return;
      const resolved = resolvePullTarget(feature, hit.faceId);
      if (!resolved.ok) {
        setPullHint(`Pull: ${resolved.reason}`);
        return;
      }
      // Screen-space drag axis: project grab point and point+normal.
      const a = vp.worldToClient(hit.point);
      const tip = vp.worldToClient(
        hit.point.clone().add(hit.normal),
      );
      const dx = tip.x - a.x;
      const dy = tip.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) return;
      sessionRef.current = {
        featureId: hit.featureId,
        faceId: hit.faceId,
        paramName: resolved.target.paramName,
        startValueMm: resolved.target.startValueMm,
        axisX: dx / len,
        axisY: dy / len,
        startClientX: e.clientX,
        startClientY: e.clientY,
        mmPerPx: vp.mmPerPixel(),
        lastSentValue: resolved.target.startValueMm,
        lastSentAt: 0,
        moved: false,
      };
      vp.setCameraInputEnabled(false);
      el.setPointerCapture(e.pointerId);
      setPullHint(
        `Dragging ${resolved.target.paramName}: ${resolved.target.startValueMm.toFixed(1)} mm — release to commit, Esc cancels`,
      );
    };

    const onPointerMove = (e: PointerEvent): void => {
      const vp = vpRef.current;
      const s = sessionRef.current;
      if (!vp || !s) return;
      const dxPx = e.clientX - s.startClientX;
      const dyPx = e.clientY - s.startClientY;
      if (Math.hypot(dxPx, dyPx) > 3) s.moved = true;
      if (!s.moved) return;
      const alongPx = dxPx * s.axisX + dyPx * s.axisY;
      const value = clampDimension(s.startValueMm + alongPx * s.mmPerPx);
      setPullHint(
        `Dragging ${s.paramName}: ${value.toFixed(1)} mm — release to commit, Esc cancels`,
      );
      // Throttled transient preview (§13): no commit, no revision.
      const now = performance.now();
      if (Math.abs(value - s.lastSentValue) < 0.5 || now - s.lastSentAt < 40) {
        return;
      }
      s.lastSentValue = value;
      s.lastSentAt = now;
      void coreClient
        .setFeatureParameter(s.featureId, s.paramName, value, true)
        .then(
          (mesh) => {
            if ("positions" in mesh) vp.showPreviewMesh(mesh);
          },
          (err: unknown) => {
            // M13: throttled previews swallow transient PREVIEW_FAILED (e.g.
            // hole target vanished) — debug-log so the commit path still
            // surfaces it honestly via executeCommand.
            console.debug("[preview] failed:", err instanceof Error ? err.message : err);
          },
        );
    };

    const onPointerUp = (e: PointerEvent): void => {
      const s = sessionRef.current;
      if (!s) return;
      const wasDrag = s.moved;
      const dxPx = e.clientX - s.startClientX;
      const dyPx = e.clientY - s.startClientY;
      const alongPx = dxPx * s.axisX + dyPx * s.axisY;
      const value = clampDimension(s.startValueMm + alongPx * s.mmPerPx);
      endSession(false);
      if (!wasDrag) {
        // Treated as a plain face select (pull mode stays non-destructive).
        select(s.faceId, false);
        return;
      }
      setPullHint(`Committing ${s.paramName} = ${value.toFixed(1)} mm…`);
      void executeCommand("SetDimension", {
        featureId: s.featureId,
        paramName: s.paramName,
        valueMm: value,
      }).then(
        () => {
          markPullLearned();
          setPullHint(null);
        },
        (err: unknown) =>
          setPullHint(err instanceof Error ? err.message : "commit failed"),
      );
    };

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && sessionRef.current) {
        endSession(true);
      }
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [activeTool, select]);

  return (
    <div ref={ref} className="h-full w-full" data-testid="viewport">
      {pullHint && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-md bg-black/70 px-3 py-1.5 text-xs text-amber-100">
          {pullHint}
        </div>
      )}
    </div>
  );
}
