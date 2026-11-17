import { afterEach, expect, it, vi } from "vitest";
import { CommandType, PROTOCOL_VERSION, type SketchProjectionDefinition } from "@kreoda/protocol";
import { coreClient } from "../src/ipc/coreClient";

const plane = { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] };
const definition: SketchProjectionDefinition = { version: 1, operation: "projectEdges", sources: [
  { type: "sketchEntities", featureId: "sk-source", entityIds: ["circle"] },
] };
const group = {
  groupId: "pg-stable", definition, generation: 2, sourceFeatureIds: ["sk-source"],
  status: "ok", error: "", blockingSourceIds: [],
};
const displayGroup = {
  ...group,
  edges: [{ memberIndex: 0, curveType: "circle", closed: true, firstParameter: 0, lastParameter: 1,
    pointsMm: [[5, 0, 0], [0, 5, 0]] }],
};

function response(value: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    protocolVersion: PROTOCOL_VERSION, requestId: "reply", status: "ok", ...value,
  }));
}

afterEach(() => vi.restoreAllMocks());

it("uses canonical projection commands and validates query and mutation DTOs", async () => {
  const roundTrip = vi.spyOn(coreClient as unknown as {
    roundTrip: (envelope: unknown) => Promise<Uint8Array>;
  }, "roundTrip");
  roundTrip
    .mockResolvedValueOnce(response({ documentId: "doc-phase1", revision: 7, projection: {
      featureId: "sk-target", plane, geometryCurrent: true, status: "ok", error: "", blockingSourceIds: [], groups: [displayGroup],
    } }))
    .mockResolvedValueOnce(response({ featureId: "sk-target", type: "Sketch", planeKind: "XY", revision: 8,
      sketch: { model: { points: [], lines: [], circles: [], arcs: [], constraints: [] }, projectionGroups: [group] },
      geometryCurrent: true, geometryStatus: "ok" }))
    .mockResolvedValueOnce(response({ featureId: "sk-target", type: "Sketch", planeKind: "XY", revision: 9,
      sketch: { model: { points: [], lines: [], circles: [], arcs: [], constraints: [] }, projectionGroups: [] },
      geometryCurrent: true, geometryStatus: "ok" }));

  const queried = await coreClient.requestSketchProjection("sk-target", "pg-stable");
  expect(queried).toMatchObject({ documentId: "doc-phase1", revision: 7,
    projection: { featureId: "sk-target", groups: [{ groupId: "pg-stable", edges: [{ memberIndex: 0 }] }] } });
  const set = await coreClient.setSketchProjection("sk-target", "pg-stable", definition);
  expect(set).toMatchObject({ featureId: "sk-target", revision: 8,
    projectionGroups: [{ groupId: "pg-stable", definition: { sources: [{ entityIds: ["circle"] }] } }] });
  const removed = await coreClient.removeSketchProjection("sk-target", "pg-stable");
  expect(removed).toMatchObject({ featureId: "sk-target", revision: 9, projectionGroups: [] });

  const requests = roundTrip.mock.calls.map(([request]) => request as Record<string, unknown>);
  expect(requests.map(request => request.type)).toEqual([
    CommandType.RequestSketchProjection, CommandType.SetSketchProjection, CommandType.RemoveSketchProjection,
  ]);
  expect(requests[0]).toMatchObject({ documentId: "doc-phase1", featureId: "sk-target", groupId: "pg-stable" });
  expect(requests[1]).toMatchObject({ featureId: "sk-target", groupId: "pg-stable", definition });
  expect(requests[2]).toMatchObject({ featureId: "sk-target", groupId: "pg-stable" });
  expect(requests.every(request => !Object.hasOwn(request, "isPreview"))).toBe(true);
});

it("rejects a projection query that returns a different target sketch", async () => {
  vi.spyOn(coreClient as unknown as { roundTrip: (envelope: unknown) => Promise<Uint8Array> }, "roundTrip")
    .mockResolvedValue(response({ documentId: "doc-phase1", revision: 1, projection: {
      featureId: "sk-other", plane, geometryCurrent: true, status: "ok", error: "", blockingSourceIds: [], groups: [],
    } }));
  await expect(coreClient.requestSketchProjection("sk-target")).rejects.toThrow("projection response target mismatch");
});
