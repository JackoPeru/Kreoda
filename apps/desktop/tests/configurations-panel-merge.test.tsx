import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({ query: vi.fn(), command: vi.fn(), snapshot: vi.fn(), sync: vi.fn() }));
vi.mock("../src/ipc/coreClient", () => ({ coreClient: {
  queryConfigurations: api.query,
  configurationCommand: api.command,
  requestSnapshot: api.snapshot,
} }));
vi.mock("../src/model/sync", () => ({ syncFromCoreList: api.sync }));

import { ConfigurationsPanel } from "../src/components/workspace/ConfigurationsPanel";
import { useDocumentUiStore, useSelectionStore } from "../src/stores";

const features = [{
  featureId: "box", type: "Box", paramsMm: [100, 50, 20], dependsOn: [], refExtra: "", expressions: {},
}, {
  featureId: "cylinder", type: "Cylinder", paramsMm: [10, 20], dependsOn: [], refExtra: "", expressions: {},
}];
type Named = Record<string, Record<string, Record<string, number>>>;
let named: Named;
let revision: number;
let active: string;

beforeEach(() => {
  vi.clearAllMocks();
  named = {};
  revision = 1;
  active = "";
  useDocumentUiStore.getState().resetDocument("config-merge-doc");
  useDocumentUiStore.getState().setFeatures(features, revision);
  useSelectionStore.getState().select("box", false);
  // The real native DefineConfiguration replaces one named entry, it does not merge fields.
  api.query.mockImplementation(async () => ({ active, named: structuredClone(named), revision }));
  api.command.mockImplementation(async (type: number, fields: { name: string; overrides?: Named[string] }) => {
    if (type === 40 && fields.overrides) named[fields.name] = structuredClone(fields.overrides);
    if (type === 41) active = fields.name;
    revision++;
  });
  api.snapshot.mockImplementation(async () => ({ features, sketches: [], datums: [], revision }));
  api.sync.mockImplementation(async () => useDocumentUiStore.getState().setFeatures(features, revision));
});
afterEach(cleanup);

async function save(name: string, parameter: string, value: string, callCount: number) {
  fireEvent.change(screen.getByLabelText("Nome nuova configurazione"), { target: { value: name } });
  fireEvent.change(screen.getByLabelText("Parametro da sovrascrivere"), { target: { value: parameter } });
  fireEvent.change(screen.getByLabelText("Valore override"), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Salva configurazione" }));
  await waitFor(() => expect(api.command).toHaveBeenCalledTimes(callCount));
  await waitFor(() => expect(api.sync).toHaveBeenCalledTimes(callCount));
  await waitFor(() => expect(useDocumentUiStore.getState().revision).toBe(revision));
}

it("preserves width when the same Medium configuration saves height, and creates a fresh Large configuration", async () => {
  render(<ConfigurationsPanel />);
  await save("Medium", "widthMm", "150", 1);
  await save("Medium", "heightMm", "70", 2);
  expect(api.command).toHaveBeenNthCalledWith(2, 40, {
    name: "Medium", overrides: { box: { widthMm: 150, heightMm: 70 } },
  });
  expect(named.Medium).toEqual({ box: { widthMm: 150, heightMm: 70 } });

  await save("Large", "widthMm", "180", 3);
  expect(api.command).toHaveBeenNthCalledWith(3, 40, {
    name: "Large", overrides: { box: { widthMm: 180 } },
  });
  expect(named.Medium).toEqual({ box: { widthMm: 150, heightMm: 70 } });
});

it("retains previous overrides from other features and parameters when updating a named configuration", async () => {
  named.Medium = { box: { depthMm: 20 }, cylinder: { radiusMm: 12 } };
  render(<ConfigurationsPanel />);
  await save("Medium", "heightMm", "70", 1);
  expect(api.command).toHaveBeenCalledWith(40, {
    name: "Medium", overrides: { box: { depthMm: 20, heightMm: 70 }, cylinder: { radiusMm: 12 } },
  });
  expect(named.Medium).toEqual({ box: { depthMm: 20, heightMm: 70 }, cylinder: { radiusMm: 12 } });
});

it("offers Base as an explicit selection and sends the empty-name activation sentinel", async () => {
  named.Medium = { box: { widthMm: 150 } };
  active = "Medium";
  render(<ConfigurationsPanel />);
  await waitFor(() => expect(screen.getByText("Attiva: Medium")).toBeTruthy());
  const picker = screen.getByLabelText("Configurazione salvata");
  expect(screen.getByRole("option", { name: "Base" }).getAttribute("value")).toBe("");
  fireEvent.change(picker, { target: { value: "Medium" } });
  fireEvent.change(picker, { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Attiva selezionata" }));
  await waitFor(() => expect(api.command).toHaveBeenCalledWith(41, { name: "" }));
  await waitFor(() => expect(api.sync).toHaveBeenCalledOnce());
  expect(active).toBe("");
  expect(named.Medium).toEqual({ box: { widthMm: 150 } });
});
