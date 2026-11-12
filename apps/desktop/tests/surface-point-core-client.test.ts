import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CommandType, PROTOCOL_VERSION, type SurfacePointResolveRequest, type SurfacePointResolveResult } from "@kreoda/protocol";
import { coreClient } from "../src/ipc/coreClient";
import { useDocumentUiStore } from "../src/stores";
import type { SurfaceCommandContext } from "../src/commands/surface-commands";

const sessionId = "550e8400-e29b-41d4-a716-446655440000";
const request: SurfacePointResolveRequest = { targetId: "surface-a", pointMm: [1, 2, 3], persistentFaceId: "face.0", maxDistanceMm: 0.05 };
const resolved: SurfacePointResolveResult = {
  keepFace: { type: "face", featureId: "surface-a", persistentFaceId: "surface-a:face.0" },
  keepUv: [0.25, 0.75], pointMm: [1, 2, 3], projectionDistanceMm: 0.04,
};
const trimParameters = {
  targetId: "surface-a", toolId: "cutter",
  keepFace: { type: "face" as const, featureId: "surface-a", persistentFaceId: "surface-a:face.0" },
  keepUv: [0.25, 0.75],
};

function context(): SurfaceCommandContext {
  const state = useDocumentUiStore.getState();
  return { documentId: state.documentId, revision: state.revision, epoch: state.epoch,
    connectionGeneration: state.connectionGeneration };
}

function reply(result: unknown, extra: Record<string, unknown> = {}): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, requestId: "surface-point",
    status: "ok", sessionId, documentId: "surface-doc", revision: 7, result, ...extra }));
}

function createdReply(featureId: string): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, requestId: "surface-created",
    status: "ok", featureId, type: "SurfaceTrim", paramsMm: [], dependsOn: ["surface-a", "cutter"],
    refExtra: "", expressions: {}, bboxMm: [0, 0, 0, 1, 1, 0], revision: 8 }));
}

const resolveSurfacePoint = (coreClient as unknown as {
  resolveSurfacePoint: (request: SurfacePointResolveRequest, context: SurfaceCommandContext) => Promise<{
    result: SurfacePointResolveResult; context: SurfaceCommandContext & { sessionId: string };
  }>;
}).resolveSurfacePoint;
const createSurface = (coreClient as unknown as {
  createSurface: (id: string, parameters: Record<string, unknown>, context: SurfaceCommandContext) => Promise<{ featureId: string; revision: number }>;
}).createSurface;

beforeEach(() => {
  useDocumentUiStore.getState().resetDocument("surface-doc");
  useDocumentUiStore.getState().setCoreStatus(true, "test");
  useDocumentUiStore.setState({ revision: 7 });
  coreClient.documentId = "surface-doc";
});

afterEach(() => vi.restoreAllMocks());

it("sends the strict point query under its captured revision and returns the acquired session context", async () => {
  expect(resolveSurfacePoint).toEqual(expect.any(Function));
  const roundTrip = vi.spyOn(coreClient as unknown as {
    roundTrip: (envelope: unknown) => Promise<Uint8Array>;
  }, "roundTrip").mockImplementation(async envelope => {
    const requestEnvelope = envelope as Record<string, unknown>;
    return requestEnvelope.type === CommandType.RequestSessionQuery ? reply(resolved) : createdReply(String(requestEnvelope.featureId));
  });
  const captured = context();

  const acquired = await resolveSurfacePoint!.call(coreClient, request, captured);
  const created = await createSurface!.call(coreClient, "CreateSurfaceTrim", trimParameters, acquired.context);

  expect(roundTrip).toHaveBeenCalledTimes(2);
  expect(roundTrip.mock.calls[0]?.[0]).toMatchObject({ documentId: "surface-doc", type: CommandType.RequestSessionQuery,
    method: "resolveSurfacePoint", params: request, expectedRevision: 7 });
  expect(acquired).toEqual({ result: resolved, context: { ...captured, sessionId } });
  expect(created.revision).toBe(8);
  expect(roundTrip.mock.calls[1]?.[0]).toMatchObject({ documentId: "surface-doc", type: CommandType.CreateSurfaceTrim,
    targetId: "surface-a", toolId: "cutter", expectedRevision: 7, expectedSessionId: sessionId });
});

it("rejects a point result owned by another surface or beyond the requested tolerance", async () => {
  expect(resolveSurfacePoint).toEqual(expect.any(Function));
  const roundTrip = vi.spyOn(coreClient as unknown as {
    roundTrip: (envelope: unknown) => Promise<Uint8Array>;
  }, "roundTrip");
  roundTrip.mockResolvedValueOnce(reply({ ...resolved, keepFace: { ...resolved.keepFace, featureId: "other" } },
    { undos: 9, redos: 2 }));
  const setUndoDepth = vi.spyOn(useDocumentUiStore.getState(), "setUndoDepth");
  await expect(resolveSurfacePoint!.call(coreClient, request, context())).rejects.toThrow();
  expect(setUndoDepth).not.toHaveBeenCalled();

  roundTrip.mockResolvedValueOnce(reply({ ...resolved, projectionDistanceMm: 0.06 }));
  await expect(resolveSurfacePoint!.call(coreClient, request, context())).rejects.toThrow();

  roundTrip.mockResolvedValueOnce(reply({ ...resolved,
    keepFace: { ...resolved.keepFace, persistentFaceId: "surface-a:face.1" } }));
  await expect(resolveSurfacePoint!.call(coreClient, request, context())).rejects.toThrow();
});

it("rejects a foreign face hint before IPC", async () => {
  expect(resolveSurfacePoint).toEqual(expect.any(Function));
  const roundTrip = vi.spyOn(coreClient as unknown as {
    roundTrip: (envelope: unknown) => Promise<Uint8Array>;
  }, "roundTrip");
  await expect(resolveSurfacePoint!.call(coreClient, { ...request, persistentFaceId: "other:face.0" }, context())).rejects.toThrow();
  expect(roundTrip).not.toHaveBeenCalled();
});

it("drops a point result when the captured document revision changes while the query is pending", async () => {
  expect(resolveSurfacePoint).toEqual(expect.any(Function));
  const roundTrip = vi.spyOn(coreClient as unknown as {
    roundTrip: (envelope: unknown) => Promise<Uint8Array>;
  }, "roundTrip");
  let resolveReply!: (value: Uint8Array) => void;
  roundTrip.mockReturnValue(new Promise(resolve => { resolveReply = resolve; }));
  const setUndoDepth = vi.spyOn(useDocumentUiStore.getState(), "setUndoDepth");
  const pending = resolveSurfacePoint!.call(coreClient, request, context());
  useDocumentUiStore.setState({ revision: 8 });
  resolveReply(reply(resolved, { undos: 11, redos: 0 }));

  await expect(pending).rejects.toThrow(/stale/i);
  expect(setUndoDepth).not.toHaveBeenCalled();
  expect(useDocumentUiStore.getState().undos).toBe(0);
});
