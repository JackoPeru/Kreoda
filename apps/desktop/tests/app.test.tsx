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
    setPickMode = vi.fn();
    syncMeshes = vi.fn();
    syncReferencePlanes = vi.fn();
    requestRender = vi.fn();
    dispose = vi.fn();
  },
}));

vi.mock("../src/ipc/coreClient", () => ({
  coreClient: { getCoreInfo: vi.fn().mockRejectedValue(new Error("offline")), readReferences: vi.fn().mockResolvedValue("[]") },
}));

// No WebGL in jsdom: the home 3D lounge falls back to its CSS gradient.
// Stub getContext so jsdom stays silent (real browsers use real WebGL).
vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

import { App } from "../src/app/App";
import { addReferencePlane, loadReferences, serializeReferences, useReferenceStore } from "../src/reference/store";
import { useDocumentUiStore } from "../src/stores";
import { act } from "@testing-library/react";
import { coreClient } from "../src/ipc/coreClient";

describe("beginner shell (§24)", () => {
  it("clears previous project references when a session switches documents", async () => {
    let receive!: (delta: { documentId: string; revision: number; features: unknown[]; sketches: unknown[] }) => void;
    Object.defineProperty(window, "kreoda", { configurable: true, value: {
      onSessionDelta: (callback: typeof receive) => { receive = callback; return () => {}; },
    } });
    useDocumentUiStore.getState().resetDocument("old-document");
    addReferencePlane({ name: "old", dataUrl: "data:image/png;base64,AAAA", imageW: 1, imageH: 1 });
    render(<App />);
    await act(async () => receive({ documentId: "new-document", revision: 1, features: [], sketches: [] }));
    expect(useReferenceStore.getState().planes).toEqual([]);
    delete (window as unknown as { kreoda?: unknown }).kreoda;
  });
  it("blocks saving during a remote switch and loads the new project references", async () => {
    let receive!: (delta: { documentId: string; revision: number; features: unknown[]; sketches: unknown[] }) => void;
    let finish!: (json: string) => void;
    vi.mocked(coreClient.readReferences).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    Object.defineProperty(window, "kreoda", { configurable: true, value: {
      onSessionDelta: (callback: typeof receive) => { receive = callback; return () => {}; },
    } });
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
    let receive!: (delta: { documentId: string; revision: number; features: unknown[]; sketches: unknown[] }) => void;
    vi.mocked(coreClient.readReferences).mockRejectedValueOnce(new Error("offline"));
    Object.defineProperty(window, "kreoda", { configurable: true, value: {
      onSessionDelta: (callback: typeof receive) => { receive = callback; return () => {}; },
    } });
    useDocumentUiStore.getState().resetDocument("retry-old");
    render(<App />);
    await act(async () => receive({ documentId: "retry-new", revision: 7, features: [], sketches: [] }));
    expect(useDocumentUiStore.getState().revision).toBe(7);
    expect(() => serializeReferences()).toThrow(/retry/i);
    await act(async () => receive({ documentId: "retry-new", revision: 8, features: [], sketches: [] }));
    expect(useDocumentUiStore.getState().revision).toBe(8);
    expect(serializeReferences()).toBe("[]");
    delete (window as unknown as { kreoda?: unknown }).kreoda;
  });
  it("keeps newer references when an older read finishes last", async () => {
    let receive!: (delta: { documentId: string; revision: number; features: unknown[]; sketches: unknown[] }) => void;
    let older!: (json: string) => void;
    let newer!: (json: string) => void;
    vi.mocked(coreClient.readReferences)
      .mockImplementationOnce(() => new Promise(resolve => { older = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { newer = resolve; }));
    Object.defineProperty(window, "kreoda", { configurable: true, value: {
      onSessionDelta: (callback: typeof receive) => { receive = callback; return () => {}; },
    } });
    useDocumentUiStore.getState().resetDocument("read-race");
    void loadReferences(null);
    render(<App />);
    await act(async () => receive({ documentId: "read-race", revision: 1, features: [], sketches: [] }));
    await act(async () => receive({ documentId: "read-race", revision: 2, features: [], sketches: [] }));
    const reference = { id: "race-ref", name: "new", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lZkAAAAASUVORK5CYII=",
      imageW: 1, imageH: 1, widthMm: 10, heightMm: 10, mmPerPx: 10, plane: "XY", opacity: 0.4 };
    await act(async () => newer(JSON.stringify([reference])));
    await act(async () => older(JSON.stringify([{ ...reference, name: "old" }])));
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
