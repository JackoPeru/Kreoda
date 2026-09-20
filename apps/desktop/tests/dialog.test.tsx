import { describe, expect, it, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { AddPrimitiveDialog } from "../src/components/AddPrimitiveDialog";
import { useDocumentUiStore } from "../src/stores";

afterEach(() => cleanup());

vi.mock("../src/ipc/coreClient", () => ({
  coreClient: {
    createBox: vi.fn().mockResolvedValue({
      featureId: "box-1",
      type: "Box",
      volumeMm3: 100000,
      bboxMm: [0, 0, 0, 100, 50, 20],
      revision: 1,
    }),
    requestMesh: vi.fn().mockResolvedValue({
      positions: new Float32Array(36),
      normals: new Float32Array(36),
      indices: new Uint32Array(36),
      faces: [
        { persistentFaceId: "box-1:box.+Z", triangleStart: 0, triangleCount: 12 },
      ],
      edgeVertices: new Float32Array(0),
      edges: [],
      volumeMm3: 100000,
      bboxMm: [0, 0, 0, 100, 50, 20],
      triangleCount: 12,
      revision: 1,
    }),
  },
}));

describe("AddPrimitiveDialog (§62 Scenario A)", () => {
  it("creates an exact-size box through the typed core path", async () => {
    useDocumentUiStore.getState().resetDocument("doc-test");
    // Commands gate on a connected engine (M11) — simulate it.
    useDocumentUiStore.getState().setCoreStatus(true, "test");
    render(<AddPrimitiveDialog kind="box" onClose={() => {}} />);
    expect(screen.getByText("Add box")).toBeTruthy();
    fireEvent.click(screen.getByText("Create"));
    await waitFor(() => {
      expect(useDocumentUiStore.getState().meshes["box-1"]).toBeTruthy();
    });
    const s = useDocumentUiStore.getState();
    expect(s.features[0]!.volumeMm3).toBe(100000);
    expect(s.revision).toBe(1);
  });

  it("rejects non-positive dimensions without touching the core", async () => {
    useDocumentUiStore.getState().resetDocument("doc-test");
    render(<AddPrimitiveDialog kind="box" onClose={() => {}} />);
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[0]!, { target: { value: "-5" } });
    fireEvent.click(screen.getByText("Create"));
    await waitFor(() => {
      expect(screen.getByText(/must be positive/)).toBeTruthy();
    });
    expect(
      useDocumentUiStore.getState().meshes["box-1"],
    ).toBeUndefined();
  });
});
