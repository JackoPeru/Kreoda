import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  query: vi.fn(), command: vi.fn(), snapshot: vi.fn(), sync: vi.fn(),
}));
vi.mock("../src/ipc/coreClient", () => ({ coreClient: {
  queryConfigurations: mocks.query, configurationCommand: mocks.command, requestSnapshot: mocks.snapshot,
} }));
vi.mock("../src/model/sync", () => ({ syncFromCoreList: mocks.sync }));
import { ConfigurationsPanel } from "../src/components/workspace/ConfigurationsPanel";
import { useDocumentUiStore, useSelectionStore } from "../src/stores";

beforeEach(() => {
  vi.clearAllMocks();
  useDocumentUiStore.getState().resetDocument("config-doc");
  useDocumentUiStore.getState().setFeatures([{
    featureId: "box", type: "Box", paramsMm: [100, 50, 20], dependsOn: [], refExtra: "", expressions: {},
  }], 1);
  useSelectionStore.getState().select("box", false);
  mocks.query.mockResolvedValue({ active: "", named: { variant: { box: { widthMm: 100 } } }, revision: 1 });
  mocks.command.mockResolvedValue(undefined);
  mocks.snapshot.mockResolvedValue({ features: [], sketches: [], datums: [], revision: 2 });
  mocks.sync.mockResolvedValue(undefined);
});
afterEach(cleanup);

it("defines one sparse selected-feature override and resyncs only after native confirmation", async () => {
  render(<ConfigurationsPanel />);
  fireEvent.change(screen.getByLabelText("Nome nuova configurazione"), { target: { value: "new" } });
  fireEvent.change(screen.getByLabelText("Parametro da sovrascrivere"), { target: { value: "widthMm" } });
  fireEvent.change(screen.getByLabelText("Valore override"), { target: { value: "125" } });
  fireEvent.click(screen.getByRole("button", { name: "Salva configurazione" }));
  await waitFor(() => expect(mocks.command).toHaveBeenCalledWith(40, { name: "new", overrides: { box: { widthMm: 125 } } }));
  await waitFor(() => expect(mocks.sync).toHaveBeenCalledOnce());
});

it("rejects stale revision without executing a mutation", async () => {
  mocks.query.mockResolvedValue({ active: "", named: {}, revision: 2 });
  render(<ConfigurationsPanel />);
  fireEvent.change(screen.getByLabelText("Nome nuova configurazione"), { target: { value: "new" } });
  fireEvent.change(screen.getByLabelText("Parametro da sovrascrivere"), { target: { value: "widthMm" } });
  fireEvent.change(screen.getByLabelText("Valore override"), { target: { value: "125" } });
  fireEvent.click(screen.getByRole("button", { name: "Salva configurazione" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Modello modificato"));
  expect(mocks.command).not.toHaveBeenCalled();
  expect(mocks.sync).not.toHaveBeenCalled();
});
