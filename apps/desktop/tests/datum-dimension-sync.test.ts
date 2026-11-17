import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DatumDescriptorSchema, type CoreMeshData } from "@kreoda/protocol";
import { coreClient } from "../src/ipc/coreClient";
import { executeCommand } from "../src/commands/execute";
import { useDocumentUiStore, useSelectionStore } from "../src/stores";

const sourceFeature = (depthMm: number) => ({
  featureId: "source-box",
  type: "Box",
  paramsMm: [100, 100, depthMm],
  volumeMm3: 10_000 * depthMm,
  dependsOn: [],
  refExtra: "",
  expressions: {},
});

const datum = (heightMm: number) => DatumDescriptorSchema.parse({
  featureId: "source-top-plane",
  kind: "DatumPlane",
  definition: { type: "offset", base: { type: "principal", planeKind: "XY" }, offsetMm: heightMm },
  dependsOn: ["source-box"],
  resolved: { originMm: [0, 0, heightMm], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] },
  status: "ok",
});

const mesh: CoreMeshData = {
  revision: 2,
  volumeMm3: 600_000,
  bboxMm: [0, 0, 0, 100, 100, 60],
  triangleCount: 0,
  positions: new Float32Array(),
  normals: new Float32Array(),
  indices: new Uint32Array(),
  faces: [],
  edges: [],
  edgeVertices: new Float32Array(),
};

beforeEach(() => {
  vi.restoreAllMocks();
  useDocumentUiStore.getState().resetDocument("datum-dimension-sync");
  useDocumentUiStore.getState().setCoreStatus(true);
  useDocumentUiStore.getState().setFeatures([sourceFeature(40)], 1);
  useDocumentUiStore.getState().setDatums([datum(40)], 1);
  useSelectionStore.getState().select("source-box", false);
});

afterEach(() => {
  vi.restoreAllMocks();
  useDocumentUiStore.getState().resetDocument("datum-dimension-sync-cleanup");
  useSelectionStore.getState().clear();
});

it("syncs updated native datum frames from full-list shape dimension edits", async () => {
  const updatedDatum = datum(60);
  const response = {
    protocolVersion: 1,
    requestId: "req-dimension-edit",
    status: "ok",
    revision: 2,
    featureId: "source-box",
    type: "Box",
    paramsMm: [100, 100, 60],
    dependsOn: [],
    refExtra: "",
    expressions: {},
    volumeMm3: 600_000,
    bboxMm: [0, 0, 0, 100, 100, 60],
    features: [sourceFeature(60)],
    sketches: [],
    datums: [updatedDatum],
  };
  vi.spyOn(coreClient as unknown as { roundTrip: (envelope: unknown) => Promise<Uint8Array> }, "roundTrip")
    .mockResolvedValue(new TextEncoder().encode(JSON.stringify(response)));
  vi.spyOn(coreClient, "requestMesh").mockResolvedValue(mesh);

  await executeCommand("SetDimension", { featureId: "source-box", paramName: "depthMm", valueMm: 60 });

  expect(useDocumentUiStore.getState().features).toEqual([sourceFeature(60)]);
  expect(useDocumentUiStore.getState().datums).toEqual([updatedDatum]);
  expect(useDocumentUiStore.getState().datums[0]?.resolved.originMm).toEqual([0, 0, 60]);
});
