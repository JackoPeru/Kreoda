import { useEffect, useMemo, useState } from "react";
import { parseLengthToMm } from "@kreoda/units";
import { executeCommand } from "../commands/execute";
import { coreClient } from "../ipc/coreClient";
import { selectionKindOf, useDocumentUiStore, useSelectionStore } from "../stores";
import {
  buildFacePlacement,
  solveEdgeDistances,
  validateHoleCenter,
  type FacePlacement,
  type PlacementError,
  type Point2,
} from "../interaction/holePlacement";
import { CadActions, CadDialog } from "./CadDialog";
import { HolePlacementPreview } from "./HolePlacementPreview";
import { t, useT, featureTypeName, type EnKey } from "../i18n";

const PLACEMENT_MESSAGES: Record<PlacementError, EnKey> = {
  "face-mesh": "hole.errNoPos",
  "face-boundary": "hole.errBoundary",
  "face-planar": "hole.errUnsupportedFace",
  "face-invalid": "hole.errInvalidFrame",
  "point-invalid": "hole.errPointInvalid",
  "point-outside": "hole.errPointOutside",
  "radius-clearance": "hole.errClearance",
  "distance-invalid": "hole.errDistanceInvalid",
  "distance-parallel": "hole.errParallel",
  "distance-incompatible": "hole.errDistanceIncompatible",
  "distance-ambiguous": "hole.errDistanceAmbiguous",
};

function formatMm(value: number): string {
  const rounded = Number(value.toPrecision(7));
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function loadErrorKey(error: unknown): EnKey {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("NOT_PLANAR") || message.includes("no plane frame")) return "hole.errUnsupportedFace";
  if (message.includes("boundary")) return "hole.errBoundary";
  return "hole.errNoFrame";
}

function isPositiveLength(value: string, maxMm = 100000): boolean {
  try {
    const millimeters = parseLengthToMm(value);
    return Number.isFinite(millimeters) && millimeters > 0 && millimeters <= maxMm;
  } catch {
    return false;
  }
}

/** Parametric hole with a face-local placement and trimmed-boundary preview. */
export function HoleDialog({ onClose }: { onClose: () => void }) {
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const features = useDocumentUiStore((s) => s.features);
  const bodies = useDocumentUiStore((s) => s.bodies);
  const faceId = selectedIds.find((id) => selectionKindOf(id) === "face") ?? null;
  const [diameter, setDiameter] = useState("8");
  const [depthMode, setDepthMode] = useState<"throughAll" | "blind">("throughAll");
  const [depth, setDepth] = useState("10");
  const [x, setX] = useState("");
  const [y, setY] = useState("");
  const [editingCoordinate, setEditingCoordinate] = useState<"x" | "y" | null>(null);
  const [placement, setPlacement] = useState<FacePlacement | null>(null);
  const [loadError, setLoadError] = useState<EnKey | null>(null);
  const [selectedEdges, setSelectedEdges] = useState<string[]>([]);
  const [edgeDistances, setEdgeDistances] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tt = useT();

  const target = useMemo(() => {
    if (!faceId) return null;
    const cut = faceId.indexOf(":");
    const bare = faceId.slice(0, cut);
    const feature = features.find((f) => f.featureId === bare);
    if (!feature) return null;
    return { featureId: bare, role: faceId.slice(cut + 1) };
  }, [faceId, features]);

  const history = bodies.find((body) => body.history.includes(target?.featureId ?? ""))?.history ?? [];
  const nextId = target ? history[history.indexOf(target.featureId) + 1] : undefined;
  const next = features.find((feature) => feature.featureId === nextId && feature.dependsOn[0] === target?.featureId);
  const [insertUpstream, setInsertUpstream] = useState(Boolean(next));

  useEffect(() => {
    let current = true;
    setPlacement(null);
    setLoadError(null);
    setSelectedEdges([]);
    setEdgeDistances([]);
    if (!target || !faceId) return () => { current = false; };

    const load = async (): Promise<void> => {
      try {
        const cachedMesh = useDocumentUiStore.getState().meshes[target.featureId];
        const [mesh, frame] = await Promise.all([
          cachedMesh ? Promise.resolve(cachedMesh) : coreClient.requestMesh(target.featureId, 1),
          coreClient.requestFaceInfo(target.featureId, target.role),
        ]);
        if (!current) return;
        const result = buildFacePlacement(mesh, faceId, frame);
        if (!result.ok) {
          setLoadError(PLACEMENT_MESSAGES[result.error]);
          return;
        }
        setPlacement(result.value);
        setX(formatMm(result.value.center.x));
        setY(formatMm(result.value.center.y));
      } catch (cause) {
        if (current) setLoadError(loadErrorKey(cause));
      }
    };
    void load();
    return () => { current = false; };
  }, [faceId, target?.featureId, target?.role]);

  const live = useMemo(() => {
    if (!placement) return null;
    let base: Point2;
    let diameterMm: number;
    try {
      base = { x: parseLengthToMm(x), y: parseLengthToMm(y) };
      diameterMm = parseLengthToMm(diameter);
    } catch {
      return { point: placement.center, diameterMm: null, error: "point-invalid" as PlacementError };
    }
    if (!Number.isFinite(base.x) || !Number.isFinite(base.y) ||
      !Number.isFinite(diameterMm) || diameterMm <= 0 || diameterMm > 100000) {
      return { point: base, diameterMm: Number.isFinite(diameterMm) ? diameterMm : null, error: "point-invalid" as PlacementError };
    }
    if (selectedEdges.length > 0) {
      if (edgeDistances.length !== selectedEdges.length) {
        return { point: base, diameterMm, error: "distance-invalid" as PlacementError };
      }
      const measures = [];
      try {
        for (let index = 0; index < selectedEdges.length; index++) {
          const edge = placement.measureEdges.find((item) => item.id === selectedEdges[index]);
          const distanceMm = parseLengthToMm(edgeDistances[index] ?? "");
          if (!edge || !Number.isFinite(distanceMm) || distanceMm <= 0) {
            return { point: base, diameterMm, error: "distance-invalid" as PlacementError };
          }
          measures.push({ edge, distanceMm });
        }
      } catch {
        return { point: base, diameterMm, error: "distance-invalid" as PlacementError };
      }
      const solved = solveEdgeDistances(placement, base, measures, diameterMm / 2);
      return solved.ok
        ? { point: solved.value, diameterMm, error: null }
        : { point: base, diameterMm, error: solved.error };
    }
    const placementError = validateHoleCenter(placement, base, diameterMm / 2);
    return { point: base, diameterMm, error: placementError };
  }, [placement, x, y, diameter, selectedEdges, edgeDistances]);

  const currentError = loadError
    ? tt(loadError)
    : live?.error ? tt(PLACEMENT_MESSAGES[live.error])
    : depthMode === "blind" && !isPositiveLength(depth) ? tt("hole.errDepth") : null;
  const displayedX = editingCoordinate === "x" || !live || live.error || selectedEdges.length === 0
    ? x
    : formatMm(live.point.x);
  const displayedY = editingCoordinate === "y" || !live || live.error || selectedEdges.length === 0
    ? y
    : formatMm(live.point.y);
  const dimensions = live && !live.error
    ? selectedEdges.flatMap((edgeId, index) => {
      try {
        const distanceMm = parseLengthToMm(edgeDistances[index] ?? "");
        return Number.isFinite(distanceMm) && distanceMm > 0 ? [{ edgeId, distanceMm }] : [];
      } catch {
        return [];
      }
    })
    : [];

  const setManualPoint = (point: Point2): void => {
    if (selectedEdges.length === 2) {
      setSelectedEdges([]);
      setEdgeDistances([]);
    }
    setX(formatMm(point.x));
    setY(formatMm(point.y));
    setError(null);
  };

  const setManualCoordinate = (axis: "x" | "y", value: string): void => {
    if (selectedEdges.length === 2) {
      setSelectedEdges([]);
      setEdgeDistances([]);
    }
    if (axis === "x") setX(value);
    else setY(value);
    setError(null);
  };

  const toggleEdge = (edgeId: string): void => {
    const index = selectedEdges.indexOf(edgeId);
    if (index >= 0) {
      setSelectedEdges(selectedEdges.filter((_, at) => at !== index));
      setEdgeDistances(edgeDistances.filter((_, at) => at !== index));
    } else if (selectedEdges.length === 0) {
      setSelectedEdges([edgeId]);
      setEdgeDistances([""]);
    } else {
      setSelectedEdges([selectedEdges[0]!, edgeId]);
      setEdgeDistances([edgeDistances[0] ?? "", ""]);
    }
    setError(null);
  };

  const setDistance = (index: number, value: string): void => {
    setEdgeDistances((current) => current.map((item, at) => at === index ? value : item));
    setError(null);
  };

  const submit = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      if (!target) throw new Error(tt("hole.errNoFace"));
      if (!placement) throw new Error(tt(loadError ?? "hole.errNoPos"));
      if (!live || live.error || live.diameterMm === null) {
        throw new Error(tt(live?.error ? PLACEMENT_MESSAGES[live.error] : "hole.errPointInvalid"));
      }
      let depthMm = 0;
      if (depthMode === "blind") {
        depthMm = parseLengthToMm(depth);
        if (!Number.isFinite(depthMm) || depthMm <= 0 || depthMm > 100000) throw new Error(tt("hole.errDepth"));
      }
      await executeCommand("CreateHole", {
        ...(insertUpstream && next ? { insertBeforeId: next.featureId } : {}),
        targetId: target.featureId,
        faceRole: target.role,
        xMm: live.point.x,
        yMm: live.point.y,
        diameterMm: live.diameterMm,
        depthMode,
        depthMm,
      });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("hole.errFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <CadDialog
      title={tt("hole.title")}
      description={target ? tt("hole.descOn", { role: target.role }) : tt("hole.descOff")}
      onClose={onClose}
      error={error}
      contentClassName="top-1/2 max-h-[calc(100dvh-2rem)] w-[min(42rem,calc(100vw-2rem))] -translate-y-1/2 overflow-y-auto"
      actions={
        <CadActions
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          busyLabel={tt("common.cutting")}
          label={tt("hole.cut")}
          disabled={!target || !placement || Boolean(currentError)}
        />
      }
    >
      {next && (
        <label className="mb-3 flex items-center gap-2 text-xs text-white/70">
          <input type="checkbox" checked={insertUpstream} onChange={(event) => setInsertUpstream(event.target.checked)} />
          {tt("hole.insertBefore", { feature: featureTypeName(next.type) })}
        </label>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
        <label className="mb-2 block text-xs text-white/70">
          {tt("hole.diameter")}
          <input
            data-testid="hole-diameter"
            value={diameter}
            onChange={(event) => { setDiameter(event.target.value); setError(null); }}
            onKeyDown={(event) => event.key === "Enter" && void submit()}
            className="mt-1 w-full rounded-md bg-white/5 px-2.5 py-1.5 text-sm text-white outline-none focus:bg-white/10"
          />
        </label>
        <div className="mb-2 flex items-end gap-1 text-xs">
          {(["throughAll", "blind"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={depthMode === mode}
              onClick={() => setDepthMode(mode)}
              className={`rounded-md px-2 py-1.5 ${depthMode === mode ? "bg-white/15" : "bg-white/5 hover:bg-white/10"}`}
            >
              {mode === "throughAll" ? tt("hole.through") : tt("hole.blind")}
            </button>
          ))}
        </div>
      </div>
      {depthMode === "blind" && (
        <label className="mb-2 block text-xs text-white/70">
          {tt("hole.depth")}
          <input
            value={depth}
            onChange={(event) => { setDepth(event.target.value); setError(null); }}
            onKeyDown={(event) => event.key === "Enter" && void submit()}
            className="mt-1 w-full rounded-md bg-white/5 px-2.5 py-1.5 text-sm text-white outline-none focus:bg-white/10"
          />
          <span className="text-white/40">{tt("hole.depthNote")}</span>
        </label>
      )}
      <div className="mb-1 grid grid-cols-2 gap-2">
        <label className="block text-xs text-white/70">
          {tt("hole.x")}
          <input
            data-testid="hole-center-x"
            value={displayedX}
            disabled={!placement || busy}
            onFocus={() => setEditingCoordinate("x")}
            onBlur={() => setEditingCoordinate(null)}
            onChange={(event) => setManualCoordinate("x", event.target.value)}
            className="mt-1 w-full rounded-md bg-white/5 px-2.5 py-1.5 text-sm text-white outline-none focus:bg-white/10"
          />
        </label>
        <label className="block text-xs text-white/70">
          {tt("hole.y")}
          <input
            data-testid="hole-center-y"
            value={displayedY}
            disabled={!placement || busy}
            onFocus={() => setEditingCoordinate("y")}
            onBlur={() => setEditingCoordinate(null)}
            onChange={(event) => setManualCoordinate("y", event.target.value)}
            className="mt-1 w-full rounded-md bg-white/5 px-2.5 py-1.5 text-sm text-white outline-none focus:bg-white/10"
          />
        </label>
      </div>
      {placement && live && (
        <HolePlacementPreview
          face={placement}
          point={live.point}
          diameterMm={live.diameterMm}
          valid={!live.error}
          selectedEdgeIds={selectedEdges}
          dimensions={dimensions}
          onPointChange={setManualPoint}
          onToggleEdge={toggleEdge}
        />
      )}
      {placement && (
        <div className="mb-2 mt-1 grid grid-cols-2 gap-2">
          {selectedEdges.map((edgeId, index) => (
            <label key={edgeId} className="block text-xs text-white/70">
              {tt(index === 0 ? "hole.edgeDistance1" : "hole.edgeDistance2")}
              <input
                data-testid={`hole-edge-distance-${index + 1}`}
                value={edgeDistances[index] ?? ""}
                onChange={(event) => setDistance(index, event.target.value)}
                className="mt-1 w-full rounded-md bg-white/5 px-2.5 py-1.5 text-sm text-white outline-none focus:bg-white/10"
              />
            </label>
          ))}
        </div>
      )}
      {placement && <p id="hole-placement-help" className="pb-2 text-[11px] text-white/45">{tt("hole.previewHelp")}</p>}
      {currentError && <div role="alert" data-testid="hole-placement-error" className="pb-2 text-xs text-red-300">{currentError}</div>}
    </CadDialog>
  );
}
