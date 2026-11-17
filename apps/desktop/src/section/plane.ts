export type CadPointMm = readonly [number, number, number];
export type SectionNormal = readonly [number, number, number];

export const SECTION_OFFSET_LIMIT_MM = 1_000_000;
export const SECTION_PICK_TOLERANCE_MM = 1e-6;
const UNIT_NORMAL_TOLERANCE = 1e-6;

export interface SectionPlane {
  normal: [number, number, number];
  offsetMm: number;
  inverted: boolean;
}

export function createSectionPlane(
  normal: SectionNormal,
  offsetMm: number,
  inverted = false,
): SectionPlane | null {
  const plane = { normal: [...normal] as [number, number, number], offsetMm, inverted };
  return isSectionPlane(plane) ? plane : null;
}

export function isSectionPlane(value: unknown): value is SectionPlane {
  if (!value || typeof value !== "object") return false;
  const plane = value as Partial<SectionPlane>;
  if (!Array.isArray(plane.normal) || plane.normal.length !== 3 || typeof plane.inverted !== "boolean") return false;
  if (!plane.normal.every(Number.isFinite) || !Number.isFinite(plane.offsetMm) ||
      Math.abs(plane.offsetMm!) > SECTION_OFFSET_LIMIT_MM) return false;
  const magnitude = Math.hypot(...plane.normal);
  return Math.abs(magnitude - 1) <= UNIT_NORMAL_TOLERANCE;
}

export function signedDistanceMm(point: CadPointMm, plane: SectionPlane): number {
  if (!isSectionPlane(plane) || !point.every(Number.isFinite)) return Number.NaN;
  const side = point[0] * plane.normal[0] + point[1] * plane.normal[1] + point[2] * plane.normal[2] - plane.offsetMm;
  return plane.inverted ? -side : side;
}

export function isVisibleAtSection(
  point: CadPointMm,
  plane: SectionPlane,
  toleranceMm = SECTION_PICK_TOLERANCE_MM,
): boolean {
  if (!Number.isFinite(toleranceMm) || toleranceMm < 0) return false;
  return signedDistanceMm(point, plane) >= -toleranceMm;
}
