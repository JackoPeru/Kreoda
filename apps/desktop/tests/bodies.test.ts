import { describe, expect, it, vi, beforeEach } from "vitest";
import type { CoreMeshData } from "@kreoda/protocol";
import type { FeatureSummary } from "../src/ipc/coreClient";
import {
  buildBodies,
  buildTreeItems,
  useDocumentUiStore,
  visibleFeatureIds,
} from "../src/stores";
import { syncFromCoreList } from "../src/model/sync";

vi.mock("../src/ipc/coreClient", () => ({
  coreClient: {
    requestMesh: vi.fn(async (featureId: string) => meshFor(featureId)),
  },
}));

import { coreClient } from "../src/ipc/coreClient";

function meshFor(featureId: string): CoreMeshData {
  return {
    positions: new Float32Array(9),
    normals: new Float32Array(9),
    indices: new Uint32Array([0, 1, 2]),
    faces: [
      { persistentFaceId: `${featureId}:box.+Z`, triangleStart: 0, triangleCount: 1 },
    ],
    edgeVertices: new Float32Array(0),
    edges: [],
    volumeMm3: 1000,
    bboxMm: [0, 0, 0, 10, 10, 10],
    triangleCount: 1,
    revision: 99,
  };
}

function feat(
  featureId: string,
  type: string,
  dependsOn: string[] = [],
  paramsMm: number[] = [],
): FeatureSummary {
  return {
    featureId,
    type,
    paramsMm,
    volumeMm3: 1000,
    dependsOn,
    refExtra: "",
    expressions: {},
  };
}

const box = () => feat("box-1", "Box", [], [100, 50, 10]);
const hole = () => feat("ho-1", "Hole", ["box-1"], [8, 0]);
const fillet = () => feat("fi-1", "Fillet", ["ho-1"], [2]);

beforeEach(() => {
  useDocumentUiStore.getState().resetDocument("doc-test");
  vi.mocked(coreClient.requestMesh).mockClear();
});

describe("buildBodies (Slice 4 body projection)", () => {
  it("groups Box→Hole→Fillet into one body with the fillet tip", () => {
    const bodies = buildBodies([box(), hole(), fillet()]);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.bodyId).toBe("body-box-1");
    expect(bodies[0]!.history).toEqual(["box-1", "ho-1", "fi-1"]);
    expect(bodies[0]!.tipFeatureId).toBe("fi-1");
  });

  it("opens a second body for an independent root", () => {
    const bodies = buildBodies([box(), hole(), feat("box-2", "Box", [], [5, 5, 5])]);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]!.bodyId).toBe("body-box-2");
    expect(bodies[1]!.tipFeatureId).toBe("box-2");
  });

  it("leaves Instance occurrences out of bodies but visible", () => {
    const features = [box(), feat("in-1", "Instance", ["box-1"])];
    expect(buildBodies(features)).toHaveLength(1);
    expect(visibleFeatureIds(features).sort()).toEqual(["box-1", "in-1"]);
  });

  it("visible ids are tips only (history stays out of the scene)", () => {
    expect(visibleFeatureIds([box(), hole(), fillet()])).toEqual(["fi-1"]);
  });
});

describe("buildTreeItems (bodies + history)", () => {
  it("renders a single-root body as one flat row (no nesting noise)", () => {
    const items = buildTreeItems([box()], []);
    expect(items).toHaveLength(1);
    expect(items[0]!.name).toBe("Box 100×50×10");
    expect(items[0]!.children).toBeUndefined();
  });

  it("renders a multi-feature body as Body N with history children", () => {
    const items = buildTreeItems([box(), hole(), fillet()], []);
    expect(items).toHaveLength(1);
    expect(items[0]!.name).toBe("Body 1");
    expect(items[0]!.children!.map((c) => c.name)).toEqual([
      "Box 100×50×10",
      "Hole 8×0",
      "Fillet 2",
    ]);
  });

  it("keeps sketches on top and instances as flat rows", () => {
    const items = buildTreeItems([box(), feat("in-1", "Instance", ["box-1"])], [
      {
        featureId: "sk-1",
        planeKind: "XY",
        points: 4,
        lines: 4,
        circles: 0,
        constraints: 4,
      },
    ]);
    expect(items[0]!.kind).toBe("sketch");
    expect(items.map((i) => i.name)).toContain("Instance ← 1 input");
  });
});

describe("syncFromCoreList (tip-only scene contents)", () => {
  it("hydrates only the tip mesh: Box→Hole→Fillet = 1 scene object", async () => {
    await syncFromCoreList([box(), hole(), fillet()], 3);
    const s = useDocumentUiStore.getState();
    // History intact for recompute/tree; scene holds the tip alone.
    expect(s.features).toHaveLength(3);
    expect(s.bodies).toHaveLength(1);
    expect(s.bodies[0]!.tipFeatureId).toBe("fi-1");
    expect(Object.keys(s.meshes)).toEqual(["fi-1"]);
    expect(vi.mocked(coreClient.requestMesh).mock.calls.map((c) => c[0])).toEqual([
      "fi-1",
    ]);
  });

  it("undo tip step swaps the rendered object with no ghosts", async () => {
    await syncFromCoreList([box(), hole(), fillet()], 3);
    await syncFromCoreList([box(), hole()], 4);
    const s = useDocumentUiStore.getState();
    expect(s.bodies[0]!.tipFeatureId).toBe("ho-1");
    expect(Object.keys(s.meshes)).toEqual(["ho-1"]);
  });

  it("setFeatures prunes a superseded tip mesh on incremental append", () => {
    const s0 = useDocumentUiStore.getState();
    s0.replaceAllMeshes({ "box-1": meshFor("box-1"), "ho-1": meshFor("ho-1") }, 2);
    useDocumentUiStore.getState().setFeatures([box(), hole()], 2);
    expect(Object.keys(useDocumentUiStore.getState().meshes)).toEqual(["ho-1"]);
  });
});
