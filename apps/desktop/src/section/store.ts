import { create } from "zustand";
import { createSectionPlane, isSectionPlane, type SectionPlane } from "./plane";

export interface SectionViewState {
  enabled: boolean;
  initialized: boolean;
  plane: SectionPlane;
  setEnabled: (enabled: boolean) => void;
  setPlane: (plane: SectionPlane) => void;
  reset: (plane?: SectionPlane) => void;
}

const initialPlane = (): SectionPlane => createSectionPlane([0, 0, 1], 0)!;

export const useSectionStore = create<SectionViewState>((set) => ({
  enabled: false,
  initialized: false,
  plane: initialPlane(),
  setEnabled: (enabled) => set({ enabled }),
  setPlane: (plane) => {
    if (isSectionPlane(plane)) set({ initialized: true, plane: { ...plane, normal: [...plane.normal] } });
  },
  reset: (plane) => {
    const next = plane ?? initialPlane();
    if (isSectionPlane(next)) set({ enabled: false, initialized: plane !== undefined, plane: { ...next, normal: [...next.normal] } });
  },
}));
