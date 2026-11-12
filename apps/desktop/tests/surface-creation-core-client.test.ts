import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CommandType, PROTOCOL_VERSION } from "@kreoda/protocol";
import { coreClient } from "../src/ipc/coreClient";
import { useDocumentUiStore } from "../src/stores";

type SurfaceCommandId =
  | "CreateSurfaceExtrude"
  | "CreateSurfaceRevolve"
  | "CreateSurfaceLoft"
  | "CreateSurfaceSew"
  | "CreateSurfaceOffset"
  | "CreateSurfaceSweep"
  | "CreateSurfaceThicken";

type SurfaceContext = {
  documentId: string;
  revision: number;
  epoch: number;
  connectionGeneration: number;
};

const context = (): SurfaceContext => {
  const state = useDocumentUiStore.getState();
  return {
    documentId: state.documentId,
    revision: state.revision,
    epoch: state.epoch,
    connectionGeneration: state.connectionGeneration,
  };
};

const createSurface = (coreClient as unknown as {
  createSurface: (
    commandId: SurfaceCommandId,
    parameters: Record<string, unknown>,
    context: SurfaceContext,
  ) => Promise<{ featureId: string; type: string; revision: number }>;
}).createSurface.bind(coreClient);

function reply(featureId: string, extra: Record<string, unknown> = {}): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    protocolVersion: PROTOCOL_VERSION,
    requestId: "surface-reply",
    status: "ok",
    featureId,
    type: "SurfaceExtrude",
    paramsMm: [],
    dependsOn: [],
    refExtra: "",
    expressions: {},
    bboxMm: [0, 0, 0, 1, 1, 1],
    revision: 2,
    ...extra,
  }));
}

const cases: [SurfaceCommandId, number, Record<string, unknown>][] = [
  ["CreateSurfaceExtrude", CommandType.CreateSurfaceExtrude, { sketchId: "sk-a", distanceMm: 10 }],
  ["CreateSurfaceRevolve", CommandType.CreateSurfaceRevolve, {
    sketchId: "sk-a", angleDeg: 90, axisOriginXMm: 1, axisOriginYMm: 2, axisOriginZMm: 3,
    axisX: 0, axisY: 1, axisZ: 0,
  }],
  ["CreateSurfaceLoft", CommandType.CreateSurfaceLoft, { sketchIds: ["sk-a", "sk-b"] }],
  ["CreateSurfaceSew", CommandType.CreateSurfaceSew, { featureIds: ["sf-a", "sf-b"], toleranceMm: 0.01, makeSolid: false }],
  ["CreateSurfaceOffset", CommandType.CreateSurfaceOffset, { targetId: "sf-a", distanceMm: -1, toleranceMm: 0.000001 }],
  ["CreateSurfaceThicken", CommandType.CreateSurfaceThicken, { targetId: "sf-a", thicknessMm: -2, toleranceMm: 0.000001 }],
  ["CreateSurfaceSweep", CommandType.CreateSurfaceSweep, {
    profileSketchId: "sk-a", pathSketchId: "sk-b", toleranceMm: 0.000001,
  }],
];

beforeEach(() => {
  useDocumentUiStore.getState().resetDocument("surface-doc");
  useDocumentUiStore.getState().setCoreStatus(true, "test");
  coreClient.documentId = "surface-doc";
});

afterEach(() => vi.restoreAllMocks());

it.each(cases)("sends %s through its registered native command and allocates one feature id", async (id, nativeType, parameters) => {
  const randomUUID = vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000001");
  const roundTrip = vi.spyOn(coreClient as unknown as {
    roundTrip: (envelope: unknown) => Promise<Uint8Array>;
  }, "roundTrip").mockImplementation(async (envelope) => {
    const request = envelope as Record<string, unknown>;
    return reply(String(request.featureId));
  });

  const created = await createSurface(id, parameters, context());

  expect(randomUUID).toHaveBeenCalledOnce();
  expect(created.featureId).toBe("surface-00000000-0000-4000-8000-000000000001");
  expect(roundTrip).toHaveBeenCalledOnce();
  expect(roundTrip.mock.calls[0]?.[0]).toMatchObject({
    documentId: "surface-doc",
    type: nativeType,
    featureId: "surface-00000000-0000-4000-8000-000000000001",
    ...parameters,
  });
});

it("rejects non-surface commands and invalid parameters before IPC", async () => {
  const randomUUID = vi.spyOn(crypto, "randomUUID");
  const roundTrip = vi.spyOn(coreClient as unknown as {
    roundTrip: (envelope: unknown) => Promise<Uint8Array>;
  }, "roundTrip");

  await expect(createSurface("CreateBox" as SurfaceCommandId, {}, context())).rejects.toThrow();
  expect(randomUUID).not.toHaveBeenCalled();
  await expect(createSurface("CreateSurfaceExtrude", { sketchId: "sk-a", distanceMm: 0 }, context())).rejects.toThrow();

  expect(randomUUID).toHaveBeenCalledOnce();
  expect(roundTrip).not.toHaveBeenCalled();
});

it("ignores stale native replies before changing undo depth", async () => {
  const roundTrip = vi.spyOn(coreClient as unknown as {
    roundTrip: (envelope: unknown) => Promise<Uint8Array>;
  }, "roundTrip");
  let resolveReply!: (value: Uint8Array) => void;
  roundTrip.mockReturnValue(new Promise(resolve => { resolveReply = resolve; }));
  const setUndoDepth = vi.spyOn(useDocumentUiStore.getState(), "setUndoDepth");
  const captured = context();

  const pending = createSurface("CreateSurfaceExtrude", { sketchId: "sk-a", distanceMm: 10 }, captured);
  useDocumentUiStore.getState().resetDocument("replacement-doc");
  resolveReply(reply("surface-created", { undos: 11, redos: 0 }));

  await expect(pending).rejects.toThrow(/stale/i);
  expect(setUndoDepth).not.toHaveBeenCalled();
  expect(useDocumentUiStore.getState().undos).toBe(0);
});
