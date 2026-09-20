// Test/E2E bridge to the imperative viewport (no React state involved).
// Registered on mount; null when unmounted.

export interface FaceAnchor {
  x: number;
  y: number;
  nx: number;
  ny: number;
}

export type ViewName = "top" | "front" | "right" | "iso" | "bottom" | "back" | "left";

interface ViewportHandle {
  faceScreenPoint: (featureId: string, role: string) => FaceAnchor | null;
  setView: (name: ViewName) => void;
  /** World mm → viewport-element px (DOM overlay space); null if behind. */
  projectPoint: (p: [number, number, number]) => { x: number; y: number } | null;
  /** Normalized camera view direction (target − position); null if unready. */
  viewDir: () => [number, number, number] | null;
  /** Next two clicks on a reference plane as image pixels (§29 Stage A). */
  beginReferenceMeasure: (id: string) => Promise<[number, number][] | null>;
  cancelReferenceMeasure: () => void;
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
