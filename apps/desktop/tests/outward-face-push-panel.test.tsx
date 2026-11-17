import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mock = vi.hoisted(() => ({ face: vi.fn(), push: vi.fn(), pocket: vi.fn(), thicken: vi.fn(), snapshot: vi.fn(), sync: vi.fn() }));
vi.mock("../src/ipc/coreClient", () => ({ coreClient: {
  requestFaceInfo: mock.face, createOutwardFacePush: mock.push, createInwardFacePocket: mock.pocket,
  createSurfaceFaceThicken: mock.thicken, requestSnapshot: mock.snapshot,
} }));
vi.mock("../src/model/sync", () => ({ syncFromCoreList: mock.sync }));
import { OutwardFacePushPanel } from "../src/components/workspace/OutwardFacePushPanel";
import { useDocumentUiStore, useSelectionStore } from "../src/stores";

beforeEach(() => {
  vi.clearAllMocks();
  useDocumentUiStore.getState().resetDocument("step-document");
  useDocumentUiStore.getState().setFeatures([{ featureId: "imported", type: "StepImport", paramsMm: [], dependsOn: [], refExtra: "", expressions: {} }], 1);
  useSelectionStore.getState().clear();
  mock.face.mockResolvedValue({ normal: [0, 0, 1] });
  mock.push.mockResolvedValue({ featureId: "push-new" });
  mock.pocket.mockResolvedValue({ featureId: "pocket-new" });
  mock.thicken.mockResolvedValue({ featureId: "thicken-new" });
  mock.snapshot.mockResolvedValue({ features: [], sketches: [], datums: [], revision: 2 });
  mock.sync.mockResolvedValue(undefined);
});

it("creates a distinct native thickened solid from an identified STEP face", async () => {
  useSelectionStore.getState().select("imported:face.semantic.TOP", false);
  render(<OutwardFacePushPanel />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Crea solido da faccia" }).hasAttribute("disabled")).toBe(false));
  fireEvent.change(screen.getByLabelText("Distanza estensione"), { target: { value: "3.25" } });
  fireEvent.click(screen.getByRole("button", { name: "Crea solido da faccia" }));
  await waitFor(() => expect(mock.thicken).toHaveBeenCalledWith("imported", "face.semantic.TOP", 3.25));
  expect(mock.push).not.toHaveBeenCalled();
  expect(mock.pocket).not.toHaveBeenCalled();
  await waitFor(() => expect(mock.sync).toHaveBeenCalledOnce());
});

it("cuts inward through the same selected persistent planar STEP face and authoritative resync", async () => {
  useSelectionStore.getState().select("imported:face.semantic.TOP", false);
  render(<OutwardFacePushPanel />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Scava verso interno" }).hasAttribute("disabled")).toBe(false));
  fireEvent.change(screen.getByLabelText("Distanza estensione"), { target: { value: "2.5" } });
  fireEvent.click(screen.getByRole("button", { name: "Scava verso interno" }));
  await waitFor(() => expect(mock.pocket).toHaveBeenCalledWith("imported", "face.semantic.TOP", 2.5));
  expect(mock.push).not.toHaveBeenCalled();
  await waitFor(() => expect(mock.sync).toHaveBeenCalledOnce());
});
afterEach(cleanup);

it("uses selected persistent semantic face role without guessing mesh indices", async () => {
  useSelectionStore.getState().select("imported:face.semantic.TOP", false);
  render(<OutwardFacePushPanel />);
  await waitFor(() => expect(mock.face).toHaveBeenCalledWith("imported", "face.semantic.TOP"));
  await waitFor(() => expect(screen.getByRole("button", { name: "Estendi faccia" }).hasAttribute("disabled")).toBe(false));
  fireEvent.change(screen.getByLabelText("Distanza estensione"), { target: { value: "7.5" } });
  fireEvent.click(screen.getByRole("button", { name: "Estendi faccia" }));
  await waitFor(() => expect(mock.push).toHaveBeenCalledWith("imported", "face.semantic.TOP", 7.5));
  await waitFor(() => expect(mock.sync).toHaveBeenCalledOnce());
});

it("hides direct edit for indexed face ids or non-imported geometry", () => {
  useSelectionStore.getState().select("imported:face[3]", false);
  render(<OutwardFacePushPanel />);
  expect(screen.queryByTestId("outward-face-push")).toBeNull();
  expect(mock.face).not.toHaveBeenCalled();
});
