// Reference images dialog (§29 Stage A): import, list, calibrate by two
// clicks + real distance (or known width), opacity, plane, delete.
// Persisted project view aids, outside the CAD undo history.
import { useEffect, useRef, useState } from "react";
import {
  addReferencePlane,
  calibrateSize,
  decodeImageSize,
  removeReferencePlane,
  updateReferencePlane,
  useReferenceStore,
  validateReferenceImage,
  type ReferencePlane,
  reloadReferences,
} from "../reference/store";
import { coreClient } from "../ipc/coreClient";
import {
  viewportBeginReferenceMeasure,
  viewportCancelReferenceMeasure,
} from "../viewport/viewportHandle";
import { executeCommand } from "../commands/execute";
import { detectReferenceGeometry, type DetectionResult } from "../reference/detect";
import { buildReferenceSketch, type ReferenceProposal } from "../reference/propose";
import { t, useT } from "../i18n";

function imageDataFromUrl(dataUrl: string): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no 2d context");
        ctx.drawImage(image, 0, 0);
        resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
      } catch (error) {
        reject(error);
      }
    };
    image.onerror = () => reject(new Error("cannot decode image"));
    image.src = dataUrl;
  });
}

function DetectionPreview({
  plane,
  result,
}: {
  plane: ReferencePlane;
  result: DetectionResult;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const maxW = 320;
      const maxH = 180;
      const scale = Math.min(
        maxW / plane.imageW,
        maxH / plane.imageH,
        1,
      );
      canvas.width = Math.max(1, Math.round(plane.imageW * scale));
      canvas.height = Math.max(1, Math.round(plane.imageH * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const sx = canvas.width / plane.imageW;
      const sy = canvas.height / plane.imageH;
      ctx.strokeStyle = "#63F5E9";
      ctx.lineWidth = 2;
      for (const line of result.lines) {
        ctx.beginPath();
        ctx.moveTo(line.x1 * sx, line.y1 * sy);
        ctx.lineTo(line.x2 * sx, line.y2 * sy);
        ctx.stroke();
      }
      for (const circle of result.circles) {
        ctx.beginPath();
        ctx.arc(circle.cx * sx, circle.cy * sy, circle.r * sx, 0, 2 * Math.PI);
        ctx.stroke();
      }
    };
    image.src = plane.dataUrl;
    return () => {
      cancelled = true;
    };
  }, [plane.dataUrl, plane.imageW, plane.imageH, result]);
  return (
    <canvas
      ref={canvasRef}
      data-testid="reference-detection-preview"
      aria-label={t("ref.detectPreviewAria")}
      className="max-w-full rounded-md border border-white/10 bg-black/30"
    />
  );
}

export function ReferenceDialog({ onClose }: { onClose: () => void }) {
  const planes = useReferenceStore((s) => s.planes);
  const loadError = useReferenceStore((s) => s.loadError);
  const [error, setError] = useState<string | null>(null);
  const [measuring, setMeasuring] = useState<string | null>(null);
  // M6: one shared knownWidth mirrored across N rows — per-row state instead.
  const [knownWidths, setKnownWidths] = useState<Record<string, string>>({});
  const [pendingPts, setPendingPts] = useState<{
    id: string;
    pts: [number, number][];
  } | null>(null);
  const [pendingDist, setPendingDist] = useState("");
  const [detecting, setDetecting] = useState<string | null>(null);
  const [detection, setDetection] = useState<{
    planeId: string;
    proposal: ReferenceProposal;
    result: DetectionResult;
  } | null>(null);
  const [creating, setCreating] = useState(false);
  const tt = useT();

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

  const updatePlane = (id: string, patch: Partial<ReferencePlane>): void => {
    updateReferencePlane(id, patch);
    if (detection?.planeId === id) setDetection(null);
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
      setError(e instanceof Error ? e.message : t("ref.errImportFailed"));
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
        setError(tt("ref.errTwoPoints"));
        return;
      }
      setPendingPts({ id: plane.id, pts });
    } catch (e) {
      setError(e instanceof Error ? e.message : tt("ref.errCalibFailed"));
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
      updatePlane(plane.id, {
        widthMm: size.widthMm,
        heightMm: size.heightMm,
        mmPerPx: size.mmPerPx,
      });
      setPendingPts(null);
      setPendingDist("");
    } catch (e) {
      setError(e instanceof Error ? e.message : tt("ref.errCalibFailed"));
    }
  };

  const applyKnownWidth = (plane: ReferencePlane): void => {
    setError(null);
    // M6: per-row input, clamped (1e12 mm plane → beyond camera.far).
    const raw = knownWidths[plane.id] ?? "";
    const w = Number(raw);
    if (!(w > 0) || !Number.isFinite(w) || w > 1000000) {
      setError(tt("ref.errWidthRange"));
      return;
    }
    try {
      const mmPerPx = w / plane.imageW;
      const h = plane.imageH * mmPerPx;
      if (!Number.isFinite(h) || h <= 0 || h > 1000000) {
        setError(tt("ref.errHeightRange"));
        return;
      }
      updatePlane(plane.id, {
        widthMm: w,
        heightMm: h,
        mmPerPx,
      });
      setKnownWidths((s) => ({ ...s, [plane.id]: "" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : tt("ref.errCalibFailed"));
    }
  };

  const detect = async (plane: ReferencePlane): Promise<void> => {
    setError(null);
    setDetection(null);
    setDetecting(plane.id);
    try {
      if (!plane.mmPerPx) throw new Error(tt("ref.detectCalibrate"));
      const image = await imageDataFromUrl(plane.dataUrl);
      const result = detectReferenceGeometry(image);
      const proposal = buildReferenceSketch(
        {
          plane: plane.plane,
          imageW: plane.imageW,
          imageH: plane.imageH,
          mmPerPx: plane.mmPerPx,
        },
        result,
      );
      setDetection({ planeId: plane.id, proposal, result });
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      setError(
        message.includes("No usable")
          ? tt("ref.detectEmpty")
          : message.includes("Calibrate")
            ? tt("ref.detectCalibrate")
            : tt("ref.detectFailed"),
      );
    } finally {
      setDetecting(null);
    }
  };

  const createSketch = async (plane: ReferencePlane): Promise<void> => {
    if (!detection || detection.planeId !== plane.id) return;
    setError(null);
    setCreating(true);
    try {
      await executeCommand("CreateSketch", {
        planeKind: plane.plane,
        model: detection.proposal.model,
      });
      setDetection(null);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : tt("ref.detectFailed"));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/60"
      data-testid="reference-dialog"
    >
      <div className="w-[28rem] max-w-[92vw] rounded-xl border border-white/15 bg-[var(--kreoda-float-elevated-bg)] p-5 shadow-2xl">
        <div className="pb-2 text-sm font-semibold">
          {tt("ref.title")}
        </div>
        <button
          onClick={() => void importImage()}
          className="rounded-md bg-white/10 px-3 py-1.5 text-sm hover:bg-white/15"
        >
          {tt("ref.import")}
        </button>
        {planes.length === 0 && (
          <div className="py-2 text-xs text-white/50">
            {tt("ref.empty")}
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
                {p.mmPerPx === null ? tt("ref.uncalibrated") : ""}
              </span>
              <button
                onClick={() => {
                  if (measuring === p.id) cancelMeasure();
                  if (pendingPts?.id === p.id) setPendingPts(null);
                  if (detection?.planeId === p.id) setDetection(null);
                  removeReferencePlane(p.id);
                }}
                className="rounded-md px-2 py-0.5 text-xs text-white/60 hover:bg-white/10"
              >
                {tt("common.delete")}
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1.5 text-xs">
              <select
                value={p.plane}
                onChange={(e) =>
                  updatePlane(p.id, {
                    plane: e.target.value as ReferencePlane["plane"],
                  })
                }
                className="rounded-md bg-white/5 px-1.5 py-1 outline-none"
                aria-label={tt("ref.planeAria")}
              >
                <option value="XY">XY</option>
                <option value="XZ">XZ</option>
                <option value="YZ">YZ</option>
              </select>
              <label className="flex items-center gap-1 text-white/60">
                {tt("ref.opacity")}
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={p.opacity}
                  onChange={(e) =>
                    updatePlane(p.id, {
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
                {measuring === p.id ? tt("ref.measuring") : tt("ref.measure")}
              </button>
              {/* C10: cancel an in-flight capture + hint that misses no longer hijack the camera. */}
              {measuring === p.id && (
                <button
                  onClick={cancelMeasure}
                  className="rounded-md bg-white/10 px-2 py-0.5 hover:bg-white/15"
                >
                  {tt("common.cancel")}
                </button>
              )}
              {measuring === p.id && (
                <span className="text-[11px] text-white/45">
                  {tt("ref.cancelMeasureHint")}
                </span>
              )}
              {pendingPts && pendingPts.id === p.id && (
                <>
                  <input
                    value={pendingDist}
                    onChange={(e) => setPendingDist(e.target.value)}
                    placeholder={tt("ref.distPh")}
                    className="w-28 rounded-md bg-white/5 px-1.5 py-1 font-mono outline-none placeholder:text-white/30"
                  />
                  <button
                    onClick={applyPendingDist}
                    className="rounded-md bg-amber-500/90 px-2 py-0.5 font-medium text-black hover:bg-amber-400"
                  >
                    {tt("common.apply")}
                  </button>
                </>
              )}
              <input
                value={knownWidths[p.id] ?? ""}
                onChange={(e) =>
                  setKnownWidths((s) => ({ ...s, [p.id]: e.target.value }))
                }
                placeholder={tt("ref.widthPh")}
                className="w-28 rounded-md bg-white/5 px-1.5 py-1 font-mono outline-none placeholder:text-white/30"
              />
              <button
                onClick={() => applyKnownWidth(p)}
                className="rounded-md bg-white/10 px-2 py-0.5 hover:bg-white/15"
              >
                {tt("common.set")}
              </button>
              <button
                onClick={() => void detect(p)}
                disabled={detecting !== null}
                data-testid="reference-detect"
                className="rounded-md bg-cyan-400/15 px-2 py-0.5 font-medium text-cyan-200 hover:bg-cyan-400/25 disabled:opacity-40"
              >
                {detecting === p.id ? tt("ref.detecting") : tt("ref.detect")}
              </button>
            </div>
            {detection?.planeId === p.id && (
              <div
                className="mt-2 rounded-md border border-cyan-300/25 bg-cyan-300/5 p-2"
                data-testid="reference-detection"
              >
                <DetectionPreview plane={p} result={detection.result} />
                <div className="flex items-center justify-between gap-2 pt-2 text-xs">
                  <span className="text-white/70">
                    {tt("ref.detected", {
                      lines: detection.proposal.lineCount,
                      circles: detection.proposal.circleCount,
                      constraints: detection.proposal.model.constraints.length,
                    })}
                  </span>
                  <button
                    onClick={() => void createSketch(p)}
                    disabled={creating}
                    data-testid="reference-create-sketch"
                    className="rounded-md bg-cyan-400/90 px-2 py-0.5 font-medium text-black hover:bg-cyan-300 disabled:opacity-50"
                  >
                    {creating ? tt("ref.creatingSketch") : tt("ref.createSketch")}
                  </button>
                </div>
                <div className="pt-1 text-[11px] text-white/45">
                  {tt("ref.detectHint")}
                </div>
              </div>
            )}
          </div>
        ))}
        {error && <div className="pt-2 text-xs text-red-300">{error}</div>}
        {loadError && <div role="alert" className="pt-2 text-xs text-red-300">{loadError}</div>}
        {loadError && <button type="button" onClick={async () => {
          await reloadReferences(() => coreClient.readReferences(coreClient.documentId));
        }}>Retry reference images</button>}
        <div className="mt-3 flex gap-2">
          {measuring !== null && (
            <button
              onClick={cancelMeasure}
              className="rounded-md bg-white/10 px-3 py-1.5 text-sm hover:bg-white/15"
            >
              {tt("ref.cancelMeasure")}
            </button>
          )}
          <button
            onClick={() => {
              cancelMeasure();
              onClose();
            }}
            className="rounded-md bg-white/10 px-3 py-1.5 text-sm hover:bg-white/15"
          >
            {tt("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
