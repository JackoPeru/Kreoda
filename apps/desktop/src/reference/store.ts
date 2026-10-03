// Reference image planes, Stage A (§29, Phase 9c): calibrated background
// planes to trace sketches over. Images and calibration travel in the
// project manifest; they remain view aids outside the CAD undo history.

import { create } from "zustand";
import { z } from "zod";
import { imageDimensionsFromData } from "image-dimensions";

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
  revision: number;
  loadError: string | null;
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
  revision: 0,
  loadError: null,
}));

const ReferenceSchema = z.array(z.object({
  id: z.string().min(1).max(256),
  name: z.string().max(4096),
  dataUrl: z.string().max(MAX_REF_DATAURL).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/),
  imageW: z.number().int().positive().max(MAX_REF_DIM),
  imageH: z.number().int().positive().max(MAX_REF_DIM),
  widthMm: z.number().positive().max(1000000),
  heightMm: z.number().positive().max(1000000),
  plane: z.enum(["XY", "XZ", "YZ"]),
  opacity: z.number().min(0).max(1),
  mmPerPx: z.number().positive().nullable(),
}).refine(p => p.imageW * p.imageH <= MAX_REF_PIXELS)).max(MAX_REF_PLANES)
  .refine(planes => new Set(planes.map(p => p.id)).size === planes.length);

export function serializeReferences(): string {
  const s = useReferenceStore.getState();
  if (s.loadError) throw new Error(s.loadError);
  return JSON.stringify(ReferenceSchema.parse(s.planes));
}

/** Invalid metadata cannot render remote URLs or silently vanish on save. */
let referenceLoadGeneration = 0;
/** Reserve the generation before IPC so late reads cannot overwrite newer ones. */
export async function reloadReferences(read: () => Promise<string>): Promise<void> {
  void loadReferences(null);
  const generation = referenceLoadGeneration;
  try {
    const json = await read();
    if (generation === referenceLoadGeneration) await loadReferences(json);
  } catch {
    if (generation === referenceLoadGeneration) {
      useReferenceStore.setState({ loadError: "Reference images could not be loaded. Open Reference images and retry before saving." });
    }
  }
}

export async function loadReferences(json: string | null): Promise<void> {
  const generation = ++referenceLoadGeneration;
  useReferenceStore.setState(s => ({ planes: [], revision: s.revision + 1,
    loadError: "Reference images are loading. Try saving again when loading finishes." }));
  if (json === null) return;
  try {
    if (json.length > MAX_REF_PLANES * MAX_REF_DATAURL + 65536) throw new Error("too large");
    const planes = ReferenceSchema.parse(JSON.parse(json));
    for (const p of planes) {
      // Read headers before the viewport allocates decoded pixel buffers.
      const bytes = Uint8Array.from(atob(p.dataUrl.slice(p.dataUrl.indexOf(",") + 1)), c => c.charCodeAt(0));
      const size = imageDimensionsFromData(bytes);
      if (!size || !["png", "jpeg", "webp"].includes(size.type)) throw new Error("invalid image");
      validateReferenceImage(size.width, size.height, p.dataUrl.length);
      // JPEG EXIF rotation changes displayed dimensions. Decode only after
      // bounding its raw pixel allocation, then verify calibration coordinates.
      const displayed = size.type === "jpeg" ? await decodeImageSize(p.dataUrl) : { w: size.width, h: size.height };
      if (displayed.w !== p.imageW || displayed.h !== p.imageH) throw new Error("image dimensions changed");
    }
    if (generation !== referenceLoadGeneration) return;
    useReferenceStore.setState(s => ({ planes, loadError: null, revision: s.revision + 1 }));
  } catch {
    if (generation !== referenceLoadGeneration) return;
    useReferenceStore.setState(s => ({ planes: [], revision: s.revision + 1,
      loadError: "Reference images are damaged. Reopen a valid project before saving to preserve the original file." }));
  }
}

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
  useReferenceStore.setState((s) => ({ planes: [...s.planes, plane], revision: s.revision + 1 }));
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
    revision: s.revision + 1,
  }));
}

export function removeReferencePlane(id: string): void {
  useReferenceStore.setState((s) => ({
    planes: s.planes.filter((p) => p.id !== id),
    revision: s.revision + 1,
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
