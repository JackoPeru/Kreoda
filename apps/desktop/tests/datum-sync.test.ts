import { beforeEach, expect, it, vi } from "vitest";
import { DatumDescriptorSchema } from "@kreoda/protocol";
import { coreClient } from "../src/ipc/coreClient";
import { syncFromCoreList } from "../src/model/sync";
import { buildTreeItems, useDocumentUiStore, useSelectionStore } from "../src/stores";

beforeEach(() => { useDocumentUiStore.getState().resetDocument("datum-ui");useSelectionStore.getState().clear();vi.restoreAllMocks(); });
it("hydrates, selects and removes native datums independently from body meshes", async () => {
  const datum = DatumDescriptorSchema.parse({ featureId: "plane", kind: "DatumPlane", definition: { type: "principal", planeKind: "XY" }, dependsOn: [],
    resolved: { originMm: [10,20,30], xAxis: [1,0,0], yAxis: [0,1,0], normal: [0,0,1] }, status: "ok" });
  const mesh = vi.spyOn(coreClient, "requestMesh");
  await syncFromCoreList([], 1, [], null, [datum]);
  expect(useDocumentUiStore.getState().datums).toEqual([datum]);expect(mesh).not.toHaveBeenCalled();expect(useDocumentUiStore.getState().bodies).toEqual([]);
  const state = useDocumentUiStore.getState();expect(buildTreeItems(state.features,state.sketches,state.bodies,state.datums)).toContainEqual(expect.objectContaining({ id: "plane", kind: "datum" }));
  useSelectionStore.getState().select("plane", false);
  await syncFromCoreList([], 2, [], null, []);
  expect(useDocumentUiStore.getState().datums).toEqual([]);expect(useSelectionStore.getState().selectedIds).toEqual([]);
});
