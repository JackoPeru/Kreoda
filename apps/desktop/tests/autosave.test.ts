import { afterEach, describe, expect, it, vi } from "vitest";
import type { FeatureSummary } from "../src/ipc/coreClient";

const mocks = vi.hoisted(() => ({
  saveDocument: vi.fn(),
  openDocument: vi.fn(),
  requestMesh: vi.fn(),
  recoveryPath: vi.fn(),
  recoveryExists: vi.fn(),
  recoveryClear: vi.fn(),
}));

vi.mock("../src/ipc/coreClient", () => ({
  coreClient: {
    documentId: "doc-test",
    saveDocument: mocks.saveDocument,
    openDocument: mocks.openDocument,
    requestMesh: mocks.requestMesh,
  },
}));

function box(featureId: string): FeatureSummary {
  return {
    featureId,
    type: "Box",
    paramsMm: [10, 10, 10],
    volumeMm3: 1000,
    dependsOn: [],
    refExtra: "",
    expressions: {},
  };
}

describe("crash autosave document versions", () => {
  it("saves reference-only edits without a CAD revision change", async () => {
    vi.resetModules();
    mocks.saveDocument.mockResolvedValue({ features: [], sketches: [] });
    mocks.recoveryPath.mockResolvedValue("/tmp/reference-recovery.icad");
    Object.defineProperty(window, "kreoda", { configurable: true, value: { recoveryPath: mocks.recoveryPath } });
    const { useDocumentUiStore } = await import("../src/stores/index.js");
    const { addReferencePlane, updateReferencePlane, removeReferencePlane } = await import("../src/reference/store.js");
    const { autosaveNow } = await import("../src/recovery/autosave.js");
    useDocumentUiStore.getState().resetDocument("references-only");
    expect(await autosaveNow()).toBe("skipped");
    const p = addReferencePlane({ name: "plate", dataUrl: "data:image/png;base64,AAAA", imageW: 200, imageH: 100 });
    expect(await autosaveNow()).toBe("saved");
    expect(await autosaveNow()).toBe("skipped");
    updateReferencePlane(p.id, { widthMm: 100, heightMm: 50, mmPerPx: 0.5 });
    expect(await autosaveNow()).toBe("saved");
    removeReferencePlane(p.id);
    expect(await autosaveNow()).toBe("saved");
  });
  afterEach(() => {
    delete (window as unknown as { kreoda?: unknown }).kreoda;
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("keys recovery by epoch and retries when a document changes during save", async () => {
    vi.resetModules();
    mocks.saveDocument.mockResolvedValue({ features: [], sketches: [] });
    mocks.openDocument.mockResolvedValue({ features: [], sketches: [], revision: 1 });
    mocks.requestMesh.mockResolvedValue({});
    mocks.recoveryPath.mockResolvedValue("/tmp/kreoda-autosave-test.icad");
    mocks.recoveryExists.mockResolvedValue(true);
    mocks.recoveryClear.mockResolvedValue(undefined);
    Object.defineProperty(window, "kreoda", {
      configurable: true,
      value: {
        recoveryPath: mocks.recoveryPath,
        recoveryExists: mocks.recoveryExists,
        recoveryClear: mocks.recoveryClear,
      },
    });

    const { useDocumentUiStore } = await import("../src/stores/index.js");
    const { autosaveNow, clearRecoveryAfterSave, restoreRecovery } =
      await import("../src/recovery/autosave.js");
    const replaceWithBox = (documentId: string, featureId: string) => {
      useDocumentUiStore.getState().resetDocument(documentId);
      useDocumentUiStore.getState().setFeatures([box(featureId)], 1);
    };

    replaceWithBox("doc-a", "box-a");
    expect(await autosaveNow()).toBe("saved");
    replaceWithBox("doc-b", "box-b");
    // Same core revision, new UI epoch: it must replace doc-a's recovery file.
    expect(await autosaveNow()).toBe("saved");
    expect(mocks.saveDocument).toHaveBeenCalledTimes(2);

    useDocumentUiStore.getState().setFeatures([box("box-b-edited")], 2);
    let signalSaveStarted!: () => void;
    let finishSave!: () => void;
    const saveStarted = new Promise<void>((resolve) => {
      signalSaveStarted = resolve;
    });
    const saveGate = new Promise<void>((resolve) => {
      finishSave = resolve;
    });
    mocks.saveDocument.mockImplementationOnce(async () => {
      signalSaveStarted();
      await saveGate;
      return { features: [], sketches: [] };
    });
    const inFlightSave = autosaveNow();
    await saveStarted;
    replaceWithBox("doc-c", "box-c");
    finishSave();
    expect(await inFlightSave).toBe("saved");
    // The in-flight write cannot stamp doc-c as saved; the next tick retries.
    expect(await autosaveNow()).toBe("saved");
    expect(mocks.saveDocument).toHaveBeenCalledTimes(4);

    await restoreRecovery();
    const beforeRestoreCheck = mocks.saveDocument.mock.calls.length;
    expect(await autosaveNow()).toBe("skipped");
    expect(mocks.saveDocument).toHaveBeenCalledTimes(beforeRestoreCheck);
    replaceWithBox("doc-after-restore", "box-after-restore");
    expect(await autosaveNow()).toBe("saved");

    await clearRecoveryAfterSave();
    expect(mocks.recoveryClear).toHaveBeenCalledOnce();
    replaceWithBox("doc-after-clear", "box-after-clear");
    expect(await autosaveNow()).toBe("saved");

    mocks.recoveryClear.mockRejectedValueOnce(new Error("clear failed"));
    await clearRecoveryAfterSave();
    expect(await autosaveNow()).toBe("saved");
  });
});
