import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  pending: vi.fn(),
  pickFaceAt: vi.fn(),
  setHandle: vi.fn(),
}));

vi.mock("../src/viewport/CadViewport", () => ({
  CadViewport: class {
    pickFaceAt = mocks.pickFaceAt;
    constructor() {}
    setPickMode() {}
    setCameraInputEnabled() {}
    showPreviewMesh() {}
    cancelCameraGesture() {}
    cancelSurfacePick() {}
    cancelReferenceMeasure() {}
    beginReferenceMeasure() { return Promise.resolve(null); }
    beginSurfacePointPick() { return Promise.resolve(null); }
    beginSurfaceEdgePick() { return Promise.resolve(null); }
    isSurfacePickPending() { return mocks.pending(); }
    setSurfacePointMarker() {}
    setSurfaceEdgeHighlight() {}
    sectionGeometryDiagnostics() { return null; }
    faceScreenPoint() { return null; }
    setView() {}
    projectPoint() { return null; }
    viewDir() { return null; }
    renderStats() { return null; }
    meshIdentity() { return null; }
    sketchProjectionSummary() { return null; }
    sharedTargetSummary() { return null; }
    setSection() {}
    setZebra() {}
    setCurvature() {}
    syncMeshes() {}
    syncReferencePlanes() {}
    syncDatums() {}
    syncSketchProjections() {}
    setSelected() {}
    setSharedTargets() {}
    dispose() {}
  },
}));
vi.mock("../src/viewport/viewportHandle", () => ({
  setViewportHandle: mocks.setHandle,
  viewportIsSurfacePickPending: mocks.pending,
}));

import { Viewport } from "../src/components/Viewport";
import { useDocumentUiStore, useSelectionStore, useToolStore } from "../src/stores";

beforeEach(() => {
  vi.clearAllMocks();
  useDocumentUiStore.getState().resetDocument("pull-capture-doc");
  useDocumentUiStore.getState().setCoreStatus(true, "test");
  useSelectionStore.getState().clear();
  useToolStore.getState().setTool("pull");
  mocks.pickFaceAt.mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  useToolStore.getState().setTool("select");
  useDocumentUiStore.getState().resetDocument("pull-capture-cleanup");
});

it("does not start Pull pointer picking while a surface point or edge capture owns the viewport", () => {
  mocks.pending.mockReturnValue(true);
  render(<Viewport />);
  expect(useToolStore.getState().activeTool).toBe("pull");
  expect(mocks.setHandle).toHaveBeenCalled();
  const viewport = screen.getByTestId("viewport");
  fireEvent(viewport, new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 10, clientY: 10 }));
  expect(mocks.pickFaceAt).not.toHaveBeenCalled();

  mocks.pending.mockReturnValue(false);
  fireEvent(viewport, new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 10, clientY: 10 }));
  expect(mocks.pickFaceAt).toHaveBeenCalledOnce();
});

