import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SketchProjectionResult, SketchProjectionGroupSummary, SketchModel } from "@kreoda/protocol";

const mockCore = vi.hoisted(() => ({
  documentId: "doc-projection",
  captureSketchContext: vi.fn(),
  requestSketch: vi.fn(),
  requestSketchProjection: vi.fn(),
  updateSketch: vi.fn(),
  cancelPreview: vi.fn(),
  requestMesh: vi.fn(),
}));

vi.mock("../src/ipc/coreClient", () => ({ coreClient: mockCore }));

import { SketchEditor } from "../src/components/SketchEditor";
import { useDocumentUiStore } from "../src/stores";

const plane = {
  origin: [0, 0, 0] as [number, number, number],
  xAxis: [1, 0, 0] as [number, number, number],
  yAxis: [0, 1, 0] as [number, number, number],
  normal: [0, 0, 1] as [number, number, number],
};

const group: SketchProjectionGroupSummary = {
  groupId: "group-1",
  definition: { version: 1, operation: "silhouette", sources: [{ type: "shape", featureId: "solid-1" }] },
  sourceFeatureIds: ["solid-1"], status: "ok", error: "", blockingSourceIds: [], generation: 1,
};

const emptyModel: SketchModel = { points: [], lines: [], circles: [], arcs: [], constraints: [] };
const circleModel: SketchModel = {
  points: [{ id: "center", x: 0, y: 0, fixed: false }], lines: [],
  circles: [{ id: "circle", center: "center", r: 12 }], arcs: [], constraints: [],
};
const arcModel: SketchModel = {
  points: [{ id: "center", x: 0, y: 0, fixed: false }], lines: [], circles: [],
  arcs: [{ id: "arc", center: "center", r: 12, startAngleRad: 0, endAngleRad: 1 }], constraints: [],
};

function projection(groups: SketchProjectionResult["groups"], geometryCurrent = true): SketchProjectionResult {
  return {
    featureId: "target-sketch", plane, geometryCurrent, status: geometryCurrent ? "ok" : "unavailable",
    error: geometryCurrent ? "" : "source unavailable", blockingSourceIds: geometryCurrent ? [] : ["solid-1"],
    groups,
  };
}

async function open(model: SketchModel, result: SketchProjectionResult): Promise<void> {
  mockCore.requestSketch.mockResolvedValue({ ...model, planeKind: "XY", plane, revision: 7, projectionGroups: result.groups.map(({ edges: _edges, ...summary }) => summary) });
  mockCore.requestSketchProjection.mockResolvedValue({ documentId: "doc-projection", revision: 7, projection: result });
  render(<SketchEditor sketchId="target-sketch" onClose={() => {}} />);
  await waitFor(() => expect(mockCore.requestSketchProjection).toHaveBeenCalledWith("target-sketch"));
}

beforeEach(() => {
  useDocumentUiStore.getState().resetDocument("doc-projection");
  useDocumentUiStore.setState({ revision: 7 });
  useDocumentUiStore.getState().upsertSketch({ featureId: "target-sketch", planeKind: "XY", points: 0, lines: 0, circles: 0, constraints: 0, projectionGroups: [] });
  mockCore.captureSketchContext.mockReset().mockImplementation(async () => {
    const state = useDocumentUiStore.getState();
    return { documentId: state.documentId, revision: state.revision, epoch: state.epoch,
      connectionGeneration: state.connectionGeneration, sessionId: "session-a" };
  });
  mockCore.requestSketch.mockReset();
  mockCore.requestSketchProjection.mockReset();
  mockCore.updateSketch.mockReset().mockResolvedValue({ revision: 8 });
  mockCore.cancelPreview.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(window, "kreoda", {
    configurable: true,
    value: { sessionSnapshot: vi.fn(async () => ({ sessionId: "session-a", documentId: "doc-projection", revision: 7 })) },
  });
});

afterEach(cleanup);

it.each([
  ["healthy projection-only", emptyModel, projection([{ ...group, edges: [] }])],
  ["broken projection-only", emptyModel, projection([{ ...group, status: "broken", error: "source unavailable", blockingSourceIds: ["solid-1"], edges: [] }], false)],
  ["circle-only", circleModel, projection([])],
  ["arc-only", arcModel, projection([])],
] as const)("opening %s does not commit a starter rectangle", async (_name, model, result) => {
  await open(model, result);
  await waitFor(() => expect(mockCore.requestSketch).toHaveBeenCalledWith("target-sketch",
    expect.objectContaining({ documentId: "doc-projection", revision: 7, sessionId: "session-a" })));
  expect(mockCore.updateSketch).not.toHaveBeenCalled();
});

it("keeps canonical empty geometry empty on open and creates a rectangle only after explicit action", async () => {
  await open(emptyModel, projection([]));
  await waitFor(() => expect((screen.getByRole("button", { name: "Rectangle" }) as HTMLButtonElement).disabled).toBe(false));
  expect(mockCore.updateSketch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Rectangle" }));
  await waitFor(() => expect(mockCore.updateSketch).toHaveBeenCalledTimes(2));
  expect(mockCore.updateSketch.mock.calls.filter(([params]) => !params.isPreview)).toHaveLength(1);
});
