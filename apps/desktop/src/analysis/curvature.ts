export interface CurvatureSettings { enabled: boolean; maximumPerMm: number }
export const defaultCurvatureSettings: CurvatureSettings = { enabled: false, maximumPerMm: .1 };
export function validCurvatureSettings(value: CurvatureSettings): boolean {
  const maximum = Math.fround(value.maximumPerMm);
  return typeof value.enabled === "boolean" && typeof value.maximumPerMm === "number" && Number.isFinite(maximum) && maximum > 0;
}
