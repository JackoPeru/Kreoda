import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const mock = vi.hoisted(() => ({ analyze: vi.fn() }));
vi.mock("../src/ipc/coreClient", () => ({ coreClient: { measureDraftAngles: mock.analyze } }));
import { DraftAnalysisPanel } from "../src/components/workspace/DraftAnalysisPanel";
import { useDocumentUiStore, useSelectionStore } from "../src/stores";

beforeEach(() => {
  vi.clearAllMocks();
  useDocumentUiStore.getState().resetDocument("draft-doc");
  useDocumentUiStore.getState().setFeatures([{ featureId: "box", type: "Box", paramsMm: [10,10,10], dependsOn: [], refExtra: "", expressions: {} }], 1);
  useSelectionStore.getState().select("box", false);
  mock.analyze.mockResolvedValue({ basis: "face-normal", faces: [{ referenceId: "box:box.+Z", featureId: "box", draftAngleDeg: 90,
    classification: "positive", normal: [0,0,1] }] });
});
afterEach(cleanup);

it("queries native B-Rep draft analysis with selected body, chosen vector and tolerance", async () => {
  render(<DraftAnalysisPanel />);
  fireEvent.change(screen.getByLabelText("Ambito analisi sformo"), { target: { value: "body" } });
  fireEvent.change(screen.getByLabelText("Direzione estrazione X"), { target: { value: "1" } });
  fireEvent.change(screen.getByLabelText("Tolleranza neutra gradi"), { target: { value: "2.5" } });
  fireEvent.click(screen.getByRole("button", { name: "Calcola sformi" }));
  await waitFor(() => expect(mock.analyze).toHaveBeenCalledWith({ bodyId: "body-box", pullDirection: [1,0,1], neutralToleranceDeg: 2.5 }));
  expect(await screen.findByText(/90.00°/)).toBeTruthy();
  expect(screen.getByText("box:box.+Z")).toBeTruthy();
});

it("blocks zero direction and rejects stale native responses after document change", async () => {
  let release!: (value: unknown) => void;
  mock.analyze.mockReturnValue(new Promise(resolve => { release = resolve; }));
  render(<DraftAnalysisPanel />);
  fireEvent.change(screen.getByLabelText("Direzione estrazione Z"), { target: { value: "0" } });
  expect((screen.getByRole("button", { name: "Calcola sformi" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Direzione estrazione Z"), { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: "Calcola sformi" }));
  useDocumentUiStore.getState().setFeatures([], 2);
  release({ basis: "native", faces: [] });
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("modificato"));
  expect(screen.queryByText("0 facce analizzate")).toBeNull();
});
