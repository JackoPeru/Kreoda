export const surfaceCommandIds = [
  "CreateSurfaceExtrude",
  "CreateSurfaceRevolve",
  "CreateSurfaceLoft",
  "CreateSurfaceSew",
  "CreateSurfaceOffset",
  "CreateSurfaceSweep",
  "CreateSurfaceThicken",
  "CreateSurfaceTrim",
  "CreateSurfaceExtend",
] as const;

export type SurfaceCommandId = (typeof surfaceCommandIds)[number];

export function isSurfaceCommandId(id: string): id is SurfaceCommandId {
  return (surfaceCommandIds as readonly string[]).includes(id);
}

export type SurfaceCommandContext = {
  documentId: string;
  revision: number;
  epoch: number;
  connectionGeneration: number;
  sessionId?: string;
};
