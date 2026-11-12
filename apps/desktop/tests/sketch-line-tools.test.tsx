import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SketchCurveDisplay, SketchModel } from "@kreoda/protocol";

const mocks = vi.hoisted(() => ({
  requestSketch: vi.fn(), captureSketchContext: vi.fn(), updateSketch: vi.fn(), cancelPreview: vi.fn(),
  requestMesh: vi.fn(), refreshProjection: vi.fn(), updateFeatureSummary: vi.fn(),
  model: null as SketchModel | null, revision: 0, driftPreview: false,
  stalePreview: false, conflictPreview: false, pendingPreviewResolve: null as (() => void) | null,
  deferPreview: false,
}));

vi.mock("../src/ipc/coreClient", () => ({
  coreClient: {
    requestSketch: mocks.requestSketch, captureSketchContext: mocks.captureSketchContext,
    updateSketch: mocks.updateSketch, cancelPreview: mocks.cancelPreview, requestMesh: mocks.requestMesh,
  },
}));
vi.mock("../src/model/sync", () => ({ refreshSketchProjection: mocks.refreshProjection,
  updateFeatureSummary: mocks.updateFeatureSummary }));
vi.mock("../src/components/workspace/SketchProjectionPanel", () => ({ SketchProjectionPanel: () => null }));

import { SketchEditor } from "../src/components/SketchEditor";
import { useDocumentUiStore } from "../src/stores";

const sourceModel = (): SketchModel => ({
  points: [{ id: "a", x: 0, y: 0, fixed: false }, { id: "b", x: 10, y: 0, fixed: false },
    { id: "c", x: 4, y: -5, fixed: true }, { id: "d", x: 4, y: 5, fixed: true },
    { id: "e", x: 15, y: -5, fixed: true }, { id: "f", x: 15, y: 5, fixed: true }],
  lines: [{ id: "target", p1: "a", p2: "b" }, { id: "boundary", p1: "c", p2: "d" },
    { id: "extension", p1: "e", p2: "f" }],
  circles: [], arcs: [], ellipses: [], splines: [], constructionIds: [], constraints: [],
});

const emptyDisplay = (): SketchCurveDisplay => ({ space: "sketch-local", curves: [], errors: [] });
const sketchEntry = (featureId: string) => ({ featureId, planeKind: "XY", points: 0, lines: 3,
  circles: 0, constraints: 0, projectionGroups: [], geometryCurrent: false, status: "ok" } as never);

function committedCalls() {
  return mocks.updateSketch.mock.calls.filter(([params]) => !params.isPreview);
}

async function openEditor() {
  render(<SketchEditor sketchId="line-tools-sketch" onClose={vi.fn()} />);
  const canvas = await screen.findByTestId("sketch-canvas");
  await waitFor(() => expect((screen.getByRole("button", { name: "Clear profile" }) as HTMLButtonElement).disabled).toBe(false));
  return canvas;
}

function setCanvasBounds(canvas: Element, size = 220): void {
  Object.defineProperty(canvas, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ x: 0, y: 0, left: 0, top: 0, right: size, bottom: size, width: size, height: size, toJSON: () => ({}) }),
  });
}

afterEach(() => cleanup());

beforeEach(() => {
  mocks.model = sourceModel();
  mocks.revision = 0;
  mocks.driftPreview = false;
  mocks.stalePreview = false;
  mocks.conflictPreview = false;
  mocks.deferPreview = false;
  mocks.pendingPreviewResolve = null;
  mocks.requestSketch.mockReset().mockImplementation(async () => ({
    ...mocks.model!, planeKind: "XY", revision: mocks.revision, projectionGroups: [], geometryCurrent: false,
    curveDisplay: emptyDisplay(),
  }));
  mocks.captureSketchContext.mockReset().mockImplementation(async () => {
    const state = useDocumentUiStore.getState();
    return { documentId: state.documentId, revision: state.revision, epoch: state.epoch,
      connectionGeneration: state.connectionGeneration, sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
  });
  mocks.updateSketch.mockReset().mockImplementation(async (params: { featureId: string; model: SketchModel; isPreview?: boolean }, context: any) => {
    if (params.isPreview && mocks.deferPreview) await new Promise<void>(resolve => { mocks.pendingPreviewResolve = resolve; });
    if (params.isPreview && mocks.stalePreview) {
      mocks.stalePreview = false;
      useDocumentUiStore.setState({ connectionGeneration: useDocumentUiStore.getState().connectionGeneration + 1 });
    }
    if (!params.isPreview) {
      mocks.model = params.model;
      mocks.revision++;
      useDocumentUiStore.getState().setFeatures([], mocks.revision, useDocumentUiStore.getState().epoch);
    }
    let solved = params.model;
    if (params.isPreview && mocks.driftPreview) {
      solved = { ...params.model, points: params.model.points.map(point => point.id === "a" ? { ...point, x: point.x + 0.005 } : point) };
    }
    return { revision: mocks.revision, context: params.isPreview ? context : { ...context, revision: mocks.revision },
      solved, curveDisplay: emptyDisplay(), residual: 0, dofs: 0,
      conflicting: params.isPreview && mocks.conflictPreview ? ["constraint-x"] : [] };
  });
  mocks.cancelPreview.mockReset().mockResolvedValue(undefined);
  mocks.requestMesh.mockReset().mockResolvedValue({ revision: 0, volumeMm3: 0 });
  mocks.refreshProjection.mockReset().mockResolvedValue(null);
  mocks.updateFeatureSummary.mockReset();
  useDocumentUiStore.getState().resetDocument("line-tools-doc");
  useDocumentUiStore.setState({ coreRunning: true, connectionGeneration: 4 });
  useDocumentUiStore.setState({ sketches: [sketchEntry("line-tools-sketch")] });
});

it("shows named line tools outside diagnostics and selects a human-labeled segment on canvas", async () => {
  const canvas = await openEditor();
  const trim = screen.queryByRole("button", { name: "Trim" });
  expect(trim).not.toBeNull();
  if (!trim) return;
  expect(screen.queryByRole("button", { name: "Extend" })).not.toBeNull();
  expect(screen.queryByRole("button", { name: "Mirror" })).not.toBeNull();
  expect(screen.queryByRole("button", { name: "Pattern" })).not.toBeNull();
  expect(trim.closest("details")).toBeNull();
  expect(screen.getByTestId("sketch-editor").className).toContain("z-[60]");
  expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBe("true");
  const hit = screen.queryByTestId("sketch-line-hit-target");
  expect(hit).not.toBeNull();
  if (!hit) return;
  fireEvent.click(screen.getByRole("button", { name: "Pattern" }));
  fireEvent.click(hit);
  expect(screen.getByTestId("sketch-line-selection").textContent).toContain("Segment 1");
  expect(canvas).toBeTruthy();
});

it("shows the exact trim point locally and calls one preview then one commit only on Apply", async () => {
  const canvas = await openEditor();
  const target = screen.queryByLabelText("Trim target segment");
  expect(target).not.toBeNull();
  if (!target) return;
  fireEvent.change(target, { target: { value: "target" } });
  fireEvent.change(screen.getByLabelText("Trim boundary segment"), { target: { value: "boundary" } });
  expect(screen.getByTestId("trim-intersection-preview").textContent).toContain("4.000");
  expect(mocks.updateSketch).not.toHaveBeenCalled();
  expect(canvas.querySelector('[data-testid="trim-candidate-overlay"]')).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Apply line edit" }));
  await waitFor(() => expect(committedCalls()).toHaveLength(1));
  expect(mocks.updateSketch).toHaveBeenCalledTimes(2);
  expect(mocks.updateSketch.mock.calls[0]![0]).toMatchObject({ isPreview: true, model: { points: expect.arrayContaining([
    expect.objectContaining({ id: "a", x: 4, y: 0 }),
  ]) } });
  expect(committedCalls()[0]![0].model.points.find((point: any) => point.id === "a")).toMatchObject({ x: 4, y: 0 });
});

it("extends the explicitly chosen end to an exact outside intersection", async () => {
  const canvas = await openEditor();
  fireEvent.click(screen.getByRole("button", { name: "Extend" }));
  fireEvent.change(screen.getByLabelText("Trim target segment"), { target: { value: "target" } });
  fireEvent.change(screen.getByLabelText("Trim boundary segment"), { target: { value: "extension" } });
  fireEvent.change(screen.getByLabelText("Endpoint to move"), { target: { value: "end" } });
  expect(screen.getByTestId("trim-intersection-preview").textContent).toContain("15.000");
  expect(canvas.querySelector('[data-testid="trim-candidate-overlay"]')).not.toBeNull();
  expect(mocks.updateSketch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Apply line edit" }));
  await waitFor(() => expect(committedCalls()).toHaveLength(1));
  expect(committedCalls()[0]![0].model.points.find((point: any) => point.id === "b")).toMatchObject({ x: 15, y: 0 });
});

it("patterns selected canvas segments with named spacing and copy count", async () => {
  await openEditor();
  const patternTab = screen.queryByRole("button", { name: "Pattern" });
  expect(patternTab).not.toBeNull();
  if (!patternTab) return;
  fireEvent.click(patternTab);
  fireEvent.click(screen.getByTestId("sketch-line-hit-target"));
  fireEvent.change(screen.getByLabelText("Spacing X (mm)"), { target: { value: "5" } });
  fireEvent.change(screen.getByLabelText("Spacing Y (mm)"), { target: { value: "-2" } });
  fireEvent.change(screen.getByLabelText("Number of copies"), { target: { value: "2" } });
  expect(mocks.updateSketch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("sketch-line-hit-boundary"));
  expect(screen.getByTestId("sketch-line-selection").textContent).toContain("2 segments selected");
  fireEvent.click(screen.getByRole("button", { name: "Apply line edit" }));
  await waitFor(() => expect(committedCalls()).toHaveLength(1));
  expect(committedCalls()[0]![0].model.lines.map((line: any) => line.id)).toEqual(expect.arrayContaining([
    expect.stringMatching(/^pattern-[a-z0-9]+-1-target$/), expect.stringMatching(/^pattern-[a-z0-9]+-2-target$/),
  ]));
  expect(mocks.updateSketch).toHaveBeenCalledTimes(2);
});

it("shows the selected named mirror axis and applies an existing-segment mirror", async () => {
  await openEditor();
  fireEvent.click(screen.getByRole("button", { name: "Mirror" }));
  fireEvent.change(screen.getByLabelText("Mirror axis"), { target: { value: "y" } });
  expect(screen.getByTestId("mirror-chosen-axis").textContent).toContain("Y axis");
  fireEvent.change(screen.getByLabelText("Mirror axis"), { target: { value: "line:boundary" } });
  expect(screen.getByTestId("mirror-chosen-axis").textContent).toContain("Segment 2");
  fireEvent.click(screen.getByTestId("sketch-line-hit-target"));
  expect(mocks.updateSketch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Apply line edit" }));
  await waitFor(() => expect(committedCalls()).toHaveLength(1));
  expect(committedCalls()[0]![0].model.lines).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: expect.stringMatching(/^mirror-[a-z0-9]+-1-target$/) }),
  ]));
});

it("keeps invalid drafts, cancels with Escape without writes, and rejects a drifted preview", async () => {
  const canvas = await openEditor();
  const patternTab = screen.queryByRole("button", { name: "Pattern" });
  expect(patternTab).not.toBeNull();
  if (!patternTab) return;
  fireEvent.click(patternTab);
  fireEvent.click(screen.getByTestId("sketch-line-hit-target"));
  const spacingX = screen.getByLabelText("Spacing X (mm)") as HTMLInputElement;
  fireEvent.change(spacingX, { target: { value: "   " } });
  expect(spacingX.value).toBe("   ");
  expect((screen.getByRole("button", { name: "Apply line edit" }) as HTMLButtonElement).disabled).toBe(true);
  expect(mocks.updateSketch).not.toHaveBeenCalled();
  fireEvent.change(spacingX, { target: { value: "5" } });
  const copies = screen.getByLabelText("Number of copies") as HTMLInputElement;
  fireEvent.change(copies, { target: { value: "65" } });
  expect(copies.value).toBe("65");
  expect((screen.getByRole("button", { name: "Apply line edit" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(mocks.updateSketch).not.toHaveBeenCalled();
  expect(canvas.querySelector('[data-testid="sketch-line-hit-target"]')?.getAttribute("data-selected")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "Pattern" }));
  expect((screen.getByLabelText("Number of copies") as HTMLInputElement).value).toBe("2");

  fireEvent.click(screen.getByRole("button", { name: "Trim" }));
  fireEvent.change(screen.getByLabelText("Trim target segment"), { target: { value: "target" } });
  fireEvent.change(screen.getByLabelText("Trim boundary segment"), { target: { value: "boundary" } });
  mocks.driftPreview = true;
  fireEvent.click(screen.getByRole("button", { name: "Apply line edit" }));
  await waitFor(() => expect(mocks.updateSketch).toHaveBeenCalledTimes(1));
  expect(committedCalls()).toHaveLength(0);
});

it("cancels a delayed preview with Escape and suppresses its later commit", async () => {
  await openEditor();
  fireEvent.click(screen.getByRole("button", { name: "Pattern" }));
  fireEvent.click(screen.getByTestId("sketch-line-hit-target"));
  mocks.deferPreview = true;
  fireEvent.click(screen.getByRole("button", { name: "Apply line edit" }));
  await waitFor(() => expect(mocks.pendingPreviewResolve).toBeTypeOf("function"));
  fireEvent.keyDown(window, { key: "Escape" });
  const resolve = mocks.pendingPreviewResolve;
  await act(async () => { resolve?.(); await Promise.resolve(); });
  await waitFor(() => expect(mocks.updateSketch).toHaveBeenCalledTimes(1));
  expect(committedCalls()).toHaveLength(0);
  expect(mocks.cancelPreview).toHaveBeenCalled();
});

it("drops a preview when the connection generation changes", async () => {
  await openEditor();
  fireEvent.change(screen.getByLabelText("Trim target segment"), { target: { value: "target" } });
  fireEvent.change(screen.getByLabelText("Trim boundary segment"), { target: { value: "boundary" } });
  mocks.stalePreview = true;
  fireEvent.click(screen.getByRole("button", { name: "Apply line edit" }));
  await waitFor(() => expect(mocks.updateSketch).toHaveBeenCalledTimes(1));
  expect(committedCalls()).toHaveLength(0);
});

it("rejects a conflicting trim preview without committing", async () => {
  await openEditor();
  fireEvent.change(screen.getByLabelText("Trim target segment"), { target: { value: "target" } });
  fireEvent.change(screen.getByLabelText("Trim boundary segment"), { target: { value: "boundary" } });
  mocks.conflictPreview = true;
  fireEvent.click(screen.getByRole("button", { name: "Apply line edit" }));
  await waitFor(() => expect(mocks.updateSketch).toHaveBeenCalledTimes(1));
  expect(committedCalls()).toHaveLength(0);
});

it("activating a line tool cancels a pending spline preview without committing or restoring its stale draft", async () => {
  const canvas = await openEditor();
  setCanvasBounds(canvas);
  mocks.deferPreview = true;
  fireEvent.click(screen.getByRole("button", { name: "Control-point spline" }));
  fireEvent.click(canvas, { clientX: 40, clientY: 40 });
  fireEvent.click(canvas, { clientX: 100, clientY: 120 });
  fireEvent.click(canvas, { clientX: 180, clientY: 50 });
  await waitFor(() => expect(mocks.pendingPreviewResolve).toBeTypeOf("function"));
  expect(screen.queryByTestId("sketch-curve-draft")).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Trim" }));
  expect(screen.queryByTestId("sketch-curve-draft")).toBeNull();
  const resolve = mocks.pendingPreviewResolve;
  await act(async () => { resolve?.(); await Promise.resolve(); });
  expect(committedCalls()).toHaveLength(0);
  expect(mocks.updateSketch).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId("sketch-curve-draft")).toBeNull();
});

it("choosing a curve tool clears a pending local trim intersection", async () => {
  const canvas = await openEditor();
  fireEvent.change(screen.getByLabelText("Trim target segment"), { target: { value: "target" } });
  fireEvent.change(screen.getByLabelText("Trim boundary segment"), { target: { value: "boundary" } });
  expect(canvas.querySelector('[data-testid="trim-candidate-overlay"]')).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Ellipse" }));
  expect(canvas.querySelector('[data-testid="trim-candidate-overlay"]')).toBeNull();
  expect(mocks.updateSketch).not.toHaveBeenCalled();
});
