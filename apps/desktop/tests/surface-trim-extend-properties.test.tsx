import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { FeatureSummary } from "../src/ipc/coreClient";

const executeMock = vi.hoisted(() => vi.fn());
vi.mock("../src/commands/execute", async importOriginal => {
  const actual = await importOriginal<typeof import("../src/commands/execute")>();
  return { ...actual, executeCommand: executeMock };
});

import { PropertiesPanel } from "../src/components/PropertiesPanel";
import { useDocumentUiStore, useSelectionStore } from "../src/stores";

function selected(type: string, paramsMm: number[]): FeatureSummary {
  return {
    featureId: `feature-${type.toLowerCase()}`, type, paramsMm, dependsOn: ["surface-source"],
    refExtra: "", expressions: {},
  };
}

function renderSelected(value: FeatureSummary) {
  useDocumentUiStore.getState().resetDocument("surface-properties-doc");
  useDocumentUiStore.getState().setFeatures([value], 1);
  useSelectionStore.setState({ selectedIds: [value.featureId] });
  return render(<PropertiesPanel onEditSketch={vi.fn()} />);
}

async function commit(label: string, value: string, enter = false) {
  const input = screen.getByLabelText(label) as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
  if (enter) fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.blur(input);
  await waitFor(() => expect(executeMock).toHaveBeenCalledOnce());
}

beforeEach(() => executeMock.mockReset().mockResolvedValue({ kind: "ok" }));
afterEach(() => {
  cleanup();
  useDocumentUiStore.getState().resetDocument("surface-properties-cleanup");
  useSelectionStore.getState().clear();
});

it("edits Trim keepU and keepV as unbounded finite values without units or scaling", async () => {
  const trim = selected("SurfaceTrim", [4.2, 5, 0.001]);
  renderSelected(trim);

  const keepU = screen.getByLabelText("Keep U") as HTMLInputElement;
  const keepV = screen.getByLabelText("Keep V") as HTMLInputElement;
  expect(keepU.value).toBe("4.2");
  expect(keepV.value).toBe("5");
  expect(keepU.min).toBe("");
  expect(keepU.max).toBe("");
  expect(screen.queryByLabelText("Keep U (mm)")).toBeNull();
  expect(screen.queryByLabelText("Keep U (deg)")).toBeNull();

  await commit("Keep U", "4.25", true);
  expect(executeMock).toHaveBeenCalledWith("SetDimension", {
    featureId: trim.featureId, paramName: "keepU", valueMm: 4.25,
  });
  executeMock.mockClear();
  await commit("Keep V", "5", true);
  expect(executeMock).toHaveBeenCalledWith("SetDimension", {
    featureId: trim.featureId, paramName: "keepV", valueMm: 5,
  });
});

it("retains normalized axis limits while editing Extend lengths with unit parsing", async () => {
  renderSelected(selected("SurfaceRevolve", [90, 0, 0, 0, 1, 0, 0]));
  expect((screen.getByLabelText("Axis direction X") as HTMLInputElement).min).toBe("-1");
  expect((screen.getByLabelText("Axis direction X") as HTMLInputElement).max).toBe("1");

  cleanup();
  const extend = selected("SurfaceExtend", [12, 0.01]);
  renderSelected(extend);
  await commit("Distance (mm)", "2 cm");
  expect(executeMock).toHaveBeenCalledWith("SetDimension", {
    featureId: extend.featureId, paramName: "distanceMm", valueMm: 20,
  });
  executeMock.mockClear();
  await commit("Tolerance (mm)", "0.005 mm");
  expect(executeMock).toHaveBeenCalledWith("SetDimension", {
    featureId: extend.featureId, paramName: "toleranceMm", valueMm: 0.005,
  });
});

