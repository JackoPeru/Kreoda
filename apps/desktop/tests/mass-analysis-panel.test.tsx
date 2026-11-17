import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const measure = vi.hoisted(() => vi.fn());
vi.mock("../src/ipc/coreClient", () => ({ coreClient: { measureMassProperties: measure } }));
import { MassAnalysisPanel } from "../src/components/workspace/MassAnalysisPanel";
import { useDocumentUiStore, useSelectionStore } from "../src/stores";

beforeEach(() => {
  measure.mockReset().mockResolvedValue({ volumeMm3: 6000, areaMm2: 2200, centroidMm: [10, 15, 5], massKg: 0.0471 });
  useDocumentUiStore.getState().resetDocument("analysis-doc");
  useDocumentUiStore.getState().setFeatures([{ featureId: "box", type: "Box", paramsMm: [], dependsOn: [], refExtra: "", expressions: {} }], 1);
  useSelectionStore.getState().select("box", false);
});
afterEach(cleanup);

it("queries native mass properties for the selected feature and shows measured units", async () => {
  render(<MassAnalysisPanel />);
  await waitFor(() => expect(measure).toHaveBeenCalledWith({ featureId: "box", densityKgPerM3: 7850 }));
  expect(await screen.findByText("0,0471 kg")).toBeTruthy();
  expect(screen.getByText("6000 mm³")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Densità (kg/m³)"), { target: { value: "1000" } });
  await waitFor(() => expect(measure).toHaveBeenCalledWith({ featureId: "box", densityKgPerM3: 1000 }));
});

it("ignores pending results after selection is cleared", async () => {
  let complete!: (value: unknown) => void;
  measure.mockReturnValue(new Promise(resolve => { complete = resolve; }));
  const rendered = render(<MassAnalysisPanel />);
  await waitFor(() => expect(measure).toHaveBeenCalledOnce());
  useSelectionStore.getState().clear();
  rendered.rerender(<MassAnalysisPanel />);
  complete({ volumeMm3: 1, areaMm2: 2, centroidMm: [0, 0, 0], massKg: 1 });
  expect(screen.queryByTestId("mass-analysis")).toBeNull();
});
