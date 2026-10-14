import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

afterEach(() => cleanup());

// Viewport needs a real GPU (WebGL) — covered by Playwright E2E against
// Electron (§49). Unit tests mock the imperative viewport boundary.
vi.mock("../src/viewport/CadViewport", () => ({
  CadViewport: class {
    setHover = vi.fn();
    setSelected = vi.fn();
    setSharedTargets = vi.fn();
    setSection = vi.fn();
    sectionGeometryDiagnostics = vi.fn(() => null);
    sharedTargetSummary = () => ({ ids: [], faceGroups: 0, edgeSegments: 0 });
    setPickMode = vi.fn();
    syncMeshes = vi.fn();
    syncReferencePlanes = vi.fn();
    syncDatums = vi.fn();
    requestRender = vi.fn();
    dispose = vi.fn();
  },
}));

vi.mock("../src/ipc/coreClient", () => ({
  coreClient: {
    cancelPreview: vi.fn().mockResolvedValue(undefined),
    getCoreInfo: vi.fn().mockRejectedValue(new Error("offline")),
    readReferences: vi.fn().mockResolvedValue("[]"),
    requestSketch: vi.fn().mockResolvedValue({
      planeKind: "XY", points: [{ id: "p0", x: 0, y: 0, fixed: false }],
      lines: [], circles: [], arcs: [], constraints: [],
    }),
  },
}));

// No WebGL in jsdom: the home 3D lounge falls back to its CSS gradient.
// Stub getContext so jsdom stays silent (real browsers use real WebGL).
vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
Object.defineProperty(window, "matchMedia", {
  configurable: true,
  writable: true,
  value: vi.fn((media: string) => ({
    matches: false,
    media,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }) as unknown as MediaQueryList),
});
vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});

import { App } from "../src/app/App";
import { addReferencePlane, loadReferences, serializeReferences, useReferenceStore } from "../src/reference/store";
import { useDocumentUiStore } from "../src/stores";
import { act } from "@testing-library/react";
import { coreClient } from "../src/ipc/coreClient";
import type { CoreMeshData } from "@kreoda/protocol";
import { useSectionStore } from "../src/section/store";
import { createSectionPlane } from "../src/section/plane";
import type { FeatureSummary } from "../src/ipc/coreClient";

function installSessionRecovery() {
  let callback!: (event: unknown) => void;
  let snapshot: unknown;
  Object.defineProperty(window, "kreoda", { configurable: true, value: {
    onSessionDelta: (receive: typeof callback) => { callback = receive; return () => {}; },
    sessionSnapshot: vi.fn(async () => snapshot),
  } });
  return (model: { documentId: string; revision: number; features: unknown[]; sketches: unknown[] }) => {
    const sessionId = `session-${model.documentId}`;
    snapshot = { ...model, sessionId, bodies: [] };
    callback({ event: "snapshot-required", sessionId, documentId: model.documentId, revision: model.revision, originClientId: "remote" });
  };
}

describe("beginner shell (§24)", () => {
  it("retains section during an empty mesh interval for a same-document Box to Hole tip swap", async () => {
    const mesh: CoreMeshData = {
      revision: 1, volumeMm3: 1, bboxMm: [0, 0, 0, 1, 1, 1], triangleCount: 1,
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 2]), faces: [], edges: [], edgeVertices: new Float32Array(),
    };
    const box: FeatureSummary = { featureId: "section-box", type: "Box", paramsMm: [1, 1, 1], volumeMm3: 1, dependsOn: [], refExtra: "", expressions: {} };
    const hole: FeatureSummary = { ...box, featureId: "section-hole", type: "Hole", dependsOn: [box.featureId] };
    try {
      useDocumentUiStore.getState().resetDocument("section-tip-swap");
      useDocumentUiStore.getState().setFeatures([box], 1);
      useDocumentUiStore.getState().upsertMesh(box.featureId, mesh, 1);
      render(<App />);
      fireEvent.click(screen.getByTestId("home-new-project"));
      await screen.findByTestId("workspace-chrome");
      await act(async () => {
        useSectionStore.getState().setPlane(createSectionPlane([0, 0, 1], 0.5)!);
        useSectionStore.getState().setEnabled(true);
      });
      await act(async () => useDocumentUiStore.getState().setFeatures([box, hole], 2));
      expect(Object.keys(useDocumentUiStore.getState().meshes)).toHaveLength(0);
      expect(useSectionStore.getState().enabled).toBe(true);
      expect(useSectionStore.getState().plane.offsetMm).toBe(0.5);
      await act(async () => useDocumentUiStore.getState().upsertMesh(hole.featureId, mesh, 2));
      expect(useSectionStore.getState().enabled).toBe(true);
      await act(async () => useDocumentUiStore.getState().setFeatures([], 3));
      expect(useSectionStore.getState().enabled).toBe(false);
    } finally { useSectionStore.getState().reset(); }
  });

  it("clears the section when a nonempty document switches while Home unmounts the viewport", async () => {
    const mesh: CoreMeshData = {
      revision: 1, volumeMm3: 1, bboxMm: [0, 0, 0, 1, 1, 1], triangleCount: 1,
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 2]), faces: [], edges: [], edgeVertices: new Float32Array(),
    };
    try {
      useDocumentUiStore.getState().resetDocument("section-before-home");
      useDocumentUiStore.getState().upsertMesh("old-body", mesh, 1);
      render(<App />);
      fireEvent.click(screen.getByTestId("home-new-project"));
      await screen.findByTestId("workspace-chrome");
      await act(async () => {
        useSectionStore.getState().setPlane(createSectionPlane([1, 0, 0], 0.5)!);
        useSectionStore.getState().setEnabled(true);
      });
      fireEvent.click(screen.getByTestId("back-home"));
      expect(screen.queryByTestId("viewport")).toBeNull();
      await act(async () => {
        // The session queue and open/recovery paths use this same document boundary.
        useDocumentUiStore.getState().resetDocument("section-after-home");
        useDocumentUiStore.getState().upsertMesh("new-body", mesh, 1);
      });
      expect(Object.keys(useDocumentUiStore.getState().meshes)).toEqual(["new-body"]);
      expect(useSectionStore.getState().enabled).toBe(false);
      fireEvent.click(screen.getByTestId("home-new-project"));
      await screen.findByTestId("workspace-chrome");
      expect(useSectionStore.getState().plane).toEqual({ normal: [0, 0, 1], offsetMm: 0, inverted: false });
    } finally {
      useSectionStore.getState().reset();
    }
  });

  it("closes a transient sketch editor when the core crashes", async () => {
    let crash!: (info: { code: number }) => void;
    Object.defineProperty(window, "kreoda", { configurable: true, value: {
      onCoreCrashed: (callback: typeof crash) => { crash = callback; return () => {}; },
    } });
    try {
      useDocumentUiStore.getState().resetDocument("crash-sketch");
      useDocumentUiStore.getState().upsertSketch({
        featureId: "sk-crash", planeKind: "XY", points: 1, lines: 0,
        circles: 0, constraints: 0,
      });
      render(<App />);
      fireEvent.click(screen.getByTestId("home-new-project"));
      await screen.findByTestId("workspace-chrome");
      await act(async () => (window as unknown as {
        __kreoda_test: { openSketch: (id: string) => unknown };
      }).__kreoda_test.openSketch("sk-crash"));
      expect(screen.getByTestId("sketch-canvas")).toBeTruthy();
      await act(async () => crash({ code: 1 }));
      expect(screen.queryByTestId("sketch-canvas")).toBeNull();
    } finally {
      delete (window as unknown as { kreoda?: unknown }).kreoda;
    }
  });
  it("clears previous project references when a session switches documents", async () => {
    const receive = installSessionRecovery();
    useDocumentUiStore.getState().resetDocument("old-document");
    addReferencePlane({ name: "old", dataUrl: "data:image/png;base64,AAAA", imageW: 1, imageH: 1 });
    render(<App />);
    await act(async () => receive({ documentId: "new-document", revision: 1, features: [], sketches: [] }));
    expect(useReferenceStore.getState().planes).toEqual([]);
    delete (window as unknown as { kreoda?: unknown }).kreoda;
  });
  it("blocks saving during a remote switch and loads the new project references", async () => {
    const receive = installSessionRecovery();
    let finish!: (json: string) => void;
    vi.mocked(coreClient.readReferences).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    useDocumentUiStore.getState().resetDocument("remote-old");
    render(<App />);
    await act(async () => receive({ documentId: "remote-new", revision: 1, features: [], sketches: [] }));
    expect(() => serializeReferences()).toThrow(/loading/i);
    const reference = { id: "new-ref", name: "new", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lZkAAAAASUVORK5CYII=",
      imageW: 1, imageH: 1, widthMm: 10, heightMm: 10, mmPerPx: 10, plane: "XY", opacity: 0.4 };
    await act(async () => finish(JSON.stringify([reference])));
    expect(useReferenceStore.getState().planes).toEqual([reference]);
    loadReferences("[]");
    delete (window as unknown as { kreoda?: unknown }).kreoda;
  });
  it("applies CAD changes after a reference read fails and retries on the next delta", async () => {
    const receive = installSessionRecovery();
    vi.mocked(coreClient.readReferences).mockRejectedValueOnce(new Error("offline"));
    useDocumentUiStore.getState().resetDocument("retry-old");
    render(<App />);
    expect(window.kreoda.sessionSnapshot).not.toHaveBeenCalled();
    await act(async () => receive({ documentId: "retry-new", revision: 7, features: [], sketches: [] }));
    expect(useDocumentUiStore.getState().revision).toBe(7);
    expect(() => serializeReferences()).toThrow(/retry/i);
    await act(async () => receive({ documentId: "retry-new", revision: 8, features: [], sketches: [] }));
    expect(useDocumentUiStore.getState().revision).toBe(8);
    expect(serializeReferences()).toBe("[]");
    delete (window as unknown as { kreoda?: unknown }).kreoda;
  });
  it("serializes document reference reads and finishes with the newest document", async () => {
    const receive = installSessionRecovery();
    let older!: (json: string) => void;
    let newer!: (json: string) => void;
    vi.mocked(coreClient.readReferences)
      .mockImplementationOnce(() => new Promise(resolve => { older = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { newer = resolve; }));
    useDocumentUiStore.getState().resetDocument("read-race");
    void loadReferences(null);
    render(<App />);
    await act(async () => receive({ documentId: "read-race", revision: 1, features: [], sketches: [] }));
    await act(async () => receive({ documentId: "read-new", revision: 2, features: [], sketches: [] }));
    expect(newer).toBeUndefined();
    const reference = { id: "race-ref", name: "new", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lZkAAAAASUVORK5CYII=",
      imageW: 1, imageH: 1, widthMm: 10, heightMm: 10, mmPerPx: 10, plane: "XY", opacity: 0.4 };
    await act(async () => older(JSON.stringify([{ ...reference, name: "old" }])));
    await act(async () => newer(JSON.stringify([reference])));
    expect(useReferenceStore.getState().planes[0]!.name).toBe("new");
    await loadReferences("[]");
    delete (window as unknown as { kreoda?: unknown }).kreoda;
  });
  it("boots to the home screen (riferimento UI/home.png)", () => {
    render(<App />);
    expect(screen.getByTestId("home-screen")).toBeTruthy();
    expect(screen.getByTestId("home-topbar")).toBeTruthy();
    expect(screen.getByTestId("home-recent")).toBeTruthy();
    expect(screen.getByTestId("home-hero")).toBeTruthy();
    expect(screen.getByTestId("home-quickstart")).toBeTruthy();
    expect(screen.getByTestId("home-tasks")).toBeTruthy();
  });

  it("shows toolbar, viewport, command bar after entering the workspace", async () => {
    render(<App />);
    fireEvent.click(screen.getByTestId("home-new-project"));
    // WorkspaceChrome is a lazy chunk — resolves a microtask after entry.
    expect(await screen.findByRole("button", { name: "Add" })).toBeTruthy();
    expect(screen.getByTestId("viewport")).toBeTruthy();
    expect(
      screen.getByPlaceholderText(/What do you want to do/),
    ).toBeTruthy();
  });
});
