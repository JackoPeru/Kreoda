import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { COMMANDS } from "@kreoda/command-schema";
import type { FeatureSummary } from "../src/ipc/coreClient";
import { PropertiesPanel } from "../src/components/PropertiesPanel";
import { useDocumentUiStore, useSelectionStore } from "../src/stores";

const executeMock = vi.hoisted(() => vi.fn());

vi.mock("../src/commands/execute", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/commands/execute")>();
  return { ...actual, executeCommand: executeMock };
});

function feature(type: string, paramsMm: number[], volumeMm3 = 0): FeatureSummary {
  return {
    featureId: `surface-${type.toLowerCase()}`,
    type,
    paramsMm,
    volumeMm3,
    dependsOn: ["source-sketch"],
    refExtra: "",
    expressions: {},
  };
}

function renderSelected(value: FeatureSummary) {
  useDocumentUiStore.getState().resetDocument("surface-properties-doc");
  useDocumentUiStore.getState().setFeatures([value], 1);
  useSelectionStore.setState({ selectedIds: [value.featureId] });
  return render(<PropertiesPanel onEditSketch={vi.fn()} />);
}

async function commitInput(label: string, value: string, enter = false): Promise<void> {
  const input = screen.getByLabelText(label) as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
  if (enter) fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.blur(input);
  await waitFor(() => {
    if (executeMock.mock.calls.length !== 1) throw new Error(`Expected one SetDimension for ${label}`);
  });
  await waitFor(() => {
    if (input.disabled) throw new Error(`SetDimension is still pending for ${label}`);
  });
}

beforeEach(() => {
  executeMock.mockReset().mockImplementation(async (id: string, params: unknown) => {
    const command = COMMANDS.find((candidate) => candidate.id === id);
    if (!command) throw new Error(`Unknown command ${id}`);
    command.parameterSchema.parse(params);
    return { kind: "ok" };
  });
});

afterEach(() => {
  cleanup();
  useDocumentUiStore.getState().resetDocument("surface-properties-cleanup");
  useSelectionStore.getState().clear();
});

describe("surface feature properties", () => {
  it("edits signed solid thickness and tolerance while showing physical volume", async () => {
    const solid = feature("SurfaceThicken", [1, 1e-6], 2000);
    renderSelected(solid);
    expect(screen.getByText("Volume 2.0 cm³")).toBeTruthy();
    await commitInput("Thickness (mm)", "-2 cm", true);
    expect(executeMock).toHaveBeenCalledWith("SetDimension", {
      featureId: solid.featureId, paramName: "thicknessMm", valueMm: -20,
    });
    executeMock.mockClear();
    await commitInput("Tolerance (mm)", "0.00001");
    expect(executeMock).toHaveBeenCalledWith("SetDimension", {
      featureId: solid.featureId, paramName: "toleranceMm", valueMm: 1e-5,
    });
  });

  it("edits surface extrude distance as one canonical SetDimension and hides zero volume", async () => {
    const extrude = feature("SurfaceExtrude", [42]);
    renderSelected(extrude);

    const distance = screen.getByLabelText("Distance (mm)") as HTMLInputElement;
    expect(distance.value).toBe("42");
    expect(screen.queryByText(/Volume/)).toBeNull();

    await commitInput("Distance (mm)", "2 cm", true);

    expect(executeMock).toHaveBeenCalledOnce();
    expect(executeMock).toHaveBeenCalledWith("SetDimension", {
      featureId: extrude.featureId,
      paramName: "distanceMm",
      valueMm: 20,
    });
  });

  it("edits SurfaceSweep tolerance in millimeters and hides zero volume", async () => {
    const sweep = feature("SurfaceSweep", [1e-6]);
    renderSelected(sweep);

    expect((screen.getByLabelText("Tolerance (mm)") as HTMLInputElement).value).toBe("0.000001");
    expect(screen.queryByText(/Volume/)).toBeNull();

    await commitInput("Tolerance (mm)", "0.002");
    expect(executeMock).toHaveBeenCalledWith("SetDimension", {
      featureId: sweep.featureId,
      paramName: "toleranceMm",
      valueMm: 0.002,
    });
  });

  it("maps all seven SurfaceRevolve values to canonical slots and units", async () => {
    const revolve = feature("SurfaceRevolve", [90, 10, 20, 30, 0, 0, 1]);
    renderSelected(revolve);

    const initialValues: Array<[string, string]> = [
      ["Angle (deg)", "90"],
      ["Axis origin X (mm)", "10"],
      ["Axis origin Y (mm)", "20"],
      ["Axis origin Z (mm)", "30"],
      ["Axis direction X", "0"],
      ["Axis direction Y", "0"],
      ["Axis direction Z", "1"],
    ];
    for (const [label, value] of initialValues) {
      expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe(value);
    }
    expect(screen.queryByLabelText("Axis direction X (mm)")).toBeNull();
    expect(screen.queryByText(/Volume/)).toBeNull();

    const edits: Array<[string, string, string, number]> = [
      ["Angle (deg)", "1.5707963267948966 rad", "angleDeg", 90],
      ["Axis origin X (mm)", "2 cm", "axisOriginXMm", 20],
      ["Axis origin Y (mm)", "30", "axisOriginYMm", 30],
      ["Axis origin Z (mm)", "4 inch", "axisOriginZMm", 101.6],
      ["Axis direction X", "0.5", "axisX", 0.5],
      ["Axis direction Y", "-0.25", "axisY", -0.25],
      ["Axis direction Z", "0.75", "axisZ", 0.75],
    ];
    for (const [label, text, paramName, valueMm] of edits) {
      await commitInput(label, text);
      expect(executeMock).toHaveBeenCalledOnce();
      expect(executeMock).toHaveBeenCalledWith("SetDimension", {
        featureId: revolve.featureId,
        paramName,
        valueMm,
      });
      executeMock.mockClear();
    }
  });

  it("rejects empty and non-finite dimensionless axis values", async () => {
    const revolve = feature("SurfaceRevolve", [90, 0, 0, 0, 1, 0, 0]);
    renderSelected(revolve);
    const direction = screen.getByLabelText("Axis direction Y") as HTMLInputElement;

    for (const value of ["", "NaN", "Infinity"]) {
      fireEvent.change(direction, { target: { value } });
      fireEvent.blur(direction);
      expect(await screen.findByText("not a number")).toBeTruthy();
      expect(executeMock).not.toHaveBeenCalled();
    }
  });

  it("keeps SurfaceLoft parameters editable through its sources only", () => {
    const loft = feature("SurfaceLoft", []);
    renderSelected(loft);

    expect(screen.getByTestId("properties")).toBeTruthy();
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.queryAllByRole("spinbutton")).toHaveLength(0);
    expect(screen.queryByText(/Volume/)).toBeNull();
  });

  it("edits signed SurfaceOffset distance and tolerance in millimeters", async () => {
    const offset = feature("SurfaceOffset", [-2, 0.001]);
    renderSelected(offset);

    expect((screen.getByLabelText("Distance (mm)") as HTMLInputElement).value).toBe("-2");
    expect((screen.getByLabelText("Tolerance (mm)") as HTMLInputElement).value).toBe("0.001");
    expect(screen.queryByText(/Volume/)).toBeNull();

    await commitInput("Distance (mm)", "-3.5", true);
    expect(executeMock).toHaveBeenCalledWith("SetDimension", {
      featureId: offset.featureId, paramName: "distanceMm", valueMm: -3.5,
    });
  });

  it("keeps sew as a zero-volume surface and sewn solid as a volume-bearing solid", () => {
    renderSelected(feature("SurfaceSew", [0.01]));
    expect(screen.getByLabelText("Tolerance (mm)")).toBeTruthy();
    expect(screen.queryByText(/Volume/)).toBeNull();

    cleanup();
    const solid = feature("SurfaceSewnSolid", [0.01], 2000);
    renderSelected(solid);
    expect(screen.getByLabelText("Tolerance (mm)")).toBeTruthy();
    expect(screen.getByText("Volume 2.0 cm³")).toBeTruthy();
  });
});
