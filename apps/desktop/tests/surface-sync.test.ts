import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CoreMeshData } from "@kreoda/protocol";
import { coreClient } from "../src/ipc/coreClient";
import { syncFromCoreList } from "../src/model/sync";
import { useDocumentUiStore, useSelectionStore } from "../src/stores";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}

const box = {
  featureId: "box-live", type: "Box", paramsMm: [1, 1, 1], dependsOn: [], refExtra: "", expressions: {},
};
const mesh = {
  positions: new Float32Array(), normals: new Float32Array(), indices: new Uint32Array(), faces: [],
  edgeVertices: new Float32Array(), edges: [], volumeMm3: 1, bboxMm: [0, 0, 0, 1, 1, 1],
  triangleCount: 0, revision: 2,
} as CoreMeshData;

function context() {
  const state = useDocumentUiStore.getState();
  return { documentId: state.documentId, epoch: state.epoch, connectionGeneration: state.connectionGeneration };
}
function guard(captured: ReturnType<typeof context>) {
  const state = useDocumentUiStore.getState();
  return state.coreRunning && state.documentId === captured.documentId && state.epoch === captured.epoch &&
    state.connectionGeneration === captured.connectionGeneration && coreClient.documentId === captured.documentId;
}

beforeEach(() => {
  useDocumentUiStore.getState().resetDocument("sync-doc");
  useDocumentUiStore.getState().setCoreStatus(true, "test");
  coreClient.documentId = "sync-doc";
  useSelectionStore.getState().clear();
  useSelectionStore.getState().select(box.featureId, false);
});
afterEach(() => vi.restoreAllMocks());

it("does not commit a late mesh after disconnect and reconnect without epoch change", async () => {
  const pendingMesh = deferred<CoreMeshData>();
  vi.spyOn(coreClient, "requestMesh").mockReturnValue(pendingMesh.promise);
  const captured = context();
  const pending = syncFromCoreList([box], 2, [], null, null, () => guard(captured));
  const disconnectState = useDocumentUiStore.getState();

  useDocumentUiStore.getState().setCoreStatus(false, null);
  useDocumentUiStore.getState().setCoreStatus(true, "reconnected");
  expect(useDocumentUiStore.getState().epoch).toBe(captured.epoch);
  const afterReconnect = useDocumentUiStore.getState();
  pendingMesh.resolve(mesh);

  await expect(pending).rejects.toThrow(/stale/i);
  expect(useDocumentUiStore.getState().meshRevision).toBe(afterReconnect.meshRevision);
  expect(useDocumentUiStore.getState().meshes).toEqual(afterReconnect.meshes);
  expect(useSelectionStore.getState().selectedIds).toEqual([box.featureId]);
  expect(disconnectState.epoch).toBe(captured.epoch);
});

it("does not commit late hydration after document replacement", async () => {
  const pendingMesh = deferred<CoreMeshData>();
  vi.spyOn(coreClient, "requestMesh").mockReturnValue(pendingMesh.promise);
  const captured = context();
  const pending = syncFromCoreList([box], 2, [], null, null, () => guard(captured));

  useDocumentUiStore.getState().resetDocument("replacement-doc");
  coreClient.documentId = "replacement-doc";
  const replacement = useDocumentUiStore.getState();
  pendingMesh.resolve(mesh);

  await expect(pending).rejects.toThrow(/stale/i);
  expect(useDocumentUiStore.getState().documentId).toBe("replacement-doc");
  expect(useDocumentUiStore.getState().meshRevision).toBe(replacement.meshRevision);
  expect(useDocumentUiStore.getState().meshes).toEqual(replacement.meshes);
});
