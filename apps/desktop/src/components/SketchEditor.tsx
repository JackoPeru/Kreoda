import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { SketchModelSchema, type SketchModel, type SketchProjectionResult, type SketchCurveDisplay } from "@kreoda/protocol";
import { coreClient, type SketchCommandContext } from "../ipc/coreClient";
import { refreshSketchProjection, updateFeatureSummary } from "../model/sync";
import { useDocumentUiStore, usePreferencesStore, visibleFeatureIds } from "../stores";
import { t, useT, sketchKindName } from "../i18n";
import { worldPointToSketchLocal } from "../viewport/ProjectionViewport";
import { SketchProjectionPanel } from "./workspace/SketchProjectionPanel";
import { sameSketchCoordinateMm, type TrimExtendCandidate } from "../model/advanced-sketch";
import { addSymmetricConstraint } from "../model/sketch-symmetry";
import { SketchCurveTools, type SketchCurveTool } from "./SketchCurveTools";
import { SketchLineTools } from "./SketchLineTools";

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Default 100×50 rectangle for the explicit Rectangle tool. */
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
    ellipses: [], splines: [], constructionIds: [],
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
const SKETCH_QUOTE_MIN_WIDTH = 200;
const SKETCH_QUOTE_MAX_WIDTH = 240;
const SKETCH_WORKSPACE_GAP = 12;
const SKETCH_CANVAS_MIN_WIDTH = 320;

function projectionLocalPoints(projection: SketchProjectionResult | undefined): [number, number][] {
  if (!projection?.geometryCurrent || projection.status !== "ok") return [];
  return projection.groups.flatMap(group => group.status === "ok"
    ? group.edges.flatMap(edge => edge.pointsMm.map(point => worldPointToSketchLocal(point, projection.plane)))
    : []);
}

function sketchFitPoints(model: SketchModel, projection: SketchProjectionResult | undefined,
  curveDisplay: SketchCurveDisplay | null): [number, number][] {
  const points: [number, number][] = model.points.map(point => [point.x, point.y]);
  const byId = new Map(model.points.map(point => [point.id, point]));
  for (const circle of model.circles) {
    const center = byId.get(circle.center);
    if (center) points.push([center.x - circle.r, center.y - circle.r], [center.x + circle.r, center.y + circle.r]);
  }
  for (const arc of model.arcs) {
    const center = byId.get(arc.center);
    if (center) points.push([center.x - arc.r, center.y - arc.r], [center.x + arc.r, center.y + arc.r]);
  }
  points.push(...projectionLocalPoints(projection));
  if (curveDisplay && !curveDisplay.errors.some(error => !error.entityId)) {
    for (const curve of curveDisplay.curves) {
      if (!curveDisplay.errors.some(error => error.entityId === curve.entityId)) {
        points.push(...curve.pointsMm.filter(point => point.every(Number.isFinite)));
      }
    }
  }
  return points;
}

type CurveDraftPoint = { id: string; x: number; y: number };
type CurveDraft = { tool: SketchCurveTool; entityId: string; points: CurveDraftPoint[] };

function fullSketchModel(full: SketchModel): SketchModel {
  return {
    points: full.points,
    lines: full.lines,
    circles: full.circles,
    arcs: full.arcs ?? [],
    ellipses: full.ellipses ?? [],
    splines: full.splines ?? [],
    constructionIds: full.constructionIds ?? [],
    constraints: full.constraints,
  };
}

function solvedSketchModel(solved: SketchModel | undefined, candidate: SketchModel): SketchModel {
  return solved ? {
    points: solved.points,
    lines: solved.lines,
    circles: solved.circles,
    arcs: solved.arcs ?? [],
    ellipses: solved.ellipses ?? candidate.ellipses ?? [],
    splines: solved.splines ?? candidate.splines ?? [],
    constructionIds: solved.constructionIds ?? candidate.constructionIds ?? [],
    constraints: solved.constraints ?? candidate.constraints,
  } : candidate;
}

function changedCurveIds(before: SketchModel, after: SketchModel): Set<string> {
  const prior = new Map([...(before.ellipses ?? []), ...(before.splines ?? [])].map(curve => [curve.id, JSON.stringify(curve)]));
  const next = [...(after.ellipses ?? []), ...(after.splines ?? [])];
  const changed = new Set(next.filter(curve => prior.get(curve.id) !== JSON.stringify(curve)).map(curve => curve.id));
  const beforePoints = new Map(before.points.map(point => [point.id, point]));
  const afterPoints = new Map(after.points.map(point => [point.id, point]));
  for (const ellipse of after.ellipses ?? []) {
    const oldCenter = beforePoints.get(ellipse.center);
    const center = afterPoints.get(ellipse.center);
    if (oldCenter && center && (oldCenter.x !== center.x || oldCenter.y !== center.y)) changed.add(ellipse.id);
  }
  for (const spline of after.splines ?? []) {
    if (spline.pointIds.some(id => {
      const oldPoint = beforePoints.get(id);
      const point = afterPoints.get(id);
      return oldPoint && point && (oldPoint.x !== point.x || oldPoint.y !== point.y);
    })) changed.add(spline.id);
  }
  const beforeConstruction = new Set(before.constructionIds ?? []);
  const afterConstruction = new Set(after.constructionIds ?? []);
  for (const curve of next) {
    if (beforeConstruction.has(curve.id) !== afterConstruction.has(curve.id)) changed.add(curve.id);
  }
  const constraintsBefore = new Map(before.constraints.map(constraint => [constraint.id, JSON.stringify(constraint)]));
  for (const constraint of after.constraints) {
    if (constraint.kind !== "ellipseMajorRadius" && constraint.kind !== "ellipseMinorRadius") continue;
    if (constraintsBefore.get(constraint.id) !== JSON.stringify(constraint)) {
      const id = constraint.refs[0];
      if (id) changed.add(id);
    }
  }
  return changed;
}

function sameSketchCommandContext(
  before: SketchCommandContext | null | undefined,
  after: SketchCommandContext | null | undefined,
): boolean {
  return Boolean(before && after && before.documentId === after.documentId && before.revision === after.revision &&
    before.epoch === after.epoch && before.connectionGeneration === after.connectionGeneration &&
    before.sessionId === after.sessionId);
}

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
  const projectionView = useDocumentUiStore((s) => s.projectionViews[sketchId]);
  const documentRevision = useDocumentUiStore((s) => s.revision);
  const documentEpoch = useDocumentUiStore((s) => s.epoch);
  const documentId = useDocumentUiStore((s) => s.documentId);
  const documentConnectionGeneration = useDocumentUiStore((s) => s.connectionGeneration);
  const [model, setModel] = useState<SketchModel | null>(null);
  const [curveDisplay, setCurveDisplay] = useState<SketchCurveDisplay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>(() => t("common.loading"));
  const [dragging, setDragging] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [curveTool, setCurveTool] = useState<SketchCurveTool | null>(null);
  const [curveDraft, setCurveDraft] = useState<CurveDraft | null>(null);
  const [curvePreviewReady, setCurvePreviewReady] = useState(false);
  const [selectedCurveId, setSelectedCurveId] = useState<string | null>(null);
  const [selectedLineIds, setSelectedLineIds] = useState<string[]>([]);
  const [hoveredPointId, setHoveredPointId] = useState<string | null>(null);
  const [hoveredLineId, setHoveredLineId] = useState<string | null>(null);
  const [trimPreviewCandidate, setTrimPreviewCandidate] = useState<TrimExtendCandidate | null>(null);
  const [lineToolsResetKey, setLineToolsResetKey] = useState(0);
  const [splineClosed, setSplineClosed] = useState(false);
  const [minorRadiusInput, setMinorRadiusInput] = useState("10");
  const [startAngleInput, setStartAngleInput] = useState("0");
  const [sweepAngleInput, setSweepAngleInput] = useState("120");
  const tt = useT();
  const dragRef = useRef<{ id: string; moved: boolean } | null>(null);
  // Latest model mirror (incl. in-flight previews): commits read from here,
  // never from a stale render closure (§15 — no pointer-frequency React).
  const modelRef = useRef<SketchModel | null>(null);
  const previewSeq = useRef(0);
  const committedModelRef = useRef<SketchModel | null>(null);
  const modelContextRef = useRef<SketchCommandContext | null>(null);
  const curveDisplayRef = useRef<SketchCurveDisplay | null>(null);
  const committedCurveDisplayRef = useRef<SketchCurveDisplay | null>(null);
  const busyRef = useRef(false);
  const activeCommitTokenRef = useRef(0);
  const ownerRef = useRef({ sketchId, documentId, epoch: documentEpoch,
    connectionGeneration: documentConnectionGeneration, generation: 0 });
  const curveToolRef = useRef<SketchCurveTool | null>(null);
  const curveDraftRef = useRef<CurveDraft | null>(null);
  const curveDraftBaseRef = useRef<SketchModel | null>(null);
  // Drag-preview throttle (same 40 ms cadence as face pull): pointermove
  // fires far faster than the core round-trip, and every unthrottled preview
  // queued a full updateSketch + setModel re-render behind the drag.
  const lastPreviewAt = useRef(0);
  // Pre-drag snapshot for Escape-cancel (restores without committing).
  const dragBaseRef = useRef<SketchModel | null>(null);
  const dragBaseCurveDisplayRef = useRef<SketchCurveDisplay | null>(null);
  const [inference, setInference] = useState<string | null>(null);
  // UX-3 progressive disclosure: diagnostics hide in Simple mode.
  const beginnerMode = usePreferencesStore((s) => s.beginnerMode);
  const [showDetails, setShowDetails] = useState(false);
  const [symPointA, setSymPointA] = useState("");
  const [symPointB, setSymPointB] = useState("");
  const [symAxis, setSymAxis] = useState("");
  const [contextReloadToken, setContextReloadToken] = useState(0);
  const [workspaceWidth, setWorkspaceWidth] = useState(0);
  const workspaceRef = useRef<HTMLDivElement>(null);

  const publishCurveDisplay = (next: SketchCurveDisplay | null): void => {
    curveDisplayRef.current = next;
    setCurveDisplay(next);
  };
  const publishCurveDraft = (next: CurveDraft | null): void => {
    curveDraftRef.current = next;
    setCurveDraft(next);
  };
  const invalidateModelForContextMismatch = (): void => {
    previewSeq.current++;
    ownerRef.current = { ...ownerRef.current, generation: ownerRef.current.generation + 1 };
    activeCommitTokenRef.current++;
    busyRef.current = false;
    setBusy(false);
    modelContextRef.current = null;
    modelRef.current = null;
    committedModelRef.current = null;
    committedCurveDisplayRef.current = null;
    dragRef.current = null;
    dragBaseRef.current = null;
    dragBaseCurveDisplayRef.current = null;
    curveToolRef.current = null;
    curveDraftRef.current = null;
    curveDraftBaseRef.current = null;
    setModel(null);
    publishCurveDisplay(null);
    setDragging(null);
    setSelectedCurveId(null);
    setSelectedLineIds([]);
    setHoveredPointId(null);
    setHoveredLineId(null);
    setTrimPreviewCandidate(null);
    setLineToolsResetKey(value => value + 1);
    setCurveTool(null);
    publishCurveDraft(null);
    setCurvePreviewReady(false);
    setStatus(t("common.loading"));
    setContextReloadToken(token => token + 1);
    void coreClient.cancelPreview(sketchId).catch(() => {});
  };

  useLayoutEffect(() => {
    const generation = ownerRef.current.generation + 1;
    ownerRef.current = { sketchId, documentId, epoch: documentEpoch,
      connectionGeneration: documentConnectionGeneration, generation };
    activeCommitTokenRef.current++;
    busyRef.current = false;
    setBusy(false);
    modelContextRef.current = null;
    modelRef.current = null;
    committedModelRef.current = null;
    curveDisplayRef.current = null;
    committedCurveDisplayRef.current = null;
    setModel(null);
    setCurveDisplay(null);
    setSelectedCurveId(null);
    setSelectedLineIds([]);
    setHoveredPointId(null);
    setHoveredLineId(null);
    setTrimPreviewCandidate(null);
    setLineToolsResetKey(value => value + 1);
    curveToolRef.current = null;
    setCurveTool(null);
    curveDraftRef.current = null;
    curveDraftBaseRef.current = null;
    setCurveDraft(null);
    setCurvePreviewReady(false);
    return () => {
      if (ownerRef.current.generation === generation) {
        ownerRef.current = { ...ownerRef.current, generation: generation + 1 };
        activeCommitTokenRef.current++;
      }
    };
  }, [sketchId, documentId, documentEpoch, documentConnectionGeneration]);
  useEffect(() => {
    setSelectedLineIds([]);
    setTrimPreviewCandidate(null);
  }, [documentRevision]);
  useLayoutEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const measure = () => setWorkspaceWidth(workspace.clientWidth);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  const chooseCurveTool = (next: SketchCurveTool | null): void => {
    previewSeq.current++;
    void coreClient.cancelPreview(sketchId).catch(() => {});
    curveToolRef.current = next;
    setCurveTool(next);
    publishCurveDraft(null);
    curveDraftBaseRef.current = null;
    setCurvePreviewReady(false);
    setSelectedLineIds([]);
    setHoveredLineId(null);
    setTrimPreviewCandidate(null);
    setLineToolsResetKey(value => value + 1);
    const committed = committedModelRef.current;
    if (committed) {
      modelRef.current = committed;
      setModel(committed);
      publishCurveDisplay(committedCurveDisplayRef.current);
    }
    setError(null);
  };
  // Escape cancels an ACTIVE drag (restores pre-drag state, no commit).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && dragRef.current && dragBaseRef.current) {
        void coreClient.cancelPreview(sketchId).catch((error: unknown) =>
          setError(error instanceof Error ? error.message : t("sketch.errCommitFailed")));
        dragRef.current = null;
        previewSeq.current++;
        setDragging(null);
        setInference(null);
        setModel(dragBaseRef.current);
        modelRef.current = dragBaseRef.current;
        publishCurveDisplay(dragBaseCurveDisplayRef.current);
        dragBaseRef.current = null;
        dragBaseCurveDisplayRef.current = null;
      } else if (e.key === "Escape" && curveToolRef.current) {
        previewSeq.current++;
        void coreClient.cancelPreview(sketchId).catch(() => {});
        curveToolRef.current = null;
        setCurveTool(null);
        publishCurveDraft(null);
        if (committedModelRef.current) {
          modelRef.current = committedModelRef.current;
          setModel(committedModelRef.current);
          publishCurveDisplay(committedCurveDisplayRef.current);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sketchId]);

  // Load full model on open.
  useEffect(() => {
    let cancelled = false;
    const captured = useDocumentUiStore.getState();
    const capturedOwner = ownerRef.current.generation;
    setModel(null);
    setCurveDisplay(null);
    setError(null);
    curveToolRef.current = null;
    setCurveTool(null);
    curveDraftRef.current = null;
    curveDraftBaseRef.current = null;
    setCurveDraft(null);
    setCurvePreviewReady(false);
    modelRef.current = null;
    committedModelRef.current = null;
    modelContextRef.current = null;
    curveDisplayRef.current = null;
    committedCurveDisplayRef.current = null;
    void (async () => {
      try {
        const context = await coreClient.captureSketchContext();
        if (cancelled || ownerRef.current.generation !== capturedOwner ||
            context.documentId !== captured.documentId || context.epoch !== captured.epoch ||
            context.connectionGeneration !== captured.connectionGeneration || context.revision !== captured.revision) return;
        const [full] = await Promise.all([
          coreClient.requestSketch(sketchId, context),
          refreshSketchProjection(sketchId).catch((e: unknown) => {
            if (!cancelled) setError(e instanceof Error ? e.message : tt("sketch.errLoadFailed"));
            return null;
          }),
        ]);
        if (cancelled || ownerRef.current.generation !== capturedOwner) return;
        const current = useDocumentUiStore.getState();
        if (current.documentId !== captured.documentId || current.epoch !== captured.epoch ||
            current.revision !== captured.revision || current.connectionGeneration !== captured.connectionGeneration ||
            sketch?.featureId !== sketchId || full.revision !== captured.revision) return;
        const loaded = fullSketchModel(full);
        modelContextRef.current = context;
        setModel(loaded);
        modelRef.current = loaded;
        committedModelRef.current = loaded;
        publishCurveDisplay(full.curveDisplay ?? null);
        committedCurveDisplayRef.current = full.curveDisplay ?? null;
        setStatus(tt("sketch.solved"));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : tt("sketch.errLoadFailed"));
      }
    })();
    return () => {
      cancelled = true;
      previewSeq.current++;
      void coreClient.cancelPreview(sketchId).catch(() => {});
    };
  }, [sketchId, documentId, documentEpoch, documentRevision, documentConnectionGeneration, contextReloadToken]);

  const bounds = useMemo(() => {
    if (!model)
      return { minX: -10, minY: -10, w: 120, h: 80 };
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    const boundsPoints = sketchFitPoints(model, projectionView?.projection, curveDisplay);
    for (const [x, y] of boundsPoints) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    if (boundsPoints.length === 0) return { minX: -10, minY: -10, w: 120, h: 80 };
    const pad = 15;
    return {
      minX: minX - pad,
      minY: minY - pad,
      w: Math.max(10, maxX - minX + pad * 2),
      h: Math.max(10, maxY - minY + pad * 2),
    };
  }, [model, projectionView, curveDisplay]);

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
  const captureFence = () => {
    const current = useDocumentUiStore.getState();
    return { documentId: current.documentId, epoch: current.epoch, revision: current.revision,
      connectionGeneration: current.connectionGeneration, sketchId, owner: ownerRef.current.generation };
  };
  const fenceCurrent = (fence: ReturnType<typeof captureFence>, seq: number): boolean => {
    const current = useDocumentUiStore.getState();
    return sketchId === fence.sketchId && ownerRef.current.generation === fence.owner &&
      ownerRef.current.connectionGeneration === fence.connectionGeneration && current.documentId === fence.documentId &&
      current.epoch === fence.epoch && current.revision === fence.revision &&
      current.connectionGeneration === fence.connectionGeneration &&
      previewSeq.current === seq;
  };
  const identityCurrent = (fence: ReturnType<typeof captureFence>): boolean => {
    const current = useDocumentUiStore.getState();
    return sketchId === fence.sketchId && ownerRef.current.generation === fence.owner &&
      ownerRef.current.connectionGeneration === fence.connectionGeneration && current.documentId === fence.documentId &&
      current.epoch === fence.epoch && current.connectionGeneration === fence.connectionGeneration;
  };
  const restoreCommitted = (): void => {
    const committed = committedModelRef.current;
    if (!committed) return;
    modelRef.current = committed;
    setModel(committed);
    publishCurveDisplay(committedCurveDisplayRef.current);
  };
  const commitModel = async (next: SketchModel, validatePreview?: (solved: SketchModel) => void): Promise<boolean> => {
    if (busyRef.current || !modelRef.current || !modelContextRef.current) return false;
    const pinnedModelContext = modelContextRef.current;
    const baseline = committedModelRef.current ?? modelRef.current;
    const fence = captureFence();
    const seq = ++previewSeq.current;
    const commitToken = ++activeCommitTokenRef.current;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const commandContext = await coreClient.captureSketchContext();
      if (!fenceCurrent(fence, seq)) return false;
      if (!sameSketchCommandContext(pinnedModelContext, commandContext)) {
        invalidateModelForContextMismatch();
        return false;
      }
      if (commandContext.documentId !== fence.documentId || commandContext.epoch !== fence.epoch ||
          commandContext.revision !== fence.revision || commandContext.connectionGeneration !== fence.connectionGeneration ||
          !identityCurrent(fence)) return false;
      const preview = await coreClient.updateSketch({
        featureId: sketchId,
        model: next,
        isPreview: true,
      }, commandContext);
      if (!fenceCurrent(fence, seq)) return false;
      if (preview.conflicting?.length) throw new Error(tt("sketch.errConflict", { s: preview.conflicting.join(", ") }));

      const previewSolved = solvedSketchModel(preview.solved, next);
      validatePreview?.(previewSolved);
      const changed = changedCurveIds(baseline, previewSolved);
      for (const id of changed) {
        const remains = [...(previewSolved.ellipses ?? []), ...(previewSolved.splines ?? [])].some(curve => curve.id === id);
        if (!remains) continue;
        const display = preview.curveDisplay;
        if (!display) throw new Error(tt("sketch.curve.globalDisplayError"));
        const globalError = display.errors.find(item => !item.entityId);
        if (globalError) throw new Error(tt("sketch.curve.globalDisplayError"));
        const displayError = display.errors.find(item => item.entityId === id);
        if (displayError) throw new Error(tt("sketch.curve.curveError", { message: displayError.message }));
        if (!display.curves.some(curve => curve.entityId === id && curve.pointsMm.length >= 2)) {
          throw new Error(tt("sketch.curve.globalDisplayError"));
        }
      }
      if (!fenceCurrent(fence, seq)) return false;
      const r = await coreClient.updateSketch({ featureId: sketchId, model: next }, commandContext);
      if (!identityCurrent(fence)) return false;
      if (r.conflicting?.length) throw new Error(tt("sketch.errConflict", { s: r.conflicting.join(", ") }));
      const committedRevision = r.context?.revision ?? r.revision;
      const afterCommitState = useDocumentUiStore.getState();
      if (afterCommitState.revision !== fence.revision && afterCommitState.revision !== committedRevision) {
        try {
          const refreshedContext = await coreClient.captureSketchContext();
          const refreshed = await coreClient.requestSketch(sketchId, refreshedContext);
          const refreshedState = useDocumentUiStore.getState();
          if (identityCurrent(fence) && refreshedContext.revision === refreshed.revision &&
              refreshedState.revision === refreshed.revision) {
            const refreshedModel = fullSketchModel(refreshed);
            committedModelRef.current = refreshedModel;
            modelContextRef.current = refreshedContext;
            modelRef.current = refreshedModel;
            setModel(refreshedModel);
            committedCurveDisplayRef.current = refreshed.curveDisplay ?? null;
            publishCurveDisplay(refreshed.curveDisplay ?? null);
          }
        } catch { /* The external revision remains authoritative. */ }
        return true;
      }
      const solved = solvedSketchModel(r.solved, next);
      const committedContext = r.context ?? { ...commandContext, revision: r.revision ?? commandContext.revision };
      if (committedContext.documentId !== commandContext.documentId || committedContext.epoch !== commandContext.epoch ||
          committedContext.connectionGeneration !== commandContext.connectionGeneration ||
          committedContext.sessionId !== commandContext.sessionId) {
        invalidateModelForContextMismatch();
        return false;
      }
      modelContextRef.current = committedContext;
      const committedDisplay = r.curveDisplay ?? preview.curveDisplay ?? curveDisplayRef.current;
      committedModelRef.current = solved;
      committedCurveDisplayRef.current = committedDisplay;
      setModel(solved);
      modelRef.current = solved;
      publishCurveDisplay(committedDisplay ?? null);
      setStatus(
        tt("sketch.solvedFull", { r: (r.residual ?? 0).toExponential(1), d: r.dofs ?? "?" }),
      );
      const canPublishCommitEffects = (): boolean => {
        const current = useDocumentUiStore.getState();
        return identityCurrent(fence) &&
          (current.revision === fence.revision || current.revision === committedRevision);
      };
      try {
        if (!canPublishCommitEffects()) return true;
        if (r.context) {
          const state = useDocumentUiStore.getState();
          state.setFeatures(state.features, r.context.revision, state.epoch);
        }
        await refreshSummary(sketchId, canPublishCommitEffects, r.context);
        if (!canPublishCommitEffects()) return true;
        const storeNow = useDocumentUiStore.getState();
        const visible = new Set(visibleFeatureIds(storeNow.features));
        const dependents = storeNow.features.filter(
          (f) => f.dependsOn?.includes(sketchId) && visible.has(f.featureId),
        );
        for (const d of dependents) {
          if (!canPublishCommitEffects()) break;
          const mesh = await coreClient.requestMesh(d.featureId, 1);
          if (!canPublishCommitEffects()) break;
          const s = useDocumentUiStore.getState();
          s.upsertMesh(d.featureId, mesh, r.revision ?? s.revision);
          if (!canPublishCommitEffects()) break;
          updateFeatureSummary(d.featureId, { volumeMm3: mesh.volumeMm3 }, r.revision ?? s.revision);
        }
      } catch (e) {
        if (identityCurrent(fence)) setError(e instanceof Error ? e.message : tt("sketch.errCommitFailed"));
      }
      return true;
    } catch (e) {
      if (!identityCurrent(fence) || previewSeq.current !== seq ||
          useDocumentUiStore.getState().revision !== fence.revision) return false;
      setError(e instanceof Error ? e.message : t("sketch.errCommitFailed"));
      void coreClient.cancelPreview(sketchId).catch(() => {});
      restoreCommitted();
      try {
        const rollbackContext = await coreClient.captureSketchContext();
        const full = await coreClient.requestSketch(sketchId, rollbackContext);
        const afterRestore = useDocumentUiStore.getState();
        if (!identityCurrent(fence) || rollbackContext.revision !== full.revision ||
            afterRestore.revision !== rollbackContext.revision || full.revision !== afterRestore.revision) return false;
        const restored = fullSketchModel(full);
        modelContextRef.current = rollbackContext;
        setModel(restored);
        modelRef.current = restored;
        committedModelRef.current = restored;
        publishCurveDisplay(full.curveDisplay ?? null);
        committedCurveDisplayRef.current = full.curveDisplay ?? null;
      } catch {
        // Keep the last committed model if restoration is unavailable.
      }
      return false;
    } finally {
      if (activeCommitTokenRef.current === commitToken && ownerRef.current.generation === fence.owner) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  };

  const applyTrimCandidate = async (candidate: TrimExtendCandidate): Promise<boolean> => {
    const baseline = committedModelRef.current ?? modelRef.current;
    if (!baseline) return false;
    const validate = (solved: SketchModel): void => {
      const moved = solved.points.find(point => point.id === candidate.pointId);
      if (!moved || !sameSketchCoordinateMm(moved.x, candidate.x) || !sameSketchCoordinateMm(moved.y, candidate.y)) {
        throw new Error(tt("sketch.lineTools.endpointMoved"));
      }
      for (const point of baseline.points) {
        if (point.id === candidate.pointId) continue;
        const after = solved.points.find(item => item.id === point.id);
        if (!after || !sameSketchCoordinateMm(after.x, point.x) || !sameSketchCoordinateMm(after.y, point.y)) {
          throw new Error(tt("sketch.lineTools.untouchedMoved"));
        }
      }
      for (const circle of [...baseline.circles, ...(baseline.arcs ?? [])]) {
        const after = [...solved.circles, ...(solved.arcs ?? [])].find(item => item.id === circle.id);
        if (!after || !sameSketchCoordinateMm(after.r, circle.r)) throw new Error(tt("sketch.lineTools.radiusMoved"));
      }
      for (const ellipse of baseline.ellipses ?? []) {
        const after = solved.ellipses?.find(item => item.id === ellipse.id);
        if (!after || !sameSketchCoordinateMm(after.majorRadius, ellipse.majorRadius) ||
            !sameSketchCoordinateMm(after.minorRadius, ellipse.minorRadius)) {
          throw new Error(tt("sketch.lineTools.radiusMoved"));
        }
      }
    };
    return commitModel(candidate.model, validate);
  };

  const cancelLineTools = (): void => {
    previewSeq.current++;
    void coreClient.cancelPreview(sketchId).catch(() => {});
    setSelectedLineIds([]);
    setTrimPreviewCandidate(null);
  };

  const activateLineTools = (): void => {
    if (!curveToolRef.current && !curveDraftRef.current) return;
    previewSeq.current++;
    void coreClient.cancelPreview(sketchId).catch(() => {});
    curveToolRef.current = null;
    curveDraftRef.current = null;
    curveDraftBaseRef.current = null;
    setCurveTool(null);
    setCurveDraft(null);
    setCurvePreviewReady(false);
    restoreCommitted();
  };

  const splineCandidate = (draft: CurveDraft, closed: boolean): SketchModel => {
    const base = curveDraftBaseRef.current ?? committedModelRef.current;
    if (!base) throw new Error(tt("sketch.errLoadFailed"));
    return SketchModelSchema.parse({
      ...base,
      points: [...base.points, ...draft.points],
      splines: [...(base.splines ?? []), {
        id: draft.entityId,
        pointIds: draft.points.map(point => point.id),
        controlPoints: draft.tool === "controlSpline",
        closed,
      }],
    });
  };

  const previewSplineDraft = async (draft: CurveDraft, closed: boolean): Promise<void> => {
    const minimum = closed ? 4 : 3;
    if (draft.points.length < minimum) {
      setCurvePreviewReady(false);
      return;
    }
    setCurvePreviewReady(false);
    setError(null);
    const candidate = splineCandidate(draft, closed);
    const fence = captureFence();
    const seq = ++previewSeq.current;
    try {
      const commandContext = await coreClient.captureSketchContext();
      if (!fenceCurrent(fence, seq)) return;
      if (!sameSketchCommandContext(modelContextRef.current, commandContext)) {
        invalidateModelForContextMismatch();
        return;
      }
      if (commandContext.documentId !== fence.documentId || commandContext.epoch !== fence.epoch ||
          commandContext.revision !== fence.revision || commandContext.connectionGeneration !== fence.connectionGeneration) return;
      const preview = await coreClient.updateSketch({ featureId: sketchId, model: candidate, isPreview: true }, commandContext);
      if (!fenceCurrent(fence, seq)) return;
      if (preview.conflicting?.length) throw new Error(tt("sketch.errConflict", { s: preview.conflicting.join(", ") }));
      const display = preview.curveDisplay;
      if (!display || display.errors.some(item => !item.entityId) ||
          display.errors.some(item => item.entityId === draft.entityId) ||
          !display.curves.some(curve => curve.entityId === draft.entityId && curve.pointsMm.length >= 2)) {
        const message = display?.errors.find(item => item.entityId === draft.entityId)?.message;
        throw new Error(message
          ? tt("sketch.curve.curveError", { message })
          : tt("sketch.curve.globalDisplayError"));
      }
      const solved = solvedSketchModel(preview.solved, candidate);
      modelRef.current = solved;
      setModel(solved);
      publishCurveDisplay(display);
      setCurvePreviewReady(true);
    } catch (e) {
      if (!fenceCurrent(fence, seq)) return;
      restoreCommitted();
      setError(e instanceof Error ? e.message : tt("sketch.errSolveFailed"));
      void coreClient.cancelPreview(sketchId).catch(() => {});
    }
  };

  const handleCanvasClick = (event: React.MouseEvent<SVGSVGElement>): void => {
    const tool = curveToolRef.current;
    if (!tool || busyRef.current || !committedModelRef.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const sx = ((event.clientX - rect.left) / rect.width) * VIEW;
    const sy = ((event.clientY - rect.top) / rect.height) * VIEW;
    const [x, y] = fromClient(sx, sy);

    if (tool === "ellipse" || tool === "ellipticalArc") {
      const draft = curveDraftRef.current;
      if (!draft) {
        curveDraftBaseRef.current = committedModelRef.current;
        publishCurveDraft({ tool, entityId: uid(tool), points: [{ id: uid("center"), x, y }] });
        setCurvePreviewReady(false);
        setError(null);
        return;
      }
      const center = draft.points[0];
      const base = curveDraftBaseRef.current;
      if (!center || !base || draft.tool !== tool) return;
      const majorRadius = Math.hypot(x - center.x, y - center.y);
      const minorRadius = Number(minorRadiusInput);
      const startDegrees = Number(startAngleInput);
      const sweepDegrees = Number(sweepAngleInput);
      if (!Number.isFinite(majorRadius) || majorRadius <= 1e-9 || !Number.isFinite(minorRadius) ||
          minorRadius <= 1e-9 || minorRadius >= majorRadius) {
        setError(tt("sketch.errSolveFailed"));
        return;
      }
      if (tool === "ellipticalArc" && (!Number.isFinite(startDegrees) || !Number.isFinite(sweepDegrees) ||
          sweepDegrees <= 0 || sweepDegrees >= 360)) {
        setError(tt("sketch.errSolveFailed"));
        return;
      }
      const radians = Math.PI / 180;
      const curveId = draft.entityId;
      let candidate: SketchModel;
      try {
        candidate = SketchModelSchema.parse({
          ...base,
          points: [...base.points, { id: center.id, x: center.x, y: center.y, fixed: false }],
          ellipses: [...(base.ellipses ?? []), {
            id: curveId,
            center: center.id,
            majorRadius,
            minorRadius,
            rotationRad: Math.atan2(y - center.y, x - center.x),
            arc: tool === "ellipticalArc",
            startAngleRad: tool === "ellipticalArc" ? startDegrees * radians : 0,
            endAngleRad: tool === "ellipticalArc" ? (startDegrees + sweepDegrees) * radians : Math.PI * 2,
          }],
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : tt("sketch.errSolveFailed"));
        return;
      }
      void commitModel(candidate).then(success => {
        if (success) {
          setSelectedCurveId(curveId);
          chooseCurveTool(null);
        }
      });
      return;
    }

    let draft = curveDraftRef.current;
    if (!draft) {
      curveDraftBaseRef.current = committedModelRef.current;
      draft = { tool, entityId: uid("spline"), points: [] };
    }
    if (draft.tool !== tool || draft.points.length >= 256) {
      setError(draft.points.length >= 256 ? tt("sketch.errSolveFailed") : null);
      return;
    }
    const nextDraft: CurveDraft = {
      ...draft,
      points: [...draft.points, { id: uid("curve-point"), x, y }],
    };
    publishCurveDraft(nextDraft);
    const minimum = splineClosed ? 4 : 3;
    if (nextDraft.points.length >= minimum) void previewSplineDraft(nextDraft, splineClosed);
    else {
      setCurvePreviewReady(false);
      setError(null);
    }
  };

  const finishSpline = async (): Promise<void> => {
    const draft = curveDraftRef.current;
    if (!draft || !curvePreviewReady || busyRef.current) return;
    const closed = splineClosed;
    const candidate = splineCandidate(draft, closed);
    if (await commitModel(candidate)) {
      setSelectedCurveId(draft.entityId);
      chooseCurveTool(null);
    }
  };

  const makeRectangle = async (): Promise<void> => {
    if (!busyRef.current && await commitModel(defaultRectModel())) {
      chooseCurveTool(null);
    }
  };

  const clearProfile = async (): Promise<void> => {
    const empty = SketchModelSchema.parse({
      points: [], lines: [], circles: [], arcs: [], ellipses: [], splines: [], constructionIds: [], constraints: [],
    });
    if (!busyRef.current && await commitModel(empty)) {
      setSelectedCurveId(null);
      chooseCurveTool(null);
    }
  };

  const updateEllipse = async (ellipseId: string, patch: Record<string, number>): Promise<void> => {
    const current = committedModelRef.current;
    if (!current) return;
    const ellipses = (current.ellipses ?? []).map(ellipse => ellipse.id === ellipseId ? { ...ellipse, ...patch } : ellipse);
    const edited = ellipses.find(ellipse => ellipse.id === ellipseId);
    if (!edited) return;
    const constraints = current.constraints.map(constraint => {
      if (constraint.refs[0] !== ellipseId) return constraint;
      if (constraint.kind === "ellipseMajorRadius") return { ...constraint, value: edited.majorRadius };
      if (constraint.kind === "ellipseMinorRadius") return { ...constraint, value: edited.minorRadius };
      return constraint;
    });
    try {
      const next = SketchModelSchema.parse({ ...current, ellipses, constraints });
      await commitModel(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : tt("sketch.errSolveFailed"));
    }
  };

  const setEllipseDimension = async (ellipseId: string, kind: "ellipseMajorRadius" | "ellipseMinorRadius"): Promise<void> => {
    const current = committedModelRef.current;
    const ellipse = current?.ellipses?.find(item => item.id === ellipseId);
    if (!current || !ellipse || current.constraints.some(item => item.kind === kind && item.refs[0] === ellipseId)) return;
    const value = kind === "ellipseMajorRadius" ? ellipse.majorRadius : ellipse.minorRadius;
    try {
      await commitModel(SketchModelSchema.parse({
        ...current,
        constraints: [...current.constraints, { id: uid(kind), kind, refs: [ellipseId], value }],
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : tt("sketch.errSolveFailed"));
    }
  };

  const toggleConstruction = async (curveId: string, enabled: boolean): Promise<void> => {
    const current = committedModelRef.current;
    if (!current) return;
    const ids = new Set(current.constructionIds ?? []);
    if (enabled) ids.add(curveId);
    else ids.delete(curveId);
    await commitModel(SketchModelSchema.parse({ ...current, constructionIds: [...ids] }));
  };

  const editSplinePoint = async (pointId: string, x: number, y: number): Promise<void> => {
    const current = committedModelRef.current;
    if (!current || !Number.isFinite(x) || !Number.isFinite(y)) return;
    await commitModel(SketchModelSchema.parse({
      ...current,
      points: current.points.map(point => point.id === pointId ? { ...point, x, y } : point),
    }));
  };

  const onPointDown = (id: string) => (e: React.PointerEvent) => {
    if (curveToolRef.current || busyRef.current) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    // Snapshot for Escape-cancel (pre-drag model).
    dragBaseRef.current = committedModelRef.current;
    dragBaseCurveDisplayRef.current = committedCurveDisplayRef.current;
    dragRef.current = { id, moved: false };
    setDragging(id);
  };

  const onPointMove = (id: string) => async (e: React.PointerEvent) => {
    const drag = dragRef.current;
    const base = dragBaseRef.current ?? modelRef.current;
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
    // Throttle BEFORE the inference setState + IPC: at most ~25 previews/s.
    const nowMove = performance.now();
    if (nowMove - lastPreviewAt.current < 40) return;
    lastPreviewAt.current = nowMove;
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
            ? t("sketch.nearV")
            : dy < 2
              ? t("sketch.nearH")
              : null,
      );
    }
    try {
      // Monotonic seq: only the latest preview may paint (no stale wins).
      const fence = captureFence();
      const seq = ++previewSeq.current;
      const commandContext = await coreClient.captureSketchContext();
      if (!fenceCurrent(fence, seq)) return;
      if (!sameSketchCommandContext(modelContextRef.current, commandContext)) {
        invalidateModelForContextMismatch();
        return;
      }
      if (commandContext.documentId !== fence.documentId || commandContext.epoch !== fence.epoch ||
          commandContext.revision !== fence.revision || commandContext.connectionGeneration !== fence.connectionGeneration) return;
      const candidate: SketchModel = {
        ...base,
        points: base.points.map(point => point.id === id ? { ...point, x, y } : point),
      };
      const r = await coreClient.updateSketch({
        featureId: sketchId,
        model: base,
        isPreview: true,
        dragPointId: id,
        dragX: x,
        dragY: y,
      }, commandContext);
      if (!fenceCurrent(fence, seq)) return;
      if (r.conflicting?.length) return;
      const next = solvedSketchModel(r.solved, candidate);
      modelRef.current = next;
      setModel(next);
      const changed = changedCurveIds(base, candidate);
      publishCurveDisplay(r.curveDisplay ?? (changed.size === 0 ? curveDisplayRef.current : null));
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
    if (!drag?.moved || !live) { await coreClient.cancelPreview(sketchId); dragBaseRef.current = null;dragBaseCurveDisplayRef.current = null;return; }
    // Commit the LIVE preview state (not a stale render closure).
    await commitModel(live);
    dragBaseRef.current = null;
    dragBaseCurveDisplayRef.current = null;
  };

  const selectedEllipse = model?.ellipses?.find(curve => curve.id === selectedCurveId);
  const selectedSpline = model?.splines?.find(curve => curve.id === selectedCurveId);
  const selectedCurveIsConstruction = Boolean(model?.constructionIds?.includes(selectedCurveId ?? ""));
  const hasGlobalCurveDisplayError = Boolean(curveDisplay?.errors.some(item => !item.entityId));
  const stackedWorkspace = workspaceWidth < SKETCH_CANVAS_MIN_WIDTH + SKETCH_WORKSPACE_GAP + SKETCH_QUOTE_MIN_WIDTH;
  const quoteWidth = Math.min(SKETCH_QUOTE_MAX_WIDTH,
    Math.max(SKETCH_QUOTE_MIN_WIDTH, Math.round(workspaceWidth * 0.34)));
  const canvasWidth = workspaceWidth > 0
    ? stackedWorkspace ? workspaceWidth : workspaceWidth - quoteWidth - SKETCH_WORKSPACE_GAP
    : null;

  if (!sketch) return null;

  return (
      <div data-testid="sketch-editor" role="dialog" aria-modal="true"
        aria-label={tt("sketch.title", { plane: sketch.planeKind })}
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60">
      <div data-testid="sketch-editor-window" className="kreoda-float-elevated max-h-[92vh] w-[96vw] max-w-[720px] overflow-y-auto p-4">
        <div className="flex items-center gap-2 pb-2">
          <span className="text-sm font-semibold">
            {tt("sketch.title", { plane: sketch.planeKind })}
          </span>
          <span className="font-mono text-[11px] text-white/40">
            {sketchId.slice(0, 13)}…
          </span>
          <div className="flex-1" />
          <span className="text-[11px] text-white/50">
            {beginnerMode ? status.split("·")[0]!.trim() : status}
          </span>
          <button
            onClick={onClose}
            className="rounded-[var(--kreoda-radius-sm)] bg-[var(--kreoda-accent)] px-3 py-1 text-sm font-medium text-white hover:bg-[var(--kreoda-accent-hover)]"
          >
            {tt("common.done")}
          </button>
        </div>
        {error && (
          <div className="mb-2 rounded-md bg-red-950 px-2.5 py-1.5 text-xs text-red-200">
            {error}
          </div>
        )}
        <SketchCurveTools activeTool={curveTool} onToolChange={chooseCurveTool}
          onRectangle={() => void makeRectangle()} onClear={() => void clearProfile()}
          disabled={busy || !model} closed={splineClosed} onClosedChange={(closed) => {
            setSplineClosed(closed);
            const draft = curveDraftRef.current;
            if (draft && (draft.tool === "controlSpline" || draft.tool === "interpolatingSpline")) {
              void previewSplineDraft(draft, closed);
            }
          }}
          minorRadius={minorRadiusInput} onMinorRadiusChange={setMinorRadiusInput}
          startAngle={startAngleInput} onStartAngleChange={setStartAngleInput}
          sweepAngle={sweepAngleInput} onSweepAngleChange={setSweepAngleInput}
          hint={curveTool === "ellipse" || curveTool === "ellipticalArc"
            ? tt(curveDraft ? "sketch.curve.hintEllipseReady" : "sketch.curve.hintCenter")
            : curveTool ? tt(curveDraft && curveDraft.points.length < (splineClosed ? 4 : 3)
              ? "sketch.curve.hintSplineIncomplete" : "sketch.curve.hintSpline", { n: splineClosed ? 4 : 3 })
              : ""}
          pointCount={curveDraft?.points.length ?? 0}
          canFinish={curvePreviewReady && (curveDraft?.points.length ?? 0) >= (splineClosed ? 4 : 3)}
          onFinish={() => void finishSpline()} onCancel={() => chooseCurveTool(null)} />
        <SketchLineTools key={`${sketchId}:${documentId}:${documentEpoch}:${documentRevision}:${documentConnectionGeneration}:${lineToolsResetKey}`}
          model={model} selectedLineIds={selectedLineIds} onSelectionChange={setSelectedLineIds}
          onTrimPreview={setTrimPreviewCandidate} onTrim={applyTrimCandidate}
          onTransform={candidate => commitModel(candidate)} onActivate={activateLineTools}
          onCancel={cancelLineTools} disabled={busy || Boolean(dragging) || !model} />
        <details data-testid="sketch-advanced-json" className="mb-2 rounded bg-white/5 p-2 text-xs">
          <summary className="cursor-pointer">{tt("sketch.curve.diagnostics")}</summary>
          <pre className="mt-2 max-h-32 overflow-auto bg-slate-900 p-2 font-mono text-[10px] text-white/60">{JSON.stringify({
            model: model ? SketchModelSchema.parse(model) : null,
            curveDisplay,
          }, null, 2)}</pre>
        </details>
        <div
          ref={workspaceRef}
          data-testid="sketch-workspace"
          className="grid min-w-0 gap-3 overflow-x-hidden"
          style={{
            gridTemplateColumns: stackedWorkspace ? "minmax(0, 1fr)" : `minmax(0, 1fr) ${quoteWidth}px`,
            gap: `${SKETCH_WORKSPACE_GAP}px`,
            overflowX: "hidden",
          }}
        >
          <svg
            viewBox={`0 0 ${VIEW} ${VIEW}`}
            preserveAspectRatio="xMidYMid meet"
            className="block aspect-square w-full max-w-full min-w-0 rounded-md bg-[var(--kreoda-workspace-bg)] touch-none select-none"
            style={canvasWidth === null ? undefined : { width: `${canvasWidth}px`, height: `${canvasWidth}px` }}
            data-testid="sketch-canvas"
            aria-label={tt("sketch.curve.canvas")}
            onClick={handleCanvasClick}
          >
            {projectionView?.revision === documentRevision && projectionView.epoch === documentEpoch &&
              projectionView.projection.geometryCurrent && projectionView.projection.status === "ok" && (
              <g data-testid="sketch-projection-lines" data-read-only="true" pointerEvents="none" aria-label={tt("sketch.projection.readOnly")}>
                {projectionView.projection.groups.map((group) => group.status === "ok" ? group.edges.map((edge, index) => {
                  const points = edge.pointsMm.map(point => worldPointToSketchLocal(point, projectionView.projection.plane));
                  if (points.length < 2 || points.some(point => point.some(value => !Number.isFinite(value)))) return null;
                  const [startX, startY] = toClient(points[0]![0], points[0]![1]);
                  const path = points.slice(1).map(([x, y]) => {
                    const [px, py] = toClient(x, y);
                    return `L ${px} ${py}`;
                  }).join(" ");
                  return <path key={`${group.groupId}:${index}`} d={`M ${startX} ${startY} ${path}${edge.closed ? " Z" : ""}`}
                    fill="none" stroke="#f0a54b" strokeWidth={1.75} strokeDasharray="5 3" data-projection-group={group.groupId} />;
                }) : null)}
              </g>
            )}
            {!hasGlobalCurveDisplayError && curveDisplay?.curves.map(curve => {
              if (curveDisplay.errors.some(item => item.entityId === curve.entityId)) return null;
              const points = curve.pointsMm.filter(point => point.every(Number.isFinite));
              if (points.length < 2) return null;
              const [startX, startY] = toClient(points[0]![0], points[0]![1]);
              const path = points.slice(1).map(([x, y]) => {
                const [px, py] = toClient(x, y);
                return `L ${px} ${py}`;
              }).join(" ");
              const construction = model?.constructionIds?.includes(curve.entityId) ?? false;
              const selected = selectedCurveId === curve.entityId;
              return <path key={curve.entityId} role="button" tabIndex={0}
                aria-label={`${curve.kind} ${curve.entityId}`} data-testid={`sk-curve-${curve.entityId}`}
                data-curve-kind={curve.kind} data-construction={construction}
                d={`M ${startX} ${startY} ${path}${curve.closed ? " Z" : ""}`}
                fill="none" stroke={construction ? "#f0a54b" : selected ? "#e6f3ff" : "#51c8db"}
                strokeWidth={selected ? 3.5 : 2.5} strokeDasharray={construction ? "5 3" : undefined}
                onClick={event => { event.stopPropagation(); setSelectedCurveId(curve.entityId); }}
                onKeyDown={event => {
                  if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedCurveId(curve.entityId); }
                }} />;
            })}
            {curveDraft?.points.length ? <g data-testid="sketch-curve-draft" pointerEvents="none">
              {((curveDraft.tool === "controlSpline" || curveDraft.tool === "interpolatingSpline") && !curvePreviewReady) && (
                <polyline points={curveDraft.points.map(point => {
                  const [px, py] = toClient(point.x, point.y);
                  return `${px},${py}`;
                }).join(" ")} fill="none" stroke="#f5cc62" strokeWidth={2} strokeDasharray="4 3" />
              )}
              {curveDraft.points.map(point => {
                const [px, py] = toClient(point.x, point.y);
                return <circle key={point.id} cx={px} cy={py} r={3.5} fill="#f5cc62" />;
              })}
            </g> : null}
            {model?.lines.map((l, index) => {
              const a = pointById(l.p1);
              const b = pointById(l.p2);
              if (!a || !b) return null;
              const [x1, y1] = toClient(a.x, a.y);
              const [x2, y2] = toClient(b.x, b.y);
              const selected = selectedLineIds.includes(l.id);
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
                    stroke={selected ? "#f4d06f" : "#9cc2ff"}
                    strokeWidth={selected ? 3.5 : 2}
                  />
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={14}
                    pointerEvents={curveTool ? "none" : "stroke"} role="button" tabIndex={curveTool ? -1 : 0}
                    aria-pressed={selected} aria-disabled={Boolean(curveTool)}
                    aria-label={tt("sketch.lineTools.segment", { n: index + 1 })}
                    data-testid={`sketch-line-hit-${l.id}`} data-selected={selected}
                    onPointerEnter={() => setHoveredLineId(l.id)}
                    onPointerLeave={() => setHoveredLineId(current => current === l.id ? null : current)}
                    onClick={event => {
                      event.stopPropagation();
                      if (curveToolRef.current) return;
                      activateLineTools();
                      setSelectedLineIds(current => current.includes(l.id)
                        ? current.filter(id => id !== l.id) : [...current, l.id]);
                    }}
                    onKeyDown={event => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();
                        if (curveToolRef.current) return;
                        activateLineTools();
                        setSelectedLineIds(current => current.includes(l.id)
                          ? current.filter(id => id !== l.id) : [...current, l.id]);
                      }
                    }} />
                  {horiz && (selected || hoveredLineId === l.id) && (
                    <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 6} fill="#7ee2a8" fontSize={11} textAnchor="middle" pointerEvents="none">
                      {t("sk.badgeH")}
                    </text>
                  )}
                </g>
              );
            })}
            {trimPreviewCandidate && model && (() => {
              const target = model.lines.find(line => line.id === trimPreviewCandidate.targetLineId);
              const otherId = target && (target.p1 === trimPreviewCandidate.pointId ? target.p2
                : target.p2 === trimPreviewCandidate.pointId ? target.p1 : null);
              const other = otherId ? pointById(otherId) : null;
              if (!other) return null;
              const [x1, y1] = toClient(other.x, other.y);
              const [x2, y2] = toClient(trimPreviewCandidate.x, trimPreviewCandidate.y);
              return <g data-testid="trim-candidate-overlay" pointerEvents="none">
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#f4d06f" strokeWidth={3} strokeDasharray="6 4" />
                <circle cx={x2} cy={y2} r={5} fill="#f4d06f" stroke="#111827" strokeWidth={1.5} />
              </g>;
            })()}
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
              const selectedSplinePoint = selectedSpline?.pointIds.includes(p.id) ?? false;
              // Keep labels inside the canvas: flip anchor near edges.
              const anchor = cx > VIEW - 60 ? "end" : "start";
              const lx = cx > VIEW - 60 ? cx - 8 : cx + 8;
              return (
                <g key={p.id}>
                  <circle
                    cx={cx}
                    cy={cy}
                    r={active || selectedSplinePoint ? 7 : 5}
                    fill={active ? "#ffb020" : selectedSplinePoint ? "#f5cc62" : "#63f5e9"}
                    stroke="var(--kreoda-workspace-bg)"
                    strokeWidth={1.5}
                    style={{ cursor: "grab" }}
                    onPointerDown={onPointDown(p.id)}
                    onPointerMove={onPointMove(p.id)}
                    onPointerUp={onPointUp(p.id)}
                    onPointerEnter={() => setHoveredPointId(p.id)}
                    onPointerLeave={() => setHoveredPointId(current => current === p.id ? null : current)}
                    data-testid={`sk-point-${p.id}`}
                    data-curve-point={selectedSplinePoint ? selectedSpline?.id : undefined}
                  />
                  {(active || (!dragging && hoveredPointId === p.id)) && (
                    <text x={lx} y={cy - 6} fill="rgba(255,255,255,.55)" fontSize={10} textAnchor={anchor} pointerEvents="none">
                      {p.x.toFixed(1)},{p.y.toFixed(1)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          <div
            data-testid="sketch-quote-panel"
            className="max-h-[60vh] min-w-0 overflow-y-auto overflow-x-hidden break-words text-xs text-white/70"
            style={{
              width: stackedWorkspace ? "100%" : `${quoteWidth}px`,
              maxHeight: "60vh",
              overflowY: "auto",
              overflowX: "hidden",
            }}
          >
            <div className="pb-1 text-[11px] uppercase tracking-wide text-white/45">
              {tt("sketch.dims")}
            </div>
            <SketchProjectionPanel sketchId={sketchId} />
            {hasGlobalCurveDisplayError && (
              <div role="status" className="mb-2 rounded bg-amber-950/70 px-2 py-1.5 text-amber-100">
                {tt("sketch.curve.globalDisplayError")}
              </div>
            )}
            {(curveDisplay?.errors ?? []).filter(item => item.entityId).map(item => (
              <div key={item.entityId} role="status" className="mb-1 rounded bg-amber-950/70 px-2 py-1 text-amber-100">
                {tt("sketch.curve.curveError", { message: item.message })} · {item.entityId}
              </div>
            ))}
            {(selectedEllipse || selectedSpline) && model && (
              <section data-testid="sketch-selected-curve" className="mb-3 rounded bg-white/5 p-2">
                <div className="mb-1 text-[11px] uppercase tracking-wide text-white/45">
                  {tt("sketch.curve.selected")} · {selectedCurveId}
                </div>
                <label className="mb-2 flex items-center gap-1.5 text-white/70">
                  <input aria-label={tt("sketch.curve.construction")} type="checkbox" checked={selectedCurveIsConstruction}
                    disabled={busy} onChange={event => void toggleConstruction(selectedCurveId!, event.target.checked)} />
                  {tt("sketch.curve.construction")}
                </label>
                {selectedEllipse && <>
                  <DimensionRow id={`${selectedEllipse.id}:major`} label={tt("sketch.curve.majorRadius")}
                    value={selectedEllipse.majorRadius} onCommit={value => updateEllipse(selectedEllipse.id, { majorRadius: value })} />
                  <DimensionRow id={`${selectedEllipse.id}:minor`} label={tt("sketch.curve.minorRadius")}
                    value={selectedEllipse.minorRadius} onCommit={value => updateEllipse(selectedEllipse.id, { minorRadius: value })} />
                  <DimensionRow id={`${selectedEllipse.id}:rotation`} label={tt("sketch.curve.rotation")}
                    value={selectedEllipse.rotationRad * 180 / Math.PI}
                    onCommit={value => updateEllipse(selectedEllipse.id, { rotationRad: value * Math.PI / 180 })} />
                  {selectedEllipse.arc && <>
                    <DimensionRow id={`${selectedEllipse.id}:start`} label={tt("sketch.curve.startAngle")}
                      value={selectedEllipse.startAngleRad * 180 / Math.PI}
                      onCommit={value => updateEllipse(selectedEllipse.id, { startAngleRad: value * Math.PI / 180 })} />
                    <DimensionRow id={`${selectedEllipse.id}:sweep`} label={tt("sketch.curve.sweepAngle")}
                      value={(selectedEllipse.endAngleRad - selectedEllipse.startAngleRad) * 180 / Math.PI}
                      onCommit={value => updateEllipse(selectedEllipse.id, { endAngleRad: selectedEllipse.startAngleRad + value * Math.PI / 180 })} />
                  </>}
                  <div className="flex flex-wrap gap-1">
                    <button type="button" disabled={busy || model.constraints.some(c => c.kind === "ellipseMajorRadius" && c.refs[0] === selectedEllipse.id)}
                      onClick={() => void setEllipseDimension(selectedEllipse.id, "ellipseMajorRadius")}
                      className="rounded bg-slate-700 px-2 py-1 disabled:opacity-40">{tt("sketch.curve.addMajorDimension")}</button>
                    <button type="button" disabled={busy || model.constraints.some(c => c.kind === "ellipseMinorRadius" && c.refs[0] === selectedEllipse.id)}
                      onClick={() => void setEllipseDimension(selectedEllipse.id, "ellipseMinorRadius")}
                      className="rounded bg-slate-700 px-2 py-1 disabled:opacity-40">{tt("sketch.curve.addMinorDimension")}</button>
                  </div>
                </>}
                {selectedSpline && <>
                  <div className="mb-2 text-white/65">
                    {selectedSpline.controlPoints ? tt("sketch.curve.controlSpline") : tt("sketch.curve.interpolatingSpline")}
                    {selectedSpline.closed ? ` · ${tt("sketch.curve.closed")}` : ""}
                  </div>
                  {selectedSpline.pointIds.map((pointId, index) => {
                    const point = model.points.find(item => item.id === pointId);
                    if (!point) return null;
                    return <div key={pointId} data-testid={`sketch-spline-point-${pointId}`}>
                      <DimensionRow id={`${pointId}:x`} label={`${pointId} · X (mm)`} value={point.x}
                        onCommit={value => editSplinePoint(pointId, value, point.y)} />
                      <DimensionRow id={`${pointId}:y`} label={`${pointId} · Y (mm)`} value={point.y}
                        onCommit={value => editSplinePoint(pointId, point.x, value)} />
                      {index < selectedSpline.pointIds.length - 1 && <div className="border-b border-white/10" />}
                    </div>;
                  })}
                </>}
              </section>
            )}
            {model?.constraints
              .filter(
                (c) =>
                  c.kind === "distance" ||
                  c.kind === "radius" ||
                  c.kind === "diameter" ||
                  c.kind === "ellipseMajorRadius" ||
                  c.kind === "ellipseMinorRadius",
              )
              .map((c) => (
                <DimensionRow
                  key={c.id}
                  id={c.id}
                  label={
                    c.kind === "distance"
                      ? `${t("sk.dist")} ${c.refs.join("–")}`
                      : c.kind === "ellipseMajorRadius"
                        ? `${tt("sketch.curve.majorRadius")} · ${c.refs[0]}`
                        : c.kind === "ellipseMinorRadius"
                          ? `${tt("sketch.curve.minorRadius")} · ${c.refs[0]}`
                          : `${sketchKindName(c.kind)} ${c.refs.join(",")}`
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
              {tt("sketch.constraints", { n: model?.constraints.length ?? 0 })}
              {beginnerMode && (
                <button
                  onClick={() => setShowDetails((v) => !v)}
                  aria-expanded={showDetails}
                  className="ml-2 rounded px-1.5 py-0.5 normal-case text-white/60 hover:bg-white/10 hover:text-white"
                >
                  {showDetails ? tt("common.hideDetails") : tt("common.details")}
                </button>
              )}
            </div>
            <div data-testid="sketch-symmetric-tool" className="mt-2 flex flex-wrap gap-1">
              <select aria-label="Primo punto simmetrico" value={symPointA} onChange={e => setSymPointA(e.target.value)} className="bg-slate-800 p-1">
                <option value="">Punto A</option>{model?.points.map(p => <option key={p.id} value={p.id}>{p.id}</option>)}
              </select>
              <select aria-label="Secondo punto simmetrico" value={symPointB} onChange={e => setSymPointB(e.target.value)} className="bg-slate-800 p-1">
                <option value="">Punto B</option>{model?.points.map(p => <option key={p.id} value={p.id}>{p.id}</option>)}
              </select>
              <select aria-label="Linea asse di simmetria" value={symAxis} onChange={e => setSymAxis(e.target.value)} className="bg-slate-800 p-1">
                <option value="">Linea asse</option>{model?.lines.map(l => <option key={l.id} value={l.id}>{l.id}</option>)}
              </select>
              <button type="button" disabled={!model || !symPointA || !symPointB || symPointA === symPointB || !symAxis}
                onClick={() => { if (!model) return;
                  try { void commitModel(addSymmetricConstraint(model, uid("symmetric"), symPointA, symPointB, symAxis)); }
                  catch (e) { setError(e instanceof Error ? e.message : String(e)); }
                }} className="rounded bg-slate-700 px-2 py-1 disabled:opacity-40">Aggiungi simmetria</button>
            </div>
            {(!beginnerMode || showDetails) && (
            <div className="max-h-48 overflow-auto font-mono text-[11px] text-white/55">
              {(model?.constraints ?? []).map((c) => (
                <div key={c.id}>
                  {sketchKindName(c.kind)} {c.refs.join(",")}
                  {c.kind === "distance" || c.kind === "radius" ? ` = ${c.value}` : ""}
                </div>
              ))}
            </div>
            )}
            {inference && (
              <div className="pt-2 text-amber-200">{tt("sketch.inference", { s: inference })}</div>
            )}
            <div className="pt-2 text-white/45">
              {tt("sketch.dragHint")}
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

async function refreshSummary(sketchId: string, canApply: () => boolean = () => true,
  context?: SketchCommandContext): Promise<void> {
  try {
    const full = await coreClient.requestSketch(sketchId, context);
    if (!canApply()) return;
    const state = useDocumentUiStore.getState();
    if (!canApply() || full.revision < state.revision) return;
    state.setFeatures(state.features, full.revision, state.epoch);
    state.setSketches([...state.sketches.filter(item => item.featureId !== sketchId), {
      featureId: sketchId,
      planeKind: full.planeKind,
      plane: full.plane,
      supportRef: full.supportRef,
      points: full.points.length,
      lines: full.lines.length,
      circles: full.circles.length,
      constraints: full.constraints.length,
      projectionGroups: full.projectionGroups,
      geometryCurrent: full.geometryCurrent,
      status: full.status,
      error: full.error,
      blockingSourceIds: full.blockingSourceIds,
      model: full,
    }], full.revision, state.epoch);
  } catch {
    // Summary refresh is best-effort; the editor already shows solved state.
  }
}
