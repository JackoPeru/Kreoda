// Test/E2E bridge to the imperative viewport (no React state involved).
// Registered on mount; null when unmounted.

import type { SectionPlane } from "../section/plane";

export interface FaceAnchor {
  x: number;
  y: number;
  nx: number;
  ny: number;
  /** Native outward world-space normal at the selected point. */
  normal: [number, number, number];
  /** World-space point used to derive the screen anchor. */
  point: [number, number, number];
}

export interface SectionGeometryDiagnostics {
  capTriangleCount: number;
  capAreaMm2: number;
  capCoversSample: boolean;
  rayCandidates: number;
  frontSideWallHits: number;
  frontSideUnoccludedWallHits: number;
  doubleSideWallHits: number;
  capOccludesDoubleSideWallHits: number;
  productionWallHits: number;
  nativeMaterialSides: string[];
  nativeFace: {
    persistentFaceId: string;
    triangleCount: number;
    zBoundsMm: [number, number];
    windingOpposedTriangles: number;
  } | null;
}

export type ViewName = "top" | "front" | "right" | "iso" | "bottom" | "back" | "left";

export interface ViewportRenderStats {
  renderedFrames: number;
  renderCpuTotalMs: number;
  renderCpuMaxMs: number;
  triangles: number;
  geometries: number;
  textures: number;
  section: {
    enabled: boolean;
    plane: SectionPlane | null;
    cappedBodies: number;
    contourSegments: number;
  };
}

interface ViewportHandle {
  faceScreenPoint: (featureId: string, role: string) => FaceAnchor | null;
  sectionGeometryDiagnostics: (
    featureId: string,
    samplePointMm: [number, number, number],
    faceRole: string,
  ) => SectionGeometryDiagnostics | null;
  setView: (name: ViewName) => void;
  /** World mm → viewport-element px (DOM overlay space); null if behind. */
  projectPoint: (p: [number, number, number]) => { x: number; y: number } | null;
  /** Normalized camera view direction (target − position); null if unready. */
  viewDir: () => [number, number, number] | null;
  /** Next two clicks on a reference plane as image pixels (§29 Stage A). */
  beginReferenceMeasure: (id: string) => Promise<[number, number][] | null>;
  cancelReferenceMeasure: () => void;
  renderStats: () => ViewportRenderStats | null;
  meshIdentity: (featureId: string) => { geometryId: string; revision: number } | null;
  sharedTargetSummary: () => { ids: string[]; faceGroups: number; edgeSegments: number } | null;
}

let handle: ViewportHandle | null = null;

export function setViewportHandle(h: ViewportHandle | null): void {
  handle = h;
}

export function faceScreenPoint(
  featureId: string,
  role: string,
): FaceAnchor | null {
  return handle?.faceScreenPoint(featureId, role) ?? null;
}

export function viewportSectionGeometryDiagnostics(
  featureId: string,
  samplePointMm: [number, number, number],
  faceRole: string,
): SectionGeometryDiagnostics | null {
  return handle?.sectionGeometryDiagnostics(featureId, samplePointMm, faceRole) ?? null;
}

export function viewportSetView(name: ViewName): boolean {
  if (!handle) return false;
  handle.setView(name);
  return true;
}

export function viewportProjectPoint(
  p: [number, number, number],
): { x: number; y: number } | null {
  return handle?.projectPoint(p) ?? null;
}

export function viewportViewDir(): [number, number, number] | null {
  return handle?.viewDir() ?? null;
}

export function viewportBeginReferenceMeasure(
  id: string,
): Promise<[number, number][] | null> {
  if (!handle) return Promise.resolve(null);
  return handle.beginReferenceMeasure(id);
}

export function viewportCancelReferenceMeasure(): void {
  handle?.cancelReferenceMeasure();
}

export function viewportRenderStats(): ViewportRenderStats | null {
  return handle?.renderStats() ?? null;
}

export function viewportMeshIdentity(featureId: string): { geometryId: string; revision: number } | null {
  return handle?.meshIdentity(featureId) ?? null;
}

export function viewportSharedTargetSummary(): { ids: string[]; faceGroups: number; edgeSegments: number } | null {
  return handle?.sharedTargetSummary() ?? null;
}
