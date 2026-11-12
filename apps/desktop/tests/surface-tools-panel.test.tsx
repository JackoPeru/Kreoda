import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";

const mocks = vi.hoisted(() => ({ execute: vi.fn(), refresh: vi.fn() }));
vi.mock("../src/commands/execute", () => ({
  executeCommand: mocks.execute,
  refreshSurfaceSnapshot: mocks.refresh,
}));

import { SurfaceToolsPanel } from "../src/components/workspace/SurfaceToolsPanel";
import { coreClient } from "../src/ipc/coreClient";
import { useDocumentUiStore, useSelectionStore } from "../src/stores";

const sketch = (featureId: string, extra: Record<string, unknown> = {}) => ({
  featureId, planeKind: "XY", points: 4, lines: 4, circles: 0, constraints: 0,
  geometryCurrent: true, status: "ok", model: { points: [], lines: [], circles: [], arcs: [], constraints: [] },
  ...extra,
});
const feature = (featureId: string, type = "SurfaceExtrude", extra: Record<string, unknown> = {}) => ({
  featureId, type, paramsMm: [10], dependsOn: [], refExtra: "", expressions: {},
  geometryCurrent: true, status: "ok", ...extra,
});
const created = {
  featureId: "surface-created", type: "SurfaceExtrude", paramsMm: [], dependsOn: ["sk-a"],
  refExtra: "", expressions: {}, bboxMm: [0, 0, 0, 1, 1, 1] as [number, number, number, number, number, number], revision: 8,
};

function setup(selectedIds: string[] = []) {
  useDocumentUiStore.getState().resetDocument("surface-doc");
  (coreClient as unknown as { documentId: string }).documentId = "surface-doc";
  useDocumentUiStore.getState().setCoreStatus(true, "test");
  useDocumentUiStore.getState().setFeatures([
    feature("surface-a"), feature("surface-b", "SurfaceOffset"),
  ], 7);
  useDocumentUiStore.getState().setSketches([sketch("sk-a"), sketch("sk-b")], 7);
  useSelectionStore.setState({ selectedIds });
}

function renderOpenPanel() {
  const close = vi.fn();
  const returnFocus = vi.fn();
  const view = render(<SurfaceToolsPanel open onClose={close} returnFocus={returnFocus} />);
  return { ...view, close, returnFocus };
}

function context() {
  const state = useDocumentUiStore.getState();
  return { documentId: state.documentId, revision: state.revision, epoch: state.epoch, connectionGeneration: state.connectionGeneration };
}

beforeEach(() => {
  vi.clearAllMocks();
  setup();
  mocks.execute.mockResolvedValue({ kind: "created", feature: created });
  mocks.refresh.mockResolvedValue({ features: [created], revision: 8 });
});
afterEach(cleanup);

const mappingCases: [string, string[], (panel: HTMLElement) => void, Record<string, unknown>][] = [
  ["CreateSurfaceExtrude", ["sk-a"], () => {}, { sketchId: "sk-a", distanceMm: 10 }],
  ["CreateSurfaceRevolve", ["sk-a"], panel => {
    fireEvent.change(panel.querySelector("[data-testid='surface-angle']")!, { target: { value: "90 deg" } });
    fireEvent.change(panel.querySelector("[data-testid='surface-axis-mode']")!, { target: { value: "custom" } });
    fireEvent.click(screen.getByTestId("surface-advanced-summary"));
    fireEvent.change(panel.querySelector("[data-testid='surface-origin-x']")!, { target: { value: "25 mm" } });
    fireEvent.change(panel.querySelector("[data-testid='surface-origin-y']")!, { target: { value: "-2 cm" } });
    fireEvent.change(panel.querySelector("[data-testid='surface-axis-x']")!, { target: { value: "0" } });
    fireEvent.change(panel.querySelector("[data-testid='surface-axis-y']")!, { target: { value: "1" } });
    fireEvent.change(panel.querySelector("[data-testid='surface-axis-z']")!, { target: { value: "0" } });
  }, { sketchId: "sk-a", angleDeg: 90, axisOriginXMm: 25, axisOriginYMm: -20, axisOriginZMm: 0, axisX: 0, axisY: 1, axisZ: 0 }],
  ["CreateSurfaceLoft", ["sk-b", "sk-a"], () => {}, { sketchIds: ["sk-b", "sk-a"] }],
  ["CreateSurfaceSew", ["surface-b", "surface-a"], () => {}, { featureIds: ["surface-b", "surface-a"], toleranceMm: 0.01, makeSolid: false }],
  ["CreateSurfaceOffset", ["surface-a"], panel => {
    fireEvent.change(panel.querySelector("[data-testid='surface-distance']")!, { target: { value: "-2 cm" } });
  }, { targetId: "surface-a", distanceMm: -20, toleranceMm: 0.000001 }],
  ["CreateSurfaceSweep", ["sk-b", "sk-a"], () => {}, { profileSketchId: "sk-b", pathSketchId: "sk-a", toleranceMm: 0.000001 }],
  ["CreateSurfaceThicken", ["surface-a"], panel => {
    fireEvent.change(panel.querySelector("[data-testid='surface-thickness']")!, { target: { value: "-2 cm" } });
  }, { targetId: "surface-a", thicknessMm: -20, toleranceMm: 0.000001 }],
];

it.each(mappingCases)("maps the %s form to native parameters", async (operation, selectedIds, edit, expected) => {
  setup(selectedIds);
  const { container } = renderOpenPanel();
  fireEvent.change(screen.getByTestId("surface-operation"), { target: { value: operation } });
  edit(container);
  fireEvent.click(screen.getByTestId("surface-create"));

  await waitFor(() => expect(mocks.execute).toHaveBeenCalledOnce());
  expect(mocks.execute).toHaveBeenCalledWith(operation, expected, { surfaceContext: context() });
});

it("offers healthy current surfaces, hidden surfaces, and supported direct instances only", async () => {
  useDocumentUiStore.getState().setFeatures([
    feature("surface-a"), feature("surface-hidden", "SurfaceExtrude", { bodyVisible: false }),
    feature("surface-instance", "Instance", { dependsOn: ["surface-a"] }),
    feature("solid-sewn", "SurfaceSewnSolid"), feature("solid-thicken", "SurfaceFaceThicken"),
    feature("surface-stale", "SurfaceOffset", { geometryCurrent: false }),
    feature("surface-broken", "SurfaceOffset", { status: "broken", error: "bad source" }),
  ], 7);
  renderOpenPanel();
  fireEvent.change(screen.getByTestId("surface-operation"), { target: { value: "CreateSurfaceOffset" } });
  const select = screen.getByTestId("surface-offset-source") as HTMLSelectElement;
  const values = [...select.options].map(option => option.value);

  expect(values).toEqual(expect.arrayContaining(["surface-a", "surface-hidden", "surface-instance"]));
  expect(values).not.toEqual(expect.arrayContaining(["solid-sewn", "solid-thicken", "surface-stale", "surface-broken"]));
  expect(select.options[1]?.textContent).not.toBe(select.options[2]?.textContent);
});

it("adds and reorders loft sections without sorting source ids", async () => {
  renderOpenPanel();
  fireEvent.change(screen.getByTestId("surface-operation"), { target: { value: "CreateSurfaceLoft" } });
  const add = screen.getByTestId("surface-loft-add-source") as HTMLSelectElement;
  fireEvent.change(add, { target: { value: "sk-a" } });
  fireEvent.click(screen.getByTestId("surface-loft-add"));
  fireEvent.change(add, { target: { value: "sk-b" } });
  fireEvent.click(screen.getByTestId("surface-loft-add"));
  fireEvent.click(screen.getByTestId("surface-loft-up-1"));
  fireEvent.click(screen.getByTestId("surface-create"));

  await waitFor(() => expect(mocks.execute).toHaveBeenCalledWith(
    "CreateSurfaceLoft", { sketchIds: ["sk-b", "sk-a"] }, { surfaceContext: context() },
  ));
});

it("offers hidden surfaces for thickening and clears a vanished source", async () => {
  setup(["surface-a"]);
  useDocumentUiStore.getState().setFeatures([
    feature("surface-a", "SurfaceExtrude", { bodyVisible: false }),
    feature("thickened", "SurfaceThicken"),
    feature("solid-instance", "Instance", { dependsOn: ["thickened"] }),
  ], 7);
  renderOpenPanel();
  fireEvent.change(screen.getByTestId("surface-operation"), { target: { value: "CreateSurfaceThicken" } });
  const select = screen.getByTestId("surface-thicken-source") as HTMLSelectElement;
  expect(select.value).toBe("surface-a");
  expect([...select.options].map(option => option.value)).toEqual(["", "surface-a"]);
  act(() => useDocumentUiStore.getState().setFeatures([], 8));
  await waitFor(() => expect(select.value).toBe(""));
  expect((screen.getByTestId("surface-create") as HTMLButtonElement).disabled).toBe(true);
});

it("rejects invalid empty units locally without native dispatch", async () => {
  setup(["surface-a"]);
  renderOpenPanel();
  fireEvent.change(screen.getByTestId("surface-operation"), { target: { value: "CreateSurfaceOffset" } });
  fireEvent.change(screen.getByTestId("surface-distance"), { target: { value: "" } });
  fireEvent.click(screen.getByTestId("surface-create"));

  expect(mocks.execute).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toBeTruthy();
});

it("preserves the selected sew list and values after native failure", async () => {
  setup(["surface-b", "surface-a"]);
  mocks.execute.mockRejectedValueOnce(new Error("open shell"));
  renderOpenPanel();
  fireEvent.change(screen.getByTestId("surface-operation"), { target: { value: "CreateSurfaceSew" } });
  fireEvent.click(screen.getByTestId("surface-create"));

  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("open shell"));
  expect(screen.getByTestId("surface-sew-item-0").textContent).toBeTruthy();
  expect(screen.getByTestId("surface-tolerance")).toHaveProperty("value", "0.01 mm");
  expect(mocks.execute).toHaveBeenCalledOnce();
});

it("blocks synchronous duplicate submits while the native command is pending", async () => {
  let resolve!: (value: unknown) => void;
  mocks.execute.mockReturnValueOnce(new Promise(accept => { resolve = accept; }));
  setup(["sk-a"]);
  renderOpenPanel();
  fireEvent.click(screen.getByTestId("surface-create"));
  fireEvent.click(screen.getByTestId("surface-create"));

  expect(mocks.execute).toHaveBeenCalledOnce();
  expect(screen.getByTestId("surface-create")).toHaveProperty("disabled", true);
  await act(async () => resolve({ kind: "created", feature: created }));
});

it("keeps the in-flight lock across hide and reopen, then releases it without stale UI effects", async () => {
  let resolve!: (value: unknown) => void;
  mocks.execute.mockReturnValueOnce(new Promise(accept => { resolve = accept; }));
  setup(["sk-a"]);
  function Harness() {
    const [open, setOpen] = useState(true);
    return <>
      <button data-testid="toggle-surface-panel" onClick={() => setOpen(value => !value)}>toggle</button>
      <SurfaceToolsPanel open={open} onClose={() => setOpen(false)} returnFocus={() => {}} />
    </>;
  }
  render(<Harness />);
  fireEvent.click(screen.getByTestId("surface-create"));
  fireEvent.click(screen.getByTestId("toggle-surface-panel"));
  expect(screen.queryByTestId("surface-tools-panel")).toBeNull();
  fireEvent.click(screen.getByTestId("toggle-surface-panel"));
  expect(screen.getByTestId("surface-create")).toHaveProperty("disabled", true);
  expect(mocks.execute).toHaveBeenCalledOnce();

  await act(async () => resolve({ kind: "created", feature: created }));
  await waitFor(() => expect(screen.getByTestId("surface-create")).toHaveProperty("disabled", false));
  expect(screen.queryByText("Surface created")).toBeNull();
  expect(useSelectionStore.getState().selectedIds).toEqual(["sk-a"]);
});

it("retains acknowledged refresh failure across hide and reopen until read-only retry succeeds", async () => {
  let resolve!: (value: unknown) => void;
  mocks.execute.mockReturnValueOnce(new Promise(accept => { resolve = accept; }));
  setup(["sk-a"]);
  function Harness() {
    const [open, setOpen] = useState(true);
    return <>
      <button data-testid="toggle-surface-panel" onClick={() => setOpen(value => !value)}>toggle</button>
      <SurfaceToolsPanel open={open} onClose={() => setOpen(false)} returnFocus={() => {}} />
    </>;
  }
  render(<Harness />);
  fireEvent.click(screen.getByTestId("surface-create"));
  fireEvent.click(screen.getByTestId("toggle-surface-panel"));
  fireEvent.click(screen.getByTestId("toggle-surface-panel"));
  await act(async () => resolve({ kind: "created", feature: created, refreshError: "mesh refresh failed" }));

  expect(screen.getByTestId("surface-refresh-warning").textContent).toContain("mesh refresh failed");
  expect(screen.getByTestId("surface-create")).toHaveProperty("disabled", true);
  expect(mocks.execute).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByTestId("surface-retry-refresh"));
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalledWith(context()));
  expect(mocks.execute).toHaveBeenCalledOnce();
  await waitFor(() => expect(screen.getByTestId("surface-create")).toHaveProperty("disabled", false));
});

it("resets form drafts and selected-source prefill for a new document lineage", async () => {
  setup(["sk-a"]);
  function Harness() {
    const [open, setOpen] = useState(true);
    return <>
      <button data-testid="toggle-surface-panel" onClick={() => setOpen(value => !value)}>toggle</button>
      <SurfaceToolsPanel open={open} onClose={() => setOpen(false)} returnFocus={() => {}} />
    </>;
  }
  render(<Harness />);
  await waitFor(() => expect((screen.getByTestId("surface-sketch-source") as HTMLSelectElement).value).toBe("sk-a"));
  fireEvent.change(screen.getByTestId("surface-distance"), { target: { value: "25 mm" } });

  act(() => {
    useDocumentUiStore.getState().resetDocument("new-surface-doc");
    useDocumentUiStore.getState().setCoreStatus(true, "test");
    useDocumentUiStore.getState().setSketches([sketch("sk-new")], 0);
    (coreClient as unknown as { documentId: string }).documentId = "new-surface-doc";
    useSelectionStore.setState({ selectedIds: ["sk-new"] });
  });
  await waitFor(() => expect(screen.queryByTestId("surface-tools-panel")).toBeNull());
  fireEvent.click(screen.getByTestId("toggle-surface-panel"));

  await waitFor(() => expect((screen.getByTestId("surface-sketch-source") as HTMLSelectElement).value).toBe("sk-new"));
  expect(screen.getByTestId("surface-distance")).toHaveProperty("value", "10 mm");
});

it("blocks repeat creation after acknowledged refresh failure and retries read-only", async () => {
  setup(["sk-a"]);
  mocks.execute.mockResolvedValueOnce({ kind: "created", feature: created, refreshError: "mesh refresh failed" });
  const { container } = renderOpenPanel();
  fireEvent.click(screen.getByTestId("surface-create"));

  await waitFor(() => expect(screen.getByTestId("surface-refresh-warning").textContent).toContain("mesh refresh failed"));
  expect(screen.getByTestId("surface-create")).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByTestId("surface-retry-refresh"));
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalledWith(context()));
  expect(mocks.execute).toHaveBeenCalledOnce();
  expect(screen.getByTestId("surface-create")).toHaveProperty("disabled", false);
  expect(container.querySelector("[data-testid='surface-retry-refresh']")).toBeNull();
});

it("clears removed references visibly and closes on document reset or disconnect", async () => {
  setup(["sk-a"]);
  function Harness() {
    const [open, setOpen] = useState(true);
    return <SurfaceToolsPanel open={open} onClose={() => setOpen(false)} returnFocus={() => {}} />;
  }
  render(<Harness />);
  await waitFor(() => expect((screen.getByTestId("surface-sketch-source") as HTMLSelectElement).value).toBe("sk-a"));
  useDocumentUiStore.getState().setSketches([sketch("sk-b")], 7);
  await waitFor(() => expect((screen.getByTestId("surface-sketch-source") as HTMLSelectElement).value).toBe(""));
  expect(screen.getByRole("alert")).toBeTruthy();

  useDocumentUiStore.getState().resetDocument("replacement-doc");
  await waitFor(() => expect(screen.queryByTestId("surface-tools-panel")).toBeNull());
});

it("ignores late creation status and selection after disconnect", async () => {
  let resolve!: (value: unknown) => void;
  mocks.execute.mockReturnValueOnce(new Promise(accept => { resolve = accept; }));
  setup(["sk-a"]);
  function Harness() {
    const [open, setOpen] = useState(true);
    return <SurfaceToolsPanel open={open} onClose={() => setOpen(false)} returnFocus={() => {}} />;
  }
  render(<Harness />);
  fireEvent.click(screen.getByTestId("surface-create"));
  useDocumentUiStore.getState().setCoreStatus(false, null);
  await waitFor(() => expect(screen.queryByTestId("surface-tools-panel")).toBeNull());
  await act(async () => resolve({ kind: "created", feature: created }));

  expect(screen.queryByText("Surface created")).toBeNull();
  expect(useSelectionStore.getState().selectedIds).toEqual(["sk-a"]);
});
