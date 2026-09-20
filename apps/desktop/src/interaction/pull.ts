// Direct manipulation mapping (§17): a dragged face edits its SOURCE
// parameter — never raw vertices. Corner-anchored primitives only expose
// their free faces (+X/+Y/+Z caps, cylinder wall, sphere); anchored faces
// report an honest reason instead of a wrong edit.

export interface PullTarget {
  featureId: string;
  faceId: string;
  paramName: string;
  startValueMm: number;
}

export type PullResolution =
  | { ok: true; target: PullTarget }
  | { ok: false; reason: string };

const FREE_FACES: Record<string, { param: string; slot: number }> = {
  "Box|box.+X": { param: "widthMm", slot: 0 },
  "Box|box.+Y": { param: "heightMm", slot: 1 },
  "Box|box.+Z": { param: "depthMm", slot: 2 },
  "Cylinder|cyl.+Z": { param: "heightMm", slot: 1 },
  "Cylinder|cyl.wall": { param: "radiusMm", slot: 0 },
  "Sphere|sph.all": { param: "radiusMm", slot: 0 },
};

export function resolvePullTarget(
  feature: { featureId: string; type: string; paramsMm: number[] },
  faceId: string,
): PullResolution {
  const cut = faceId.indexOf(":");
  const role = cut < 0 ? faceId : faceId.slice(cut + 1);
  const key = `${feature.type}|${role}`;
  const mapping = FREE_FACES[key];
  if (!mapping) {
    return {
      ok: false,
      reason: `This face is anchored (${role || "unknown"}) — pull the highlighted + face instead`,
    };
  }
  const startValueMm = feature.paramsMm[mapping.slot];
  if (!(startValueMm! > 0)) {
    return { ok: false, reason: "Cannot read the source dimension" };
  }
  return {
    ok: true,
    target: {
      featureId: feature.featureId,
      faceId,
      paramName: mapping.param,
      startValueMm: startValueMm!,
    },
  };
}

/** Clamp a dragged dimension to the kernel-valid range (mm). */
export function clampDimension(valueMm: number): number {
  if (!Number.isFinite(valueMm)) return 0.1;
  return Math.min(100000, Math.max(0.1, valueMm));
}
