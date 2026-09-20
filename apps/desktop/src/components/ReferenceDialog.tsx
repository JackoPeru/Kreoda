// Reference images dialog (§29 Stage A): import, list, calibrate by two
// clicks + real distance (or known width), opacity, plane, delete.
// Session-scoped view aids — deliberately not persisted, not undoable.
import { useEffect, useState } from "react";
import {
  addReferencePlane,
  calibrateSize,
  decodeImageSize,
  removeReferencePlane,
  updateReferencePlane,
  useReferenceStore,
  validateReferenceImage,
  type ReferencePlane,
} from "../reference/store";
import {
  viewportBeginReferenceMeasure,
  viewportCancelReferenceMeasure,
} from "../viewport/viewportHandle";

export function ReferenceDialog({ onClose }: { onClose: () => void }) {
  const planes = useReferenceStore((s) => s.planes);
  const [error, setError] = useState<string | null>(null);
  const [measuring, setMeasuring] = useState<string | null>(null);
  // M6: one shared knownWidth mirrored across N rows — per-row state instead.
  const [knownWidths, setKnownWidths] = useState<Record<string, string>>({});
  const [pendingPts, setPendingPts] = useState<{
    id: string;
    pts: [number, number][];
  } | null>(null);
  const [pendingDist, setPendingDist] = useState("");

  // C10: dialog close/unmount must cancel an in-flight measure (the old
  // path left clicks hijacked with no cancel).
  useEffect(() => {
    return () => {
      try {
        viewportCancelReferenceMeasure();
      } catch {
        // Best-effort.
      }
    };
  }, []);

  const cancelMeasure = (): void => {
    viewportCancelReferenceMeasure();
    setMeasuring(null);
    setPendingPts(null);
  };

  const importImage = async (): Promise<void> => {
    setError(null);
    try {
      const picked = await window.kreoda.importReferenceImage();
      if (!picked) return;
      const { w, h } = await decodeImageSize(picked.dataUrl);
      // C9: pixel/texture caps enforced at the store, validated early here
      // for an actionable dialog error (not a silent white quad).
      validateReferenceImage(w, h, picked.dataUrl.length);
      addReferencePlane({
        name: picked.name,
        dataUrl: picked.dataUrl,
        imageW: w,
        imageH: h,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "import failed");
    }
  };

  const measure = async (plane: ReferencePlane): Promise<void> => {
    setError(null);
    setPendingPts(null);
    setMeasuring(plane.id);
    try {
      // window.prompt is unsupported in Electron: clicks are captured first,
      // the real distance goes in the inline field below.
      const pts = await viewportBeginReferenceMeasure(plane.id);
      if (!pts || pts.length < 2) {
        setError("Click two points on the image.");
        return;
      }
      setPendingPts({ id: plane.id, pts });
    } catch (e) {
      setError(e instanceof Error ? e.message : "calibration failed");
    } finally {
      setMeasuring(null);
    }
  };

  const applyPendingDist = (): void => {
    setError(null);
    if (!pendingPts) return;
    const plane = planes.find((p) => p.id === pendingPts.id);
    if (!plane) {
      setPendingPts(null);
      return;
    }
    const realMm = Number(pendingDist);
    try {
      const size = calibrateSize(
        plane.imageW,
        plane.imageH,
        pendingPts.pts[0]!,
        pendingPts.pts[1]!,
        realMm,
      );
      updateReferencePlane(plane.id, {
        widthMm: size.widthMm,
        heightMm: size.heightMm,
        mmPerPx: size.mmPerPx,
      });
      setPendingPts(null);
      setPendingDist("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "calibration failed");
    }
  };

  const applyKnownWidth = (plane: ReferencePlane): void => {
    setError(null);
    // M6: per-row input, clamped (1e12 mm plane → beyond camera.far).
    const raw = knownWidths[plane.id] ?? "";
    const w = Number(raw);
    if (!(w > 0) || !Number.isFinite(w) || w > 1000000) {
      setError("Known width must be in (0, 1000000] mm.");
      return;
    }
    try {
      const mmPerPx = w / plane.imageW;
      const h = plane.imageH * mmPerPx;
      if (!Number.isFinite(h) || h <= 0 || h > 1000000) {
        setError("Calibrated height out of range (max 1000000 mm).");
        return;
      }
      updateReferencePlane(plane.id, {
        widthMm: w,
        heightMm: h,
        mmPerPx,
      });
      setKnownWidths((s) => ({ ...s, [plane.id]: "" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "calibration failed");
    }
  };

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/60"
      data-testid="reference-dialog"
    >
      <div className="w-[28rem] max-w-[92vw] rounded-xl border border-white/15 bg-[#141922] p-5 shadow-2xl">
        <div className="pb-2 text-sm font-semibold">
          Reference images (tracing aids — session only)
        </div>
        <button
          onClick={() => void importImage()}
          className="rounded-md bg-white/10 px-3 py-1.5 text-sm hover:bg-white/15"
        >
          Import image…
        </button>
        {planes.length === 0 && (
          <div className="py-2 text-xs text-white/50">
            No reference images. Import a blueprint, calibrate it, trace over
            it.
          </div>
        )}
        {planes.map((p) => (
          <div key={p.id} className="border-t border-white/10 py-2">
            <div className="flex items-center gap-2">
              <span className="flex-1 truncate text-xs font-medium text-white/85">
                {p.name}
              </span>
              <span className="font-mono text-[11px] text-white/45">
                {p.widthMm.toFixed(1)}×{p.heightMm.toFixed(1)} mm
                {p.mmPerPx === null ? " (uncalibrated)" : ""}
              </span>
              <button
                onClick={() => {
                  if (measuring === p.id) cancelMeasure();
                  if (pendingPts?.id === p.id) setPendingPts(null);
                  removeReferencePlane(p.id);
                }}
                className="rounded-md px-2 py-0.5 text-xs text-white/60 hover:bg-white/10"
              >
                Delete
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1.5 text-xs">
              <select
                value={p.plane}
                onChange={(e) =>
                  updateReferencePlane(p.id, {
                    plane: e.target.value as ReferencePlane["plane"],
                  })
                }
                className="rounded-md bg-white/5 px-1.5 py-1 outline-none"
                aria-label="Reference plane"
              >
                <option value="XY">XY</option>
                <option value="XZ">XZ</option>
                <option value="YZ">YZ</option>
              </select>
              <label className="flex items-center gap-1 text-white/60">
                opacity
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={p.opacity}
                  onChange={(e) =>
                    updateReferencePlane(p.id, {
                      opacity: Number(e.target.value),
                    })
                  }
                  className="w-20"
                />
              </label>
              <button
                onClick={() => void measure(p)}
                disabled={measuring !== null}
                className="rounded-md bg-white/10 px-2 py-0.5 hover:bg-white/15 disabled:opacity-40"
              >
                {measuring === p.id ? "click 2 points…" : "Measure"}
              </button>
              {/* C10: cancel an in-flight capture + hint that misses no longer hijack the camera. */}
              {measuring === p.id && (
                <button
                  onClick={cancelMeasure}
                  className="rounded-md bg-white/10 px-2 py-0.5 hover:bg-white/15"
                >
                  Cancel
                </button>
              )}
              {measuring === p.id && (
                <span className="text-[11px] text-white/45">
                  Click on the image or Cancel
                </span>
              )}
              {pendingPts && pendingPts.id === p.id && (
                <>
                  <input
                    value={pendingDist}
                    onChange={(e) => setPendingDist(e.target.value)}
                    placeholder="real distance mm"
                    className="w-28 rounded-md bg-white/5 px-1.5 py-1 font-mono outline-none placeholder:text-white/30"
                  />
                  <button
                    onClick={applyPendingDist}
                    className="rounded-md bg-amber-500/90 px-2 py-0.5 font-medium text-black hover:bg-amber-400"
                  >
                    Apply
                  </button>
                </>
              )}
              <input
                value={knownWidths[p.id] ?? ""}
                onChange={(e) =>
                  setKnownWidths((s) => ({ ...s, [p.id]: e.target.value }))
                }
                placeholder="known width mm"
                className="w-28 rounded-md bg-white/5 px-1.5 py-1 font-mono outline-none placeholder:text-white/30"
              />
              <button
                onClick={() => applyKnownWidth(p)}
                className="rounded-md bg-white/10 px-2 py-0.5 hover:bg-white/15"
              >
                Set
              </button>
            </div>
          </div>
        ))}
        {error && <div className="pt-2 text-xs text-red-300">{error}</div>}
        <div className="mt-3 flex gap-2">
          {measuring !== null && (
            <button
              onClick={cancelMeasure}
              className="rounded-md bg-white/10 px-3 py-1.5 text-sm hover:bg-white/15"
            >
              Cancel measure
            </button>
          )}
          <button
            onClick={() => {
              cancelMeasure();
              onClose();
            }}
            className="rounded-md bg-white/10 px-3 py-1.5 text-sm hover:bg-white/15"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
