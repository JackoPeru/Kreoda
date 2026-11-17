import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../src/commands/execute", () => ({ executeCommand: mocks.execute }));

import { PropertiesPanel } from "../src/components/PropertiesPanel";
import { useDocumentUiStore, useSelectionStore } from "../src/stores";

beforeEach(() => {
  vi.clearAllMocks();
  useDocumentUiStore.getState().resetDocument("direct-properties");
  useDocumentUiStore.getState().setCoreStatus(true, "test");
  useDocumentUiStore.getState().setFeatures([
    { featureId: "move-a", type: "MoveFace", paramsMm: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      dependsOn: ["source-a"], refExtra: "", expressions: {}, bodyTip: true },
  ], 8);
  useSelectionStore.setState({ selectedIds: ["move-a"] });
  mocks.execute.mockResolvedValue({ kind: "ok" });
});
afterEach(cleanup);

it("shows all nine MoveFace values in native tx/ty/tz, rx/ry/rz, px/py/pz order", () => {
  render(<PropertiesPanel onEditSketch={vi.fn()} />);
  const inputs = screen.getAllByRole("textbox") as HTMLInputElement[];
  expect(inputs.map(input => input.value)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
  expect(screen.getAllByText(/Pivot/)).toHaveLength(3);
});

it("uses native MoveFace SetDimension names and signed OffsetFace distance", async () => {
  render(<PropertiesPanel onEditSketch={vi.fn()} />);
  const moveInputs = screen.getAllByRole("textbox") as HTMLInputElement[];
  fireEvent.change(moveInputs[3]!, { target: { value: "-12" } });
  fireEvent.keyDown(moveInputs[3]!, { key: "Enter" });
  await waitFor(() => expect(mocks.execute).toHaveBeenCalledWith("SetDimension", {
    featureId: "move-a", paramName: "rxDeg", valueMm: -12,
  }));

  useDocumentUiStore.getState().setFeatures([
    { featureId: "offset-a", type: "OffsetFace", paramsMm: [-2.5],
      dependsOn: ["source-a"], refExtra: "", expressions: {}, bodyTip: true },
  ], 9);
  useSelectionStore.setState({ selectedIds: ["offset-a"] });
  cleanup();
  render(<PropertiesPanel onEditSketch={vi.fn()} />);
  const offset = screen.getByRole("textbox") as HTMLInputElement;
  expect(offset.value).toBe("-2.5");
  expect(screen.getByText(/mm/)).toBeTruthy();
});
