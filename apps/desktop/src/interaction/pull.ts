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

/** Structural mesh view for centroid math (CoreMeshData satisfies this). */
export interface CentroidMesh {
  faces: {
    persistentFaceId: string;
    triangleStart: number;
    triangleCount: number;
  }[];
  positions: ArrayLike<number>;
  indices: ArrayLike<number>;
}

/**
 * World centroid of one face (default hole position, chip anchors).
 * Averages up to maxTris triangles so side faces whose first triangle sits
 * at an edge don't skew the center. Returns null when unreadable.
 */
export function faceCentroid(
  mesh: CentroidMesh,
  persistentFaceId: string,
  maxTris = 16,
): [number, number, number] | null {
  const range = mesh.faces.find((f) => f.persistentFaceId === persistentFaceId);
  if (!range || range.triangleCount <= 0) return null;
  let cx = 0,
    cy = 0,
    cz = 0,
    n = 0;
  const tris = Math.min(range.triangleCount, maxTris);
  for (let t = 0; t < tris; t++) {
    for (let k = 0; k < 3; k++) {
      const vi = mesh.indices[(range.triangleStart + t) * 3 + k]!;
      cx += mesh.positions[vi * 3]!;
      cy += mesh.positions[vi * 3 + 1]!;
      cz += mesh.positions[vi * 3 + 2]!;
      n++;
    }
  }
  if (n === 0) return null;
  return [cx / n, cy / n, cz / n];
}

/** Face plane frame in world coords (see coreClient.requestFaceInfo). */
export interface FaceFrame {
  originMm: [number, number, number];
  xAxis: [number, number, number];
  yAxis: [number, number, number];
}

/** World point → face-local (x, y) through the core face frame (§10). */
export function faceLocalFromWorld(
  frame: FaceFrame,
  world: [number, number, number],
): { x: number; y: number } {
  const dx = [
    world[0] - frame.originMm[0],
    world[1] - frame.originMm[1],
    world[2] - frame.originMm[2],
  ];
  const dot = (a: number[], b: [number, number, number]): number =>
    a[0]! * b[0] + a[1]! * b[1] + a[2]! * b[2];
  return { x: dot(dx, frame.xAxis), y: dot(dx, frame.yAxis) };
}
