import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  context: vi.fn(), capture: vi.fn(), execute: vi.fn(),
}));
vi.mock("../src/ipc/coreClient", () => ({ coreClient: {
  captureDirectFaceContext: mocks.context,
  captureDirectFaceSelection: mocks.capture,
} }));
vi.mock("../src/commands/execute", () => ({ executeCommand: mocks.execute }));

import { DirectFaceHistoryPanel } from "../src/components/workspace/DirectFaceHistoryPanel";
import { useDocumentUiStore, useSelectionStore } from "../src/stores";

let context = {
  documentId: "direct-doc", revision: 7, epoch: 0, connectionGeneration: 0,
  meshRevision: 0, sessionId: "550e8400-e29b-41d4-a716-446655440000",
};
const sourceFace = { type: "face", featureId: "box-a", persistentFaceId: "box-a:box.+Z" };
const supportFace = { type: "face", featureId: "instance-a", persistentFaceId: "instance-a:box.+Z" };
const sourceBase = {
  sourceFace, persistentId: "box-a:box.+Z", captureRevision: 7, surfaceType: "plane",
  centroidMm: [10, 20, 30],
};
const supportBase = {
  sourceFace: supportFace, persistentId: "instance-a:box.+Z", captureRevision: 7,
  surfaceType: "plane", centroidMm: [5, 6, 7],
};
let source = { ...sourceBase, context };
let support = { ...supportBase, context };

function setup() {
  vi.clearAllMocks();
  useDocumentUiStore.getState().resetDocument("direct-doc");
  useDocumentUiStore.getState().setCoreStatus(true, "test");
  useDocumentUiStore.getState().setFeatures([
    { featureId: "box-a", bodyId: "body-box-a", bodyTip: true, bodyVisible: true,
      type: "StepImport", paramsMm: [], dependsOn: [], refExtra: "", expressions: {}, status: "ok" },
    { featureId: "instance-a", bodyVisible: true, type: "Instance", paramsMm: [],
      dependsOn: ["box-a"], refExtra: "", expressions: {}, status: "ok" },
  ], 7);
  const state = useDocumentUiStore.getState();
  context = { ...context, epoch: state.epoch, connectionGeneration: state.connectionGeneration,
    meshRevision: state.meshRevision };
  source = { ...sourceBase, context };
  support = { ...supportBase, context };
  useSelectionStore.setState({ selectedIds: ["box-a:box.+Z"] });
  mocks.context.mockResolvedValue(context);
  mocks.capture.mockImplementation(async (_pick: string, _context: unknown, role: string) =>
    role === "support" ? support : source);
  mocks.execute.mockResolvedValue({ kind: "created", feature: { featureId: "direct-result" } });
}

function renderPanel() {
  return render(<DirectFaceHistoryPanel />);
}

beforeEach(setup);
afterEach(cleanup);

it("captures source and Replace support in separate slots and initializes editable centroid pivot", async () => {
  renderPanel();
  expect(screen.queryByTestId("direct-support-capture")).toBeNull();
  fireEvent.click(screen.getByTestId("direct-source-capture"));
  await waitFor(() => expect(screen.getByTestId("direct-source-owner").textContent).toContain("box-a"));
  expect(screen.getByTestId("direct-pivot-x")).toHaveProperty("value", "10");
  expect(screen.getByTestId("direct-pivot-y")).toHaveProperty("value", "20");
  expect(screen.getByTestId("direct-pivot-z")).toHaveProperty("value", "30");

  act(() => useSelectionStore.setState({ selectedIds: ["instance-a:box.+Z"] }));
  fireEvent.change(screen.getByTestId("direct-operation"), { target: { value: "CreateReplaceFace" } });
  expect(screen.queryByTestId("direct-support-capture")).not.toBeNull();
  fireEvent.click(screen.getByTestId("direct-support-capture"));
  await waitFor(() => expect(screen.getByTestId("direct-support-owner").textContent).toContain("instance-a"));
  expect(mocks.capture).toHaveBeenNthCalledWith(2, "instance-a:box.+Z", context, "support");
  expect(screen.getByTestId("direct-source-owner").textContent).toContain("box-a");

  fireEvent.change(screen.getByTestId("direct-operation"), { target: { value: "CreateMoveFace" } });
  expect(screen.queryByTestId("direct-support-capture")).toBeNull();
  fireEvent.change(screen.getByTestId("direct-operation"), { target: { value: "CreateReplaceFace" } });
  expect(screen.queryByTestId("direct-support-capture")).not.toBeNull();
  expect(screen.getByTestId("direct-support-owner").textContent).toContain("instance-a");
});

it("clears only failed support recapture and keeps source capture intact", async () => {
  renderPanel();
  fireEvent.click(screen.getByTestId("direct-source-capture"));
  await waitFor(() => expect(screen.getByTestId("direct-source-owner").textContent).toContain("box-a"));
  act(() => useSelectionStore.setState({ selectedIds: ["instance-a:box.+Z"] }));
  fireEvent.change(screen.getByTestId("direct-operation"), { target: { value: "CreateReplaceFace" } });
  mocks.capture.mockResolvedValueOnce(support).mockRejectedValueOnce(new Error("ambiguous"));
  fireEvent.click(screen.getByTestId("direct-support-capture"));
  await waitFor(() => expect(screen.getByTestId("direct-support-owner").textContent).toContain("instance-a"));
  fireEvent.click(screen.getByTestId("direct-support-capture"));
  await waitFor(() => expect(screen.getByTestId("direct-support-owner").textContent).toContain("—"));
  expect(screen.getByTestId("direct-source-owner").textContent).toContain("box-a");
});

it("keeps all nine Move values and sends exact direct DTO on one Apply", async () => {
  renderPanel();
  fireEvent.click(screen.getByTestId("direct-source-capture"));
  await waitFor(() => expect(screen.getByTestId("direct-source-owner").textContent).toContain("box-a"));
  fireEvent.change(screen.getByTestId("direct-operation"), { target: { value: "CreateMoveFace" } });
  fireEvent.change(screen.getByTestId("direct-translation-x"), { target: { value: "1" } });
  fireEvent.change(screen.getByTestId("direct-rotation-z"), { target: { value: "15" } });
  fireEvent.click(screen.getByTestId("direct-apply"));
  await waitFor(() => expect(mocks.execute).toHaveBeenCalledOnce());
  expect(mocks.execute).toHaveBeenCalledWith("CreateMoveFace", {
    sourceFeatureId: "box-a", sourceFace, captureRevision: 7,
    translationMm: { x: 1, y: 0, z: 0 },
    rotationDeg: { x: 0, y: 0, z: 15 }, pivotMm: { x: 10, y: 20, z: 30 },
  }, { directFaceContext: context });
  expect(mocks.execute.mock.calls[0]![1]).not.toHaveProperty("sourceBinding");
});

it("accepts signed nonzero Offset, rejects zero, and applies Delete without a second confirmation modal", async () => {
  renderPanel();
  fireEvent.click(screen.getByTestId("direct-source-capture"));
  await waitFor(() => expect(screen.getByTestId("direct-source-owner").textContent).toContain("box-a"));
  fireEvent.change(screen.getByTestId("direct-operation"), { target: { value: "CreateOffsetFace" } });
  fireEvent.change(screen.getByTestId("direct-offset-distance"), { target: { value: "-2.5" } });
  fireEvent.click(screen.getByTestId("direct-apply"));
  await waitFor(() => expect(mocks.execute).toHaveBeenCalledWith("CreateOffsetFace", {
    sourceFeatureId: "box-a", sourceFace, captureRevision: 7, distanceMm: -2.5,
  }, { directFaceContext: context }));

  mocks.execute.mockClear();
  fireEvent.change(screen.getByTestId("direct-offset-distance"), { target: { value: "0" } });
  fireEvent.click(screen.getByTestId("direct-apply"));
  expect(mocks.execute).not.toHaveBeenCalled();

  fireEvent.click(screen.getByTestId("direct-source-capture"));
  await waitFor(() => expect(screen.getByTestId("direct-source-owner").textContent).toContain("box-a"));
  fireEvent.change(screen.getByTestId("direct-operation"), { target: { value: "CreateDeleteFace" } });
  fireEvent.click(screen.getByTestId("direct-apply"));
  await waitFor(() => expect(mocks.execute).toHaveBeenCalledWith("CreateDeleteFace", {
    sourceFeatureId: "box-a", sourceFace, captureRevision: 7,
  }, { directFaceContext: context }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("allows a distinct replacement face from same feature", async () => {
  const sameOwnerSupport = { ...support, persistentId: "box-a:box.-Z",
    sourceFace: { type: "face", featureId: "box-a", persistentFaceId: "box-a:box.-Z" } };
  mocks.capture.mockImplementation(async (_pick: string, _context: unknown, role: string) =>
    role === "support" ? sameOwnerSupport : source);
  renderPanel();
  fireEvent.click(screen.getByTestId("direct-source-capture"));
  await waitFor(() => expect(screen.getByTestId("direct-source-owner").textContent).toContain("box-a"));
  act(() => useSelectionStore.setState({ selectedIds: ["box-a:box.-Z"] }));
  fireEvent.change(screen.getByTestId("direct-operation"), { target: { value: "CreateReplaceFace" } });
  fireEvent.click(screen.getByTestId("direct-support-capture"));
  await waitFor(() => expect(screen.getByTestId("direct-support-owner").textContent).toContain("box-a"));
  fireEvent.click(screen.getByTestId("direct-apply"));
  await waitFor(() => expect(mocks.execute).toHaveBeenCalledWith("CreateReplaceFace", {
    sourceFeatureId: "box-a", sourceFace, captureRevision: 7,
    replacementFace: sameOwnerSupport.sourceFace,
  }, { directFaceContext: context }));
});

it("does not publish late capture after Cancel and disables duplicate apply while command is pending", async () => {
  let releaseCapture!: (value: typeof source) => void;
  mocks.capture.mockImplementationOnce(() => new Promise(resolve => { releaseCapture = resolve; }));
  renderPanel();
  fireEvent.click(screen.getByTestId("direct-source-capture"));
  await waitFor(() => expect(releaseCapture).toBeTypeOf("function"));
  fireEvent.click(screen.getByTestId("direct-cancel"));
  await act(async () => releaseCapture(source));
  expect(screen.getByTestId("direct-source-owner").textContent).toContain("—");

  mocks.capture.mockResolvedValue(source);
  fireEvent.click(screen.getByTestId("direct-source-capture"));
  await waitFor(() => expect(screen.getByTestId("direct-source-owner").textContent).toContain("box-a"));
  let releaseApply!: (value: unknown) => void;
  mocks.execute.mockImplementationOnce(() => new Promise(resolve => { releaseApply = resolve; }));
  fireEvent.click(screen.getByTestId("direct-apply"));
  await waitFor(() => expect(releaseApply).toBeTypeOf("function"));
  expect((screen.getByTestId("direct-apply") as HTMLButtonElement).disabled).toBe(true);
  await act(async () => releaseApply({ kind: "created", feature: { featureId: "move-a" } }));
});

it("releases capture controls and drops a late result when revision changes", async () => {
  let releaseCapture!: (value: typeof source) => void;
  mocks.capture.mockImplementationOnce(() => new Promise(resolve => { releaseCapture = resolve; }));
  renderPanel();
  fireEvent.click(screen.getByTestId("direct-source-capture"));
  await waitFor(() => expect(releaseCapture).toBeTypeOf("function"));
  expect((screen.getByTestId("direct-source-capture") as HTMLButtonElement).disabled).toBe(true);

  act(() => useDocumentUiStore.getState().setFeatures(useDocumentUiStore.getState().features, 8));
  expect((screen.getByTestId("direct-source-capture") as HTMLButtonElement).disabled).toBe(false);
  await act(async () => releaseCapture(source));
  expect(screen.getByTestId("direct-source-owner").textContent).toBe("—");
});

it("ignores a late apply callback after the document identity changes", async () => {
  renderPanel();
  fireEvent.click(screen.getByTestId("direct-source-capture"));
  await waitFor(() => expect(screen.getByTestId("direct-source-owner").textContent).toContain("box-a"));
  let releaseApply!: (value: unknown) => void;
  mocks.execute.mockImplementationOnce(() => new Promise(resolve => { releaseApply = resolve; }));
  fireEvent.click(screen.getByTestId("direct-apply"));
  await waitFor(() => expect(releaseApply).toBeTypeOf("function"));

  act(() => {
    useDocumentUiStore.getState().resetDocument("new-direct-doc");
    useDocumentUiStore.getState().setCoreStatus(true, "test");
    useDocumentUiStore.getState().setFeatures([
      { featureId: "new-box", bodyId: "body-new", bodyTip: true, bodyVisible: true,
        type: "StepImport", paramsMm: [], dependsOn: [], refExtra: "", expressions: {}, status: "ok" },
    ], 7);
    useSelectionStore.setState({ selectedIds: ["new-box:box.+Z"] });
  });
  const state = useDocumentUiStore.getState();
  context = { ...context, documentId: "new-direct-doc", epoch: state.epoch,
    connectionGeneration: state.connectionGeneration, meshRevision: state.meshRevision };
  source = { ...sourceBase, sourceFace: { ...sourceFace, featureId: "new-box", persistentFaceId: "new-box:box.+Z" },
    persistentId: "new-box:box.+Z", context };
  mocks.context.mockResolvedValue(context);
  fireEvent.click(screen.getByTestId("direct-source-capture"));
  await waitFor(() => expect(screen.getByTestId("direct-source-owner").textContent).toContain("new-box"));

  await act(async () => releaseApply({ kind: "created", feature: { featureId: "old-result" } }));
  expect(screen.getByTestId("direct-source-owner").textContent).toContain("new-box");
});
