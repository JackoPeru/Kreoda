import { useRef, useState } from "react";
import { parseAngleToDeg, parseLengthToMm } from "@kreoda/units";
import { featureGeometryKind } from "@kreoda/command-schema";
import { executeCommand } from "../commands/execute";
import { selectionKindOf, useDocumentUiStore, useSelectionStore } from "../stores";
import { t, useT, featureTypeName, type EnKey } from "../i18n";

// Canonical mm slots per primitive type (mirrors the core evaluator;
// the core re-validates every name, §63.10).
const SLOTS: Record<string, { param: string; label: EnKey }[]> = {
  Box: [
    { param: "widthMm", label: "props.slotWidth" },
    { param: "heightMm", label: "props.slotHeight" },
    { param: "depthMm", label: "props.slotDepth" },
  ],
  Cylinder: [
    { param: "radiusMm", label: "props.slotRadius" },
    { param: "heightMm", label: "props.slotHeight" },
  ],
  Sphere: [{ param: "radiusMm", label: "props.slotRadius" }],
  Extrude: [{ param: "distanceMm", label: "props.slotDistance" }],
  Revolve: [{ param: "angleDeg", label: "props.slotAngle" }],
  SurfaceExtrude: [{ param: "distanceMm", label: "props.slotDistance" }],
  SurfaceSweep: [{ param: "toleranceMm", label: "props.slotTolerance" }],
  SurfaceThicken: [
    { param: "thicknessMm", label: "props.slotThickness" },
    { param: "toleranceMm", label: "props.slotTolerance" },
  ],
  SurfaceSew: [{ param: "toleranceMm", label: "props.slotTolerance" }],
  SurfaceSewnSolid: [{ param: "toleranceMm", label: "props.slotTolerance" }],
  SurfaceOffset: [
    { param: "distanceMm", label: "props.slotDistance" },
    { param: "toleranceMm", label: "props.slotTolerance" },
  ],
  SurfaceTrim: [
    { param: "keepU", label: "props.slotKeepU" },
    { param: "keepV", label: "props.slotKeepV" },
    { param: "toleranceMm", label: "props.slotTolerance" },
  ],
  SurfaceExtend: [
    { param: "distanceMm", label: "props.slotDistance" },
    { param: "toleranceMm", label: "props.slotTolerance" },
  ],
  SurfaceRevolve: [
    { param: "angleDeg", label: "props.slotAngle" },
    { param: "axisOriginXMm", label: "props.slotAxisOriginX" },
    { param: "axisOriginYMm", label: "props.slotAxisOriginY" },
    { param: "axisOriginZMm", label: "props.slotAxisOriginZ" },
    { param: "axisX", label: "props.slotAxisDirectionX" },
    { param: "axisY", label: "props.slotAxisDirectionY" },
    { param: "axisZ", label: "props.slotAxisDirectionZ" },
  ],
  Hole: [
    { param: "diameterMm", label: "props.slotDiameter" },
    { param: "depthMm", label: "props.slotDepthBlind" },
  ],
  HolePattern: [
    { param: "diameterMm", label: "props.slotDiameter" },
    { param: "depthMm", label: "props.slotDepthBlind" },
    { param: "count", label: "props.slotCount" },
  ],
  Fillet: [{ param: "radiusMm", label: "props.slotRadius" }],
  Chamfer: [{ param: "distanceMm", label: "props.slotDistance" }],
  // M4: Instance placement was uneditable except via command-bar/E2E —
  // expose signed/zero-tolerant slots (translations mm, rotations deg).
  Instance: [
    { param: "txMm", label: "props.slotTx" },
    { param: "tyMm", label: "props.slotTy" },
    { param: "tzMm", label: "props.slotTz" },
    { param: "rxDeg", label: "props.slotRx" },
    { param: "ryDeg", label: "props.slotRy" },
    { param: "rzDeg", label: "props.slotRz" },
  ],
  MoveFace: [
    { param: "txMm", label: "props.slotTx" },
    { param: "tyMm", label: "props.slotTy" },
    { param: "tzMm", label: "props.slotTz" },
    { param: "rxDeg", label: "props.slotRx" },
    { param: "ryDeg", label: "props.slotRy" },
    { param: "rzDeg", label: "props.slotRz" },
    { param: "pxMm", label: "props.slotPivotX" },
    { param: "pyMm", label: "props.slotPivotY" },
    { param: "pzMm", label: "props.slotPivotZ" },
  ],
  OffsetFace: [{ param: "distanceMm", label: "props.slotDistance" }],
  BodyPattern: [
    { param: "count", label: "props.slotCopies" },
    { param: "spacingMm", label: "props.slotSpacing" },
  ],
  CircularBodyPattern: [
    { param: "count", label: "props.slotCopies" },
    { param: "angleDeg", label: "props.slotAngle" },
  ],
};

const ANGLE_PARAMS = new Set(["angleDeg", "rxDeg", "ryDeg", "rzDeg"]);
const DIMENSIONLESS_PARAMS = new Set(["axisX", "axisY", "axisZ", "keepU", "keepV"]);
const NORMALIZED_DIMENSIONLESS_PARAMS = new Set(["axisX", "axisY", "axisZ"]);

/** Dimension editing (§22): exact values, one Undo step per commit (§12). */
export function PropertiesPanel({ onEditSketch }: { onEditSketch: (id: string) => void }) {
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const features = useDocumentUiStore((s) => s.features);
  const sketches = useDocumentUiStore((s) => s.sketches);
  const revision = useDocumentUiStore((s) => s.revision);
  const [error, setError] = useState<string | null>(null);
  const [busyParam, setBusyParam] = useState<string | null>(null);
  const committing = useRef(false);
  const tt = useT();

  const sketchId =
    selectedIds.find((id) =>
      sketches.some((k) => k.featureId === id),
    ) ?? null;
  const sketch = sketchId
    ? (sketches.find((k) => k.featureId === sketchId) ?? null)
    : null;

  const bodyId = selectedIds.find((id) => selectionKindOf(id) === "body") ?? null;
  const feature = bodyId
    ? (features.find((f) => f.featureId === bodyId) ?? null)
    : null;

  if (sketch) {
    return (
      <div className="w-60 shrink-0 border-l border-white/10 bg-[#0e1218] p-3" data-testid="properties">
        <div className="pb-1 text-xs uppercase tracking-wide text-white/50">
          {tt("props.sketchTitle", { plane: sketch.planeKind })}
        </div>
        <div className="pb-2 font-mono text-[11px] text-white/40">
          {sketch.featureId.slice(0, 13)}… · {tt("props.rev", { n: revision })}
        </div>
        <div className="text-xs text-white/65">
          {tt("props.sketchStats", { p: sketch.points, l: sketch.lines, c: sketch.circles, con: sketch.constraints })}
        </div>
        <button
          onClick={() => onEditSketch(sketch.featureId)}
          className="mt-2 w-full rounded-md bg-blue-600 px-2.5 py-1.5 text-sm font-medium hover:bg-blue-500"
        >
          {tt("props.editSketch")}
        </button>
      </div>
    );
  }

  if (!feature) return null;

  const slots = SLOTS[feature.type] ?? [];
  // Through-holes have no meaningful depth: hide the blind slot instead of
  // offering a silent no-op edit (mode rides in refExtra, §10).
  const visibleSlots =
    (feature.type === "Hole" || feature.type === "HolePattern") && !feature.refExtra.includes("mode=blind")
      ? slots.filter((s) => s.param !== "depthMm")
      : slots;

  const commit = async (paramName: string, text: string): Promise<void> => {
    // Enter can disable/blur this input before React renders busyParam.
    // Keep that blur from creating a second command and Undo delta.
    if (committing.current) return;
    committing.current = true;
    setError(null);
    setBusyParam(paramName);
    try {
      // Revolve/instance angles are degrees (accept "90", "90 deg", "1.57 rad",
      // including 0/negatives for placement); translations are signed mm.
      // M4: zero/negative placement must reach the core (not a v>0 gate).
      const parseNumber = (): number => {
        if (!text.trim()) throw new Error(tt("props.errNotNumber"));
        return Number(text);
      };
      const valueMm = paramName === "count" ? Number(text)
        : DIMENSIONLESS_PARAMS.has(paramName) ? parseNumber()
        : ANGLE_PARAMS.has(paramName)
        ? parseAngleToDeg(text)
        : parseLengthToMm(text);
      if (!Number.isFinite(valueMm)) throw new Error(tt("props.errNotNumber"));
      await executeCommand("SetDimension", {
        featureId: feature.featureId,
        paramName,
        valueMm,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("props.errEditFailed"));
    } finally {
      committing.current = false;
      setBusyParam(null);
    }
  };

  // Canonical slot order per type (mirrors the core evaluator layout).
  const SLOT_INDEX: Record<string, Record<string, number>> = {
    Box: { widthMm: 0, heightMm: 1, depthMm: 2 },
    Cylinder: { radiusMm: 0, heightMm: 1 },
    Sphere: { radiusMm: 0 },
    Extrude: { distanceMm: 0 },
    Revolve: { angleDeg: 0 },
    SurfaceExtrude: { distanceMm: 0 },
    SurfaceSweep: { toleranceMm: 0 },
    SurfaceThicken: { thicknessMm: 0, toleranceMm: 1 },
    SurfaceSew: { toleranceMm: 0 },
    SurfaceSewnSolid: { toleranceMm: 0 },
    SurfaceOffset: { distanceMm: 0, toleranceMm: 1 },
    SurfaceTrim: { keepU: 0, keepV: 1, toleranceMm: 2 },
    SurfaceExtend: { distanceMm: 0, toleranceMm: 1 },
    SurfaceRevolve: {
      angleDeg: 0,
      axisOriginXMm: 1,
      axisOriginYMm: 2,
      axisOriginZMm: 3,
      axisX: 4,
      axisY: 5,
      axisZ: 6,
    },
    Hole: { diameterMm: 0, depthMm: 1 },
    HolePattern: { diameterMm: 0, depthMm: 1, count: 2 },
    Fillet: { radiusMm: 0 },
    Chamfer: { distanceMm: 0 },
    Instance: { txMm: 0, tyMm: 1, tzMm: 2, rxDeg: 3, ryDeg: 4, rzDeg: 5 },
    MoveFace: { txMm: 0, tyMm: 1, tzMm: 2, rxDeg: 3, ryDeg: 4, rzDeg: 5, pxMm: 6, pyMm: 7, pzMm: 8 },
    OffsetFace: { distanceMm: 0 },
    BodyPattern: { count: 0, spacingMm: 1 },
    CircularBodyPattern: { count: 0, angleDeg: 1 },
  };
  const paramIndex = (param: string): number =>
    SLOT_INDEX[feature.type]?.[param] ?? -1;

  return (
    <div className="w-60 shrink-0 border-l border-white/10 bg-[#0e1218] p-3" data-testid="properties">
      <div className="pb-1 text-xs uppercase tracking-wide text-white/50">
        {tt("props.title", { type: featureTypeName(feature.type) })}
      </div>
      <div className="pb-2 font-mono text-[11px] text-white/40">
        {feature.featureId.slice(0, 13)}… · {tt("props.rev", { n: revision })}
      </div>
      {visibleSlots.map((s) => {
        const i = paramIndex(s.param);
        const current = i >= 0 ? feature.paramsMm[i] : undefined;
        return (
        <label key={s.param} className="mb-2 block text-xs text-white/70">
          {tt(s.label)}{s.param === "count" || DIMENSIONLESS_PARAMS.has(s.param)
            ? ""
            : ` ${ANGLE_PARAMS.has(s.param) ? tt("common.unitDeg") : tt("common.unitMm")}`}
          <input
            key={`${feature.featureId}:${s.param}:${current ?? ""}`}
            type={DIMENSIONLESS_PARAMS.has(s.param) ? "number" : "text"}
            step={DIMENSIONLESS_PARAMS.has(s.param) ? "any" : undefined}
            min={NORMALIZED_DIMENSIONLESS_PARAMS.has(s.param) ? -1 : undefined}
            max={NORMALIZED_DIMENSIONLESS_PARAMS.has(s.param) ? 1 : undefined}
            defaultValue={String(current ?? "")}
            disabled={busyParam !== null}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                void commit(s.param, (e.target as HTMLInputElement).value);
              }
            }}
            onBlur={(e) => {
              if (e.target.value !== String(current ?? "")) {
                void commit(s.param, e.target.value);
              }
            }}
            className="mt-1 w-full rounded-md bg-white/5 px-2.5 py-1.5 text-sm text-white outline-none focus:bg-white/10 disabled:opacity-50"
          />
        </label>
        );
      })}
      {feature.geometryCurrent === false || feature.status === "unavailable" ? (
        <div className="pt-1 text-xs text-red-300">{tt("props.geometryUnavailable")}</div>
      ) : featureGeometryKind(feature.type) === "solid" && typeof feature.volumeMm3 === "number" ? (
        <div className="pt-1 text-xs text-white/55">
          {tt("props.volume", { v: (feature.volumeMm3 / 1000).toFixed(1) })}
        </div>
      ) : null}
      {error && <div className="pt-2 text-xs text-red-300">{error}</div>}
      {busyParam && <div className="pt-1 text-[11px] text-white/40">{tt("common.recomputing")}</div>}
    </div>
  );
}
