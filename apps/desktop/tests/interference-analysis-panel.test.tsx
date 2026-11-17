import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const mock = vi.hoisted(() => ({ analyze: vi.fn() }));
vi.mock("../src/ipc/coreClient", () => ({ coreClient: { measureInterferences: mock.analyze } }));
import { InterferenceAnalysisPanel } from "../src/components/workspace/InterferenceAnalysisPanel";
import { useDocumentUiStore, useSelectionStore } from "../src/stores";

const result = { basis: "occt-common-volume", componentCount: 2, candidatePairCount: 1,
  volumeToleranceMm3: 0.001, skippedNonSolidFeatureIds: [], interferences: [{
    featureA: "first", featureB: "second", bodyA: "body-first", bodyB: "",
    volumeMm3: 500, centroidMm: [7.5,5,5], bboxMm: [5,0,0,10,10,10],
  }] };
beforeEach(() => {
  vi.clearAllMocks();
  useDocumentUiStore.getState().resetDocument("interference-doc");
  useDocumentUiStore.setState({ bodies: [{ bodyId: "body-first", history: ["ancestor", "first"], tipFeatureId: "first" }] });
  useSelectionStore.setState({ selectedIds: ["first:box.+Z", "second"] });
  mock.analyze.mockResolvedValue(result);
});
afterEach(cleanup);

it("requests native common-volume analysis and accepts Italian decimal tolerance", async () => {
  render(<InterferenceAnalysisPanel />);
  fireEvent.change(screen.getByLabelText("Soglia volume interferenza mm³"), { target: { value: "0,001" } });
  fireEvent.click(screen.getByRole("button", { name: "Controlla interferenze" }));
  await waitFor(() => expect(mock.analyze).toHaveBeenCalledWith({ volumeToleranceMm3: 0.001 }));
  expect(await screen.findByText("500 mm³")).toBeTruthy();
  expect(screen.getByText("first ↔ second")).toBeTruthy();
});

it("rejects invalid tolerance and fewer than two distinct selected components", async () => {
  render(<InterferenceAnalysisPanel />);
  fireEvent.change(screen.getByLabelText("Soglia volume interferenza mm³"), { target: { value: "-1" } });
  expect((screen.getByRole("button", { name: "Controlla interferenze" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Soglia volume interferenza mm³"), { target: { value: "0" } });
  fireEvent.change(screen.getByLabelText("Ambito interferenze"), { target: { value: "selection" } });
  act(() => useSelectionStore.setState({ selectedIds: ["first:box.+Z", "first:box.-Z"] }));
  expect((screen.getByRole("button", { name: "Controlla interferenze" }) as HTMLButtonElement).disabled).toBe(true);
  act(() => useSelectionStore.setState({ selectedIds: ["ancestor", "body-first"] }));
  expect((screen.getByRole("button", { name: "Controlla interferenze" }) as HTMLButtonElement).disabled).toBe(true);
  expect(mock.analyze).not.toHaveBeenCalled();
});

it.each(["selection", "document"])("discards pending results after %s changes", async change => {
  let release!: (value: unknown) => void;
  mock.analyze.mockReturnValue(new Promise(resolve => { release = resolve; }));
  render(<InterferenceAnalysisPanel />);
  fireEvent.change(screen.getByLabelText("Ambito interferenze"), { target: { value: "selection" } });
  fireEvent.click(screen.getByRole("button", { name: "Controlla interferenze" }));
  expect(mock.analyze).toHaveBeenCalledWith({ featureIds: ["first", "second"], volumeToleranceMm3: 0.000001 });
  act(() => {
    if (change === "selection") useSelectionStore.setState({ selectedIds: ["first", "third"] });
    else useDocumentUiStore.getState().resetDocument("next-doc");
  });
  await act(async () => { release(result); });
  expect(screen.queryByText("500 mm³")).toBeNull();
  expect(screen.queryByText("Nessuna interferenza volumetrica.")).toBeNull();
});
