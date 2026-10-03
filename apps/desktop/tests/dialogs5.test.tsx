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
      positions: new Float32Array([
        0, 0, 10,
        100, 0, 10,
        100, 50, 10,
        0, 50, 10,
      ]),
      normals: new Float32Array(12),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
      faces: [
        { persistentFaceId: "box-1:box.+Z", triangleStart: 0, triangleCount: 2 },
      ],
      edgeVertices: new Float32Array(0),
      edges: [],
      volumeMm3: 49497.3,
      bboxMm: [0, 0, 0, 100, 50, 10],
      triangleCount: 2,
      revision: 2,
    }),
    requestFaceInfo: vi.fn().mockResolvedValue({
      originMm: [0, 0, 10],
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      normal: [0, 0, 1],
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
  expressions: {} as Record<string, string>,
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
    await screen.findByTestId("hole-placement-preview");
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

  it("keeps the visible preview Y label aligned with positive and negative input", async () => {
    useDocumentUiStore.getState().resetDocument("doc-test");
    useDocumentUiStore.getState().setCoreStatus(true, "test");
    useDocumentUiStore.getState().setFeatures([box], 1);
    useSelectionStore.getState().select("box-1:box.+Z", false);
    render(<HoleDialog onClose={() => {}} />);

    const preview = await screen.findByTestId("hole-placement-preview");
    const xInput = screen.getByTestId("hole-center-x") as HTMLInputElement;
    const yInput = screen.getByTestId("hole-center-y") as HTMLInputElement;
    const label = preview.querySelector("g[aria-label^='Center X'] text");
    expect(label).not.toBeNull();

    fireEvent.change(xInput, { target: { value: "13" } });
    for (const y of ["12", "-12"]) {
      fireEvent.change(yInput, { target: { value: y } });
      await waitFor(() => {
        expect(yInput.value).toBe(y);
        expect(label?.textContent).toBe(`13, ${y}`);
      });
    }
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
