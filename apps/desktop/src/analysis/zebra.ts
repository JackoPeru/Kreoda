import { create } from "zustand";
import { defaultCurvatureSettings, validCurvatureSettings, type CurvatureSettings } from "./curvature";

export interface ZebraSettings { enabled: boolean; bands: number; angleDeg: number }
export const defaultZebraSettings: ZebraSettings = { enabled: false, bands: 16, angleDeg: 0 };
export function validZebraSettings(value: ZebraSettings): boolean {
  return typeof value.enabled === "boolean" && Number.isInteger(value.bands) && value.bands >= 4 && value.bands <= 48 &&
    Number.isFinite(value.angleDeg) && value.angleDeg >= 0 && value.angleDeg <= 180;
}
export const useZebraStore = create<ZebraSettings & {
  curvature: CurvatureSettings;
  setCurvature: (patch: Partial<CurvatureSettings>) => void;
  update: (patch: Partial<ZebraSettings>) => void; reset: () => void;
}>((set, get) => ({
  ...defaultZebraSettings,
  curvature: { ...defaultCurvatureSettings },
  // The two surface inspections share the existing document-reset lifecycle.
  update: patch => {
    const next = { ...get(), ...patch };
    if (validZebraSettings(next)) set({ ...next, ...(next.enabled ? { curvature: { ...next.curvature, enabled: false } } : {}) });
  },
  setCurvature: patch => {
    const next = { ...get().curvature, ...patch };
    if (validCurvatureSettings(next)) set({ curvature: next, ...(next.enabled ? { enabled: false } : {}) });
  },
  reset: () => set({ ...defaultZebraSettings, curvature: { ...defaultCurvatureSettings } }),
}));
