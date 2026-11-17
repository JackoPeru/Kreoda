import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const analyze = vi.hoisted(() => vi.fn());
vi.mock("../src/ipc/coreClient", () => ({ coreClient: { measureMinimumThickness: analyze } }));
import { ThicknessAnalysisPanel } from "../src/components/workspace/ThicknessAnalysisPanel";
import { useDocumentUiStore, useSelectionStore } from "../src/stores";

const measured = { basis: "occt-sampled-normal-rays", isGlobalMinimum: false, featureId: "box", requestedSamples: 512,
  solidCount: 1, totalFaces: 6, sampledFaces: 6, attemptedSamples: 512, validSamples: 512, missedSamples: 0,
  timeBudgetExceeded: false, minimumThicknessMm: 2.5, witness: { pointAMm: [10,20,30], pointBMm: [10,20,32.5] } };
beforeEach(() => {
  analyze.mockReset().mockResolvedValue(measured);
  useDocumentUiStore.getState().resetDocument("thickness-doc");
  useDocumentUiStore.getState().setFeatures([{ featureId: "box", type: "Box", paramsMm: [], dependsOn: [], refExtra: "", expressions: {} }], 1);
  useSelectionStore.getState().select("box", false);
});
afterEach(cleanup);

it("measures the selected native feature explicitly, showing sampled limits and witness points", async () => {
  render(<ThicknessAnalysisPanel />);
  expect(analyze).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Calcola spessore" }));
  await waitFor(() => expect(analyze).toHaveBeenCalledWith({ featureId: "box", maxSamples: 512 }));
  expect(await screen.findByText("2,5 mm")).toBeTruthy();
  expect(screen.getByText(/campionata/)).toBeTruthy();
  expect(screen.getByText(/A: 10, 20, 30 mm/)).toBeTruthy();
  expect(screen.getByText(/B: 10, 20, 32,5 mm/)).toBeTruthy();
});

it("shows unknown coverage without a zero value or a pass claim", async () => {
  analyze.mockResolvedValue({ ...measured, sampledFaces: 0, validSamples: 0, missedSamples: 512, minimumThicknessMm: null, witness: null });
  render(<ThicknessAnalysisPanel />);
  fireEvent.click(screen.getByRole("button", { name: "Calcola spessore" }));
  expect(await screen.findByText("Nessuna misura disponibile")).toBeTruthy();
  expect(screen.queryByText("0 mm")).toBeNull();expect(screen.queryByText("2,5 mm")).toBeNull();
});

it.each(["selection", "revision"])("cannot publish a delayed result after %s changes", async change => {
  let release!: (value: unknown) => void;
  analyze.mockReturnValue(new Promise(resolve => { release = resolve; }));
  render(<ThicknessAnalysisPanel />);
  fireEvent.click(screen.getByRole("button", { name: "Calcola spessore" }));
  act(() => {
    if (change === "selection") useSelectionStore.getState().clear();
    else useDocumentUiStore.getState().setFeatures([], 2);
  });
  await act(async () => { release(measured); });
  expect(screen.queryByText("2,5 mm")).toBeNull();
});
