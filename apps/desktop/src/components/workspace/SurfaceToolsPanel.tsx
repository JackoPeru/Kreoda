import { useEffect, useMemo, useRef, useState } from "react";
import { COMMANDS } from "@kreoda/command-schema";
import { parseAngleToDeg, parseLengthToMm } from "@kreoda/units";
import type { SurfacePointResolveRequest, SurfacePointResolveResult } from "@kreoda/protocol";
import { executeCommand, refreshSurfaceSnapshot } from "../../commands/execute";
import { surfaceCommandIds, type SurfaceCommandContext, type SurfaceCommandId } from "../../commands/surface-commands";
import { commandText } from "../../i18n/commands";
import { featureTypeName, useT } from "../../i18n";
import { buildTreeItems, surfaceFeatureIds, useDocumentUiStore, useSelectionStore } from "../../stores";
import { coreClient } from "../../ipc/coreClient";
import {
  viewportBeginSurfaceEdgePick,
  viewportBeginSurfacePointPick,
  viewportCancelSurfacePick,
  viewportSetSurfaceEdgeHighlight,
  viewportSetSurfacePointMarker,
} from "../../viewport/viewportHandle";

type SourceOption = { id: string; label: string };
type RefreshFailure = { context: SurfaceCommandContext; featureId: string; message: string };
type PointAcquisition = { result: SurfacePointResolveResult; context: SurfaceCommandContext };
type EdgeAcquisition = {
  boundaryEdge: { type: "edge"; featureId: string; persistentEdgeId: string };
  context: SurfaceCommandContext;
};

function healthy(source: { geometryCurrent?: boolean; status?: string; error?: string; blockingSourceIds?: string[] }): boolean {
  return source.geometryCurrent !== false && (source.status === undefined || source.status === "ok") &&
    !source.error?.trim() && !source.blockingSourceIds?.length;
}

function orderedOptions(items: { id: string; name: string }[]): SourceOption[] {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.name, (counts.get(item.name) ?? 0) + 1);
  const ordinals = new Map<string, number>();
  return items.map(item => {
    const ordinal = (ordinals.get(item.name) ?? 0) + 1;
    ordinals.set(item.name, ordinal);
    return { id: item.id, label: counts.get(item.name)! > 1 ? `${item.name} (${ordinal})` : item.name };
  });
}

function flattenTree(items: ReturnType<typeof buildTreeItems>, result = new Map<string, string>()): Map<string, string> {
  for (const item of items) {
    result.set(item.id, item.name);
    if (item.children) flattenTree(item.children, result);
  }
  return result;
}

function finiteNumber(value: string, label: string): number {
  if (!value.trim()) throw new Error(label);
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(label);
  return number;
}

function positiveLength(value: string, min: number, max: number): boolean {
  try {
    const parsed = parseLengthToMm(value);
    return Number.isFinite(parsed) && parsed >= min && parsed <= max;
  } catch {
    return false;
  }
}

function moved<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (index < 0 || target < 0 || target >= items.length) return items;
  const copy = [...items];
  [copy[index], copy[target]] = [copy[target]!, copy[index]!];
  return copy;
}

export function SurfaceToolsPanel({ open, onClose, returnFocus }: {
  open: boolean;
  onClose: () => void;
  returnFocus?: () => void;
}) {
  const t = useT();
  const documentId = useDocumentUiStore(s => s.documentId);
  const revision = useDocumentUiStore(s => s.revision);
  const epoch = useDocumentUiStore(s => s.epoch);
  const connectionGeneration = useDocumentUiStore(s => s.connectionGeneration);
  const coreRunning = useDocumentUiStore(s => s.coreRunning);
  const features = useDocumentUiStore(s => s.features);
  const sketches = useDocumentUiStore(s => s.sketches);
  const bodies = useDocumentUiStore(s => s.bodies);
  const datums = useDocumentUiStore(s => s.datums);

  const [operation, setOperation] = useState<SurfaceCommandId>("CreateSurfaceExtrude");
  const [extrudeSketch, setExtrudeSketch] = useState("");
  const [extrudeDistance, setExtrudeDistance] = useState("10 mm");
  const [revolveSketch, setRevolveSketch] = useState("");
  const [revolveAngle, setRevolveAngle] = useState("360 deg");
  const [axisMode, setAxisMode] = useState<"X" | "Y" | "Z" | "custom">("X");
  const [originX, setOriginX] = useState("0 mm");
  const [originY, setOriginY] = useState("0 mm");
  const [originZ, setOriginZ] = useState("0 mm");
  const [axisX, setAxisX] = useState("1");
  const [axisY, setAxisY] = useState("0");
  const [axisZ, setAxisZ] = useState("0");
  const [loftSketches, setLoftSketches] = useState<string[]>([]);
  const [loftAdd, setLoftAdd] = useState("");
  const [sewSurfaces, setSewSurfaces] = useState<string[]>([]);
  const [sewAdd, setSewAdd] = useState("");
  const [sewTolerance, setSewTolerance] = useState("0.01 mm");
  const [makeSolid, setMakeSolid] = useState(false);
  const [offsetSurface, setOffsetSurface] = useState("");
  const [offsetDistance, setOffsetDistance] = useState("1 mm");
  const [offsetTolerance, setOffsetTolerance] = useState("0.000001 mm");
  const [thickenSurface, setThickenSurface] = useState("");
  const [thickness, setThickness] = useState("1 mm");
  const [thickenTolerance, setThickenTolerance] = useState("0.000001 mm");
  const [trimTarget, setTrimTarget] = useState("");
  const [trimTool, setTrimTool] = useState("");
  const [trimPointX, setTrimPointX] = useState("0 mm");
  const [trimPointY, setTrimPointY] = useState("0 mm");
  const [trimPointZ, setTrimPointZ] = useState("0 mm");
  const [trimTolerance, setTrimTolerance] = useState("0.000001 mm");
  const [pointState, setPointState] = useState<"idle" | "capturing" | "resolving" | "resolved" | "failed">("idle");
  const [pointAcquisition, setPointAcquisition] = useState<PointAcquisition | null>(null);
  const [extendTarget, setExtendTarget] = useState("");
  const [extendDistance, setExtendDistance] = useState("10 mm");
  const [extendTolerance, setExtendTolerance] = useState("0.000001 mm");
  const [edgeState, setEdgeState] = useState<"idle" | "capturing" | "selected">("idle");
  const [edgeAcquisition, setEdgeAcquisition] = useState<EdgeAcquisition | null>(null);
  const [sweepProfile, setSweepProfile] = useState("");
  const [sweepPath, setSweepPath] = useState("");
  const [sweepTolerance, setSweepTolerance] = useState("0.000001 mm");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [refreshFailure, setRefreshFailure] = useState<RefreshFailure | null>(null);

  const operationRef = useRef<HTMLSelectElement>(null);
  const wasOpen = useRef(false);
  const prefilled = useRef(false);
  const mounted = useRef(true);
  const busyRef = useRef(false);
  const requestToken = useRef(0);
  const activeRequest = useRef<symbol | null>(null);
  const acquisitionToken = useRef(0);
  const previousLineage = useRef({ documentId, epoch, connectionGeneration, coreRunning });
  const previousPointContext = useRef({ documentId, revision, epoch, connectionGeneration, coreRunning });

  const surfaceIds = useMemo(() => surfaceFeatureIds(features), [features]);
  const treeNames = useMemo(() => flattenTree(buildTreeItems(features, sketches, bodies, datums)), [features, sketches, bodies, datums]);
  const sketchOptions = useMemo(() => orderedOptions(sketches.filter(healthy).map(sketch => ({
    id: sketch.featureId,
    name: treeNames.get(sketch.featureId) ?? t("surface.sketchName"),
  }))), [sketches, treeNames, t]);
  const surfaceOptions = useMemo(() => orderedOptions(features.filter(feature =>
    surfaceIds.has(feature.featureId) && feature.type !== "SurfaceSewnSolid" && feature.type !== "SurfaceFaceThicken" && healthy(feature),
  ).map(feature => ({
    id: feature.featureId,
    name: treeNames.get(feature.featureId) ?? featureTypeName(feature.type),
  }))), [features, surfaceIds, treeNames, t]);
  const sketchIds = useMemo(() => new Set(sketchOptions.map(option => option.id)), [sketchOptions]);
  const selectableSurfaceIds = useMemo(() => new Set(surfaceOptions.map(option => option.id)), [surfaceOptions]);
  const trimSurfaceOptions = surfaceOptions;
  const trimSurfaceIds = selectableSurfaceIds;
  const datumPlaneOptions = useMemo(() => orderedOptions(datums.filter(datum =>
    datum.kind === "DatumPlane" && datum.status === "ok" && !datum.error?.trim(),
  ).map(datum => ({ id: datum.featureId, name: t("surface.datumPlane") }))), [datums, t]);
  const trimToolOptions = useMemo(() => orderedOptions([
    ...trimSurfaceOptions.filter(option => option.id !== trimTarget).map(option => ({ id: option.id, name: option.label })),
    ...datumPlaneOptions.map(option => ({ id: option.id, name: option.label })),
  ]), [trimSurfaceOptions, trimTarget, datumPlaneOptions]);
  const trimToolIds = useMemo(() => new Set(trimToolOptions.map(option => option.id)), [trimToolOptions]);

  const invalidateAcquisitions = (): void => {
    acquisitionToken.current++;
    viewportCancelSurfacePick();
    viewportSetSurfacePointMarker(null);
    viewportSetSurfaceEdgeHighlight(null);
    setPointAcquisition(null);
    setEdgeAcquisition(null);
    setPointState("idle");
    setEdgeState("idle");
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestToken.current++;
      acquisitionToken.current++;
      viewportCancelSurfacePick();
      viewportSetSurfacePointMarker(null);
      viewportSetSurfaceEdgeHighlight(null);
    };
  }, []);

  useEffect(() => {
    const previous = previousLineage.current;
    const documentChanged = previous.documentId !== documentId || previous.epoch !== epoch;
    const changed = previous.documentId !== documentId || previous.epoch !== epoch ||
      previous.connectionGeneration !== connectionGeneration || previous.coreRunning !== coreRunning;
    previousLineage.current = { documentId, epoch, connectionGeneration, coreRunning };
    if (!changed) return;
    requestToken.current++;
    acquisitionToken.current++;
    viewportCancelSurfacePick();
    viewportSetSurfacePointMarker(null);
    viewportSetSurfaceEdgeHighlight(null);
    activeRequest.current = null;
    busyRef.current = false;
    setBusy(false);
    setRefreshFailure(null);
    setError("");
    setStatus("");
    if (documentChanged) {
      prefilled.current = false;
      setOperation("CreateSurfaceExtrude");
      setExtrudeSketch("");
      setExtrudeDistance("10 mm");
      setRevolveSketch("");
      setRevolveAngle("360 deg");
      setAxisMode("X");
      setOriginX("0 mm");
      setOriginY("0 mm");
      setOriginZ("0 mm");
      setAxisX("1");
      setAxisY("0");
      setAxisZ("0");
      setLoftSketches([]);
      setLoftAdd("");
      setSewSurfaces([]);
      setSewAdd("");
      setSewTolerance("0.01 mm");
      setMakeSolid(false);
      setOffsetSurface("");
      setOffsetDistance("1 mm");
      setOffsetTolerance("0.000001 mm");
      setThickenSurface("");
      setThickness("1 mm");
      setThickenTolerance("0.000001 mm");
      setTrimTarget("");
      setTrimTool("");
      setTrimPointX("0 mm");
      setTrimPointY("0 mm");
      setTrimPointZ("0 mm");
      setTrimTolerance("0.000001 mm");
      setPointAcquisition(null);
      setPointState("idle");
      setExtendTarget("");
      setExtendDistance("10 mm");
      setExtendTolerance("0.000001 mm");
      setEdgeAcquisition(null);
      setEdgeState("idle");
      setSweepProfile("");
      setSweepPath("");
      setSweepTolerance("0.000001 mm");
    }
    if (wasOpen.current) onClose();
  }, [documentId, epoch, connectionGeneration, coreRunning, onClose]);

  useEffect(() => {
    const previous = previousPointContext.current;
    const changed = previous.documentId !== documentId || previous.revision !== revision ||
      previous.epoch !== epoch || previous.connectionGeneration !== connectionGeneration || previous.coreRunning !== coreRunning;
    previousPointContext.current = { documentId, revision, epoch, connectionGeneration, coreRunning };
    if (!changed) return;
    acquisitionToken.current++;
    viewportCancelSurfacePick();
    viewportSetSurfacePointMarker(null);
    viewportSetSurfaceEdgeHighlight(null);
    setPointAcquisition(null);
    setEdgeAcquisition(null);
    setPointState("idle");
    setEdgeState("idle");
  }, [documentId, revision, epoch, connectionGeneration, coreRunning]);

  useEffect(() => {
    if (open && !wasOpen.current) {
      operationRef.current?.focus();
      if (!prefilled.current) {
        const selected = useSelectionStore.getState().selectedIds;
        const selectedSketches = selected.filter(id => sketchIds.has(id));
        const selectedSurfaces = selected.filter(id => selectableSurfaceIds.has(id));
        if (selectedSketches.length === 1) {
          setExtrudeSketch(selectedSketches[0]!);
          setRevolveSketch(selectedSketches[0]!);
        }
        if (selectedSketches.length >= 2 && selectedSketches.length <= 128) setLoftSketches(selectedSketches);
        if (selectedSketches.length === 2) {
          setSweepProfile(selectedSketches[0]!);
          setSweepPath(selectedSketches[1]!);
        }
        if (selectedSurfaces.length >= 1 && selectedSurfaces.length <= 128) setSewSurfaces(selectedSurfaces);
        if (selectedSurfaces.length === 1) {
          setOffsetSurface(selectedSurfaces[0]!);
          setThickenSurface(selectedSurfaces[0]!);
          if (trimSurfaceIds.has(selectedSurfaces[0]!)) setTrimTarget(selectedSurfaces[0]!);
          setExtendTarget(selectedSurfaces[0]!);
        }
        prefilled.current = true;
      }
    } else if (!open && wasOpen.current) {
      requestToken.current++;
      invalidateAcquisitions();
      if (!busyRef.current) returnFocus?.();
    }
    wasOpen.current = open;
  }, [open, sketchIds, selectableSurfaceIds, trimSurfaceIds, returnFocus]);

  useEffect(() => {
    if (!open) return;
    const keydown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || busyRef.current) return;
      event.preventDefault();
      invalidateAcquisitions();
      onClose();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [open, onClose, returnFocus]);

  useEffect(() => {
    let cleared = false;
    if (extrudeSketch && !sketchIds.has(extrudeSketch)) { setExtrudeSketch(""); cleared = true; }
    if (revolveSketch && !sketchIds.has(revolveSketch)) { setRevolveSketch(""); cleared = true; }
    if (sweepProfile && !sketchIds.has(sweepProfile)) { setSweepProfile(""); cleared = true; }
    if (sweepPath && !sketchIds.has(sweepPath)) { setSweepPath(""); cleared = true; }
    if (loftSketches.some(id => !sketchIds.has(id))) {
      setLoftSketches(ids => ids.filter(id => sketchIds.has(id)));
      cleared = true;
    }
    if (loftAdd && !sketchIds.has(loftAdd)) { setLoftAdd(""); cleared = true; }
    if (offsetSurface && !selectableSurfaceIds.has(offsetSurface)) { setOffsetSurface(""); cleared = true; }
    if (thickenSurface && !selectableSurfaceIds.has(thickenSurface)) { setThickenSurface(""); cleared = true; }
    if (trimTarget && !trimSurfaceIds.has(trimTarget)) { setTrimTarget(""); cleared = true; }
    if (trimTool && !trimToolIds.has(trimTool)) { setTrimTool(""); cleared = true; }
    if (extendTarget && !selectableSurfaceIds.has(extendTarget)) { setExtendTarget(""); cleared = true; }
    if (sewSurfaces.some(id => !selectableSurfaceIds.has(id))) {
      setSewSurfaces(ids => ids.filter(id => selectableSurfaceIds.has(id)));
      cleared = true;
    }
    if (sewAdd && !selectableSurfaceIds.has(sewAdd)) { setSewAdd(""); cleared = true; }
    if (cleared) {
      invalidateAcquisitions();
      setError(t("surface.referenceCleared"));
    }
  }, [sketchIds, selectableSurfaceIds, trimSurfaceIds, trimToolIds, extrudeSketch, revolveSketch, sweepProfile, sweepPath,
    loftSketches, loftAdd, offsetSurface, thickenSurface, trimTarget, trimTool, extendTarget, sewSurfaces, sewAdd, t]);

  const captureContext = (): SurfaceCommandContext => ({ documentId, revision, epoch, connectionGeneration });
  const isCurrent = (captured: SurfaceCommandContext): boolean => {
    const state = useDocumentUiStore.getState();
    return mounted.current && state.coreRunning && coreClient.documentId === captured.documentId && state.documentId === captured.documentId &&
      state.epoch === captured.epoch && state.connectionGeneration === captured.connectionGeneration;
  };
  const isAcquisitionCurrent = (captured: SurfaceCommandContext): boolean =>
    isCurrent(captured) && useDocumentUiStore.getState().revision === captured.revision;
  const captureSessionContext = async (captured: SurfaceCommandContext): Promise<SurfaceCommandContext> => {
    const readSession = window.kreoda?.sessionSnapshot;
    if (!readSession) throw new Error(t("surface.stale"));
    const session = await readSession();
    if (!isAcquisitionCurrent(captured) || session.documentId !== captured.documentId ||
        session.revision !== captured.revision || typeof session.sessionId !== "string" || !session.sessionId) {
      throw new Error(t("surface.stale"));
    }
    return { ...captured, sessionId: session.sessionId };
  };
  const optionLabel = (options: SourceOption[], id: string): string => options.find(option => option.id === id)?.label ?? "";
  const currentCommand = COMMANDS.find(command => command.id === operation)!;
  const commandLabels = commandText(operation, currentCommand);
  const resolveTrimPoint = async (request: SurfacePointResolveRequest, captured: SurfaceCommandContext, token: number): Promise<void> => {
    setPointState("resolving");
    setError("");
    try {
      const acquired = await coreClient.resolveSurfacePoint(request, captured);
      if (token !== acquisitionToken.current || !mounted.current) return;
      if (!isAcquisitionCurrent(acquired.context) || acquired.result.keepFace.featureId !== request.targetId) {
        throw new Error(t("surface.stale"));
      }
      setPointAcquisition(acquired);
      setPointState("resolved");
      viewportSetSurfacePointMarker(acquired.result.pointMm);
    } catch (cause) {
      if (token !== acquisitionToken.current || !mounted.current) return;
      setPointAcquisition(null);
      setPointState("failed");
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const resolveNumericPoint = async (): Promise<void> => {
    if (!trimTarget || !trimSurfaceIds.has(trimTarget)) return;
    invalidateAcquisitions();
    const token = acquisitionToken.current;
    setPointState("resolving");
    try {
      const captured = await captureSessionContext(captureContext());
      if (token !== acquisitionToken.current || !isAcquisitionCurrent(captured)) return;
      await resolveTrimPoint({
        targetId: trimTarget,
        pointMm: [parseLengthToMm(trimPointX), parseLengthToMm(trimPointY), parseLengthToMm(trimPointZ)],
      }, captured, token);
    } catch (cause) {
      if (token !== acquisitionToken.current || !mounted.current) return;
      setPointState("failed");
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const beginPointPick = async (): Promise<void> => {
    if (pointState === "capturing") {
      invalidateAcquisitions();
      return;
    }
    if (!trimTarget || !trimSurfaceIds.has(trimTarget)) return;
    invalidateAcquisitions();
    const token = acquisitionToken.current;
    const base = captureContext();
    setPointState("capturing");
    setError("");
    try {
      const captured = await captureSessionContext(base);
      if (token !== acquisitionToken.current || !isAcquisitionCurrent(captured)) return;
      const pick = await viewportBeginSurfacePointPick(trimTarget);
      if (token !== acquisitionToken.current || !mounted.current) return;
      if (!pick) { setPointState("idle"); return; }
      if (pick.featureId !== trimTarget || !isAcquisitionCurrent(captured)) throw new Error(t("surface.stale"));
      await resolveTrimPoint({
        targetId: trimTarget,
        pointMm: pick.pointMm,
        persistentFaceId: pick.persistentFaceId,
      }, captured, token);
    } catch (cause) {
      if (token !== acquisitionToken.current || !mounted.current) return;
      setPointState("failed");
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const beginEdgePick = async (): Promise<void> => {
    if (edgeState === "capturing") {
      invalidateAcquisitions();
      return;
    }
    if (!extendTarget || !selectableSurfaceIds.has(extendTarget)) return;
    invalidateAcquisitions();
    const token = acquisitionToken.current;
    const base = captureContext();
    setEdgeState("capturing");
    setError("");
    try {
      const captured = await captureSessionContext(base);
      if (token !== acquisitionToken.current || !isAcquisitionCurrent(captured)) return;
      const pick = await viewportBeginSurfaceEdgePick(extendTarget);
      if (token !== acquisitionToken.current || !mounted.current) return;
      if (!pick) { setEdgeState("idle"); return; }
      if (pick.featureId !== extendTarget || !isAcquisitionCurrent(captured)) throw new Error(t("surface.stale"));
      const acquired: EdgeAcquisition = {
        boundaryEdge: { type: "edge", featureId: pick.featureId, persistentEdgeId: pick.persistentEdgeId },
        context: captured,
      };
      setEdgeAcquisition(acquired);
      setEdgeState("selected");
      viewportSetSurfaceEdgeHighlight(pick.persistentEdgeId);
    } catch (cause) {
      if (token !== acquisitionToken.current || !mounted.current) return;
      setEdgeState("idle");
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const hasSources = (() => {
    switch (operation) {
      case "CreateSurfaceExtrude": return !!extrudeSketch && sketchIds.has(extrudeSketch);
      case "CreateSurfaceRevolve": return !!revolveSketch && sketchIds.has(revolveSketch);
      case "CreateSurfaceLoft": return loftSketches.length >= 2 && loftSketches.every(id => sketchIds.has(id));
      case "CreateSurfaceSew": return sewSurfaces.length > 0 && sewSurfaces.every(id => selectableSurfaceIds.has(id));
      case "CreateSurfaceOffset": return !!offsetSurface && selectableSurfaceIds.has(offsetSurface);
      case "CreateSurfaceThicken": return !!thickenSurface && selectableSurfaceIds.has(thickenSurface);
      case "CreateSurfaceTrim": return !!trimTarget && trimSurfaceIds.has(trimTarget) && !!trimTool && trimTool !== trimTarget &&
        trimToolIds.has(trimTool) && !!pointAcquisition && pointAcquisition.result.keepFace.featureId === trimTarget &&
        isAcquisitionCurrent(pointAcquisition.context) && positiveLength(trimTolerance, 1e-7, 1);
      case "CreateSurfaceExtend": return !!extendTarget && selectableSurfaceIds.has(extendTarget) && !!edgeAcquisition &&
        edgeAcquisition.boundaryEdge.featureId === extendTarget && isAcquisitionCurrent(edgeAcquisition.context) &&
        positiveLength(extendDistance, 1e-6, 100000) && positiveLength(extendTolerance, 1e-7, 1);
      case "CreateSurfaceSweep": return !!sweepProfile && !!sweepPath && sweepProfile !== sweepPath && sketchIds.has(sweepProfile) && sketchIds.has(sweepPath);
    }
  })();

  const params = (): Record<string, unknown> => {
    switch (operation) {
      case "CreateSurfaceExtrude":
        return { sketchId: extrudeSketch, distanceMm: parseLengthToMm(extrudeDistance) };
      case "CreateSurfaceRevolve": {
        const principal = axisMode === "X" ? [1, 0, 0] : axisMode === "Y" ? [0, 1, 0] : axisMode === "Z" ? [0, 0, 1] : null;
        return {
          sketchId: revolveSketch,
          angleDeg: parseAngleToDeg(revolveAngle),
          axisOriginXMm: parseLengthToMm(originX),
          axisOriginYMm: parseLengthToMm(originY),
          axisOriginZMm: parseLengthToMm(originZ),
          axisX: principal?.[0] ?? finiteNumber(axisX, t("surface.invalidNumber")),
          axisY: principal?.[1] ?? finiteNumber(axisY, t("surface.invalidNumber")),
          axisZ: principal?.[2] ?? finiteNumber(axisZ, t("surface.invalidNumber")),
        };
      }
      case "CreateSurfaceLoft": return { sketchIds: loftSketches };
      case "CreateSurfaceSew": return { featureIds: sewSurfaces, toleranceMm: parseLengthToMm(sewTolerance), makeSolid };
      case "CreateSurfaceOffset": return { targetId: offsetSurface, distanceMm: parseLengthToMm(offsetDistance), toleranceMm: parseLengthToMm(offsetTolerance) };
      case "CreateSurfaceThicken": return { targetId: thickenSurface, thicknessMm: parseLengthToMm(thickness), toleranceMm: parseLengthToMm(thickenTolerance) };
      case "CreateSurfaceTrim": {
        if (!pointAcquisition) throw new Error(t("surface.stale"));
        return {
          targetId: trimTarget, toolId: trimTool,
          keepFace: pointAcquisition.result.keepFace, keepUv: pointAcquisition.result.keepUv,
          toleranceMm: parseLengthToMm(trimTolerance),
        };
      }
      case "CreateSurfaceExtend": {
        if (!edgeAcquisition) throw new Error(t("surface.stale"));
        return {
          targetId: extendTarget, boundaryEdge: edgeAcquisition.boundaryEdge,
          distanceMm: parseLengthToMm(extendDistance), toleranceMm: parseLengthToMm(extendTolerance),
        };
      }
      case "CreateSurfaceSweep": return { profileSketchId: sweepProfile, pathSketchId: sweepPath, toleranceMm: parseLengthToMm(sweepTolerance) };
    }
  };

  const relevant = (token: number, captured: SurfaceCommandContext): boolean => token === requestToken.current && isCurrent(captured);
  const selectIfPresent = (featureId: string): void => {
    if (useDocumentUiStore.getState().features.some(feature => feature.featureId === featureId)) {
      useSelectionStore.getState().select(featureId, false);
    }
  };

  const create = async (): Promise<void> => {
    if (busyRef.current || refreshFailure || !hasSources) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setStatus("");
    const token = ++requestToken.current;
    const owner = Symbol("surface-create");
    activeRequest.current = owner;
    const captured = operation === "CreateSurfaceTrim" ? pointAcquisition!.context
      : operation === "CreateSurfaceExtend" ? edgeAcquisition!.context
      : captureContext();
    try {
      const result = await executeCommand(operation, params(), { surfaceContext: captured });
      if (result.kind !== "created" || !isCurrent(captured)) return;
      if (operation === "CreateSurfaceTrim") {
        acquisitionToken.current++;
        setPointAcquisition(null);
        setPointState("idle");
        viewportSetSurfacePointMarker(null);
      } else if (operation === "CreateSurfaceExtend") {
        acquisitionToken.current++;
        setEdgeAcquisition(null);
        setEdgeState("idle");
        viewportSetSurfaceEdgeHighlight(null);
      }
      if (result.refreshError) {
        setRefreshFailure({ context: captured, featureId: result.feature.featureId, message: result.refreshError });
        if (relevant(token, captured)) setStatus(t(operation === "CreateSurfaceThicken" ? "surface.solidCreated" : "surface.created"));
      } else if (relevant(token, captured)) {
        setRefreshFailure(null);
        setStatus(t(operation === "CreateSurfaceThicken" ? "surface.solidCreated" : "surface.created"));
        selectIfPresent(result.feature.featureId);
      }
    } catch (cause) {
      if (relevant(token, captured)) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (activeRequest.current === owner) {
        activeRequest.current = null;
        busyRef.current = false;
        if (mounted.current) setBusy(false);
      }
    }
  };

  const retryRefresh = async (): Promise<void> => {
    const failure = refreshFailure;
    if (!failure || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    const token = ++requestToken.current;
    const owner = Symbol("surface-refresh");
    activeRequest.current = owner;
    try {
      const snapshot = await refreshSurfaceSnapshot(failure.context);
      if (!relevant(token, failure.context)) return;
      setRefreshFailure(null);
      setStatus(t("surface.refreshSucceeded"));
      if (snapshot.features.some(feature => feature.featureId === failure.featureId)) selectIfPresent(failure.featureId);
    } catch (cause) {
      if (relevant(token, failure.context)) {
        setRefreshFailure({ ...failure, message: cause instanceof Error ? cause.message : String(cause) });
      }
    } finally {
      if (activeRequest.current === owner) {
        activeRequest.current = null;
        busyRef.current = false;
        if (mounted.current) setBusy(false);
      }
    }
  };

  const close = (): void => {
    if (busyRef.current) return;
    invalidateAcquisitions();
    onClose();
  };
  const sourceSelect = (testId: string, label: string, value: string, setValue: (next: string) => void, options: SourceOption[], emptyLabel: string) => (
    <label className="block text-xs text-white/70">{label}
      <select data-testid={testId} aria-label={label} value={value} onChange={event => setValue(event.target.value)}
        className="mt-1 w-full rounded border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-white">
        <option value="">{emptyLabel}</option>
        {options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </label>
  );
  const lengthField = (testId: string, label: string, value: string, setValue: (next: string) => void) => (
    <label className="block text-xs text-white/70">{label}
      <input data-testid={testId} aria-label={label} type="text" inputMode="decimal" value={value}
        onChange={event => setValue(event.target.value)}
        className="mt-1 w-full rounded border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-white" />
    </label>
  );
  const numberedField = (testId: string, label: string, value: string, setValue: (next: string) => void) => (
    <label className="block text-xs text-white/70">{label}
      <input data-testid={testId} aria-label={label} type="number" step="any" min="-1" max="1" value={value}
        onChange={event => setValue(event.target.value)}
        className="mt-1 w-full rounded border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-white" />
    </label>
  );

  if (!open) return null;
  return (
    <aside data-testid="surface-tools-panel" role="complementary" aria-labelledby="surface-tools-title"
      className="kreoda-float-elevated absolute right-3 top-[68px] z-40 flex flex-col overflow-hidden"
      style={{ width: 320, maxWidth: "calc(100vw - 24px)", maxHeight: "calc(100vh - 176px)" }}>
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="min-w-0">
          <h2 id="surface-tools-title" className="text-sm font-semibold text-white">{t("surface.title")}</h2>
          <p className="mt-1 text-[11px] leading-4 text-white/55">{commandLabels.description}</p>
        </div>
        <button type="button" aria-label={t("surface.close")} onClick={close} disabled={busy}
          className="shrink-0 rounded px-1.5 py-0.5 text-white/60 hover:bg-white/10 disabled:opacity-40">×</button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <label className="block text-xs text-white/70">{t("surface.operation")}
          <select ref={operationRef} data-testid="surface-operation" aria-label={t("surface.operation")} value={operation}
            onChange={event => { invalidateAcquisitions(); setOperation(event.target.value as SurfaceCommandId); setError(""); setStatus(""); }}
            className="mt-1 w-full rounded border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-white">
            {surfaceCommandIds.map(id => {
              const definition = COMMANDS.find(command => command.id === id)!;
              const labels = commandText(id, definition);
              return <option key={id} value={id}>{labels.label}</option>;
            })}
          </select>
        </label>

        <div className="mt-3 space-y-3">
          {operation === "CreateSurfaceExtrude" && <>
            <div>{sourceSelect("surface-sketch-source", t("surface.sketchSource"), extrudeSketch, setExtrudeSketch, sketchOptions, t("surface.selectSketch"))}
              {!sketchOptions.length && <p className="mt-1 text-[11px] text-white/45">{t("surface.noSketches")}</p>}</div>
            {lengthField("surface-distance", t("surface.distance"), extrudeDistance, setExtrudeDistance)}
          </>}

          {operation === "CreateSurfaceRevolve" && <>
            <div>{sourceSelect("surface-sketch-source", t("surface.sketchSource"), revolveSketch, setRevolveSketch, sketchOptions, t("surface.selectSketch"))}
              {!sketchOptions.length && <p className="mt-1 text-[11px] text-white/45">{t("surface.noSketches")}</p>}</div>
            {lengthField("surface-angle", t("surface.angle"), revolveAngle, setRevolveAngle)}
            <label className="block text-xs text-white/70">{t("surface.axis")}
              <select data-testid="surface-axis-mode" aria-label={t("surface.axis")} value={axisMode}
                onChange={event => setAxisMode(event.target.value as typeof axisMode)}
                className="mt-1 w-full rounded border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-white">
                <option value="X">{t("surface.axisX")}</option><option value="Y">{t("surface.axisY")}</option>
                <option value="Z">{t("surface.axisZ")}</option><option value="custom">{t("surface.customAxis")}</option>
              </select>
            </label>
            <details>
              <summary data-testid="surface-advanced-summary" className="cursor-pointer text-xs text-white/60">{t("surface.advancedAxis")}</summary>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {lengthField("surface-origin-x", t("surface.originX"), originX, setOriginX)}
                {lengthField("surface-origin-y", t("surface.originY"), originY, setOriginY)}
                {lengthField("surface-origin-z", t("surface.originZ"), originZ, setOriginZ)}
              </div>
              {axisMode === "custom" && <div className="mt-2 grid grid-cols-3 gap-2">
                {numberedField("surface-axis-x", t("surface.directionX"), axisX, setAxisX)}
                {numberedField("surface-axis-y", t("surface.directionY"), axisY, setAxisY)}
                {numberedField("surface-axis-z", t("surface.directionZ"), axisZ, setAxisZ)}
              </div>}
            </details>
          </>}

          {operation === "CreateSurfaceLoft" && <>
            <div className="space-y-2">
              {loftSketches.map((id, index) => <div key={`${id}-${index}`} data-testid={`surface-loft-item-${index}`} className="flex items-center gap-1 rounded bg-white/[0.04] px-2 py-1.5 text-xs text-white/75">
                <span className="min-w-0 flex-1 truncate">{optionLabel(sketchOptions, id)}</span>
                <button type="button" data-testid={`surface-loft-up-${index}`} aria-label={t("surface.moveUp")} disabled={busy || index === 0}
                  onClick={() => setLoftSketches(items => moved(items, index, -1))} className="rounded px-1 text-white/60 disabled:opacity-25">↑</button>
                <button type="button" data-testid={`surface-loft-down-${index}`} aria-label={t("surface.moveDown")} disabled={busy || index === loftSketches.length - 1}
                  onClick={() => setLoftSketches(items => moved(items, index, 1))} className="rounded px-1 text-white/60 disabled:opacity-25">↓</button>
                <button type="button" data-testid={`surface-loft-remove-${index}`} aria-label={t("surface.removeSource")} disabled={busy}
                  onClick={() => setLoftSketches(items => items.filter((_, itemIndex) => itemIndex !== index))} className="rounded px-1 text-white/60 disabled:opacity-25">×</button>
              </div>)}
              {sourceSelect("surface-loft-add-source", t("surface.sketchSource"), loftAdd, setLoftAdd, sketchOptions, t("surface.selectSketch"))}
              <button type="button" data-testid="surface-loft-add" disabled={busy || !loftAdd || loftSketches.length >= 128}
                onClick={() => { if (loftSketches.includes(loftAdd)) setError(t("surface.duplicateSource")); else { setLoftSketches(items => [...items, loftAdd]); setLoftAdd(""); setError(""); } }}
                className="rounded bg-white/10 px-2 py-1 text-xs text-white/80 disabled:opacity-40">{t("surface.addSection")}</button>
              {!!loftAdd && loftSketches.includes(loftAdd) && <p className="text-[11px] text-amber-200/80">{t("surface.duplicateSource")}</p>}
              {!sketchOptions.length && <p className="text-[11px] text-white/45">{t("surface.noSketches")}</p>}
            </div>
          </>}

          {operation === "CreateSurfaceSew" && <>
            <div className="space-y-2">
              {sewSurfaces.map((id, index) => <div key={`${id}-${index}`} data-testid={`surface-sew-item-${index}`} className="flex items-center gap-1 rounded bg-white/[0.04] px-2 py-1.5 text-xs text-white/75">
                <span className="min-w-0 flex-1 truncate">{optionLabel(surfaceOptions, id)}</span>
                <button type="button" data-testid={`surface-sew-up-${index}`} aria-label={t("surface.moveUp")} disabled={busy || index === 0}
                  onClick={() => setSewSurfaces(items => moved(items, index, -1))} className="rounded px-1 text-white/60 disabled:opacity-25">↑</button>
                <button type="button" data-testid={`surface-sew-down-${index}`} aria-label={t("surface.moveDown")} disabled={busy || index === sewSurfaces.length - 1}
                  onClick={() => setSewSurfaces(items => moved(items, index, 1))} className="rounded px-1 text-white/60 disabled:opacity-25">↓</button>
                <button type="button" data-testid={`surface-sew-remove-${index}`} aria-label={t("surface.removeSource")} disabled={busy}
                  onClick={() => setSewSurfaces(items => items.filter((_, itemIndex) => itemIndex !== index))} className="rounded px-1 text-white/60 disabled:opacity-25">×</button>
              </div>)}
              {sourceSelect("surface-sew-add-source", t("surface.surfaceSource"), sewAdd, setSewAdd, surfaceOptions, t("surface.selectSurface"))}
              <button type="button" data-testid="surface-sew-add" disabled={busy || !sewAdd || sewSurfaces.length >= 128}
                onClick={() => { if (sewSurfaces.includes(sewAdd)) setError(t("surface.duplicateSource")); else { setSewSurfaces(items => [...items, sewAdd]); setSewAdd(""); setError(""); } }}
                className="rounded bg-white/10 px-2 py-1 text-xs text-white/80 disabled:opacity-40">{t("surface.addSurface")}</button>
              {!!sewAdd && sewSurfaces.includes(sewAdd) && <p className="text-[11px] text-amber-200/80">{t("surface.duplicateSource")}</p>}
              {!surfaceOptions.length && <p className="text-[11px] text-white/45">{t("surface.noSurfaces")}</p>}
            </div>
            {lengthField("surface-tolerance", t("surface.tolerance"), sewTolerance, setSewTolerance)}
            <label className="flex items-center gap-2 text-xs text-white/70">
              <input data-testid="surface-make-solid" type="checkbox" checked={makeSolid} onChange={event => setMakeSolid(event.target.checked)} />
              {t("surface.makeSolid")}
            </label>
          </>}

          {operation === "CreateSurfaceOffset" && <>
            <div>{sourceSelect("surface-offset-source", t("surface.surfaceSource"), offsetSurface, setOffsetSurface, surfaceOptions, t("surface.selectSurface"))}
              {!surfaceOptions.length && <p className="mt-1 text-[11px] text-white/45">{t("surface.noSurfaces")}</p>}</div>
            {lengthField("surface-distance", t("surface.distance"), offsetDistance, setOffsetDistance)}
            {lengthField("surface-tolerance", t("surface.tolerance"), offsetTolerance, setOffsetTolerance)}
          </>}

          {operation === "CreateSurfaceThicken" && <>
            <div>{sourceSelect("surface-thicken-source", t("surface.surfaceSource"), thickenSurface, setThickenSurface, surfaceOptions, t("surface.selectSurface"))}
              {!surfaceOptions.length && <p className="mt-1 text-[11px] text-white/45">{t("surface.noSurfaces")}</p>}</div>
            {lengthField("surface-thickness", t("surface.thickness"), thickness, setThickness)}
            <p className="text-[11px] leading-4 text-white/45">{t("surface.thickenHint")}</p>
            <details>
              <summary className="cursor-pointer text-xs text-white/60">{t("surface.advancedTolerance")}</summary>
              <div className="mt-2">{lengthField("surface-thicken-tolerance", t("surface.tolerance"), thickenTolerance, setThickenTolerance)}</div>
            </details>
          </>}

          {operation === "CreateSurfaceTrim" && <>
            <div>{sourceSelect("surface-trim-target", t("surface.trimTarget"), trimTarget,
              next => { invalidateAcquisitions(); setTrimTarget(next); setError(""); }, trimSurfaceOptions, t("surface.selectSurface"))}
              {!trimSurfaceOptions.length && <p className="mt-1 text-[11px] text-white/45">{t("surface.noSurfaces")}</p>}</div>
            <div>{sourceSelect("surface-trim-tool", t("surface.trimTool"), trimTool,
              next => { invalidateAcquisitions(); setTrimTool(next); setError(""); }, trimToolOptions, t("surface.selectTrimTool"))}
              {!trimToolOptions.length && <p className="mt-1 text-[11px] text-white/45">{t("surface.noTrimTools")}</p>}</div>
            <div className="space-y-2">
              <div className="flex gap-2">
                <button type="button" data-testid="surface-point-pick" disabled={busy || !trimTarget}
                  onClick={() => void beginPointPick()}
                  className="rounded bg-white/10 px-2 py-1 text-xs text-white/80 disabled:opacity-40">
                  {pointState === "capturing" ? t("surface.cancelPick") : t("surface.choosePoint")}
                </button>
                <button type="button" data-testid="surface-point-resolve" disabled={busy || !trimTarget}
                  onClick={() => void resolveNumericPoint()}
                  className="rounded bg-white/10 px-2 py-1 text-xs text-white/80 disabled:opacity-40">{t("surface.resolvePoint")}</button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {lengthField("surface-point-x", t("surface.pointX"), trimPointX,
                  next => { invalidateAcquisitions(); setTrimPointX(next); })}
                {lengthField("surface-point-y", t("surface.pointY"), trimPointY,
                  next => { invalidateAcquisitions(); setTrimPointY(next); })}
                {lengthField("surface-point-z", t("surface.pointZ"), trimPointZ,
                  next => { invalidateAcquisitions(); setTrimPointZ(next); })}
              </div>
              <p role="status" data-testid="surface-point-state" className="text-[11px] leading-4 text-white/55">
                {pointState === "capturing" ? t("surface.pointCapturing")
                  : pointState === "resolving" ? t("surface.pointResolving")
                  : pointState === "resolved" && pointAcquisition
                    ? t("surface.pointResolved", {
                      x: String(pointAcquisition.result.pointMm[0]),
                      y: String(pointAcquisition.result.pointMm[1]),
                      z: String(pointAcquisition.result.pointMm[2]),
                    })
                  : pointState === "failed" ? t("surface.pointFailed") : t("surface.pointIdle")}
              </p>
            </div>
            <details>
              <summary className="cursor-pointer text-xs text-white/60">{t("surface.advancedTolerance")}</summary>
              <div className="mt-2">{lengthField("surface-trim-tolerance", t("surface.trimTolerance"), trimTolerance, setTrimTolerance)}</div>
            </details>
          </>}

          {operation === "CreateSurfaceExtend" && <>
            <div>{sourceSelect("surface-extend-target", t("surface.extendTarget"), extendTarget,
              next => { invalidateAcquisitions(); setExtendTarget(next); setError(""); }, surfaceOptions, t("surface.selectSurface"))}
              {!surfaceOptions.length && <p className="mt-1 text-[11px] text-white/45">{t("surface.noSurfaces")}</p>}</div>
            <div className="flex gap-2">
              <button type="button" data-testid="surface-edge-pick" disabled={busy || !extendTarget}
                onClick={() => void beginEdgePick()}
                className="rounded bg-white/10 px-2 py-1 text-xs text-white/80 disabled:opacity-40">
                {edgeState === "capturing" ? t("surface.cancelPick") : t("surface.chooseEdge")}
              </button>
              <p role="status" data-testid="surface-edge-state" className="self-center text-[11px] text-white/55">
                {edgeState === "capturing" ? t("surface.edgeCapturing")
                  : edgeState === "selected" ? t("surface.edgeSelected") : t("surface.edgeIdle")}
              </p>
            </div>
            {lengthField("surface-extend-distance", t("surface.extendDistance"), extendDistance, setExtendDistance)}
            <p className="text-[11px] leading-4 text-white/45">{t("surface.extendChordHint")}</p>
            <details>
              <summary className="cursor-pointer text-xs text-white/60">{t("surface.advancedTolerance")}</summary>
              <div className="mt-2">{lengthField("surface-extend-tolerance", t("surface.extendTolerance"), extendTolerance, setExtendTolerance)}</div>
            </details>
          </>}

          {operation === "CreateSurfaceSweep" && <>
            <div>{sourceSelect("surface-profile-sketch", t("surface.profileSketch"), sweepProfile, setSweepProfile, sketchOptions, t("surface.selectSketch"))}
              {!sketchOptions.length && <p className="mt-1 text-[11px] text-white/45">{t("surface.noSketches")}</p>}</div>
            <div>{sourceSelect("surface-path-sketch", t("surface.pathSketch"), sweepPath, setSweepPath, sketchOptions, t("surface.selectSketch"))}</div>
            {lengthField("surface-tolerance", t("surface.tolerance"), sweepTolerance, setSweepTolerance)}
            <p className="text-[11px] leading-4 text-white/45">{t("surface.sweepHint")}</p>
          </>}
        </div>

        {busy && <p role="status" data-testid="surface-busy" className="mt-3 text-xs text-white/60">{t("surface.busy")}</p>}
        {status && <p role="status" data-testid="surface-status" className="mt-3 text-xs text-emerald-200">{status}</p>}
        {error && <p role="alert" data-testid="surface-error" className="mt-3 text-xs text-red-300">{error}</p>}
        {refreshFailure && <div role="alert" data-testid="surface-refresh-warning" className="mt-3 rounded border border-amber-300/20 bg-amber-950/30 p-2 text-xs text-amber-100">
          <p>{t("surface.createdRefreshFailed")}</p><p className="mt-1 break-words text-amber-100/75">{refreshFailure.message}</p>
          <button type="button" data-testid="surface-retry-refresh" disabled={busy} onClick={() => void retryRefresh()}
            className="mt-2 rounded bg-amber-100/10 px-2 py-1 text-amber-50 disabled:opacity-40">{t("surface.retryRefresh")}</button>
        </div>}
      </div>

      <footer className="flex shrink-0 justify-end gap-2 border-t border-white/10 px-4 py-3">
        <button type="button" onClick={close} disabled={busy} className="rounded px-3 py-1.5 text-xs text-white/65 hover:bg-white/10 disabled:opacity-40">{t("surface.close")}</button>
        <button type="button" data-testid="surface-create" onClick={() => void create()} disabled={busy || !hasSources || !!refreshFailure}
          className="rounded bg-cyan-500/80 px-3 py-1.5 text-xs font-medium text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-40">{t("surface.create")}</button>
      </footer>
    </aside>
  );
}
