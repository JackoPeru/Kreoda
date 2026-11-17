import { expect, it, vi } from "vitest";
import { normalizeSnapshot, runSessionQuery, type QueryEnv, type SelectionRegistry } from "../electron/session-queries";

const selections: SelectionRegistry = { get: () => [], set: () => {}, clear: () => {}, drop: () => {} };
const frame = { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] };
const definition = { version: 1, operation: "projectEdges", sources: [
  { type: "sketchEntities", featureId: "source", entityIds: ["circle"] },
] };
const group = { groupId: "linked", definition, sourceFeatureIds: ["source"], status: "ok", error: "", blockingSourceIds: [], generation: 2 };
const projection = { featureId: "target", plane: frame, geometryCurrent: true, status: "ok", error: "",
  blockingSourceIds: [], groups: [{ ...group, edges: [{ memberIndex: 0, curveType: "circle", firstParameter: 0,
    lastParameter: 6.28, closed: true, pointsMm: [[1, 0, 0], [0, 1, 0]] }] }] };

it("preserves unavailable geometry and projection groups without manufacturing a volume", () => {
  const snapshot = normalizeSnapshot("doc", 7, [{ featureId: "solid", type: "Extrude", volumeMm3: 99, geometryCurrent: false,
    status: "unavailable", error: "blocked by source", blockingSourceIds: ["source"] }], [{ featureId: "target",
    planeKind: "XY", geometryCurrent: false, status: "unavailable", error: "blocked by source",
    blockingSourceIds: ["source"], projectionGroups: [group] }]);

  expect(snapshot.features[0]).toMatchObject({ geometryCurrent: false, status: "unavailable",
    error: "blocked by source", blockingSourceIds: ["source"] });
  expect(snapshot.features[0]).not.toHaveProperty("volumeMm3");
  expect(snapshot.sketches[0]).toMatchObject({ geometryCurrent: false, projectionGroups: [group] });
});

it("lists unavailable bodies without stale measurements and excludes them from volume filters", async () => {
  const snapshot = normalizeSnapshot("doc", 7, [
    { featureId: "healthy", type: "Box", volumeMm3: 60, geometryCurrent: true, status: "ok" },
    { featureId: "stale", type: "Extrude", volumeMm3: 99, geometryCurrent: false, status: "unavailable",
      error: "blocked by source", blockingSourceIds: ["source"] },
  ], []);
  const env = { snapshot: async () => snapshot } as unknown as QueryEnv;
  const unfiltered = await runSessionQuery(env, selections, "client", "findBodies", {}, "doc");
  const bodies = (unfiltered.result as { bodies: Record<string, unknown>[] }).bodies;
  expect(bodies).toHaveLength(2);
  expect(bodies.find(body => body.tip === "stale")).toMatchObject({ geometryCurrent: false,
    status: "unavailable", error: "blocked by source", blockingSourceIds: ["source"] });
  expect(bodies.find(body => body.tip === "stale")).not.toHaveProperty("volumeMm3");
  expect(bodies.find(body => body.tip === "stale")).not.toHaveProperty("geometricSummary");
  const filtered = await runSessionQuery(env, selections, "client", "findBodies", { minVolumeMm3: 1 }, "doc");
  expect((filtered.result as { bodies: Record<string, unknown>[] }).bodies.map(body => body.tip)).toEqual(["healthy"]);
});

it("runs getSketchProjection as a typed read and fences its exact native lineage", async () => {
  const nativeReply = { status: "ok", documentId: "doc", revision: 7, projection };
  const geometry = vi.fn(async () => nativeReply);
  const env = { geometry, sessionId: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } as unknown as QueryEnv;
  const reply = await runSessionQuery(env, selections, "client", "getSketchProjection",
    { featureId: "target", groupId: "linked", expectedRevision: 7 }, "doc");

  expect(reply).toEqual({ result: projection, lineage: {
    sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", documentId: "doc", revision: 7,
  } });
  expect(geometry).toHaveBeenCalledWith("doc", "RequestSketchProjection", { featureId: "target", groupId: "linked" });
});

it("rejects stale expected revisions and malformed native projection replies", async () => {
  const geometry = vi.fn(async () => ({ status: "ok", documentId: "doc", revision: 8, projection }));
  const env = { geometry, sessionId: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } as unknown as QueryEnv;
  await expect(runSessionQuery(env, selections, "client", "getSketchProjection",
    { featureId: "target", expectedRevision: 7 }, "doc")).rejects.toMatchObject({ code: "NEED_FULL_SNAPSHOT" });
  geometry.mockResolvedValueOnce({ status: "ok", documentId: "other", revision: 7, projection } as never);
  await expect(runSessionQuery(env, selections, "client", "getSketchProjection",
    { featureId: "target" }, "doc")).rejects.toMatchObject({ code: "NEED_FULL_SNAPSHOT" });
  geometry.mockResolvedValueOnce({ status: "ok", documentId: "doc", revision: 7, projection: { ...projection, privateBindings: [] } } as never);
  await expect(runSessionQuery(env, selections, "client", "getSketchProjection",
    { featureId: "target" }, "doc")).rejects.toMatchObject({ code: "CORE_FAILED" });
});
