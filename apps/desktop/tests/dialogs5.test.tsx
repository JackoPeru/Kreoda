import { describe, expect, it, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { HoleDialog } from "../src/components/HoleDialog";
import { DressUpDialog } from "../src/components/DressUpDialog";
import { useDocumentUiStore, useSelectionStore } from "../src/stores";

vi.mock("../src/ipc/coreClient", () => ({
  coreClient: {
    createHole: vi.fn().mockResolvedValue({
      featureId: "ho-1",
      type: "Hole",
      paramsMm: [8, 0],
      dependsOn: ["box-1"],
      refExtra: "face=box.+Z;x=50;y=25;mode=throughAll",
      volumeMm3: 49497.3,
      bboxMm: [0, 0, 0, 100, 50, 10],
      revision: 2,
    }),
    createFillet: vi.fn().mockRejectedValue(
      new Error(
        "Fillet could not be created at 40 mm. Maximum stable value appears to be approximately 13.4 mm.",
      ),
    ),
    requestMesh: vi.fn().mockResolvedValue({
      positions: new Float32Array(36),
      normals: new Float32Array(36),
      indices: new Uint32Array(36),
      faces: [],
      edgeVertices: new Float32Array(0),
      edges: [],
      volumeMm3: 49497.3,
      bboxMm: [0, 0, 0, 100, 50, 10],
      triangleCount: 12,
      revision: 2,
    }),
  },
}));

import { coreClient } from "../src/ipc/coreClient";

afterEach(() => cleanup());

const box = {
  featureId: "box-1",
  type: "Box",
  paramsMm: [100, 50, 10],
  dependsOn: [] as string[],
  refExtra: "",
  volumeMm3: 50000,
};

describe("HoleDialog (§62 Scenario A widgets)", () => {
  it("cuts a hole through the typed command with explicit position", async () => {
    useDocumentUiStore.getState().resetDocument("doc-test");
    // Commands gate on a connected engine (M11) — simulate it.
    useDocumentUiStore.getState().setCoreStatus(true, "test");
    useDocumentUiStore.getState().setFeatures([box], 1);
    useSelectionStore.getState().select("box-1:box.+Z", false);
    render(<HoleDialog onClose={() => {}} />);
    expect(screen.getByText("Make hole")).toBeTruthy();
    const inputs = screen.getAllByRole("textbox");
    // diameter, X, Y (depth hidden in through mode)
    fireEvent.change(inputs[0]!, { target: { value: "8" } });
    fireEvent.change(inputs[1]!, { target: { value: "50" } });
    fireEvent.change(inputs[2]!, { target: { value: "25" } });
    fireEvent.click(screen.getByText("Cut hole"));
    await waitFor(() => {
      expect(coreClient.createHole).toHaveBeenCalledWith(
        expect.objectContaining({
          targetId: "box-1",
          faceRole: "box.+Z",
          diameterMm: 8,
          depthMode: "throughAll",
        }),
      );
    });
    expect(
      useDocumentUiStore.getState().features.some((f) => f.type === "Hole"),
    ).toBe(true);
  });
});

describe("DressUpDialog (safe-range message, §41)", () => {
  it("surfaces the actionable oversize error instead of failing silently", async () => {
    useDocumentUiStore.getState().resetDocument("doc-test");
    useDocumentUiStore.getState().setCoreStatus(true, "test");
    useDocumentUiStore.getState().setFeatures([box], 1);
    useSelectionStore.getState().select("box-1:edge.lin.box.+X~box.+Z", false);
    render(<DressUpDialog kind="fillet" onClose={() => {}} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "40" } });
    fireEvent.click(screen.getByText("Round"));
    await waitFor(() => {
      expect(screen.getByText(/Maximum stable value/)).toBeTruthy();
    });
  });
});
