import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createSurface: vi.fn(), requestSnapshot: vi.fn(), sync: vi.fn() }));
vi.mock("../src/ipc/coreClient", () => ({
  coreClient: { documentId: "surface-doc", createSurface: mocks.createSurface, requestSnapshot: mocks.requestSnapshot },
}));
vi.mock("../src/model/sync", () => ({ syncFromCoreList: mocks.sync, pullFeatureMesh: vi.fn(), updateFeatureSummary: vi.fn() }));

import { executeCommand } from "../src/commands/execute";
import { coreClient } from "../src/ipc/coreClient";
import { useDocumentUiStore } from "../src/stores";

const SESSION_ID = "b818bf60-237e-4d1f-9f03-f286c4c58ac7";
const surface = (featureId: string, type = "SurfaceExtrude", extra: Record<string, unknown> = {}) => ({
  featureId, type, paramsMm: [], dependsOn: [], refExtra: "", expressions: {}, geometryCurrent: true, status: "ok", ...extra,
});
const created = {
  featureId: "surface-created", type: "SurfaceTrim", paramsMm: [], dependsOn: ["surface-a"], refExtra: "", expressions: {},
  bboxMm: [0, 0, 0, 1, 1, 1] as [number, number, number, number, number, number], revision: 8,
};
const trim = {
  targetId: "surface-a", toolId: "datum-plane",
  keepFace: { type: "face" as const, featureId: "surface-a", persistentFaceId: "surface-a:face-1" },
  keepUv: [0.25, 0.75] as [number, number], toleranceMm: 0.000001,
};
const extend = {
  targetId: "surface-instance",
  boundaryEdge: { type: "edge" as const, featureId: "surface-instance", persistentEdgeId: "surface-instance:edge-1" },
  distanceMm: 20, toleranceMm: 0.01,
};

function context() {
  const state = useDocumentUiStore.getState();
  return { documentId: state.documentId, revision: state.revision, epoch: state.epoch, connectionGeneration: state.connectionGeneration, sessionId: SESSION_ID };
}

beforeEach(() => {
  vi.clearAllMocks();
  useDocumentUiStore.getState().resetDocument("surface-doc");
  useDocumentUiStore.getState().setCoreStatus(true, "test");
  useDocumentUiStore.getState().setFeatures([
    surface("surface-a"), surface("surface-b", "SurfaceOffset"),
    surface("surface-instance", "Instance", { dependsOn: ["surface-a"] }),
    surface("solid", "SurfaceThicken"),
  ], 7);
  useDocumentUiStore.getState().setDatums([{
    featureId: "datum-plane", kind: "DatumPlane", status: "ok", dependsOn: [],
    definition: { type: "principal" }, resolved: {},
  } as never], 7);
  (coreClient as unknown as { documentId: string }).documentId = "surface-doc";
  mocks.createSurface.mockResolvedValue(created);
  mocks.requestSnapshot.mockResolvedValue({
    features: [surface("surface-a"), surface("surface-b", "SurfaceOffset"), created],
    sketches: [], datums: [], revision: 8,
  });
  mocks.sync.mockResolvedValue(undefined);
});

it.each([
  ["CreateSurfaceTrim", trim],
  ["CreateSurfaceExtend", extend],
] as const)("dispatches %s through the ordinary surface create and refresh path", async (id, params) => {
  await executeCommand(id, params, { surfaceContext: context() });
  expect(mocks.createSurface).toHaveBeenCalledWith(id, params, context());
  expect(mocks.requestSnapshot).toHaveBeenCalledWith(context());
  expect(mocks.sync).toHaveBeenCalledOnce();
});

it("accepts distinct healthy surface instances and surfaces or a healthy DatumPlane tool", async () => {
  await executeCommand("CreateSurfaceTrim", trim, { surfaceContext: context() });
  const trimInstance = {
    ...trim,
    targetId: "surface-instance",
    keepFace: { ...trim.keepFace, featureId: "surface-instance", persistentFaceId: "surface-instance:face-1" },
  };
  await executeCommand("CreateSurfaceTrim", trimInstance, { surfaceContext: context() });
  expect(mocks.createSurface).toHaveBeenCalledTimes(2);
  mocks.createSurface.mockClear();

  await expect(executeCommand("CreateSurfaceTrim", { ...trim, toolId: "surface-a" }, { surfaceContext: context() })).rejects.toThrow();
  await expect(executeCommand("CreateSurfaceTrim", { ...trim, toolId: "solid" }, { surfaceContext: context() })).rejects.toThrow();
  useDocumentUiStore.getState().setDatums([{
    featureId: "datum-plane", kind: "DatumPlane", status: "broken", error: "missing reference", dependsOn: [],
    definition: { type: "principal" }, resolved: {},
  } as never], 7);
  await expect(executeCommand("CreateSurfaceTrim", trim, { surfaceContext: context() })).rejects.toThrow();
  expect(mocks.createSurface).not.toHaveBeenCalled();
});

it("rejects unavailable, stale, and wrong-owner Extend targets before native dispatch", async () => {
  await expect(executeCommand("CreateSurfaceExtend", { ...extend, targetId: "solid", boundaryEdge: { ...extend.boundaryEdge, featureId: "solid" } }, { surfaceContext: context() })).rejects.toThrow();
  await expect(executeCommand("CreateSurfaceExtend", { ...extend, targetId: "missing", boundaryEdge: { ...extend.boundaryEdge, featureId: "missing" } }, { surfaceContext: context() })).rejects.toThrow();
  await expect(executeCommand("CreateSurfaceExtend", { ...extend, boundaryEdge: { ...extend.boundaryEdge, featureId: "surface-a" } }, { surfaceContext: context() })).rejects.toThrow();
  const stale = context();
  useDocumentUiStore.getState().setFeatures(useDocumentUiStore.getState().features, 8);
  await expect(executeCommand("CreateSurfaceExtend", extend, { surfaceContext: stale })).rejects.toThrow(/document changed|stale/i);
  expect(mocks.createSurface).not.toHaveBeenCalled();
});

