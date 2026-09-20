import { useState } from "react";
import { parseAngleToDeg, parseLengthToMm } from "@intentcad/units";
import { executeCommand } from "../commands/execute";
import { selectionKindOf, useDocumentUiStore, useSelectionStore } from "../stores";

// Canonical mm slots per primitive type (mirrors the core evaluator;
// the core re-validates every name, §63.10).
const SLOTS: Record<string, { param: string; label: string }[]> = {
  Box: [
    { param: "widthMm", label: "Width" },
    { param: "heightMm", label: "Height" },
    { param: "depthMm", label: "Depth" },
  ],
  Cylinder: [
    { param: "radiusMm", label: "Radius" },
    { param: "heightMm", label: "Height" },
  ],
  Sphere: [{ param: "radiusMm", label: "Radius" }],
  Extrude: [{ param: "distanceMm", label: "Distance" }],
  Revolve: [{ param: "angleDeg", label: "Angle (deg)" }],
  Hole: [
    { param: "diameterMm", label: "Diameter" },
    { param: "depthMm", label: "Depth (blind)" },
  ],
  Fillet: [{ param: "radiusMm", label: "Radius" }],
  Chamfer: [{ param: "distanceMm", label: "Distance" }],
};

/** Dimension editing (§22): exact values, one Undo step per commit (§12). */
export function PropertiesPanel({ onEditSketch }: { onEditSketch: (id: string) => void }) {
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const features = useDocumentUiStore((s) => s.features);
  const sketches = useDocumentUiStore((s) => s.sketches);
  const revision = useDocumentUiStore((s) => s.revision);
  const [error, setError] = useState<string | null>(null);
  const [busyParam, setBusyParam] = useState<string | null>(null);

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
          Sketch · {sketch.planeKind}
        </div>
        <div className="pb-2 font-mono text-[11px] text-white/40">
          {sketch.featureId.slice(0, 13)}… · rev {revision}
        </div>
        <div className="text-xs text-white/65">
          {sketch.points} points · {sketch.lines} lines · {sketch.circles} circles ·{" "}
          {sketch.constraints} constraints
        </div>
        <button
          onClick={() => onEditSketch(sketch.featureId)}
          className="mt-2 w-full rounded-md bg-blue-600 px-2.5 py-1.5 text-sm font-medium hover:bg-blue-500"
        >
          Edit sketch
        </button>
      </div>
    );
  }

  if (!feature) return null;

  const slots = SLOTS[feature.type] ?? [];
  // Through-holes have no meaningful depth: hide the blind slot instead of
  // offering a silent no-op edit (mode rides in refExtra, §10).
  const visibleSlots =
    feature.type === "Hole" && !feature.refExtra.includes("mode=blind")
      ? slots.filter((s) => s.param !== "depthMm")
      : slots;

  const commit = async (paramName: string, text: string): Promise<void> => {
    setError(null);
    setBusyParam(paramName);
    try {
      // Revolve angles are degrees (accept "90", "90 deg", "1.57 rad").
      const valueMm =
        paramName === "angleDeg" ? parseAngleToDeg(text) : parseLengthToMm(text);
      await executeCommand("SetDimension", {
        featureId: feature.featureId,
        paramName,
        valueMm,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "edit failed");
    } finally {
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
    Hole: { diameterMm: 0, depthMm: 1 },
    Fillet: { radiusMm: 0 },
    Chamfer: { distanceMm: 0 },
  };
  const paramIndex = (param: string): number =>
    SLOT_INDEX[feature.type]?.[param] ?? -1;

  return (
    <div className="w-60 shrink-0 border-l border-white/10 bg-[#0e1218] p-3" data-testid="properties">
      <div className="pb-1 text-xs uppercase tracking-wide text-white/50">
        Properties · {feature.type}
      </div>
      <div className="pb-2 font-mono text-[11px] text-white/40">
        {feature.featureId.slice(0, 13)}… · rev {revision}
      </div>
      {visibleSlots.map((s) => {
        const i = paramIndex(s.param);
        const current = i >= 0 ? feature.paramsMm[i] : undefined;
        return (
        <label key={s.param} className="mb-2 block text-xs text-white/70">
          {s.label} {s.param === "angleDeg" ? "(deg)" : "(mm)"}
          <input
            key={`${feature.featureId}:${s.param}:${current ?? ""}`}
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
      <div className="pt-1 text-xs text-white/55">
        Volume {(feature.volumeMm3 / 1000).toFixed(1)} cm³
      </div>
      {error && <div className="pt-2 text-xs text-red-300">{error}</div>}
      {busyParam && <div className="pt-1 text-[11px] text-white/40">Recomputing…</div>}
    </div>
  );
}
