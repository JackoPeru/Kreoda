import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SketchCurveDisplay, SketchModel } from "@kreoda/protocol";

const mocks = vi.hoisted(() => ({
  requestSketch: vi.fn(),
  captureSketchContext: vi.fn(),
  updateSketch: vi.fn(),
  cancelPreview: vi.fn(),
  requestMesh: vi.fn(),
  refreshProjection: vi.fn(),
  updateFeatureSummary: vi.fn(),
  storedModels: {} as Record<string, any>,
  revision: 0,
  displayError: null as string | null,
  displayErrorEntityId: null as string | null,
  previewSolvedModel: null as SketchModel | null,
  deferPreview: false,
  pendingPreviewResolve: null as (() => void) | null,
  deferCommit: false,
  pendingCommitResolve: null as (() => void) | null,
  deferMesh: false,
  pendingMeshResolve: null as (() => void) | null,
  deferSketchLoad: false,
  pendingSketchLoadResolves: [] as (() => void)[],
  sketchLoadModels: [] as unknown[],
}));

vi.mock("../src/ipc/coreClient", () => ({
  coreClient: {
    requestSketch: mocks.requestSketch,
    captureSketchContext: mocks.captureSketchContext,
    updateSketch: mocks.updateSketch,
    cancelPreview: mocks.cancelPreview,
    requestMesh: mocks.requestMesh,
  },
}));
vi.mock("../src/model/sync", () => ({
  refreshSketchProjection: mocks.refreshProjection,
  updateFeatureSummary: mocks.updateFeatureSummary,
}));
vi.mock("../src/components/workspace/SketchProjectionPanel", () => ({
  SketchProjectionPanel: () => null,
}));

import { SketchEditor } from "../src/components/SketchEditor";
import { useDocumentUiStore } from "../src/stores";

const emptyModel = (): SketchModel => ({
  points: [], lines: [], circles: [], arcs: [], ellipses: [], splines: [], constructionIds: [], constraints: [],
});

function displayFor(model: SketchModel): SketchCurveDisplay {
  const pointById = new Map(model.points.map(point => [point.id, point]));
  const curves: SketchCurveDisplay["curves"] = [];
  for (const ellipse of model.ellipses ?? []) {
    const center = pointById.get(ellipse.center);
    if (!center) continue;
    const start = ellipse.arc ? ellipse.startAngleRad : 0;
    const end = ellipse.arc ? ellipse.endAngleRad : Math.PI * 2;
    const samples = Array.from({ length: 17 }, (_, index) => {
      const angle = start + (end - start) * index / 16;
      const u = ellipse.majorRadius * Math.cos(angle);
      const v = ellipse.minorRadius * Math.sin(angle);
      return [
        center.x + Math.cos(ellipse.rotationRad) * u - Math.sin(ellipse.rotationRad) * v,
        center.y + Math.sin(ellipse.rotationRad) * u + Math.cos(ellipse.rotationRad) * v,
      ] as [number, number];
    });
    curves.push({ entityId: ellipse.id, kind: ellipse.arc ? "ellipticalArc" : "ellipse",
      closed: !ellipse.arc, pointsMm: samples });
  }
  for (const spline of model.splines ?? []) {
    const pointsMm = spline.pointIds.flatMap(id => {
      const point = pointById.get(id);
      return point ? [[point.x, point.y] as [number, number]] : [];
    });
    curves.push({ entityId: spline.id, kind: "spline", closed: spline.closed, pointsMm });
  }
  const errors = mocks.displayError
    ? curves.filter(curve => !mocks.displayErrorEntityId || curve.entityId === mocks.displayErrorEntityId)
      .map(curve => ({ entityId: curve.entityId, message: mocks.displayError! }))
    : [];
  const failedIds = new Set(errors.map(error => error.entityId));
  return { space: "sketch-local", curves: curves.filter(curve => !failedIds.has(curve.entityId)), errors };
}

function bodyFor(featureId: string) {
  const model = (mocks.storedModels[featureId] as SketchModel | undefined) ?? emptyModel();
  return {
    ...model,
    planeKind: "XY",
    revision: mocks.revision,
    projectionGroups: [],
    geometryCurrent: false,
    curveDisplay: displayFor(model),
  };
}

function sketchEntry(featureId: string) {
  return {
    featureId, planeKind: "XY", points: 0, lines: 0, circles: 0, constraints: 0,
    projectionGroups: [], geometryCurrent: false, status: "ok",
  } as never;
}

function canvasBounds(canvas: Element, size = 220): void {
  Object.defineProperty(canvas, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ x: 0, y: 0, left: 0, top: 0, right: size, bottom: size, width: size, height: size, toJSON: () => ({}) }),
  });
}

function clickCanvas(canvas: Element, x: number, y: number): void {
  fireEvent.click(canvas, { clientX: x, clientY: y });
}

function firePointer(target: Element, type: "pointerdown" | "pointermove" | "pointerup", x: number, y: number): void {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
  Object.defineProperty(event, "pointerId", { value: 1 });
  fireEvent(target, event);
}

function committedCalls(): any[] {
  return mocks.updateSketch.mock.calls.filter(([params]) => !params.isPreview);
}

async function openEditor(featureId = "sketch-curves") {
  render(<SketchEditor sketchId={featureId} onClose={vi.fn()} />);
  const canvas = await screen.findByTestId("sketch-canvas");
  await waitFor(() => expect((screen.getByRole("button", { name: "Clear profile" }) as HTMLButtonElement).disabled).toBe(false));
  return canvas;
}

afterEach(() => cleanup());

beforeEach(() => {
  mocks.storedModels = {};
  mocks.revision = 0;
  mocks.displayError = null;
  mocks.displayErrorEntityId = null;
  mocks.previewSolvedModel = null;
  mocks.deferPreview = false;
  mocks.pendingPreviewResolve = null;
  mocks.deferCommit = false;
  mocks.pendingCommitResolve = null;
  mocks.deferMesh = false;
  mocks.pendingMeshResolve = null;
  mocks.deferSketchLoad = false;
  mocks.pendingSketchLoadResolves = [];
  mocks.sketchLoadModels = [];
  mocks.requestSketch.mockReset().mockImplementation(async (featureId: string) => {
    const queuedModel = mocks.sketchLoadModels.shift() as SketchModel | undefined;
    const body = queuedModel ? {
      ...queuedModel, planeKind: "XY", revision: mocks.revision, projectionGroups: [], geometryCurrent: false,
      curveDisplay: displayFor(queuedModel),
    } : bodyFor(featureId);
    if (mocks.deferSketchLoad) await new Promise<void>(resolve => { mocks.pendingSketchLoadResolves.push(resolve); });
    return body;
  });
  mocks.captureSketchContext.mockReset().mockImplementation(async () => {
    const state = useDocumentUiStore.getState();
    return {
      documentId: state.documentId,
      revision: state.revision,
      epoch: state.epoch,
      connectionGeneration: state.connectionGeneration,
      sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    };
  });
  mocks.updateSketch.mockReset().mockImplementation(async (params: {
    featureId: string; model: SketchModel; isPreview?: boolean; dragPointId?: string; dragX?: number; dragY?: number;
  }) => {
    if (params.isPreview && mocks.deferPreview) {
      await new Promise<void>(resolve => { mocks.pendingPreviewResolve = resolve; });
    }
    if (!params.isPreview && mocks.deferCommit) {
      await new Promise<void>(resolve => { mocks.pendingCommitResolve = resolve; });
    }
    if (!params.isPreview) {
      mocks.storedModels[params.featureId] = params.model;
      mocks.revision++;
    }
    const solved = params.isPreview && mocks.previewSolvedModel
      ? mocks.previewSolvedModel
      : params.isPreview && params.dragPointId
      ? { ...params.model, points: params.model.points.map(point => point.id === params.dragPointId
        ? { ...point, x: params.dragX ?? point.x, y: params.dragY ?? point.y } : point) }
      : params.model;
    return {
      revision: mocks.revision,
      solved,
      curveDisplay: displayFor(solved),
      residual: 0,
      dofs: 0,
      conflicting: [],
    };
  });
  mocks.cancelPreview.mockReset().mockResolvedValue(undefined);
  mocks.requestMesh.mockReset().mockImplementation(async () => {
    if (mocks.deferMesh) await new Promise<void>(resolve => { mocks.pendingMeshResolve = resolve; });
    return { revision: mocks.revision, volumeMm3: 10 };
  });
  mocks.refreshProjection.mockReset().mockResolvedValue(null);
  mocks.updateFeatureSummary.mockReset();
  useDocumentUiStore.getState().resetDocument("doc-sketch-curves");
  useDocumentUiStore.setState({ coreRunning: true, connectionGeneration: 4 });
  useDocumentUiStore.setState({ sketches: [sketchEntry("sketch-curves")] });
});

it("exposes named canvas tools and explicit rectangle/clear actions with read-only diagnostics", async () => {
  await openEditor();
  expect(screen.getByRole("button", { name: "Ellipse" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Elliptical arc" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Control-point spline" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Interpolating spline" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Rectangle" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Clear profile" })).toBeTruthy();
  expect(screen.queryByRole("textbox", { name: "SketchModel JSON" })).toBeNull();
  expect(screen.getByTestId("sketch-editor-window").className).toContain("max-h-[92vh]");
});

it("sizes canvas and quote panel from measured width without overflow at desktop and stacked widths", async () => {
  const initialInnerWidth = window.innerWidth;
  const initialInnerHeight = window.innerHeight;
  const canvas = await openEditor();
  const svgCanvas = canvas as unknown as SVGSVGElement;
  const workspace = screen.getByTestId("sketch-workspace");
  const quotePanel = screen.getByTestId("sketch-quote-panel");
  Object.defineProperty(workspace, "clientWidth", { configurable: true, value: 688 });
  fireEvent(window, new Event("resize"));

  await waitFor(() => expect(svgCanvas.style.width).not.toBe(""));
  const canvasSize = Number.parseFloat(svgCanvas.style.width);
  const quoteWidth = Number.parseFloat((quotePanel as HTMLElement).style.width);
  const gap = Number.parseFloat((workspace as HTMLElement).style.gap);
  canvasBounds(canvas, canvasSize);
  const canvasRect = canvas.getBoundingClientRect();
  expect(canvasSize).toBeGreaterThan(400);
  expect(canvasRect.width).toBe(canvasRect.height);
  expect(canvas.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");
  expect(quoteWidth).toBeGreaterThanOrEqual(200);
  expect(canvasRect.width + quoteWidth + gap).toBeLessThanOrEqual(workspace.clientWidth);

  fireEvent.click(screen.getByRole("button", { name: "Ellipse" }));
  clickCanvas(canvas, canvasSize / 2, canvasSize / 2);
  clickCanvas(canvas, canvasSize * 0.75, canvasSize / 2);
  await waitFor(() => expect(committedCalls()).toHaveLength(1));
  const ellipse = (mocks.storedModels["sketch-curves"] as SketchModel).ellipses![0]!;
  expect(ellipse.majorRadius).toBeCloseTo(30);
  fireEvent.click(screen.getByTestId(`sk-curve-${ellipse.id}`));

  for (const [width, height] of [[800, 600], [1600, 1000]]) {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
    fireEvent(window, new Event("resize"));
    expect(Number.parseFloat(svgCanvas.style.width)).toBe(canvasSize);
    expect(svgCanvas.style.height).toBe(`${canvasSize}px`);
    expect(quotePanel.contains(screen.getByLabelText("Major radius (mm)"))).toBe(true);
    expect(quotePanel.contains(screen.getByRole("button", { name: "Dimension major radius" }))).toBe(true);
    expect((quotePanel as HTMLElement).style.overflowY).toBe("auto");
  }

  Object.defineProperty(workspace, "clientWidth", { configurable: true, value: 480 });
  fireEvent(window, new Event("resize"));
  await waitFor(() => expect(svgCanvas.style.width).toBe("480px"));
  expect(svgCanvas.style.height).toBe("480px");
  expect((quotePanel as HTMLElement).style.width).toBe("100%");
  expect((workspace as HTMLElement).style.overflowX).toBe("hidden");
  expect(Number.parseFloat(svgCanvas.style.width)).toBeLessThanOrEqual(workspace.clientWidth);
  expect(quotePanel.contains(screen.getByLabelText("Major radius (mm)"))).toBe(true);
  Object.defineProperty(window, "innerWidth", { configurable: true, value: initialInnerWidth });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: initialInnerHeight });
});

it("creates an ellipse from canvas points, previews native samples, and drives a named radius dimension", async () => {
  const canvas = await openEditor();
  canvasBounds(canvas);
  fireEvent.click(screen.getByRole("button", { name: "Ellipse" }));
  fireEvent.change(screen.getByLabelText("Minor radius (mm)"), { target: { value: "4" } });
  clickCanvas(canvas, 110, 110);
  clickCanvas(canvas, 165, 110);

  await waitFor(() => expect(committedCalls()).toHaveLength(1));
  const ellipse = (mocks.storedModels["sketch-curves"] as SketchModel).ellipses?.[0];
  expect(ellipse?.majorRadius).toBeCloseTo(30);
  expect(ellipse?.minorRadius).toBe(4);
  expect(await screen.findByTestId(`sk-curve-${ellipse!.id}`)).toBeTruthy();
  expect(mocks.updateSketch.mock.calls.some(([params]) => params.isPreview)).toBe(true);

  fireEvent.click(screen.getByRole("button", { name: "Dimension major radius" }));
  await waitFor(() => expect((mocks.storedModels["sketch-curves"] as SketchModel).constraints)
    .toContainEqual(expect.objectContaining({ kind: "ellipseMajorRadius", refs: [ellipse!.id], value: 30 })));
  const majorField = screen.getByLabelText("Major radius (mm)");
  fireEvent.change(majorField, { target: { value: "14" } });
  fireEvent.keyDown(majorField, { key: "Enter" });
  await waitFor(() => {
    const stored = mocks.storedModels["sketch-curves"] as SketchModel;
    expect(stored.ellipses?.[0]?.majorRadius).toBe(14);
    expect(stored.constraints.find(item => item.kind === "ellipseMajorRadius")?.value).toBe(14);
  });
});

it("creates elliptical arcs with editable non-180-degree start and sweep", async () => {
  const canvas = await openEditor();
  canvasBounds(canvas);
  fireEvent.click(screen.getByRole("button", { name: "Elliptical arc" }));
  fireEvent.change(screen.getByLabelText("Minor radius (mm)"), { target: { value: "5" } });
  fireEvent.change(screen.getByLabelText("Start angle (deg)"), { target: { value: "30" } });
  fireEvent.change(screen.getByLabelText("Sweep (deg)"), { target: { value: "87.5" } });
  clickCanvas(canvas, 110, 110);
  clickCanvas(canvas, 165, 110);
  await waitFor(() => expect(committedCalls()).toHaveLength(1));
  const arc = (mocks.storedModels["sketch-curves"] as SketchModel).ellipses?.[0];
  expect(arc?.arc).toBe(true);
  expect(arc?.startAngleRad).toBeCloseTo(Math.PI / 6);
  expect(arc!.endAngleRad - arc!.startAngleRad).toBeCloseTo(87.5 * Math.PI / 180);
  expect(await screen.findByTestId(`sk-curve-${arc!.id}`)).toBeTruthy();
});

it("authors a control-point spline, toggles construction, and edits a named point", async () => {
  const canvas = await openEditor();
  canvasBounds(canvas);
  fireEvent.click(screen.getByRole("button", { name: "Control-point spline" }));
  clickCanvas(canvas, 45, 170);
  clickCanvas(canvas, 90, 115);
  clickCanvas(canvas, 155, 150);
  const finish = screen.getByRole("button", { name: "Finish spline" });
  await waitFor(() => expect((finish as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(finish);
  await waitFor(() => expect((mocks.storedModels["sketch-curves"] as SketchModel).splines).toHaveLength(1));
  let stored = mocks.storedModels["sketch-curves"] as SketchModel;
  const spline = stored.splines![0]!;
  expect(spline.controlPoints).toBe(true);
  expect(spline.closed).toBe(false);
  expect(await screen.findByTestId(`sk-curve-${spline.id}`)).toBeTruthy();

  fireEvent.click(screen.getByLabelText("Construction geometry"));
  await waitFor(() => expect((mocks.storedModels["sketch-curves"] as SketchModel).constructionIds).toContain(spline.id));
  const pointId = spline.pointIds[0]!;
  const xField = screen.getByLabelText(`${pointId} · X (mm)`);
  const oldX = Number(xField.getAttribute("value") ?? (xField as HTMLInputElement).value);
  fireEvent.change(xField, { target: { value: String(oldX + 3) } });
  fireEvent.keyDown(xField, { key: "Enter" });
  await waitFor(() => {
    stored = mocks.storedModels["sketch-curves"] as SketchModel;
    expect(stored.points.find(point => point.id === pointId)?.x).toBeCloseTo(oldX + 3);
  });
  expect(committedCalls()).toHaveLength(3);
});

it("drags a selected spline control point on canvas and commits the moved position", async () => {
  const canvas = await openEditor();
  canvasBounds(canvas);
  fireEvent.click(screen.getByRole("button", { name: "Control-point spline" }));
  clickCanvas(canvas, 45, 170);
  clickCanvas(canvas, 90, 115);
  clickCanvas(canvas, 155, 150);
  const finish = screen.getByRole("button", { name: "Finish spline" });
  await waitFor(() => expect((finish as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(finish);
  await waitFor(() => expect(committedCalls()).toHaveLength(1));

  const spline = (mocks.storedModels["sketch-curves"] as SketchModel).splines![0]!;
  const pointId = spline.pointIds[0]!;
  const point = screen.getByTestId(`sk-point-${pointId}`);
  const before = (mocks.storedModels["sketch-curves"] as SketchModel).points.find(item => item.id === pointId)!;
  Object.defineProperty(point, "ownerSVGElement", { configurable: true, value: canvas });
  firePointer(point, "pointerdown", 50, 160);
  firePointer(point, "pointermove", 90, 160);
  await waitFor(() => expect(mocks.updateSketch.mock.calls.some(([params]) => params.isPreview && params.dragPointId === pointId)).toBe(true));
  firePointer(point, "pointerup", 90, 160);

  await waitFor(() => expect(committedCalls()).toHaveLength(2));
  const moved = (mocks.storedModels["sketch-curves"] as SketchModel).points.find(item => item.id === pointId)!;
  expect(moved.x).not.toBeCloseTo(before.x);
});

it("authors a closed interpolating spline after four canvas points", async () => {
  const canvas = await openEditor();
  canvasBounds(canvas);
  fireEvent.click(screen.getByRole("button", { name: "Interpolating spline" }));
  fireEvent.click(screen.getByLabelText("Closed"));
  clickCanvas(canvas, 40, 165);
  clickCanvas(canvas, 100, 50);
  clickCanvas(canvas, 175, 115);
  expect((screen.getByRole("button", { name: "Finish spline" }) as HTMLButtonElement).disabled).toBe(true);
  clickCanvas(canvas, 115, 190);
  const finish = screen.getByRole("button", { name: "Finish spline" });
  await waitFor(() => expect((finish as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(finish);
  await waitFor(() => expect((mocks.storedModels["sketch-curves"] as SketchModel).splines).toHaveLength(1));
  const spline = (mocks.storedModels["sketch-curves"] as SketchModel).splines![0]!;
  expect(spline.controlPoints).toBe(false);
  expect(spline.closed).toBe(true);
  expect(spline.pointIds).toHaveLength(4);
});

it("keeps incomplete spline drafts local and Escape cancels a delayed native preview", async () => {
  const canvas = await openEditor();
  canvasBounds(canvas);
  fireEvent.click(screen.getByRole("button", { name: "Interpolating spline" }));
  fireEvent.click(screen.getByLabelText("Closed"));
  clickCanvas(canvas, 40, 165);
  clickCanvas(canvas, 100, 50);
  clickCanvas(canvas, 175, 115);
  expect(screen.getByTestId("sketch-curve-draft")).toBeTruthy();
  expect(committedCalls()).toHaveLength(0);
  mocks.deferPreview = true;
  clickCanvas(canvas, 115, 190);
  await waitFor(() => expect(mocks.pendingPreviewResolve).toBeTypeOf("function"));
  fireEvent.keyDown(window, { key: "Escape" });
  await act(async () => { mocks.pendingPreviewResolve?.(); });
  await waitFor(() => expect(screen.queryByTestId("sketch-curve-draft")).toBeNull());
  expect(committedCalls()).toHaveLength(0);
});

it("does not commit or display a spline when native preview reports a per-curve failure", async () => {
  const canvas = await openEditor();
  canvasBounds(canvas);
  mocks.displayError = "interpolation failed";
  fireEvent.click(screen.getByRole("button", { name: "Interpolating spline" }));
  clickCanvas(canvas, 45, 170);
  clickCanvas(canvas, 90, 115);
  clickCanvas(canvas, 155, 150);
  await waitFor(() => expect(screen.getByText(/interpolation failed/)).toBeTruthy());
  expect((screen.getByRole("button", { name: "Finish spline" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByTestId(/sk-curve-spline-/)).toBeNull();
  expect(committedCalls()).toHaveLength(0);
});

it("checks curves moved by the solved preview before committing a driving dimension", async () => {
  const dependentModel: SketchModel = {
    points: [
      { id: "ellipse-center", x: 0, y: 0, fixed: false },
      { id: "spline-p0", x: 20, y: 10, fixed: false },
      { id: "spline-p1", x: 30, y: 22, fixed: false },
      { id: "spline-p2", x: 42, y: 8, fixed: false },
    ],
    lines: [], circles: [], arcs: [],
    ellipses: [{ id: "driving-ellipse", center: "ellipse-center", majorRadius: 10, minorRadius: 4,
      rotationRad: 0, arc: false, startAngleRad: 0, endAngleRad: Math.PI * 2 }],
    splines: [{ id: "dependent-spline", pointIds: ["spline-p0", "spline-p1", "spline-p2"], controlPoints: true, closed: false }],
    constructionIds: [], constraints: [],
  };
  mocks.storedModels["sketch-curves"] = dependentModel;
  await openEditor();
  fireEvent.click(screen.getByTestId("sk-curve-driving-ellipse"));
  fireEvent.click(screen.getByRole("button", { name: "Dimension major radius" }));
  await waitFor(() => expect(committedCalls()).toHaveLength(1));

  const committed = mocks.storedModels["sketch-curves"] as SketchModel;
  const movedPointId = "spline-p1";
  mocks.previewSolvedModel = {
    ...committed,
    points: committed.points.map(point => point.id === movedPointId ? { ...point, x: point.x + 5 } : point),
    ellipses: committed.ellipses?.map(ellipse => ellipse.id === "driving-ellipse"
      ? { ...ellipse, majorRadius: 15 } : ellipse),
  };
  mocks.displayError = "interpolation failed after solve";
  mocks.displayErrorEntityId = "dependent-spline";
  const majorRadius = screen.getByLabelText("Major radius (mm)");
  fireEvent.change(majorRadius, { target: { value: "15" } });
  fireEvent.keyDown(majorRadius, { key: "Enter" });

  await waitFor(() => expect(screen.getAllByText(/interpolation failed after solve/).length).toBeGreaterThan(0));
  expect(committedCalls()).toHaveLength(1);
  expect((mocks.storedModels["sketch-curves"] as SketchModel).ellipses?.[0]?.majorRadius).toBe(10);
  expect((mocks.storedModels["sketch-curves"] as SketchModel).points.find(point => point.id === movedPointId)?.x)
    .toBe(committed.points.find(point => point.id === movedPointId)?.x);
});

it("does not let a deferred old-sketch commit repaint the newly selected sketch", async () => {
  useDocumentUiStore.getState().upsertSketch(sketchEntry("sketch-next"));
  const view = render(<SketchEditor sketchId="sketch-curves" onClose={vi.fn()} />);
  const canvas = await screen.findByTestId("sketch-canvas");
  await waitFor(() => expect((screen.getByRole("button", { name: "Clear profile" }) as HTMLButtonElement).disabled).toBe(false));
  canvasBounds(canvas);
  mocks.deferCommit = true;
  fireEvent.click(screen.getByRole("button", { name: "Ellipse" }));
  clickCanvas(canvas, 110, 110);
  clickCanvas(canvas, 165, 110);
  await waitFor(() => expect(mocks.pendingCommitResolve).toBeTypeOf("function"));
  view.rerender(<SketchEditor sketchId="sketch-next" onClose={vi.fn()} />);
  await waitFor(() => expect(mocks.requestSketch).toHaveBeenCalledWith("sketch-next", expect.any(Object)));
  await act(async () => { mocks.pendingCommitResolve?.(); });
  expect(screen.queryByTestId(/sk-curve-ellipse-/)).toBeNull();
  expect(screen.queryByTestId("sketch-selected-curve")).toBeNull();
});

it("drops old-load responses and blocks edits while a new connection generation reloads", async () => {
  const oldModel: SketchModel = {
    points: [{ id: "stale-center", x: 0, y: 0, fixed: false }],
    lines: [], circles: [], arcs: [],
    ellipses: [{ id: "stale-ellipse", center: "stale-center", majorRadius: 12, minorRadius: 5,
      rotationRad: 0, arc: false, startAngleRad: 0, endAngleRad: Math.PI * 2 }],
    splines: [], constructionIds: [], constraints: [],
  };
  mocks.sketchLoadModels = [oldModel, emptyModel()];
  mocks.deferSketchLoad = true;
  render(<SketchEditor sketchId="sketch-curves" onClose={vi.fn()} />);
  await waitFor(() => expect(mocks.pendingSketchLoadResolves).toHaveLength(1));
  const before = useDocumentUiStore.getState();
  act(() => useDocumentUiStore.getState().advanceConnectionGeneration());
  await waitFor(() => expect(mocks.pendingSketchLoadResolves).toHaveLength(2));
  const after = useDocumentUiStore.getState();
  expect(after.documentId).toBe(before.documentId);
  expect(after.epoch).toBe(before.epoch);
  expect(after.revision).toBe(before.revision);
  expect(after.connectionGeneration).toBe(before.connectionGeneration + 1);
  const rectangle = screen.getByRole("button", { name: "Rectangle" }) as HTMLButtonElement;
  expect(rectangle.disabled).toBe(true);
  fireEvent.click(rectangle);
  expect(committedCalls()).toHaveLength(0);

  await act(async () => { mocks.pendingSketchLoadResolves[0]?.(); });
  expect(screen.queryByTestId("sk-curve-stale-ellipse")).toBeNull();
  expect(committedCalls()).toHaveLength(0);
  await act(async () => { mocks.pendingSketchLoadResolves[1]?.(); });
  await waitFor(() => expect(rectangle.disabled).toBe(false));
  expect(screen.queryByTestId("sk-curve-stale-ellipse")).toBeNull();
  expect((mocks.storedModels["sketch-curves"] as SketchModel | undefined)?.ellipses ?? []).toEqual([]);
  expect(committedCalls()).toHaveLength(0);
});

it("does not publish a delayed dependent mesh after a document switch", async () => {
  useDocumentUiStore.setState({ features: [{
    featureId: "dependent-box", type: "Box", dependsOn: ["sketch-curves"], status: "ok",
  } as never] });
  const canvas = await openEditor();
  canvasBounds(canvas);
  fireEvent.click(screen.getByRole("button", { name: "Ellipse" }));
  clickCanvas(canvas, 110, 110);
  clickCanvas(canvas, 165, 110);
  mocks.deferMesh = true;
  await waitFor(() => expect(mocks.pendingMeshResolve).toBeTypeOf("function"));
  act(() => useDocumentUiStore.getState().resetDocument("doc-next"));
  await waitFor(() => expect(useDocumentUiStore.getState().documentId).toBe("doc-next"));
  await act(async () => { mocks.pendingMeshResolve?.(); });
  expect(mocks.updateFeatureSummary).not.toHaveBeenCalled();
  expect(useDocumentUiStore.getState().meshes["dependent-box"]).toBeUndefined();
});

it("keeps a cleared canonical sketch empty after reopening with a fresh profile", async () => {
  mocks.storedModels["sketch-curves"] = {
    ...emptyModel(),
    points: [{ id: "old-p", x: 1, y: 2, fixed: false }],
    lines: [{ id: "old-line", p1: "old-p", p2: "old-p" }],
  };
  await openEditor();
  fireEvent.click(screen.getByRole("button", { name: "Clear profile" }));
  await waitFor(() => expect(committedCalls()).toHaveLength(1));
  expect((mocks.storedModels["sketch-curves"] as SketchModel).lines).toEqual([]);
  expect(screen.getByRole("button", { name: "Rectangle" })).toBeTruthy();
  expect(useDocumentUiStore.getState().sketches.find(item => item.featureId === "sketch-curves")?.points).toBe(0);
  cleanup();
  window.localStorage.clear();
  await openEditor();
  expect((mocks.storedModels["sketch-curves"] as SketchModel)).toMatchObject({ points: [], lines: [], circles: [], arcs: [] });
  expect(committedCalls()).toHaveLength(1);
  expect(screen.queryByTestId(/sk-curve-/)).toBeNull();
  expect(screen.getByRole("button", { name: "Rectangle" })).toBeTruthy();
});
