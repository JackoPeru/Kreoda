import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CoreMeshData } from "@kreoda/protocol";
import { SectionPanel } from "../src/components/workspace/SectionPanel";
import { createSectionPlane } from "../src/section/plane";
import { useSectionStore } from "../src/section/store";
import { useDocumentUiStore } from "../src/stores";

function loadMesh(bboxMm: CoreMeshData["bboxMm"] = [-2, -3, -4, 8, 7, 6]): void {
  const mesh: CoreMeshData = {
    revision: 0,
    volumeMm3: 1,
    bboxMm,
    triangleCount: 1,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
    faces: [],
    edges: [],
    edgeVertices: new Float32Array(),
  };
  const state = useDocumentUiStore.getState();
  state.replaceAllMeshes({ body: mesh }, 0, state.epoch);
}

afterEach(() => {
  cleanup();
  useDocumentUiStore.getState().resetDocument("doc-section-test");
  useSectionStore.getState().reset();
});

describe("section view controls", () => {
  it("preserves the accepted plane and enabled state when reset midpoint is invalid", () => {
    loadMesh();
    render(<SectionPanel />);
    fireEvent.click(screen.getByTestId("section-open"));
    fireEvent.click(screen.getByTestId("section-enable"));
    fireEvent.change(screen.getByTestId("section-offset"), { target: { value: "-12" } });
    act(() => loadMesh([0, 0, 1_000_000, 100, 100, 1_100_000]));
    fireEvent.click(screen.getByTestId("section-reset"));
    expect(useSectionStore.getState().enabled).toBe(true);
    expect(useSectionStore.getState().plane.offsetMm).toBe(-12);
  });

  it("does not enable an invalid midpoint beyond the quota limit", () => {
    loadMesh([0, 0, 1_000_000, 100, 100, 1_100_000]);
    render(<SectionPanel />);
    fireEvent.click(screen.getByTestId("section-open"));
    fireEvent.click(screen.getByTestId("section-enable"));
    expect(useSectionStore.getState().enabled).toBe(false);
    expect(useSectionStore.getState().initialized).toBe(false);
    expect(useSectionStore.getState().plane.offsetMm).toBe(0);
  });

  it("preserves an explicit zero quota across disable, remount and re-enable", () => {
    loadMesh();
    const view = render(<SectionPanel />);
    fireEvent.click(screen.getByTestId("section-open"));
    fireEvent.click(screen.getByTestId("section-enable"));
    expect(useSectionStore.getState().plane.offsetMm).toBe(1);
    fireEvent.change(screen.getByTestId("section-offset"), { target: { value: "0" } });
    fireEvent.click(screen.getByTestId("section-enable"));
    view.unmount();
    render(<SectionPanel />);
    fireEvent.click(screen.getByTestId("section-open"));
    fireEvent.click(screen.getByTestId("section-enable"));
    expect(useSectionStore.getState().enabled).toBe(true);
    expect(useSectionStore.getState().plane.offsetMm).toBe(0);
    cleanup();
    useDocumentUiStore.getState().resetDocument("doc-new-section");
    loadMesh();
    render(<SectionPanel />);
    fireEvent.click(screen.getByTestId("section-open"));
    fireEvent.click(screen.getByTestId("section-enable"));
    expect(useSectionStore.getState().plane.offsetMm).toBe(1);
  });

  it("keeps empty documents disabled", () => {
    render(<SectionPanel />);
    fireEvent.click(screen.getByTestId("section-open"));
    expect((screen.getByTestId("section-enable") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Add a solid/)).toBeTruthy();
  });

  it("initializes quota from native bounds midpoint and rejects invalid edits", () => {
    loadMesh();
    render(<SectionPanel />);
    fireEvent.click(screen.getByTestId("section-open"));
    fireEvent.click(screen.getByTestId("section-enable"));
    expect(useSectionStore.getState().plane.offsetMm).toBe(1);

    const plane = createSectionPlane([0, 0, 1], -12)!;
    useSectionStore.getState().setPlane(plane);
    const input = screen.getByTestId("section-offset");
    fireEvent.change(input, { target: { value: "1000001" } });
    fireEvent.blur(input);
    expect(useSectionStore.getState().plane.offsetMm).toBe(-12);
  });
});
