// UX-2 selection anchor: shared viewport-space anchor for the contextual
// toolbar (and any future overlay). Same imperative principle as
// DimensionChips: plain reads, no React state, safe to call every frame.
// Faces reuse centroid + projection; edges use their polyline midpoint;
// bodies use the mesh bounding-box top-center (display only — the CAD
// model is never touched). Sketches have no 3D anchor (null → the toolbar
// falls back to its default docked spot).
import { faceCentroid } from "./pull";
import {
  isSketchId,
  selectionKindOf,
  useDocumentUiStore,
  useSelectionStore,
} from "../stores";
import { viewportProjectPoint } from "../viewport/viewportHandle";

type World = [number, number, number];

// Bbox cache: positions scans run only when the mesh revision changes,
// never per frame.
const bodyCache = new Map<string, { rev: number; world: World | null }>();

function bodyAnchorWorld(featureId: string): World | null {
  const mesh = useDocumentUiStore.getState().meshes[featureId];
  if (!mesh || mesh.positions.length < 3) return null;
  const hit = bodyCache.get(featureId);
  if (hit && hit.rev === mesh.revision) return hit.world;
  if (bodyCache.size > 64) bodyCache.clear();
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  const p = mesh.positions;
  for (let i = 0; i + 2 < p.length; i += 3) {
    const x = p[i]!,
      y = p[i + 1]!,
      z = p[i + 2]!;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  const world: World | null =
    Number.isFinite(minX) && Number.isFinite(maxZ)
      ? [(minX + maxX) / 2, (minY + maxY) / 2, maxZ]
      : null;
  bodyCache.set(featureId, { rev: mesh.revision, world });
  return world;
}

function edgeAnchorWorld(featureId: string, edgeId: string): World | null {
  const mesh = useDocumentUiStore.getState().meshes[featureId];
  if (!mesh) return null;
  const range = mesh.edges.find((e) => e.persistentEdgeId === edgeId);
  if (!range || range.vertexCount <= 0) return null;
  const v = mesh.edgeVertices;
  let cx = 0,
    cy = 0,
    cz = 0,
    n = 0;
  const end = Math.min(
    range.vertexStart + range.vertexCount,
    Math.floor(v.length / 3),
  );
  for (let i = range.vertexStart; i < end; i++) {
    cx += v[i * 3]!;
    cy += v[i * 3 + 1]!;
    cz += v[i * 3 + 2]!;
    n++;
  }
  if (n === 0) return null;
  return [cx / n, cy / n, cz / n];
}

function faceAnchorWorld(featureId: string, faceId: string): World | null {
  const mesh = useDocumentUiStore.getState().meshes[featureId];
  if (!mesh) return null;
  const cut = faceId.indexOf(":");
  const role = cut >= 0 ? faceId.slice(cut + 1) : faceId;
  // Same tolerant match as the viewport picker (full id or role suffix).
  const rec = mesh.faces.find(
    (f) =>
      f.persistentFaceId === faceId ||
      f.persistentFaceId === role ||
      f.persistentFaceId.endsWith(`:${role}`),
  );
  if (!rec) return null;
  return faceCentroid(mesh, rec.persistentFaceId, 8);
}

/**
 * Viewport-space anchor (px, overlay origin) for the first selection item,
 * or null when there is nothing to anchor to (empty selection, sketch
 * nouns, missing mesh, point behind the camera).
 */
export function selectionAnchorPoint(): { x: number; y: number } | null {
  const sel = useSelectionStore.getState().selectedIds;
  const first = sel[0];
  if (first === undefined || isSketchId(first)) return null;
  const kind = selectionKindOf(first);
  const cut = first.indexOf(":");
  const featureId = cut < 0 ? first : first.slice(0, cut);
  let world: World | null = null;
  if (kind === "face") world = faceAnchorWorld(featureId, first);
  else if (kind === "edge") world = edgeAnchorWorld(featureId, first);
  else world = bodyAnchorWorld(featureId);
  // A face/edge whose record vanished (post-undo stale mesh) still gets a
  // useful anchor from its owner body instead of jumping to the default.
  if (!world && kind !== "body") world = bodyAnchorWorld(featureId);
  if (!world) return null;
  return viewportProjectPoint(world);
}
