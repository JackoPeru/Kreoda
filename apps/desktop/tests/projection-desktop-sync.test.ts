import { beforeEach, expect, it } from "vitest";
import type { SketchProjectionGroupSummary } from "@kreoda/protocol";
import { syncFromCoreList } from "../src/model/sync";
import { useDocumentUiStore } from "../src/stores";

const group: SketchProjectionGroupSummary = {
  groupId: "group-stable",
  definition: { version: 1, operation: "projectEdges", sources: [{ type: "edge", featureId: "solid", persistentEdgeId: "solid:edge-2" }] },
  sourceFeatureIds: ["solid"], status: "broken", error: "edge missing", blockingSourceIds: ["solid"], generation: 3,
};

beforeEach(() => useDocumentUiStore.getState().resetDocument("projection-sync"));

it("preserves projection definitions and repair status through renderer summary sync", async () => {
  await syncFromCoreList([], 4, [{ featureId: "sketch", planeKind: "XY", points: 0, lines: 0, circles: 0,
    constraints: 0, projectionGroups: [group], geometryCurrent: false, status: "unavailable", error: "edge missing",
    blockingSourceIds: ["solid"] }]);

  expect(useDocumentUiStore.getState().sketches[0]).toMatchObject({
    projectionGroups: [group], geometryCurrent: false, status: "unavailable", error: "edge missing",
  });
});
