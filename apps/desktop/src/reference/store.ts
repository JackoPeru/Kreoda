// Reference image planes, Stage A (§29, Phase 9c): calibrated background
// planes to trace sketches over. Renderer-SESSION state (like the grid —
// view aids, not CAD): not persisted, not undoable, never part of the
// model. Import (calibrated size) → trace → model; Stage B/C add vision.

import { create } from "zustand";

export type RefPlaneKind = "XY" | "XZ" | "YZ";

export interface ReferencePlane {
  id: string;
  name: string;
  dataUrl: string;
  imageW: number;
  imageH: number;
  /** Calibrated size; default = 1 px maps to 1 mm until calibrated. */
  widthMm: number;
  heightMm: number;
  plane: RefPlaneKind;
  opacity: number;
  mmPerPx: number | null;
}

interface ReferenceState {
  planes: ReferencePlane[];
}

/**
 * Calibrate from two clicks given DIRECTLY in image pixels (UV-mapped
 * raycast hits): pixel distance against the user-given real distance.
 * Pure + unit-tested; the store/viewport only apply it.
 */
export function calibrateSize(
  imageW: number,
  imageH: number,
  p1px: [number, number],
  p2px: [number, number],
  realMm: number,
): { widthMm: number; heightMm: number; mmPerPx: number } {
  if (!(realMm > 0) || !Number.isFinite(realMm) || realMm > 1000000) {
    throw new Error("calibration distance must be positive and ≤ 1000000 mm");
  }
  if (
    !Number.isFinite(imageW) ||
    !Number.isFinite(imageH) ||
    imageW <= 0 ||
    imageH <= 0
  ) {
    throw new Error("image has no pixels");
  }
  const pxDist = Math.hypot(p2px[0] - p1px[0], p2px[1] - p1px[1]);
  if (!(pxDist > 0) || !Number.isFinite(pxDist)) {
    throw new Error("calibration clicks must be two distinct points");
  }
  const mmPerPx = realMm / pxDist;
  if (!Number.isFinite(mmPerPx) || mmPerPx <= 0) {
    throw new Error("calibration failed (non-finite scale)");
  }
  const widthMm = imageW * mmPerPx;
  const heightMm = imageH * mmPerPx;
  // C9/M6: clamp runaway planes (1e12 mm → beyond camera.far, Infinity store).
  if (
    !Number.isFinite(widthMm) ||
    !Number.isFinite(heightMm) ||
    widthMm <= 0 ||
    heightMm <= 0 ||
    widthMm > 1000000 ||
    heightMm > 1000000
  ) {
    throw new Error("calibrated size out of range (max 1000000 mm)");
  }
  return {
    widthMm,
    heightMm,
    mmPerPx,
  };
}

let seq = 0;

// C9 bounds: file bytes alone (8 MiB) still decode to ~1 GiB RGBA at 16k².
export const MAX_REF_PIXELS = 16_000_000; // w*h ≤ 16 MP
export const MAX_REF_DIM = 8192; // each side ≤ 8192 px
export const MAX_REF_PLANES = 8;
export const MAX_REF_DATAURL = 12 * 1024 * 1024;

export function validateReferenceImage(
  imageW: number,
  imageH: number,
  dataUrlLength = 0,
): void {
  if (
    !Number.isFinite(imageW) ||
    !Number.isFinite(imageH) ||
    imageW <= 0 ||
    imageH <= 0
  ) {
    throw new Error("image has no pixels");
  }
  if (imageW > MAX_REF_DIM || imageH > MAX_REF_DIM) {
    throw new Error(`image too large (max ${MAX_REF_DIM}px per side)`);
  }
  if (imageW * imageH > MAX_REF_PIXELS) {
    throw new Error("image too large (max 16 MP)");
  }
  if (dataUrlLength > MAX_REF_DATAURL) {
    throw new Error("image data too large (max ~12 MB)");
  }
}

export const useReferenceStore = create<ReferenceState>(() => ({
  planes: [],
}));

export function addReferencePlane(p: {
  name: string;
  dataUrl: string;
  imageW: number;
  imageH: number;
}): ReferencePlane {
  // C9: E2E hook bypasses the 8 MiB host cap with arbitrary dataURLs —
  // enforce pixel/texture/count caps here (single choke point).
  validateReferenceImage(p.imageW, p.imageH, p.dataUrl.length);
  const existing = useReferenceStore.getState().planes.length;
  if (existing >= MAX_REF_PLANES) {
    throw new Error(`too many reference planes (max ${MAX_REF_PLANES})`);
  }
  if (!Number.isFinite(p.imageW) || !Number.isFinite(p.imageH)) {
    throw new Error("image has no pixels");
  }
  const plane: ReferencePlane = {
    id: `ref-${Date.now().toString(36)}-${seq++}`,
    name: p.name,
    dataUrl: p.dataUrl,
    imageW: p.imageW,
    imageH: p.imageH,
    widthMm: p.imageW,
    heightMm: p.imageH,
    plane: "XY",
    opacity: 0.85,
    mmPerPx: null,
  };
  useReferenceStore.setState((s) => ({ planes: [...s.planes, plane] }));
  return plane;
}

export function updateReferencePlane(
  id: string,
  patch: Partial<ReferencePlane>,
): void {
  // M6/C9: clamp runaway sizes (known-width overflow → Infinity store,
  // far beyond camera.far) at the single mutation point.
  const clean: Partial<ReferencePlane> = { ...patch };
  if (
    clean.widthMm !== undefined &&
    (!Number.isFinite(clean.widthMm) ||
      clean.widthMm <= 0 ||
      clean.widthMm > 1000000)
  ) {
    throw new Error("reference width out of range (max 1000000 mm)");
  }
  if (
    clean.heightMm !== undefined &&
    (!Number.isFinite(clean.heightMm) ||
      clean.heightMm <= 0 ||
      clean.heightMm > 1000000)
  ) {
    throw new Error("reference height out of range (max 1000000 mm)");
  }
  useReferenceStore.setState((s) => ({
    planes: s.planes.map((p) => (p.id === id ? { ...p, ...clean } : p)),
  }));
}

export function removeReferencePlane(id: string): void {
  useReferenceStore.setState((s) => ({
    planes: s.planes.filter((p) => p.id !== id),
  }));
}

/** Load an image data URL for dimensions (async decode, honest errors). */
export function decodeImageSize(dataUrl: string): Promise<{
  w: number;
  h: number;
}> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth <= 0 || img.naturalHeight <= 0) {
        reject(new Error("image has no pixels"));
        return;
      }
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.onerror = () => reject(new Error("cannot decode image"));
    img.src = dataUrl;
  });
}
