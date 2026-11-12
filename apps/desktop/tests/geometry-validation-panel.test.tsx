import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mock = vi.hoisted(() => ({ validate: vi.fn() }));
vi.mock("../src/ipc/coreClient", () => ({ coreClient: { validateCadGeometry: mock.validate } }));
import { GeometryValidationPanel } from "../src/components/workspace/GeometryValidationPanel";
import { useDocumentUiStore, useSelectionStore } from "../src/stores";

beforeEach(() => {
  vi.clearAllMocks();
  useDocumentUiStore.getState().resetDocument("cad-validation");
  useDocumentUiStore.getState().setFeatures([{ featureId: "box", type: "Box", paramsMm: [10, 10, 10], dependsOn: [], refExtra: "", expressions: {} }], 1);
  useSelectionStore.getState().select("box", false);
  mock.validate.mockResolvedValue({ valid: false, checks: [
    { code: "brep-valid", detail: "box", ok: false }, { code: "params-finite", detail: "box", ok: true },
  ] });
});
afterEach(cleanup);

it("queries real-native validation scope and displays individual failures without mutations", async () => {
  render(<GeometryValidationPanel />);
  fireEvent.change(screen.getByLabelText("Ambito verifica CAD"), { target: { value: "body" } });
  fireEvent.click(screen.getByRole("button", { name: "Esegui verifica" }));
  await waitFor(() => expect(mock.validate).toHaveBeenCalledWith({ bodyId: "body-box" }));
  expect(await screen.findByText(/Problemi rilevati/)).toBeTruthy();
  expect(screen.getByText(/brep-valid: box/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Ambito verifica CAD"), { target: { value: "feature" } });
  fireEvent.click(screen.getByRole("button", { name: "Esegui verifica" }));
  await waitFor(() => expect(mock.validate).toHaveBeenCalledWith({ featureId: "box" }));
});

it("drops native validation if the document revision changes during request", async () => {
  let release!: (v: unknown) => void;
  mock.validate.mockReturnValue(new Promise(resolve => { release = resolve; }));
  render(<GeometryValidationPanel />);
  fireEvent.click(screen.getByRole("button", { name: "Esegui verifica" }));
  useDocumentUiStore.getState().setFeatures([], 2);
  release({ valid: true, checks: [] });
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("cambiato"));
  expect(screen.queryByText("Geometria valida")).toBeNull();
});
