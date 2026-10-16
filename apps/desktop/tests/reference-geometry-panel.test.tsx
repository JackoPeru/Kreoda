import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { COMMANDS } from "@kreoda/command-schema";
import type { DatumDescriptor } from "@kreoda/protocol";
import { useDocumentUiStore, useSelectionStore } from "../src/stores";
import { TopToolDock } from "../src/components/workspace/TopToolDock";
import { ReferenceGeometryPanel } from "../src/components/workspace/ReferenceGeometryPanel";

const executeMock = vi.hoisted(() => vi.fn());

vi.mock("../src/commands/execute", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/commands/execute")>();
  return { ...actual, executeCommand: executeMock };
});

const planeDatum: DatumDescriptor = {
  featureId: "datum-plane",
  kind: "DatumPlane",
  definition: { type: "principal", planeKind: "XY" },
  dependsOn: [],
  resolved: { originMm: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] },
  status: "ok",
};
const offsetPlaneDatum: DatumDescriptor = {
  ...planeDatum,
  featureId: "datum-offset-plane",
  definition: { type: "offset", base: { type: "principal", planeKind: "XY" }, offsetMm: 30 },
  resolved: { originMm: [0, 0, 30], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] },
};
const axisDatum: DatumDescriptor = {
  featureId: "datum-axis",
  kind: "DatumAxis",
  definition: { type: "twoPoint", first: { type: "coordinates", positionMm: [0, 0, 0] }, second: { type: "coordinates", positionMm: [0, 0, 1] } },
  dependsOn: [],
  resolved: { originMm: [0, 0, 0], direction: [0, 0, 1] },
  status: "ok",
};
const pointDatum: DatumDescriptor = {
  featureId: "datum-point",
  kind: "DatumPoint",
  definition: { type: "coordinates", positionMm: [4, 5, 6] },
  dependsOn: [],
  resolved: { positionMm: [4, 5, 6] },
  status: "ok",
};

function renderPanel(onSketchCreated = vi.fn(), onClose = vi.fn()) {
  return render(<ReferenceGeometryPanel onSketchCreated={onSketchCreated} onClose={onClose} />);
}

function choose(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function setNumber(label: string, value: number): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value: String(value) } });
}

async function createReference(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "Create reference" }));
  await waitFor(() => expect(executeMock).toHaveBeenCalled());
}

function chooseVisibleOption(label: string, optionName: RegExp): void {
  const select = screen.getByLabelText(label) as HTMLSelectElement;
  const option = Array.from(select.options).find((candidate) => optionName.test(candidate.textContent ?? ""));
  if (!option) throw new Error(`No visible option matched ${optionName}`);
  fireEvent.change(select, { target: { value: option.value } });
}

beforeEach(() => {
  useDocumentUiStore.setState({ datums: [], features: [{ featureId: "box-1", type: "Box", dependsOn: [], paramsMm: [] } as never], sketches: [], coreRunning: true });
  useSelectionStore.setState({ selectedIds: [], mode: "auto" });
  executeMock.mockReset();
  executeMock.mockImplementation(async (id: string, params: unknown) => {
    const command = COMMANDS.find((item) => item.id === id);
    if (!command) throw new Error(`Unknown command ${id}`);
    command.parameterSchema.parse(params);
    if (id === "CreateSketch") {
      useDocumentUiStore.setState({
        sketches: [{ featureId: "sketch-created", planeKind: "Datum", points: 0, lines: 0, circles: 0, constraints: 0 } as never],
      });
    }
    return { kind: "ok" };
  });
});

afterEach(() => {
  cleanup();
  useDocumentUiStore.setState({ datums: [], features: [], sketches: [] });
  useSelectionStore.setState({ selectedIds: [], mode: "auto" });
});

describe("reference geometry entry point", () => {
  it("opens native reference geometry without opening image references", () => {
    const onReferenceGeometry = vi.fn();
    const onReference = vi.fn();
    render(
      <TopToolDock
        onAdd={() => {}}
        onSketch={() => {}}
        onOpenProject={() => {}}
        onToggleProps={() => {}}
        onPlugins={() => {}}
        onReference={onReference}
        onReferenceGeometry={onReferenceGeometry}
        onInstance={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("button", { name: "Reference geometry" }));

    expect(onReferenceGeometry).toHaveBeenCalledOnce();
    expect(onReference).not.toHaveBeenCalled();
  });
});

describe("native reference geometry workflows", () => {
  it.each([
    { name: "principal plane", kind: "plane", operation: "principal", expected: { type: "principal", planeKind: "YZ" }, setup: () => choose("Principal plane", "YZ"), command: "CreateDatumPlane" },
    { name: "offset plane", kind: "plane", operation: "offset", expected: { type: "offset", base: { type: "principal", planeKind: "XY" }, offsetMm: 42 }, setup: () => setNumber("Offset (mm)", 42), command: "CreateDatumPlane" },
    { name: "mid plane", kind: "plane", operation: "mid", expected: { type: "mid", first: { type: "principal", planeKind: "XY" }, second: { type: "datum", featureId: "datum-offset-plane" } }, setup: () => { act(() => useDocumentUiStore.setState({ datums: [offsetPlaneDatum] })); chooseVisibleOption("Second plane", /Reference plane.*datum-offset-plane/); }, command: "CreateDatumPlane" },
    { name: "angled plane", kind: "plane", operation: "angle", expected: { type: "angle", base: { type: "principal", planeKind: "XY" }, axis: { type: "principal", axis: "Z" }, angleDeg: 35 }, setup: () => setNumber("Angle (deg)", 35), command: "CreateDatumPlane" },
    { name: "three-point plane", kind: "plane", operation: "threePoint", expected: { type: "threePoint", first: { type: "coordinates", positionMm: [1, 2, 3] }, second: { type: "coordinates", positionMm: [4, 5, 6] }, third: { type: "coordinates", positionMm: [7, 8, 9] } }, setup: () => { for (const [label, value] of [["First point X (mm)", 1], ["First point Y (mm)", 2], ["First point Z (mm)", 3], ["Second point X (mm)", 4], ["Second point Y (mm)", 5], ["Second point Z (mm)", 6], ["Third point X (mm)", 7], ["Third point Y (mm)", 8], ["Third point Z (mm)", 9]] as const) setNumber(label, value); }, command: "CreateDatumPlane" },
    { name: "two-point axis", kind: "axis", operation: "twoPoint", expected: { type: "twoPoint", first: { type: "coordinates", positionMm: [0, 0, 0] }, second: { type: "coordinates", positionMm: [8, 9, 10] } }, setup: () => { setNumber("Second point X (mm)", 8); setNumber("Second point Y (mm)", 9); setNumber("Second point Z (mm)", 10); }, command: "CreateDatumAxis" },
    { name: "plane-normal axis", kind: "axis", operation: "planeNormal", expected: { type: "planeNormal", plane: { type: "principal", planeKind: "XY" } }, setup: () => {}, command: "CreateDatumAxis" },
    { name: "intersecting-planes axis", kind: "axis", operation: "planeIntersection", expected: { type: "planeIntersection", first: { type: "principal", planeKind: "XY" }, second: { type: "principal", planeKind: "YZ" } }, setup: () => chooseVisibleOption("Second plane", /YZ plane/), command: "CreateDatumAxis" },
    { name: "coordinate point", kind: "point", operation: "coordinates", expected: { type: "coordinates", positionMm: [11, 12, 13] }, setup: () => { setNumber("Point X (mm)", 11); setNumber("Point Y (mm)", 12); setNumber("Point Z (mm)", 13); }, command: "CreateDatumPoint" },
    { name: "midpoint", kind: "point", operation: "midpoint", expected: { type: "midpoint", first: { type: "coordinates", positionMm: [0, 0, 0] }, second: { type: "coordinates", positionMm: [14, 15, 16] } }, setup: () => { setNumber("Second point X (mm)", 14); setNumber("Second point Y (mm)", 15); setNumber("Second point Z (mm)", 16); }, command: "CreateDatumPoint" },
  ])("creates $name through visible controls", async ({ kind, operation, expected, setup, command }) => {
    renderPanel();
    choose("Reference type", kind);
    choose("Construction method", operation);
    setup();
    await createReference();
    expect(executeMock).toHaveBeenCalledWith(command, { definition: expected });
  });

  it("retains native datum sources for plane, axis and point references", async () => {
    useDocumentUiStore.setState({ datums: [planeDatum, axisDatum, pointDatum] });
    renderPanel();
    choose("Reference type", "plane");
    choose("Construction method", "angle");
    chooseVisibleOption("Base plane", /Reference plane.*datum-plane/);
    chooseVisibleOption("Rotation axis", /Reference axis.*datum-axis/);
    await createReference();
    expect(executeMock).toHaveBeenCalledWith("CreateDatumPlane", {
      definition: {
        type: "angle",
        base: { type: "datum", featureId: "datum-plane" },
        axis: { type: "datum", featureId: "datum-axis" },
        angleDeg: 0,
      },
    });

    cleanup();
    executeMock.mockClear();
    renderPanel();
    choose("Reference type", "point");
    choose("Construction method", "midpoint");
    chooseVisibleOption("Second point", /Reference point.*datum-point/);
    await createReference();
    expect(executeMock).toHaveBeenCalledWith("CreateDatumPoint", {
      definition: {
        type: "midpoint",
        first: { type: "coordinates", positionMm: [0, 0, 0] },
        second: { type: "datum", featureId: "datum-point" },
      },
    });
  });

  it("uses a selected persistent face as a real plane source", async () => {
    renderPanel();
    choose("Reference type", "plane");
    choose("Construction method", "offset");
    fireEvent.click(screen.getByRole("button", { name: "Select face" }));
    expect(useSelectionStore.getState().mode).toBe("face");
    act(() => useSelectionStore.getState().select("box-1:box.+Z", false));
    expect(useSelectionStore.getState().mode).toBe("auto");
    chooseVisibleOption("Base plane", /Box.*face/);
    setNumber("Offset (mm)", 12);
    await createReference();
    expect(executeMock).toHaveBeenCalledWith("CreateDatumPlane", {
      definition: {
        type: "offset",
        base: { type: "face", featureId: "box-1", persistentFaceId: "box-1:box.+Z" },
        offsetMm: 12,
      },
    });
  });

  it("restores the prior viewport pick mode when closing before selecting a source", () => {
    const onClose = vi.fn();
    renderPanel(vi.fn(), onClose);
    choose("Construction method", "offset");
    fireEvent.click(screen.getByRole("button", { name: "Select face" }));
    expect(useSelectionStore.getState().mode).toBe("face");
    fireEvent.click(screen.getByRole("button", { name: "Close reference geometry" }));
    expect(useSelectionStore.getState().mode).toBe("auto");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("uses a selected persistent edge as a real axis source", async () => {
    renderPanel();
    choose("Reference type", "plane");
    choose("Construction method", "angle");
    fireEvent.click(screen.getByRole("button", { name: "Select edge" }));
    expect(useSelectionStore.getState().mode).toBe("edge");
    act(() => useSelectionStore.getState().select("box-1:edge.box.bottom.0", false));
    chooseVisibleOption("Rotation axis", /Box.*edge/);
    await createReference();
    expect(executeMock).toHaveBeenCalledWith("CreateDatumPlane", {
      definition: {
        type: "angle",
        base: { type: "principal", planeKind: "XY" },
        axis: { type: "edge", featureId: "box-1", persistentEdgeId: "box-1:edge.box.bottom.0" },
        angleDeg: 0,
      },
    });
  });

  it("lets a plane-normal axis pass through a chosen XYZ point", async () => {
    renderPanel();
    choose("Reference type", "axis");
    choose("Construction method", "planeNormal");
    fireEvent.click(screen.getByLabelText("Set a through point"));
    setNumber("Through point X (mm)", 3);
    setNumber("Through point Y (mm)", 4);
    setNumber("Through point Z (mm)", 5);
    await createReference();
    expect(executeMock).toHaveBeenCalledWith("CreateDatumAxis", {
      definition: {
        type: "planeNormal",
        plane: { type: "principal", planeKind: "XY" },
        through: { type: "coordinates", positionMm: [3, 4, 5] },
      },
    });
  });

  it("edits the selected datum with UpdateDatum and shows its source and resolved frame", async () => {
    const existing: DatumDescriptor = {
      ...planeDatum,
      definition: { type: "offset", base: { type: "principal", planeKind: "XY" }, offsetMm: 10 },
      resolved: { originMm: [0, 0, 10], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] },
      dependsOn: [],
    };
    useDocumentUiStore.setState({ datums: [existing] });
    useSelectionStore.setState({ selectedIds: [existing.featureId] });
    renderPanel();
    expect(screen.getByText("OK")).toBeTruthy();
    expect(screen.getByText(/Origin.*0, 0, 10 mm/)).toBeTruthy();
    setNumber("Offset (mm)", 25);
    fireEvent.click(screen.getByRole("button", { name: "Update reference" }));
    await waitFor(() => expect(executeMock).toHaveBeenCalled());
    expect(executeMock).toHaveBeenCalledWith("UpdateDatum", {
      featureId: existing.featureId,
      definition: { type: "offset", base: { type: "principal", planeKind: "XY" }, offsetMm: 25 },
    });
  });

  it("creates a sketch on the selected valid datum plane", async () => {
    useDocumentUiStore.setState({ datums: [planeDatum] });
    useSelectionStore.setState({ selectedIds: [planeDatum.featureId] });
    const onSketchCreated = vi.fn();
    const onClose = vi.fn();
    renderPanel(onSketchCreated, onClose);
    fireEvent.click(screen.getByRole("button", { name: "Create sketch here" }));
    await waitFor(() => expect(executeMock).toHaveBeenCalledWith("CreateSketch", { supportRef: planeDatum.featureId, model: {} }));
    expect(onSketchCreated).toHaveBeenCalledWith("sketch-created");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("surfaces canonical validation errors from an invalid numeric definition", async () => {
    renderPanel();
    choose("Reference type", "plane");
    choose("Construction method", "offset");
    setNumber("Offset (mm)", 1_000_001);
    fireEvent.click(screen.getByRole("button", { name: "Create reference" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).not.toBe("") );
    expect(executeMock).toHaveBeenCalledWith("CreateDatumPlane", {
      definition: { type: "offset", base: { type: "principal", planeKind: "XY" }, offsetMm: 1_000_001 },
    });
  });

  it("surfaces native source errors instead of accepting an invalid edge", async () => {
    executeMock.mockRejectedValueOnce(new Error("Selected edge is not a straight line."));
    renderPanel();
    choose("Reference type", "plane");
    choose("Construction method", "angle");
    fireEvent.click(screen.getByRole("button", { name: "Select edge" }));
    act(() => useSelectionStore.getState().select("box-1:edge.curve.0", false));
    chooseVisibleOption("Rotation axis", /Box.*edge/);
    fireEvent.click(screen.getByRole("button", { name: "Create reference" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("not a straight line"));
  });

  it("shows a broken source error and disables supported sketch creation", () => {
    const broken: DatumDescriptor = { ...planeDatum, status: "broken", error: "Source face is no longer planar." };
    useDocumentUiStore.setState({ datums: [broken] });
    useSelectionStore.setState({ selectedIds: [broken.featureId] });
    renderPanel();
    fireEvent.click(screen.getByText("Sources and resolved geometry"));
    expect(screen.getByRole("alert").textContent).toContain("Source face is no longer planar.");
    expect((screen.getByRole("button", { name: "Create sketch here" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
