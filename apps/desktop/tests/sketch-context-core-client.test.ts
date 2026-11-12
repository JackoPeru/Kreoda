import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CommandType, FrameDecoder, PROTOCOL_VERSION, type SketchModel } from "@kreoda/protocol";
import { coreClient, type SketchCommandContext } from "../src/ipc/coreClient";
import { useDocumentUiStore } from "../src/stores";

const documentId = "sketch-context-doc";
const sessionId = "550e8400-e29b-41d4-a716-446655440000";
const model: SketchModel = { points: [], lines: [], circles: [], arcs: [], constraints: [] };

type WireEnvelope = Record<string, unknown> & { type: number; requestId: string; documentId: string };
type WindowKreoda = { invoke: (payload: string) => Promise<string>; sessionSnapshot: () => Promise<unknown> };

function encodePayload(body: Record<string, unknown>): string {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(""));
}

function decodeFrame(payload: string): WireEnvelope {
  const bytes = Uint8Array.from(atob(payload), char => char.charCodeAt(0));
  const [content] = new FrameDecoder().push(bytes);
  if (!content) throw new Error("missing framed request");
  return JSON.parse(new TextDecoder().decode(content)) as WireEnvelope;
}

function sketchReply(request: WireEnvelope, revision: number, undos = 3): Record<string, unknown> {
  return {
    protocolVersion: PROTOCOL_VERSION,
    requestId: request.requestId,
    status: "ok",
    featureId: "sketch-1",
    type: "Sketch",
    planeKind: "XY",
    revision,
    sketch: { model: request.model ?? model, projectionGroups: [] },
    undos,
    redos: 0,
  };
}

let targetWindow: { kreoda?: WindowKreoda };
let originalKreoda: WindowKreoda | undefined;
let lineage: { sessionId: string; documentId: string; revision: number };

beforeEach(() => {
  targetWindow = window as unknown as { kreoda?: WindowKreoda };
  originalKreoda = targetWindow.kreoda;
  lineage = { sessionId, documentId, revision: 7 };
  useDocumentUiStore.getState().resetDocument(documentId);
  useDocumentUiStore.getState().setCoreStatus(true, "test-core");
  useDocumentUiStore.setState({ revision: 7, undos: 0, redos: 0 });
  coreClient.documentId = documentId;
});

afterEach(() => {
  if (originalKreoda) targetWindow.kreoda = originalKreoda;
  else delete targetWindow.kreoda;
  vi.restoreAllMocks();
});

it("sends sketch reads and commits as framed, document-scoped CAS requests", async () => {
  const requests: WireEnvelope[] = [];
  targetWindow.kreoda = {
    sessionSnapshot: vi.fn(async () => ({ ...lineage })),
    invoke: vi.fn(async payload => {
      const request = decodeFrame(payload);
      requests.push(request);
      const responseRevision = request.type === CommandType.UpdateSketch && request.isPreview !== true ? 8 : 7;
      if (responseRevision === 8) lineage.revision = 8;
      return encodePayload(sketchReply(request, responseRevision));
    }),
  };

  const context = await coreClient.captureSketchContext();
  const loaded = await coreClient.requestSketch("sketch-1", context);
  const committed = await coreClient.updateSketch({ featureId: "sketch-1", model }, context);

  expect(loaded.revision).toBe(7);
  expect(committed.context).toEqual({ ...context, revision: 8 });
  expect(requests).toHaveLength(2);
  expect(requests[0]).toMatchObject({
    type: CommandType.RequestSketch,
    documentId,
    featureId: "sketch-1",
    expectedRevision: 7,
    expectedSessionId: sessionId,
  });
  expect(requests[1]).toMatchObject({
    type: CommandType.UpdateSketch,
    documentId,
    featureId: "sketch-1",
    model,
    expectedRevision: 7,
    expectedSessionId: sessionId,
  });
});

it("accepts a successful commit after its own revision event reaches the renderer first", async () => {
  let resolveInvoke!: (payload: string) => void;
  const invoke = vi.fn((payload: string) => new Promise<string>(resolve => { resolveInvoke = () => {
    const request = decodeFrame(payload);
    resolve(encodePayload(sketchReply(request, 8, 4)));
  }; }));
  targetWindow.kreoda = {
    sessionSnapshot: vi.fn(async () => ({ ...lineage })),
    invoke,
  };
  const context = await coreClient.captureSketchContext();
  const pending = coreClient.updateSketch({ featureId: "sketch-1", model }, context);
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());

  lineage = { ...lineage, revision: 8 };
  useDocumentUiStore.setState({ revision: 8 });
  resolveInvoke("");

  await expect(pending).resolves.toMatchObject({ revision: 8, context: { ...context, revision: 8 } });
  expect(useDocumentUiStore.getState()).toMatchObject({ undos: 4, redos: 0 });
});

it("rejects a commit response when a newer external revision reaches the renderer", async () => {
  let resolveInvoke!: (payload: string) => void;
  const invoke = vi.fn((payload: string) => new Promise<string>(resolve => { resolveInvoke = () => {
    const request = decodeFrame(payload);
    resolve(encodePayload(sketchReply(request, 9, 99)));
  }; }));
  targetWindow.kreoda = {
    sessionSnapshot: vi.fn(async () => ({ ...lineage })),
    invoke,
  };
  const context = await coreClient.captureSketchContext();
  const setUndoDepth = vi.spyOn(useDocumentUiStore.getState(), "setUndoDepth");
  const pending = coreClient.updateSketch({ featureId: "sketch-1", model }, context);
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
  lineage = { ...lineage, revision: 9 };
  useDocumentUiStore.setState({ revision: 9 });
  resolveInvoke("");

  await expect(pending).rejects.toThrow(/stale/i);
  expect(setUndoDepth).not.toHaveBeenCalled();
  expect(useDocumentUiStore.getState().undos).toBe(0);
});

it("rechecks sketch context after async validation before publishing Undo depth", async () => {
  targetWindow.kreoda = {
    sessionSnapshot: vi.fn(async () => ({ ...lineage })),
    invoke: vi.fn(async payload => {
      const request = decodeFrame(payload);
      return encodePayload(sketchReply(request, 7, 99));
    }),
  };
  const context = await coreClient.captureSketchContext();
  const validatorTarget = coreClient as unknown as {
    validateSketchResponse: (
      context: SketchCommandContext,
      response: Record<string, unknown>,
      expectedRevision: number,
      allowSingleRevisionAdvance?: boolean,
    ) => Promise<SketchCommandContext>;
  };
  const originalValidate = validatorTarget.validateSketchResponse.bind(coreClient);
  vi.spyOn(validatorTarget, "validateSketchResponse").mockImplementation(async (...args) => {
    const accepted = await originalValidate(...args);
    queueMicrotask(() => useDocumentUiStore.setState({ revision: 8 }));
    return accepted;
  });
  const setUndoDepth = vi.spyOn(useDocumentUiStore.getState(), "setUndoDepth");

  await expect(coreClient.requestSketch("sketch-1", context)).rejects.toThrow(/stale/i);
  expect(setUndoDepth).not.toHaveBeenCalled();
  expect(useDocumentUiStore.getState().undos).toBe(0);
});

it("rejects a delayed sketch response before it can change Undo depth", async () => {
  let resolveInvoke!: (payload: string) => void;
  const invoke = vi.fn((payload: string) => new Promise<string>(resolve => { resolveInvoke = () => {
    const request = decodeFrame(payload);
    resolve(encodePayload(sketchReply(request, 7, 99)));
  }; }));
  targetWindow.kreoda = {
    sessionSnapshot: vi.fn(async () => ({ ...lineage })),
    invoke,
  };
  const context = await coreClient.captureSketchContext();
  const setUndoDepth = vi.spyOn(useDocumentUiStore.getState(), "setUndoDepth");
  const pending = coreClient.requestSketch("sketch-1", context);
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
  useDocumentUiStore.setState({ revision: 8 });
  resolveInvoke("");

  await expect(pending).rejects.toThrow(/stale/i);
  expect(setUndoDepth).not.toHaveBeenCalled();
  expect(useDocumentUiStore.getState().undos).toBe(0);
});

it("rejects a response from a replaced session before it can change Undo depth", async () => {
  let resolveInvoke!: (payload: string) => void;
  const invoke = vi.fn((payload: string) => new Promise<string>(resolve => { resolveInvoke = () => {
    const request = decodeFrame(payload);
    resolve(encodePayload(sketchReply(request, 7, 99)));
  }; }));
  targetWindow.kreoda = {
    sessionSnapshot: vi.fn(async () => ({ ...lineage })),
    invoke,
  };
  const context = await coreClient.captureSketchContext();
  const setUndoDepth = vi.spyOn(useDocumentUiStore.getState(), "setUndoDepth");
  const pending = coreClient.requestSketch("sketch-1", context);
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
  lineage = { ...lineage, sessionId: "650e8400-e29b-41d4-a716-446655440000" };
  resolveInvoke("");

  await expect(pending).rejects.toThrow(/lineage/i);
  expect(setUndoDepth).not.toHaveBeenCalled();
  expect(useDocumentUiStore.getState().undos).toBe(0);
});

it("does not dispatch a captured context after its session has been replaced", async () => {
  const invoke = vi.fn(async payload => {
    const request = decodeFrame(payload);
    return encodePayload(sketchReply(request, 7));
  });
  targetWindow.kreoda = {
    sessionSnapshot: vi.fn(async () => ({ ...lineage })),
    invoke,
  };
  const context = await coreClient.captureSketchContext();
  lineage = { ...lineage, sessionId: "650e8400-e29b-41d4-a716-446655440000" };

  await expect(coreClient.requestSketch("sketch-1", context)).rejects.toThrow(/lineage/i);
  expect(invoke).not.toHaveBeenCalled();
});
