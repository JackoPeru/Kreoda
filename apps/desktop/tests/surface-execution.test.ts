import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSurface: vi.fn(),
  requestSnapshot: vi.fn(),
  sync: vi.fn(),
}));

vi.mock("../src/ipc/coreClient", () => ({
  coreClient: { documentId: "surface-doc", createSurface: mocks.createSurface, requestSnapshot: mocks.requestSnapshot },
}));
vi.mock("../src/model/sync", () => ({
  syncFromCoreList: mocks.sync,
  pullFeatureMesh: vi.fn(),
  updateFeatureSummary: vi.fn(),
}));

import { executeCommand, commandAvailability, refreshSurfaceSnapshot } from "../src/commands/execute";
import { coreClient } from "../src/ipc/coreClient";
import { useDocumentUiStore, useSelectionStore } from "../src/stores";

const sketch = (featureId: string) => ({
  featureId, planeKind: "XY", points: 4, lines: 4, circles: 0, constraints: 0,
  geometryCurrent: true, status: "ok", model: { points: [], lines: [], circles: [], arcs: [], constraints: [] },
});
const surface = (featureId: string, type = "SurfaceExtrude") => ({
  featureId, type, paramsMm: [], dependsOn: [], refExtra: "", expressions: {},
  geometryCurrent: true, status: "ok",
});
const created = {
  featureId: "surface-created", type: "SurfaceExtrude", paramsMm: [], dependsOn: ["sk-a"],
  refExtra: "", expressions: {}, bboxMm: [0, 0, 0, 1, 1, 1] as [number, number, number, number, number, number], revision: 8,
};
const surfaceCases: [string, Record<string, unknown>][] = [
  ["CreateSurfaceExtrude", { sketchId: "sk-a", distanceMm: 10 }],
  ["CreateSurfaceRevolve", { sketchId: "sk-a", angleDeg: 90, axisOriginXMm: 0, axisOriginYMm: 0, axisOriginZMm: 0, axisX: 1, axisY: 0, axisZ: 0 }],
  ["CreateSurfaceLoft", { sketchIds: ["sk-a", "sk-b"] }],
  ["CreateSurfaceSew", { featureIds: ["surface-a", "surface-b"], toleranceMm: 0.01, makeSolid: false }],
  ["CreateSurfaceOffset", { targetId: "surface-a", distanceMm: -1, toleranceMm: 0.000001 }],
  ["CreateSurfaceThicken", { targetId: "surface-a", thicknessMm: -1, toleranceMm: 0.000001 }],
  ["CreateSurfaceSweep", { profileSketchId: "sk-a", pathSketchId: "sk-b", toleranceMm: 0.000001 }],
];

function captureContext() {
  const state = useDocumentUiStore.getState();
  return {
    documentId: state.documentId,
    revision: state.revision,
    epoch: state.epoch,
    connectionGeneration: state.connectionGeneration,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useDocumentUiStore.getState().resetDocument("surface-doc");
  useDocumentUiStore.getState().setCoreStatus(true, "test");
  useDocumentUiStore.getState().setFeatures([surface("surface-a"), surface("surface-b", "SurfaceOffset")], 7);
  useDocumentUiStore.getState().setSketches([sketch("sk-a"), sketch("sk-b")], 7);
  useSelectionStore.getState().clear();
  (coreClient as unknown as { documentId: string }).documentId = "surface-doc";
  mocks.createSurface.mockResolvedValue(created);
  mocks.requestSnapshot.mockResolvedValue({
    features: [surface("surface-a"), surface("surface-b", "SurfaceOffset"), surface("surface-created")],
    sketches: [sketch("sk-a"), sketch("sk-b")], datums: [], revision: 8,
  });
  mocks.sync.mockResolvedValue(undefined);
});

it.each(surfaceCases)("dispatches %s with explicit healthy local sources and canonical refresh", async (id, params) => {
  const result = await executeCommand(id, params, { surfaceContext: captureContext() } as never);

  expect(mocks.createSurface).toHaveBeenCalledWith(id, params, captureContext());
  expect(mocks.requestSnapshot).toHaveBeenCalledWith(captureContext());
  expect(mocks.sync).toHaveBeenCalledOnce();
  expect(result).toMatchObject({ kind: "created", feature: { featureId: created.featureId } });
});

it("lets a form execute sweep without mutating global selection, while keeping the toolbar hint", async () => {
  const params = { profileSketchId: "sk-a", pathSketchId: "sk-b", toleranceMm: 0.000001 };

  expect(commandAvailability("CreateSurfaceSweep").available).toBe(false);
  await executeCommand("CreateSurfaceSweep", params, { surfaceContext: captureContext() } as never);

  expect(useSelectionStore.getState().selectedIds).toEqual([]);
  expect(mocks.createSurface).toHaveBeenCalledWith("CreateSurfaceSweep", params, captureContext());
});

it("rejects missing, stale, duplicate, or wrong-kind sources before native dispatch", async () => {
  const missingSource = { sketchId: "missing", distanceMm: 10 };
  await expect(executeCommand("CreateSurfaceExtrude", missingSource, { surfaceContext: captureContext() } as never)).rejects.toThrow();
  await expect(executeCommand("CreateSurfaceSweep", { profileSketchId: "sk-a", pathSketchId: "sk-a", toleranceMm: 0.000001 }, { surfaceContext: captureContext() } as never)).rejects.toThrow();
  useDocumentUiStore.getState().setSketches([sketch("sk-a"), { ...sketch("sk-b"), status: "broken", geometryCurrent: false }], 7);
  await expect(executeCommand("CreateSurfaceLoft", { sketchIds: ["sk-a", "sk-b"] }, { surfaceContext: captureContext() } as never)).rejects.toThrow();
  useDocumentUiStore.getState().setSketches([sketch("sk-a"), sketch("sk-b")], 7);
  const stale = captureContext();
  useDocumentUiStore.getState().setFeatures(useDocumentUiStore.getState().features, 8);
  await expect(executeCommand("CreateSurfaceExtrude", { sketchId: "sk-a", distanceMm: 10 }, { surfaceContext: stale } as never)).rejects.toThrow(/document changed|stale/i);
  expect(mocks.createSurface).not.toHaveBeenCalled();
});

it("keeps skipAvailability source authority with native for provider dispatch", async () => {
  const params = { sketchId: "not-in-local-cache", distanceMm: 10 };
  useDocumentUiStore.getState().setSketches([], 7);

  await expect(executeCommand("CreateSurfaceExtrude", params, { surfaceContext: captureContext() } as never)).rejects.toThrow();
  expect(mocks.createSurface).not.toHaveBeenCalled();

  await executeCommand("CreateSurfaceExtrude", params, { skipAvailability: true, surfaceContext: captureContext() } as never);
  expect(mocks.createSurface).toHaveBeenCalledWith("CreateSurfaceExtrude", params, captureContext());
});

it("rejects solids and invalid signed thickness before thicken dispatch", async () => {
  await expect(executeCommand("CreateSurfaceThicken", { targetId: "surface-a", thicknessMm: 0 })).rejects.toThrow();
  useDocumentUiStore.getState().setFeatures([surface("solid", "SurfaceThicken")], 7);
  await expect(executeCommand("CreateSurfaceThicken", { targetId: "solid", thicknessMm: 1 })).rejects.toThrow();
  expect(mocks.createSurface).not.toHaveBeenCalled();
});

it("rejects surface context on another command id", async () => {
  await expect(executeCommand("CreateBox", { widthMm: 1, heightMm: 1, depthMm: 1 }, { surfaceContext: captureContext() } as never)).rejects.toThrow();
  expect(mocks.createSurface).not.toHaveBeenCalled();
});

it("reports acknowledged creation when canonical refresh fails", async () => {
  mocks.requestSnapshot.mockRejectedValueOnce(new Error("snapshot unavailable"));

  const result = await executeCommand("CreateSurfaceExtrude", { sketchId: "sk-a", distanceMm: 10 }, { surfaceContext: captureContext() } as never);

  expect(result).toMatchObject({ kind: "created", feature: { featureId: created.featureId }, refreshError: "snapshot unavailable" });
  expect(mocks.createSurface).toHaveBeenCalledOnce();
});

it("uses a current full session snapshot for guarded refresh when native sketches are summaries", async () => {
  const context = captureContext();
  const { model: _modelA, ...summaryA } = sketch("sk-a");
  const { model: _modelB, ...summaryB } = sketch("sk-b");
  const features = [surface("surface-a"), surface("surface-created")];
  mocks.requestSnapshot.mockResolvedValueOnce({ features, sketches: [summaryA, summaryB], datums: [], revision: 8 });
  const sessionSnapshot = vi.fn().mockResolvedValue({
    documentId: "surface-doc", revision: 8, features, sketches: [sketch("sk-a"), sketch("sk-b")], datums: [],
  });
  const targetWindow = window as unknown as { kreoda?: { sessionSnapshot?: () => Promise<unknown> } };
  const originalKreoda = targetWindow.kreoda;
  targetWindow.kreoda = { ...(originalKreoda ?? {}), sessionSnapshot };

  try {
    await refreshSurfaceSnapshot(context);
    expect(sessionSnapshot).toHaveBeenCalledOnce();
    expect(mocks.sync).toHaveBeenCalledWith(features, 8, [sketch("sk-a"), sketch("sk-b")], null, [], expect.any(Function));
  } finally {
    targetWindow.kreoda = originalKreoda;
  }
});

it("refuses a mismatched full snapshot without syncing summaries or cached models", async () => {
  const context = captureContext();
  const { model: _model, ...summary } = sketch("sk-a");
  mocks.requestSnapshot.mockResolvedValueOnce({ features: [surface("surface-created")], sketches: [summary], datums: [], revision: 8 });
  const sessionSnapshot = vi.fn().mockResolvedValue({
    documentId: "other-doc", revision: 8, features: [surface("surface-created")], sketches: [sketch("sk-a")], datums: [],
  });
  const targetWindow = window as unknown as { kreoda?: { sessionSnapshot?: () => Promise<unknown> } };
  const originalKreoda = targetWindow.kreoda;
  targetWindow.kreoda = { ...(originalKreoda ?? {}), sessionSnapshot };

  try {
    await expect(refreshSurfaceSnapshot(context)).rejects.toThrow(/document changed|stale/i);
    expect(mocks.sync).not.toHaveBeenCalled();
  } finally {
    targetWindow.kreoda = originalKreoda;
  }
});

it("retries canonical refresh read-only and refuses stale lineage", async () => {
  const context = captureContext();
  await refreshSurfaceSnapshot(context);
  expect(mocks.requestSnapshot).toHaveBeenCalledWith(context);
  expect(mocks.createSurface).not.toHaveBeenCalled();
  expect(mocks.sync).toHaveBeenCalledOnce();

  useDocumentUiStore.getState().resetDocument("replacement-doc");
  await expect(refreshSurfaceSnapshot(context)).rejects.toThrow(/document changed|stale/i);
  expect(mocks.createSurface).not.toHaveBeenCalled();
});

it("ignores late creation replies after document replacement", async () => {
  let resolveCreate!: (value: typeof created) => void;
  mocks.createSurface.mockReturnValueOnce(new Promise(resolve => { resolveCreate = resolve; }));
  const pending = executeCommand("CreateSurfaceExtrude", { sketchId: "sk-a", distanceMm: 10 }, { surfaceContext: captureContext() } as never);
  useDocumentUiStore.getState().resetDocument("replacement-doc");
  (coreClient as unknown as { documentId: string }).documentId = "replacement-doc";
  resolveCreate(created);

  await expect(pending).resolves.toMatchObject({ kind: "created", feature: { featureId: created.featureId } });
  expect(mocks.requestSnapshot).not.toHaveBeenCalled();
  expect(mocks.sync).not.toHaveBeenCalled();
  expect(useSelectionStore.getState().selectedIds).toEqual([]);
});
