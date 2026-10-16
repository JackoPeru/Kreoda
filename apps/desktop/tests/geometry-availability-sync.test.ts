import { beforeEach, expect, it, vi } from "vitest";
import type { CoreMeshData } from "@kreoda/protocol";
import type { FeatureSummary } from "../src/ipc/coreClient";
import { syncFromCoreList } from "../src/model/sync";
import { useDocumentUiStore } from "../src/stores";

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
    faces: [{ persistentFaceId: `${featureId}:box.+Z`, triangleStart: 0, triangleCount: 1 }],
    edgeVertices: new Float32Array(0),
    edges: [],
    volumeMm3: 1000,
    bboxMm: [0, 0, 0, 10, 10, 10],
    triangleCount: 1,
    revision: 1,
  };
}

function feature(featureId: string): FeatureSummary {
  return {
    featureId,
    type: "Extrude",
    paramsMm: [10],
    dependsOn: [],
    refExtra: "",
    expressions: {},
    volumeMm3: 1000,
  };
}

beforeEach(() => {
  useDocumentUiStore.getState().resetDocument("geometry-availability");
  vi.mocked(coreClient.requestMesh).mockClear();
});

it("retains unavailable body history and drops stale meshes for either unavailability marker", async () => {
  const first = feature("broken-geometry-flag");
  const second = feature("broken-status-flag");
  await syncFromCoreList([first, second], 1);
  expect(useDocumentUiStore.getState().meshes[first.featureId]).toBeDefined();
  expect(useDocumentUiStore.getState().meshes[second.featureId]).toBeDefined();

  vi.mocked(coreClient.requestMesh).mockClear();
  await syncFromCoreList([
    {
      ...first,
      volumeMm3: undefined,
      geometryCurrent: false,
      status: "error",
      error: "source unavailable",
      blockingSourceIds: ["source-a"],
    },
    {
      ...second,
      status: "unavailable",
      error: "source unavailable",
      blockingSourceIds: ["source-b"],
    },
  ], 2, [], [first.featureId, second.featureId]);

  const state = useDocumentUiStore.getState();
  expect(vi.mocked(coreClient.requestMesh)).not.toHaveBeenCalled();
  expect(state.features.map(value => value.featureId)).toEqual([first.featureId, second.featureId]);
  expect(state.bodies.map(body => body.tipFeatureId)).toEqual([first.featureId, second.featureId]);
  expect(state.meshes[first.featureId]).toBeUndefined();
  expect(state.meshes[second.featureId]).toBeUndefined();
  expect(state.features[0]?.blockingSourceIds).toEqual(["source-a"]);
  expect(state.features[1]?.status).toBe("unavailable");
});
