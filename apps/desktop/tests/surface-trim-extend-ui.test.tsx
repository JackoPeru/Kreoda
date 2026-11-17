import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  refresh: vi.fn(),
  beginPoint: vi.fn(),
  beginEdge: vi.fn(),
  cancelPick: vi.fn(),
  pointMarker: vi.fn(),
  edgeHighlight: vi.fn(),
}));

vi.mock("../src/commands/execute", () => ({
  executeCommand: mocks.execute,
  refreshSurfaceSnapshot: mocks.refresh,
}));
vi.mock("../src/viewport/viewportHandle", () => ({
  viewportBeginSurfacePointPick: mocks.beginPoint,
  viewportBeginSurfaceEdgePick: mocks.beginEdge,
  viewportCancelSurfacePick: mocks.cancelPick,
  viewportSetSurfacePointMarker: mocks.pointMarker,
  viewportSetSurfaceEdgeHighlight: mocks.edgeHighlight,
}));

import { SurfaceToolsPanel } from "../src/components/workspace/SurfaceToolsPanel";
import { coreClient } from "../src/ipc/coreClient";
import { useDocumentUiStore, useSelectionStore } from "../src/stores";

const SESSION_ID = "b818bf60-237e-4d1f-9f03-f286c4c58ac7";
const pointPick = { featureId: "surface-a", persistentFaceId: "surface-a:face-1", pointMm: [5, 6, 7] as [number, number, number] };
const edgePick = { featureId: "surface-a", persistentEdgeId: "surface-a:edge-1" };
const resolvedPoint = {
  keepFace: { type: "face" as const, featureId: "surface-a", persistentFaceId: "surface-a:face-1" },
  keepUv: [0.25, 0.75] as [number, number],
  pointMm: [5, 6, 7] as [number, number, number],
  projectionDistanceMm: 0.01,
};
const created = {
  featureId: "surface-created", type: "SurfaceTrim", paramsMm: [], dependsOn: ["surface-a"],
  refExtra: "", expressions: {}, bboxMm: [0, 0, 0, 1, 1, 1] as [number, number, number, number, number, number], revision: 8,
};

const feature = (featureId: string, type = "SurfaceExtrude", extra: Record<string, unknown> = {}) => ({
  featureId, type, paramsMm: [], dependsOn: [], refExtra: "", expressions: {},
  geometryCurrent: true, status: "ok", ...extra,
});

function context() {
  const state = useDocumentUiStore.getState();
  return { documentId: state.documentId, revision: state.revision, epoch: state.epoch, connectionGeneration: state.connectionGeneration };
}

function sessionContext() {
  return { ...context(), sessionId: SESSION_ID };
}

function resolvedResponse(captured = sessionContext()) {
  return { result: resolvedPoint, context: captured } as Awaited<ReturnType<typeof coreClient.resolveSurfacePoint>>;
}

let originalKreoda: unknown;
let resolvePoint: ReturnType<typeof vi.spyOn>;

function selectOperation(id: string) {
  fireEvent.change(screen.getByTestId("surface-operation"), { target: { value: id } });
}

beforeEach(() => {
  vi.clearAllMocks();
  useDocumentUiStore.getState().resetDocument("surface-doc");
  (coreClient as unknown as { documentId: string }).documentId = "surface-doc";
  useDocumentUiStore.getState().setCoreStatus(true, "test");
  useDocumentUiStore.getState().setFeatures([
    feature("surface-a"), feature("surface-b", "SurfaceOffset"),
    feature("surface-instance", "Instance", { dependsOn: ["surface-a"] }),
    feature("solid-tool", "SurfaceThicken"),
  ], 7);
  useDocumentUiStore.getState().setDatums([{
    featureId: "datum-plane", kind: "DatumPlane", status: "ok", dependsOn: [],
    definition: { type: "principal" }, resolved: {},
  } as never], 7);
  useSelectionStore.getState().clear();
  mocks.execute.mockResolvedValue({ kind: "created", feature: created });
  mocks.refresh.mockResolvedValue({ features: [created], revision: 8 });
  mocks.beginPoint.mockResolvedValue(pointPick);
  mocks.beginEdge.mockResolvedValue(edgePick);

  const targetWindow = window as unknown as { kreoda?: Record<string, unknown> };
  originalKreoda = targetWindow.kreoda;
  targetWindow.kreoda = {
    ...(targetWindow.kreoda ?? {}),
    sessionSnapshot: vi.fn().mockImplementation(async () => ({ ...sessionContext() })),
  };
  resolvePoint = vi.spyOn(coreClient, "resolveSurfacePoint").mockResolvedValue(resolvedResponse());
});

afterEach(() => {
  cleanup();
  (window as unknown as { kreoda?: unknown }).kreoda = originalKreoda as never;
  vi.restoreAllMocks();
  useDocumentUiStore.getState().resetDocument("surface-ui-cleanup");
  useSelectionStore.getState().clear();
});

it("resolves a clicked semantic face and creates Trim with the exact acquired context once", async () => {
  render(<SurfaceToolsPanel open onClose={vi.fn()} />);
  selectOperation("CreateSurfaceTrim");
  fireEvent.change(screen.getByTestId("surface-trim-target"), { target: { value: "surface-a" } });
  fireEvent.change(screen.getByTestId("surface-trim-tool"), { target: { value: "datum-plane" } });
  fireEvent.click(screen.getByTestId("surface-point-pick"));

  await waitFor(() => expect(resolvePoint).toHaveBeenCalledOnce());
  expect(resolvePoint).toHaveBeenCalledWith({
    targetId: "surface-a", pointMm: pointPick.pointMm, persistentFaceId: pointPick.persistentFaceId,
  }, sessionContext());
  expect(mocks.pointMarker).toHaveBeenLastCalledWith(resolvedPoint.pointMm);
  expect(screen.getByTestId("surface-point-state").textContent).not.toContain("surface-a:face-1");

  fireEvent.click(screen.getByTestId("surface-create"));
  await waitFor(() => expect(mocks.execute).toHaveBeenCalledOnce());
  expect(mocks.execute).toHaveBeenCalledWith("CreateSurfaceTrim", {
    targetId: "surface-a", toolId: "datum-plane", keepFace: resolvedPoint.keepFace,
    keepUv: resolvedPoint.keepUv, toleranceMm: 0.000001,
  }, { surfaceContext: sessionContext() });
});

it("offers a healthy surface instance as Trim target and preserves its semantic owner", async () => {
  const instancePoint = {
    ...resolvedPoint,
    keepFace: { ...resolvedPoint.keepFace, featureId: "surface-instance", persistentFaceId: "surface-instance:face-1" },
  };
  resolvePoint.mockResolvedValueOnce({ result: instancePoint, context: sessionContext() } as Awaited<ReturnType<typeof coreClient.resolveSurfacePoint>>);
  render(<SurfaceToolsPanel open onClose={vi.fn()} />);
  selectOperation("CreateSurfaceTrim");
  const targets = screen.getByTestId("surface-trim-target") as HTMLSelectElement;
  expect([...targets.options].map(option => option.value)).toContain("surface-instance");
  fireEvent.change(targets, { target: { value: "surface-instance" } });
  fireEvent.change(screen.getByTestId("surface-trim-tool"), { target: { value: "surface-a" } });
  fireEvent.click(screen.getByTestId("surface-point-resolve"));

  await waitFor(() => expect(resolvePoint).toHaveBeenCalledOnce());
  expect(resolvePoint).toHaveBeenCalledWith({ targetId: "surface-instance", pointMm: [0, 0, 0] }, sessionContext());
  fireEvent.click(screen.getByTestId("surface-create"));
  await waitFor(() => expect(mocks.execute).toHaveBeenCalledWith("CreateSurfaceTrim", {
    targetId: "surface-instance", toolId: "surface-a", keepFace: instancePoint.keepFace,
    keepUv: instancePoint.keepUv, toleranceMm: 0.000001,
  }, { surfaceContext: sessionContext() }));
});

it("parses unit-aware world XYZ and invalidates the old point when an input changes", async () => {
  render(<SurfaceToolsPanel open onClose={vi.fn()} />);
  selectOperation("CreateSurfaceTrim");
  fireEvent.change(screen.getByTestId("surface-trim-target"), { target: { value: "surface-a" } });
  fireEvent.change(screen.getByTestId("surface-trim-tool"), { target: { value: "surface-b" } });
  fireEvent.change(screen.getByTestId("surface-point-x"), { target: { value: "25 mm" } });
  fireEvent.change(screen.getByTestId("surface-point-y"), { target: { value: "-2 cm" } });
  fireEvent.change(screen.getByTestId("surface-point-z"), { target: { value: "4 inch" } });
  fireEvent.click(screen.getByTestId("surface-point-resolve"));

  await waitFor(() => expect(resolvePoint).toHaveBeenCalledOnce());
  expect(resolvePoint).toHaveBeenCalledWith({ targetId: "surface-a", pointMm: [25, -20, 101.6] }, sessionContext());
  expect(screen.getByTestId("surface-create")).toHaveProperty("disabled", false);
  fireEvent.change(screen.getByTestId("surface-point-x"), { target: { value: "26 mm" } });
  expect(screen.getByTestId("surface-create")).toHaveProperty("disabled", true);
  expect(mocks.pointMarker).toHaveBeenLastCalledWith(null);
  fireEvent.click(screen.getByTestId("surface-create"));
  expect(mocks.execute).not.toHaveBeenCalled();
});

it("ignores an out-of-order point reply and rejects a revision-changed acquisition", async () => {
  let finishFirst!: (value: Awaited<ReturnType<typeof coreClient.resolveSurfacePoint>>) => void;
  let finishSecond!: (value: Awaited<ReturnType<typeof coreClient.resolveSurfacePoint>>) => void;
  resolvePoint
    .mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }))
    .mockImplementationOnce(() => new Promise(resolve => { finishSecond = resolve; }));
  render(<SurfaceToolsPanel open onClose={vi.fn()} />);
  selectOperation("CreateSurfaceTrim");
  fireEvent.change(screen.getByTestId("surface-trim-target"), { target: { value: "surface-a" } });
  fireEvent.change(screen.getByTestId("surface-trim-tool"), { target: { value: "surface-b" } });
  fireEvent.click(screen.getByTestId("surface-point-resolve"));
  await waitFor(() => expect(resolvePoint).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByTestId("surface-point-x"), { target: { value: "1 mm" } });
  fireEvent.click(screen.getByTestId("surface-point-resolve"));
  await waitFor(() => expect(resolvePoint).toHaveBeenCalledTimes(2));

  await act(async () => finishSecond(resolvedResponse()));
  expect(mocks.pointMarker).toHaveBeenLastCalledWith(resolvedPoint.pointMm);
  await act(async () => finishFirst(resolvedResponse()));
  expect(mocks.pointMarker).toHaveBeenLastCalledWith(resolvedPoint.pointMm);

  act(() => useDocumentUiStore.getState().setFeatures(useDocumentUiStore.getState().features, 8));
  await waitFor(() => expect(screen.getByTestId("surface-create")).toHaveProperty("disabled", true));
  expect(mocks.pointMarker).toHaveBeenLastCalledWith(null);
  fireEvent.click(screen.getByTestId("surface-create"));
  expect(mocks.execute).not.toHaveBeenCalled();
});

it("rejects a mismatched session snapshot and clears a resolved point when its target is removed", async () => {
  render(<SurfaceToolsPanel open onClose={vi.fn()} />);
  selectOperation("CreateSurfaceTrim");
  fireEvent.change(screen.getByTestId("surface-trim-target"), { target: { value: "surface-a" } });
  fireEvent.change(screen.getByTestId("surface-trim-tool"), { target: { value: "surface-b" } });
  const targetWindow = window as unknown as { kreoda: { sessionSnapshot: ReturnType<typeof vi.fn> } };
  targetWindow.kreoda.sessionSnapshot.mockResolvedValueOnce({ ...sessionContext(), revision: 6 });
  fireEvent.click(screen.getByTestId("surface-point-resolve"));
  await waitFor(() => expect(screen.getByTestId("surface-error").textContent).toContain("document changed"));
  expect(resolvePoint).not.toHaveBeenCalled();
  expect(screen.getByTestId("surface-create")).toHaveProperty("disabled", true);

  fireEvent.click(screen.getByTestId("surface-point-resolve"));
  await waitFor(() => expect(resolvePoint).toHaveBeenCalledOnce());
  expect(screen.getByTestId("surface-create")).toHaveProperty("disabled", false);
  act(() => useDocumentUiStore.getState().setFeatures([feature("surface-b", "SurfaceOffset")], 8));
  await waitFor(() => expect(screen.getByTestId("surface-create")).toHaveProperty("disabled", true));
  expect(mocks.pointMarker).toHaveBeenLastCalledWith(null);
  fireEvent.click(screen.getByTestId("surface-create"));
  expect(mocks.execute).not.toHaveBeenCalled();
});

it("cancels an unresolved viewport capture on document replacement and unmount", async () => {
  let finishPick!: (value: null) => void;
  mocks.beginPoint.mockImplementationOnce(() => new Promise(resolve => { finishPick = resolve; }));
  const view = render(<SurfaceToolsPanel open onClose={vi.fn()} />);
  selectOperation("CreateSurfaceTrim");
  fireEvent.change(screen.getByTestId("surface-trim-target"), { target: { value: "surface-a" } });
  fireEvent.click(screen.getByTestId("surface-point-pick"));
  await waitFor(() => expect(mocks.beginPoint).toHaveBeenCalledOnce());
  act(() => {
    useDocumentUiStore.getState().resetDocument("replacement-doc");
    (coreClient as unknown as { documentId: string }).documentId = "replacement-doc";
    useDocumentUiStore.getState().setCoreStatus(true, "test");
  });
  await waitFor(() => expect(mocks.cancelPick).toHaveBeenCalled());
  await act(async () => finishPick(null));
  expect(resolvePoint).not.toHaveBeenCalled();
  expect(mocks.execute).not.toHaveBeenCalled();
  view.unmount();
  expect(mocks.cancelPick.mock.calls.length).toBeGreaterThanOrEqual(2);
});

it("captures a semantic Extend edge and forwards the session-stamped context and measured distance", async () => {
  render(<SurfaceToolsPanel open onClose={vi.fn()} />);
  selectOperation("CreateSurfaceExtend");
  fireEvent.change(screen.getByTestId("surface-extend-target"), { target: { value: "surface-a" } });
  fireEvent.change(screen.getByTestId("surface-extend-distance"), { target: { value: "2 cm" } });
  fireEvent.change(screen.getByTestId("surface-extend-tolerance"), { target: { value: "0.01 mm" } });
  fireEvent.click(screen.getByTestId("surface-edge-pick"));

  await waitFor(() => expect(mocks.beginEdge).toHaveBeenCalledWith("surface-a"));
  expect(mocks.edgeHighlight).toHaveBeenLastCalledWith(edgePick.persistentEdgeId);
  expect(screen.getByTestId("surface-edge-state").textContent).not.toContain(edgePick.persistentEdgeId);
  fireEvent.click(screen.getByTestId("surface-create"));
  await waitFor(() => expect(mocks.execute).toHaveBeenCalledOnce());
  expect(mocks.execute).toHaveBeenCalledWith("CreateSurfaceExtend", {
    targetId: "surface-a",
    boundaryEdge: { type: "edge", featureId: "surface-a", persistentEdgeId: edgePick.persistentEdgeId },
    distanceMm: 20, toleranceMm: 0.01,
  }, { surfaceContext: sessionContext() });
});

it("cancels a pending edge pick on Escape and keeps failed Extend inputs visible", async () => {
  const close = vi.fn();
  render(<SurfaceToolsPanel open onClose={close} />);
  selectOperation("CreateSurfaceExtend");
  fireEvent.change(screen.getByTestId("surface-extend-target"), { target: { value: "surface-a" } });
  fireEvent.change(screen.getByTestId("surface-extend-distance"), { target: { value: "3 mm" } });
  mocks.execute.mockRejectedValueOnce(new Error("unsupported boundary"));
  let resolvePendingEdge!: (value: null) => void;
  mocks.beginEdge.mockImplementationOnce(() => new Promise(resolve => { resolvePendingEdge = resolve; }));
  fireEvent.click(screen.getByTestId("surface-edge-pick"));
  await waitFor(() => expect(mocks.beginEdge).toHaveBeenCalledOnce());
  fireEvent.keyDown(window, { key: "Escape" });
  expect(mocks.cancelPick).toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
  await act(async () => resolvePendingEdge(null));

  // A failed native create leaves the useful target and numeric inputs intact.
  fireEvent.click(screen.getByTestId("surface-edge-pick"));
  await waitFor(() => expect(screen.getByTestId("surface-edge-state").textContent).toBe("Boundary edge selected."));
  fireEvent.click(screen.getByTestId("surface-create"));
  await waitFor(() => expect(mocks.execute).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("unsupported boundary"));
  expect((screen.getByTestId("surface-extend-distance") as HTMLInputElement).value).toBe("3 mm");
  expect((screen.getByTestId("surface-extend-target") as HTMLSelectElement).value).toBe("surface-a");
  expect(screen.queryByText("Surface created.")).toBeNull();
});

